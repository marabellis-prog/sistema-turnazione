/**
 * CambioTurnoModal
 *
 * Modal usato dai medici turnisti (mode 'self') per richiedere un cambio
 * turno all'admin. Workflow:
 *   1. I medici si mettono d'accordo offline.
 *   2. Uno dei due (il "richiedente") apre il modal e descrive le modifiche
 *      proposte: una o piu` righe { medico, data, DA → A }.
 *   3. Submit → la richiesta finisce in stato 'pending' nella tabella
 *      `cambi_turno`. L'admin la vede in /admin/cambi e approva/rifiuta.
 *   4. In caso di approvazione, l'admin applica AUTOMATICAMENTE le
 *      modifiche al calendario (handler in GestioneCambiPage).
 *
 * UI: il medico sceglie SOLO il nuovo TC (M/P/L/REP). I turni di ricerca
 * (RM/RP) verranno ricalcolati automaticamente in fase di approvazione,
 * e i placement SUB/MED li sistema l'admin a mano in Modifica Turni se
 * serve. Cosi` il modulo resta leggero e l'utente non deve preoccuparsi
 * dei dettagli operativi.
 */

import { useState, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { X, Plus, Trash2, ArrowRight, AlertTriangle, Send } from 'lucide-react'
import { supabase } from '../lib/supabase'
import type {
  Medico, Turno, ColonnaCal, TurnoClinico, TurnoRicerca,
  SlotPlacement, ModificaCambio,
} from '../types'

interface Props {
  /** Medico associato all'utente loggato (richiedente). */
  medicoRichiedente: Medico
  /** Tutti i medici (per il select del medico target di ogni modifica). */
  medici:            Medico[]
  /** Tutti i turni del periodo corrente (per leggere "DA"). */
  turni:             Turno[]
  /** Tutte le colonne (giorni) del periodo, per validazione data. */
  colonne:           ColonnaCal[]
  onClose:           () => void
  /** Chiamata dopo submit riuscita. Il parent puo` invalidare cache /
   *  mostrare un toast. */
  onSuccess?:        () => void
}

// Struttura del form: una row per ogni modifica proposta. Solo TC; TR
// e slot SUB/MED li gestisce l'admin in fase di approvazione/edit.
interface RowEditor {
  medico_id: string
  data:      string             // ISO YYYY-MM-DD
  tc_a:      TurnoClinico       // nuovo TC proposto
}

/** Helper: trova il turno corrente di (medico, data) nei turni passati. */
function findTurnoCorrente(turni: Turno[], medicoId: string, data: string) {
  const t = turni.find(t => t.medico_id === medicoId && t.data === data)
  return t
    ? {
        tc: t.turno_clinico,
        tr: t.turno_ricerca,
        slot_mattina:    t.slot_mattina,
        slot_pomeriggio: t.slot_pomeriggio,
      }
    : {
        tc: '' as TurnoClinico,
        tr: '' as TurnoRicerca,
        slot_mattina:    null as SlotPlacement,
        slot_pomeriggio: null as SlotPlacement,
      }
}

/** Helper: normalizza slot_mattina/pomeriggio in base al TC scelto.
 *  Logica:
 *   - TC=M  o TC=EM → solo mattina rilevante
 *   - TC=P  o TC=EP → solo pomeriggio rilevante
 *   - TC=L  o TC=EL → entrambi rilevanti
 *   - TC=REP o vuoto → entrambi null
 *  Usato al submit per propagare gli slot della "DA" alla "A" filtrando
 *  per eligibilita` del nuovo TC. */
function normalizzaSlot(tc: TurnoClinico, sm: SlotPlacement, sp: SlotPlacement): {
  slot_mattina: SlotPlacement; slot_pomeriggio: SlotPlacement
} {
  if (tc === 'M'  || tc === 'EM') return { slot_mattina: sm, slot_pomeriggio: null }
  if (tc === 'P'  || tc === 'EP') return { slot_mattina: null, slot_pomeriggio: sp }
  if (tc === 'L'  || tc === 'EL') return { slot_mattina: sm, slot_pomeriggio: sp }
  // REP o '' (vuoto): nessuno slot
  return { slot_mattina: null, slot_pomeriggio: null }
}

/** Formatta TC+TR+slot in stringa compatta per la visualizzazione "DA". */
function fmtCella(c: {
  tc: TurnoClinico; tr: TurnoRicerca
  slot_mattina:    SlotPlacement
  slot_pomeriggio: SlotPlacement
}): string {
  if (!c.tc && !c.tr) return '—'
  const parts: string[] = []
  if (c.tc) parts.push(c.tc)
  if (c.tr) parts.push(`+${c.tr}`)
  const slot: string[] = []
  if (c.slot_mattina)    slot.push(c.slot_mattina)
  if (c.slot_pomeriggio && c.slot_pomeriggio !== c.slot_mattina) {
    slot.push(c.slot_pomeriggio)
  }
  if (slot.length) parts.push(` (${slot.join('|')})`)
  return parts.join('')
}

export function CambioTurnoModal({
  medicoRichiedente, medici, turni, colonne, onClose, onSuccess,
}: Props) {
  const qc = useQueryClient()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [motivo, setMotivo] = useState('')

  // Datepicker constraints: prima e ultima data del periodo
  const minDate = colonne[0]?.data ?? ''
  const maxDate = colonne[colonne.length - 1]?.data ?? ''
  // Default: oggi se dentro al range, altrimenti il primo giorno disponibile
  const today = new Date().toISOString().slice(0, 10)
  const defaultDate =
    today >= minDate && today <= maxDate ? today : (minDate || '')

  // Una riga di default: richiedente, oggi (o primo giorno), TC = quello attuale
  const [rows, setRows] = useState<RowEditor[]>(() => {
    const cur = findTurnoCorrente(turni, medicoRichiedente.id, defaultDate)
    return [{
      medico_id: medicoRichiedente.id,
      data:      defaultDate,
      tc_a:      cur.tc,
    }]
  })

  // Medici ordinati alfabeticamente per il select
  const mediciOrd = useMemo(
    () => [...medici].sort((a, b) =>
      a.nome.localeCompare(b.nome, 'it', { sensitivity: 'base' })
    ),
    [medici]
  )

  function setRow(i: number, patch: Partial<RowEditor>) {
    setRows(prev => prev.map((r, idx) => idx === i ? { ...r, ...patch } : r))
  }

  function addRow() {
    setRows(prev => {
      const last = prev[prev.length - 1]
      // Aggiungo una riga vuota con stessa data dell'ultima + medico richiedente
      const cur = findTurnoCorrente(turni, medicoRichiedente.id, last?.data ?? defaultDate)
      return [
        ...prev,
        {
          medico_id: medicoRichiedente.id,
          data:      last?.data ?? defaultDate,
          tc_a:      cur.tc,
        },
      ]
    })
  }

  function removeRow(i: number) {
    setRows(prev => prev.filter((_, idx) => idx !== i))
  }

  /** Quando cambia medico_id o data, ricarico "DA" e auto-popolo "A" col TC corrente. */
  function onMedicoOrDataChange(i: number, patch: Partial<RowEditor>) {
    setRows(prev => prev.map((r, idx) => {
      if (idx !== i) return r
      const next = { ...r, ...patch }
      const cur = findTurnoCorrente(turni, next.medico_id, next.data)
      return { ...next, tc_a: cur.tc }
    }))
  }

  async function handleSubmit() {
    setError(null)
    // Validazione: ogni riga deve avere medico_id + data valida
    for (const r of rows) {
      if (!r.medico_id) { setError('Seleziona un medico per ogni riga.'); return }
      if (!r.data) { setError('Imposta una data per ogni riga.'); return }
      if (r.data < minDate || r.data > maxDate) {
        setError(`La data ${r.data} non rientra nel periodo del calendario.`); return
      }
    }

    // Costruisco le ModificaCambio:
    //   - da: snapshot del turno attuale dal DB
    //   - a:  nuovo TC scelto dall'utente
    //         TR: preservato da "DA" (l'admin lo ricalcolera` automatic in
    //              fase di approvazione tramite la regola RM↔P / RP↔M)
    //         slot_mattina/pomeriggio: preservati da "DA", normalizzati per
    //              l'eligibilita` del nuovo TC (l'admin sistema a mano se serve)
    const modifiche: ModificaCambio[] = rows.map(r => {
      const da = findTurnoCorrente(turni, r.medico_id, r.data)
      const slotA = normalizzaSlot(r.tc_a, da.slot_mattina, da.slot_pomeriggio)
      return {
        medico_id: r.medico_id,
        data:      r.data,
        da: { tc: da.tc, tr: da.tr, slot_mattina: da.slot_mattina, slot_pomeriggio: da.slot_pomeriggio },
        a:  {
          tc: r.tc_a,
          tr: da.tr,    // preservato; sara` riallineato dall'admin
          slot_mattina:    slotA.slot_mattina,
          slot_pomeriggio: slotA.slot_pomeriggio,
        },
      }
    })

    // Almeno UNA modifica deve essere diversa fra da e a (sul TC)
    const haAlmenoUnaModifica = modifiche.some(m => m.da.tc !== m.a.tc)
    if (!haAlmenoUnaModifica) {
      setError('Nessuna modifica effettiva: cambia il TC di almeno una riga.')
      return
    }

    setSubmitting(true)
    try {
      const { error: insErr } = await supabase.from('cambi_turno').insert({
        medico_richiedente_id: medicoRichiedente.id,
        modifiche,
        motivo: motivo.trim() || null,
        stato:  'pending',
      })
      if (insErr) throw insErr

      // Notifica broadcast a tutti gli admin: nuova richiesta cambio
      // turno da approvare. Errore silenziato per non bloccare il flusso.
      const nMod = modifiche.length
      const { error: notifErr } = await supabase.from('messaggi').insert({
        medico_id:          null,
        destinatario_ruolo: 'admin',
        tipo:               'cambio_richiesto',
        titolo:             `Richiesta cambio turno da ${medicoRichiedente.nome}`,
        corpo:              `${medicoRichiedente.nome} ha proposto ${nMod} modific${nMod === 1 ? 'a' : 'he'} al calendario${motivo.trim() ? ` (motivo: ${motivo.trim()})` : ''}. Vai in Admin → Gestione Cambi per approvare o rifiutare.`,
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3"
      style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(2px)' }}
      onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl flex flex-col w-full"
        style={{ maxWidth: 'min(94vw, 680px)', maxHeight: 'min(88dvh, 720px)' }}
        onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-stone-200 shrink-0">
          <div>
            <h3 className="font-bold text-stone-800 text-base flex items-center gap-2">
              <Send size={18} style={{ color: '#476540' }} />
              Richiesta cambio turno
            </h3>
            <p className="text-xs text-stone-500 mt-1">
              Specifica solo il nuovo turno clinico (M/P/L/REP). I turni di ricerca
              (RM/RP) verranno ricalcolati in automatico, gli eventuali SUB/MED li
              sistema l'admin a mano.
            </p>
          </div>
          <button onClick={onClose}
            className="text-stone-400 hover:text-stone-600 transition-colors p-1">
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-auto p-4 space-y-3">
          {rows.map((r, i) => {
            const da = findTurnoCorrente(turni, r.medico_id, r.data)
            return (
              <div key={i} className="rounded-lg border border-stone-200 p-3 bg-stone-50">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-stone-600">
                    Modifica #{i + 1}
                  </span>
                  {rows.length > 1 && (
                    <button onClick={() => removeRow(i)}
                      className="text-stone-400 hover:text-red-600 transition-colors p-1"
                      title="Rimuovi questa riga">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>

                {/* Selettori medico + data */}
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <label className="text-xs">
                    <span className="block text-stone-600 mb-0.5">Medico</span>
                    <select
                      value={r.medico_id}
                      onChange={e => onMedicoOrDataChange(i, { medico_id: e.target.value })}
                      className="w-full px-2 py-1.5 rounded border border-stone-300 text-xs">
                      {mediciOrd.map(m => (
                        <option key={m.id} value={m.id}>{m.nome}</option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs">
                    <span className="block text-stone-600 mb-0.5">Data</span>
                    <input
                      type="date"
                      value={r.data}
                      min={minDate}
                      max={maxDate}
                      onChange={e => onMedicoOrDataChange(i, { data: e.target.value })}
                      className="w-full px-2 py-1.5 rounded border border-stone-300 text-xs" />
                  </label>
                </div>

                {/* DA → A (solo TC) */}
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                  <div>
                    <span className="block text-xs text-stone-600 mb-0.5">Turno attuale (DA)</span>
                    <div className="px-2 py-1.5 rounded bg-white border border-stone-200 text-xs font-mono text-stone-700">
                      {fmtCella(da)}
                    </div>
                  </div>
                  <ArrowRight size={16} style={{ color: '#476540' }} className="mt-4" />
                  <div>
                    <span className="block text-xs text-stone-600 mb-0.5">Diventa (A)</span>
                    <select
                      value={r.tc_a}
                      onChange={e => setRow(i, { tc_a: e.target.value as TurnoClinico })}
                      className="w-full px-2 py-1.5 rounded border border-stone-300 text-xs font-semibold">
                      <option value="">— vuoto</option>
                      <option value="M">M (mattina)</option>
                      <option value="P">P (pomeriggio)</option>
                      <option value="L">L (lunga)</option>
                      <option value="REP">REP (reperibilita`)</option>
                    </select>
                  </div>
                </div>
              </div>
            )
          })}

          {/* Aggiungi riga */}
          <button onClick={addRow}
            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border border-dashed border-stone-300 text-xs font-semibold text-stone-600 hover:bg-stone-50 transition-colors">
            <Plus size={14} /> Aggiungi modifica
          </button>

          {/* Motivo */}
          <label className="block">
            <span className="block text-xs text-stone-600 mb-1">
              Nota all'admin (opzionale)
            </span>
            <textarea
              value={motivo}
              onChange={e => setMotivo(e.target.value)}
              rows={2}
              placeholder="Es: B copre la mia mattina del lunga di lunedi'"
              className="w-full px-3 py-2 rounded border border-stone-300 text-xs
                         focus:outline-none focus:ring-2 focus:ring-green-300" />
          </label>

          {/* Error */}
          {error && (
            <div className="px-3 py-2 rounded-lg text-xs font-medium flex items-start gap-2"
              style={{ background: '#fee2e2', color: '#991b1b' }}>
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-stone-200 flex justify-end gap-2 shrink-0">
          <button onClick={onClose}
            className="px-3 py-1.5 rounded text-xs font-semibold border border-stone-300 text-stone-700 hover:bg-stone-50 transition-colors">
            Annulla
          </button>
          <button onClick={handleSubmit}
            disabled={submitting}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold text-white shadow-sm transition-colors"
            style={{ background: '#476540', opacity: submitting ? 0.6 : 1 }}>
            <Send size={13} />
            {submitting ? 'Invio…' : 'Invia richiesta'}
          </button>
        </div>
      </div>
    </div>
  )
}
