/**
 * CambioTurnoModal — procedura guidata (wizard) per richiedere un cambio
 * turno dalla pagina pubblica.
 *
 * Flusso a step:
 *   1. 'change' (tuo)     → quale turno/giorno vuoi cambiare e come diventa
 *                           (selezionando turnista+giorno mostra il turno attuale)
 *   2. 'involves'         → "Il cambio coinvolge un altro collega?" No / Sì
 *        - No  → 'confirm'
 *        - Sì  → 'change' (collega)
 *   3. 'change' (collega) → dati e turno dell'altro collega → Continua
 *   4. 'more'             → "Ci sono altri cambi?" No / Sì
 *        - No  → 'confirm'
 *        - Sì  → riparte da 'change' (tuo)
 *   5. 'confirm'          → "Confermi?" + riepilogo → invia la richiesta
 *
 * La richiesta finisce in stato 'pending' in `cambi_turno`; l'admin la
 * approva/rifiuta in /admin/cambi. Il medico sceglie SOLO il nuovo TC
 * (M/P/L/REP); TR e SUB/MED li sistema l'admin in fase di approvazione.
 */

import { useState, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { X, ArrowRight, AlertTriangle, Send, ChevronLeft, Users, Check } from 'lucide-react'
import { supabase } from '../lib/supabase'
import type {
  Medico, Turno, ColonnaCal, TurnoClinico, TurnoRicerca,
  SlotPlacement, ModificaCambio,
} from '../types'

interface Props {
  /** Medico associato all'utente loggato (richiedente). */
  medicoRichiedente: Medico
  /** Tutti i medici (per il select del medico target di ogni cambio). */
  medici:            Medico[]
  /** Tutti i turni del periodo corrente (per leggere "DA"). */
  turni:             Turno[]
  /** Tutte le colonne (giorni) del periodo, per validazione data. */
  colonne:           ColonnaCal[]
  onClose:           () => void
  /** Chiamata dopo submit riuscita. */
  onSuccess?:        () => void
}

type Role = 'tuo' | 'collega'
type Step = 'change' | 'involves' | 'more' | 'confirm'

interface Draft { medico_id: string; data: string; tc_a: TurnoClinico }
interface Entry extends Draft { role: Role }

/** Trova il turno corrente di (medico, data) nei turni passati. */
function findTurnoCorrente(turni: Turno[], medicoId: string, data: string) {
  const t = turni.find(t => t.medico_id === medicoId && t.data === data)
  return t
    ? { tc: t.turno_clinico, tr: t.turno_ricerca, slot_mattina: t.slot_mattina, slot_pomeriggio: t.slot_pomeriggio }
    : { tc: '' as TurnoClinico, tr: '' as TurnoRicerca, slot_mattina: null as SlotPlacement, slot_pomeriggio: null as SlotPlacement }
}

/** Normalizza gli slot in base al TC scelto (eligibilita` mattina/pomeriggio). */
function normalizzaSlot(tc: TurnoClinico, sm: SlotPlacement, sp: SlotPlacement): {
  slot_mattina: SlotPlacement; slot_pomeriggio: SlotPlacement
} {
  if (tc === 'M' || tc === 'EM') return { slot_mattina: sm, slot_pomeriggio: null }
  if (tc === 'P' || tc === 'EP') return { slot_mattina: null, slot_pomeriggio: sp }
  if (tc === 'L' || tc === 'EL') return { slot_mattina: sm, slot_pomeriggio: sp }
  return { slot_mattina: null, slot_pomeriggio: null }
}

/** TC + TR + slot in stringa compatta per la visualizzazione. */
function fmtCella(c: { tc: TurnoClinico; tr: TurnoRicerca; slot_mattina: SlotPlacement; slot_pomeriggio: SlotPlacement }): string {
  if (!c.tc && !c.tr) return '—'
  const parts: string[] = []
  if (c.tc) parts.push(c.tc)
  if (c.tr) parts.push(`+${c.tr}`)
  const slot: string[] = []
  if (c.slot_mattina)    slot.push(c.slot_mattina)
  if (c.slot_pomeriggio && c.slot_pomeriggio !== c.slot_mattina) slot.push(c.slot_pomeriggio)
  if (slot.length) parts.push(` (${slot.join('|')})`)
  return parts.join('')
}

/** Data ISO → "dd/mm". */
function fmtDataBreve(iso: string): string {
  const [, m, d] = iso.split('-')
  return d && m ? `${d}/${m}` : iso
}

export function CambioTurnoModal({
  medicoRichiedente, medici, turni, colonne, onClose, onSuccess,
}: Props) {
  const qc = useQueryClient()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [motivo, setMotivo] = useState('')

  // Vincoli date
  const minDate = colonne[0]?.data ?? ''
  const maxDate = colonne[colonne.length - 1]?.data ?? ''
  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const defaultDate = today >= minDate && today <= maxDate ? today : (minDate || '')

  const mediciOrd = useMemo(
    () => [...medici].sort((a, b) => a.nome.localeCompare(b.nome, 'it', { sensitivity: 'base' })),
    [medici]
  )
  const nomeById = useMemo(() => {
    const m = new Map<string, string>()
    for (const x of medici) m.set(x.id, x.nome)
    return m
  }, [medici])
  const primoCollega = useMemo(
    () => mediciOrd.find(m => m.id !== medicoRichiedente.id)?.id ?? medicoRichiedente.id,
    [mediciOrd, medicoRichiedente.id]
  )

  /** Draft iniziale per un ruolo: turnista di default + giorno + TC attuale. */
  function makeDraft(r: Role, lastData?: string): Draft {
    const data = lastData ?? defaultDate
    const medico_id = r === 'tuo' ? medicoRichiedente.id : primoCollega
    return { medico_id, data, tc_a: findTurnoCorrente(turni, medico_id, data).tc }
  }

  const [step, setStep]       = useState<Step>('change')
  const [role, setRole]       = useState<Role>('tuo')
  const [draft, setDraft]     = useState<Draft>(() => makeDraft('tuo'))
  const [entries, setEntries] = useState<Entry[]>([])
  const [confirmFrom, setConfirmFrom] = useState<'involves' | 'more'>('involves')

  /** Aggiorna il draft; cambiando medico/data riallinea il TC "diventa"
   *  al turno attuale (utile come punto di partenza). */
  function patchDraft(patch: Partial<Draft>) {
    setDraft(prev => {
      const next = { ...prev, ...patch }
      if (patch.medico_id !== undefined || patch.data !== undefined) {
        next.tc_a = findTurnoCorrente(turni, next.medico_id, next.data).tc
      }
      return next
    })
  }

  function validateDraft(): string | null {
    if (!draft.medico_id) return 'Seleziona un turnista.'
    if (!draft.data) return 'Imposta una data.'
    if (draft.data < minDate || draft.data > maxDate) return 'La data non rientra nel periodo del calendario.'
    const cur = findTurnoCorrente(turni, draft.medico_id, draft.data)
    if (draft.tc_a === cur.tc) return 'Il nuovo turno coincide con quello attuale: scegline uno diverso.'
    return null
  }

  // ── Navigazione step ──────────────────────────────────────────────
  function onContinua() {
    const err = validateDraft()
    if (err) { setError(err); return }
    setError(null)
    setEntries(prev => [...prev, { ...draft, role }])
    setStep(role === 'tuo' ? 'involves' : 'more')
  }

  function onInvolves(yes: boolean) {
    if (yes) {
      setRole('collega')
      setDraft(makeDraft('collega', draft.data))  // stesso giorno per comodita`
      setError(null)
      setStep('change')
    } else {
      setConfirmFrom('involves')
      setStep('confirm')
    }
  }

  function onMore(yes: boolean) {
    if (yes) {
      setRole('tuo')
      setDraft(makeDraft('tuo', draft.data))
      setError(null)
      setStep('change')
    } else {
      setConfirmFrom('more')
      setStep('confirm')
    }
  }

  /** Torna a modificare l'ultimo cambio inserito (lo riapre nel form). */
  function backToEditLast() {
    setEntries(prev => {
      const last = prev[prev.length - 1]
      if (last) {
        setRole(last.role)
        setDraft({ medico_id: last.medico_id, data: last.data, tc_a: last.tc_a })
      }
      return prev.slice(0, -1)
    })
    setError(null)
    setStep('change')
  }

  function buildModifica(e: Entry): ModificaCambio {
    const da = findTurnoCorrente(turni, e.medico_id, e.data)
    const slotA = normalizzaSlot(e.tc_a, da.slot_mattina, da.slot_pomeriggio)
    return {
      medico_id: e.medico_id,
      data:      e.data,
      da: { tc: da.tc, tr: da.tr, slot_mattina: da.slot_mattina, slot_pomeriggio: da.slot_pomeriggio },
      a:  { tc: e.tc_a, tr: da.tr, slot_mattina: slotA.slot_mattina, slot_pomeriggio: slotA.slot_pomeriggio },
    }
  }

  async function handleSubmit() {
    if (entries.length === 0) { setError('Nessun cambio inserito.'); return }
    setError(null)
    const modifiche = entries.map(buildModifica)

    setSubmitting(true)
    try {
      const { error: insErr } = await supabase.from('cambi_turno').insert({
        medico_richiedente_id: medicoRichiedente.id,
        reparto_id: medicoRichiedente.reparto_id,
        modifiche,
        motivo: motivo.trim() || null,
        stato:  'pending',
      })
      if (insErr) throw insErr

      const nMod = modifiche.length
      const { error: notifErr } = await supabase.from('messaggi').insert({
        medico_id:          null,
        destinatario_ruolo: 'admin',
        tipo:               'cambio_richiesto',
        titolo:             `Richiesta cambio turno da ${medicoRichiedente.nome}`,
        corpo:              `${medicoRichiedente.nome} ha proposto ${nMod} cambi${nMod === 1 ? 'o' : ''} turno${motivo.trim() ? ` (motivo: ${motivo.trim()})` : ''}. Vai in Admin → Gestione Cambi per approvare o rifiutare.`,
      })
      if (notifErr) console.warn('[cambio-turno] notifica admin fallita:', notifErr.message)

      qc.invalidateQueries({ queryKey: ['cambi-turno'] })
      qc.invalidateQueries({ queryKey: ['cambi-turno-pending-count'] })
      onSuccess?.()
      onClose()
    } catch (e) {
      setError('Errore invio richiesta: ' + (e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  // ── Recap dei cambi gia` inseriti ─────────────────────────────────
  const recap = (compact = false) => {
    if (entries.length === 0) return null
    return (
      <div className={compact ? 'mt-3' : ''}>
        <div className="text-[11px] font-bold uppercase tracking-wider text-stone-500 mb-1.5">
          Cambi inseriti ({entries.length})
        </div>
        <div className="space-y-1.5">
          {entries.map((e, i) => {
            const da = findTurnoCorrente(turni, e.medico_id, e.data)
            const a  = { tc: e.tc_a, tr: da.tr, ...normalizzaSlot(e.tc_a, da.slot_mattina, da.slot_pomeriggio) }
            return (
              <div key={i} className="flex items-center gap-1.5 text-xs flex-wrap rounded-lg px-2.5 py-1.5"
                style={{ background: '#f6f5f1', border: '1px solid #e7e5e4' }}>
                <span className="font-semibold text-stone-700">{nomeById.get(e.medico_id) ?? '?'}</span>
                <span className="font-mono text-stone-500">{fmtDataBreve(e.data)}</span>
                <span className="font-mono px-1 rounded bg-white border border-stone-200">{fmtCella(da)}</span>
                <ArrowRight size={11} style={{ color: '#476540' }} />
                <span className="font-mono px-1 rounded bg-white border border-stone-300 font-semibold">{fmtCella(a)}</span>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  // ── Form di un cambio (riusato per "tuo" e "collega") ─────────────
  const da = findTurnoCorrente(turni, draft.medico_id, draft.data)
  const renderChangeForm = () => (
    <>
      <p className="text-sm font-semibold text-stone-800">
        {role === 'tuo' ? 'Il tuo cambio turno' : 'Il cambio turno del collega'}
      </p>
      <p className="text-xs text-stone-500 mt-0.5 mb-3">
        Scegli turnista e giorno: ti mostro il turno attuale, poi indica come deve diventare.
      </p>

      <div className="grid grid-cols-2 gap-2 mb-3">
        <label className="text-xs">
          <span className="block text-stone-600 mb-0.5">Turnista</span>
          <select value={draft.medico_id}
            onChange={e => patchDraft({ medico_id: e.target.value })}
            className="w-full px-2 py-2 rounded border border-stone-300 text-xs">
            {mediciOrd.map(m => <option key={m.id} value={m.id}>{m.nome}</option>)}
          </select>
        </label>
        <label className="text-xs">
          <span className="block text-stone-600 mb-0.5">Giorno</span>
          <input type="date" value={draft.data} min={minDate} max={maxDate}
            onChange={e => patchDraft({ data: e.target.value })}
            className="w-full px-2 py-2 rounded border border-stone-300 text-xs" />
        </label>
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
        <div>
          <span className="block text-xs text-stone-600 mb-0.5">Turno attuale</span>
          <div className="px-2 py-2 rounded bg-stone-50 border border-stone-200 text-sm font-mono text-stone-700 text-center">
            {fmtCella(da)}
          </div>
        </div>
        <ArrowRight size={18} style={{ color: '#476540' }} className="mb-2" />
        <div>
          <span className="block text-xs text-stone-600 mb-0.5">Diventa</span>
          <select value={draft.tc_a}
            onChange={e => patchDraft({ tc_a: e.target.value as TurnoClinico })}
            className="w-full px-2 py-2 rounded border border-stone-300 text-sm font-semibold">
            <option value="">— vuoto (nessun turno)</option>
            <option value="M">M (mattina)</option>
            <option value="P">P (pomeriggio)</option>
            <option value="L">L (lunga)</option>
            <option value="REP">REP (reperibilità)</option>
          </select>
        </div>
      </div>

      {recap(true)}
    </>
  )

  // ── Step "domanda" (Sì/No) ────────────────────────────────────────
  const renderQuestion = (
    icon: React.ReactNode, titolo: string, sub: string,
    onNo: () => void, onYes: () => void,
  ) => (
    <div className="text-center py-2">
      <div className="flex justify-center mb-3">{icon}</div>
      <p className="text-base font-bold text-stone-800">{titolo}</p>
      <p className="text-xs text-stone-500 mt-1 max-w-sm mx-auto">{sub}</p>
      <div className="flex items-center justify-center gap-3 mt-5">
        <button onClick={onNo}
          className="px-6 py-2.5 rounded-lg text-sm font-bold border-2 transition-colors"
          style={{ borderColor: '#d5ccb8', color: '#5a5a4a', background: '#faf8f3' }}>
          No
        </button>
        <button onClick={onYes}
          className="px-6 py-2.5 rounded-lg text-sm font-bold text-white shadow-sm transition-colors"
          style={{ background: '#476540' }}>
          Sì
        </button>
      </div>
      {recap(true) && <div className="mt-5 text-left">{recap(true)}</div>}
    </div>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3"
      style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(2px)' }}
      onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl flex flex-col w-full"
        style={{ maxWidth: 'min(94vw, 560px)', maxHeight: 'min(88dvh, 720px)' }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-stone-200 shrink-0">
          <h3 className="font-bold text-stone-800 text-base flex items-center gap-2">
            <Send size={18} style={{ color: '#476540' }} />
            Richiesta cambio turno
          </h3>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-600 transition-colors p-1">
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-auto p-5 flex-1">
          {step === 'change'   && renderChangeForm()}

          {step === 'involves' && renderQuestion(
            <Users size={30} style={{ color: '#476540' }} />,
            'Il cambio coinvolge un altro collega?',
            'Es: tu cedi il turno e un collega lo prende al posto tuo. Se sì, lo aggiungeremo adesso.',
            () => onInvolves(false), () => onInvolves(true),
          )}

          {step === 'more' && renderQuestion(
            <Send size={28} style={{ color: '#476540' }} />,
            'Ci sono altri cambi?',
            'Puoi aggiungere un altro scambio (il tuo turno e quello di un collega) alla stessa richiesta.',
            () => onMore(false), () => onMore(true),
          )}

          {step === 'confirm' && (
            <div>
              <div className="flex justify-center mb-3">
                <div className="rounded-full p-2" style={{ background: '#dcfce7' }}>
                  <Check size={26} style={{ color: '#166534' }} />
                </div>
              </div>
              <p className="text-base font-bold text-stone-800 text-center">Confermi la richiesta?</p>
              <p className="text-xs text-stone-500 mt-1 mb-4 text-center">
                Verrà inviata all'admin che potrà approvarla o rifiutarla.
              </p>
              {recap()}
              <label className="block mt-4">
                <span className="block text-xs text-stone-600 mb-1">Nota all'admin (opzionale)</span>
                <textarea value={motivo} onChange={e => setMotivo(e.target.value)} rows={2}
                  placeholder="Es: il collega copre la mia mattina di lunedì"
                  className="w-full px-3 py-2 rounded border border-stone-300 text-xs focus:outline-none focus:ring-2 focus:ring-green-300" />
              </label>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="mt-3 px-3 py-2 rounded-lg text-xs font-medium flex items-start gap-2"
              style={{ background: '#fee2e2', color: '#991b1b' }}>
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-stone-200 flex items-center justify-between gap-2 shrink-0">
          {/* Sinistra: Annulla / Indietro */}
          <div>
            {step === 'change' && (
              <button onClick={onClose}
                className="px-3 py-1.5 rounded text-xs font-semibold border border-stone-300 text-stone-700 hover:bg-stone-50 transition-colors">
                Annulla
              </button>
            )}
            {(step === 'involves' || step === 'more') && (
              <button onClick={backToEditLast}
                className="flex items-center gap-1 px-3 py-1.5 rounded text-xs font-semibold border border-stone-300 text-stone-700 hover:bg-stone-50 transition-colors">
                <ChevronLeft size={13} /> Modifica
              </button>
            )}
            {step === 'confirm' && (
              <button onClick={() => setStep(confirmFrom)}
                className="flex items-center gap-1 px-3 py-1.5 rounded text-xs font-semibold border border-stone-300 text-stone-700 hover:bg-stone-50 transition-colors">
                <ChevronLeft size={13} /> Indietro
              </button>
            )}
          </div>

          {/* Destra: azione principale */}
          <div>
            {step === 'change' && (
              <button onClick={onContinua}
                className="px-4 py-1.5 rounded text-xs font-semibold text-white shadow-sm transition-colors"
                style={{ background: '#476540' }}>
                Continua
              </button>
            )}
            {step === 'confirm' && (
              <button onClick={handleSubmit} disabled={submitting}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded text-xs font-semibold text-white shadow-sm transition-colors"
                style={{ background: '#476540', opacity: submitting ? 0.6 : 1 }}>
                <Send size={13} />
                {submitting ? 'Invio…' : 'Invia richiesta'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
