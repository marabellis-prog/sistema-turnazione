/**
 * GestioneCambiPage
 *
 * Pagina admin per gestire le richieste di cambio turno aperte dai medici.
 *
 * Flusso:
 *   1. Il medico (in CalendarioPage) apre il modal "Richiedi Cambio Turno",
 *      compila le modifiche proposte (medico/data + da → a) e submit.
 *   2. La richiesta arriva qui in stato `pending`.
 *   3. L'admin valuta:
 *      - Approva → applica AUTOMATICAMENTE i cambi alla tabella `turni`
 *        (upsert + modificato_manualmente=true) e marca la richiesta
 *        come `approved`. Il calendario si aggiorna realtime per tutti.
 *      - Rifiuta → marca la richiesta come `rejected` con motivo
 *        opzionale. Nessuna modifica ai turni.
 *
 * Lo stato `pending` viene mostrato in cima, archivio (approved/rejected)
 * in basso. Aggiornamento realtime via useCambiTurnoRealtime.
 */

import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowRightLeft, Check, X, Clock, AlertTriangle, MessageSquare,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useConfirm } from '../../hooks/useConfirm'
import { useCambiTurnoRealtime } from '../../hooks/useCambiTurnoRealtime'
import { ConfirmModal } from '../../components/ConfirmModal'
import type {
  Medico, CambioTurno, ModificaCambio, TurnoClinico, TurnoRicerca,
  SlotPlacement,
} from '../../types'

// ════════════════════════════════════════════════════════════════════
// HELPER
// ════════════════════════════════════════════════════════════════════

/** Formatta una data ISO "YYYY-MM-DD" in dd/mm (anno omesso se = oggi) */
function fmtData(iso: string): string {
  const [y, m, d] = iso.split('-')
  const curY = String(new Date().getFullYear())
  return y !== curY ? `${d}/${m}/${y.slice(2)}` : `${d}/${m}`
}

/** Formatta una "celletta" (TC + slot mattina/pom) in stringa compatta.
 *  Esempi:
 *    { tc:'M', slot_mattina:'SUB' }                → "M (SUB)"
 *    { tc:'L', slot_mattina:'SUB', slot_pomeriggio:'MED' } → "L (SUB|MED)"
 *    { tc:'P', slot_pomeriggio:null }              → "P"
 *    { tc:'' }                                     → "—" */
function fmtCellaCompatta(c: {
  tc: TurnoClinico; tr?: TurnoRicerca
  slot_mattina?:    SlotPlacement
  slot_pomeriggio?: SlotPlacement
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

/** Restituisce true se la cella "da" e "a" sono effettivamente diverse */
function diversa(m: ModificaCambio): boolean {
  return m.da.tc !== m.a.tc
    || m.da.tr !== m.a.tr
    || m.da.slot_mattina    !== m.a.slot_mattina
    || m.da.slot_pomeriggio !== m.a.slot_pomeriggio
}

// ════════════════════════════════════════════════════════════════════
// PAGINA
// ════════════════════════════════════════════════════════════════════

export function GestioneCambiPage() {
  const qc = useQueryClient()
  const { confirm, confirmState } = useConfirm()
  const [msg,        setMsg]        = useState<string | null>(null)
  const [err,        setErr]        = useState<string | null>(null)
  const [busyId,     setBusyId]     = useState<string | null>(null)
  const [rejectFor,  setRejectFor]  = useState<CambioTurno | null>(null)
  const [rejectMsg,  setRejectMsg]  = useState('')

  useCambiTurnoRealtime()

  // ── Query: tutte le richieste ──────────────────────────────────────
  const { data: cambi = [], isLoading } = useQuery<CambioTurno[]>({
    queryKey: ['cambi-turno'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cambi_turno').select('*')
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as CambioTurno[]
    },
    staleTime:                   0,
    refetchOnMount:              'always',
    refetchInterval:             30_000,
    refetchIntervalInBackground: false,
  })

  // ── Query: tutti i medici (per mostrare i nomi) ────────────────────
  const { data: medici = [] } = useQuery<Medico[]>({
    queryKey: ['medici-tutti'],
    queryFn: async () => {
      const { data, error } = await supabase.from('medici').select('*')
      if (error) throw error
      return data ?? []
    },
  })
  const mediciById = useMemo(() => {
    const m = new Map<string, Medico>()
    for (const x of medici) m.set(x.id, x)
    return m
  }, [medici])

  const pending  = cambi.filter(c => c.stato === 'pending')
  const archivio = cambi.filter(c => c.stato !== 'pending')

  // ── Approva ────────────────────────────────────────────────────────
  // Applica TUTTE le modifiche della richiesta alla tabella `turni`
  // (upsert su (medico_id, data) con modificato_manualmente=true),
  // poi marca la richiesta come `approved`. Operazione atomica? No,
  // ma se l'upsert dei turni fallisce manteniamo lo stato pending
  // (cosi` l'admin puo` riprovare). Se invece passa l'upsert ma fallisce
  // l'update finale, possiamo restare in stato "applicato ma non
  // marcato": l'admin vede comunque pending e puo` riprovare → idempotente
  // (l'upsert re-applica gli stessi valori, nessun danno).
  async function handleApprova(c: CambioTurno) {
    const ok = await confirm({
      title:   `Approvare il cambio turno?`,
      message: `Applicherai ${c.modifiche.length} modific${c.modifiche.length === 1 ? 'a' : 'he'} al calendario. Operazione immediata e visibile a tutti gli utenti.`,
      confirmLabel: 'Approva e applica',
    })
    if (!ok) return

    setBusyId(c.id); setErr(null); setMsg(null)
    try {
      // 1) Upsert dei turni — calcolando is_sub / is_med come OR sui placement
      // (backward compat con le colonne legacy che servono per il colore
      // del riepilogo).
      const turniRows = c.modifiche.map(m => ({
        medico_id:               m.medico_id,
        data:                    m.data,
        turno_clinico:           m.a.tc,
        turno_ricerca:           m.a.tr,
        modificato_manualmente:  true,
        slot_mattina:            m.a.slot_mattina,
        slot_pomeriggio:         m.a.slot_pomeriggio,
        is_sub: m.a.slot_mattina === 'SUB' || m.a.slot_pomeriggio === 'SUB',
        is_med: m.a.slot_mattina === 'MED' || m.a.slot_pomeriggio === 'MED',
        is_ferie: false,    // un cambio turno non tocca le ferie
      }))
      const { error: upErr } = await supabase.from('turni')
        .upsert(turniRows, { onConflict: 'medico_id,data' })
      if (upErr) throw upErr

      // 2) Marca la richiesta come approvata
      const { data: authData } = await supabase.auth.getUser()
      const { error: rsErr } = await supabase.from('cambi_turno')
        .update({
          stato:       'approved',
          resolved_at: new Date().toISOString(),
          resolved_by: authData.user?.id ?? null,
        })
        .eq('id', c.id)
      if (rsErr) throw rsErr

      setMsg(`✓ Cambio turno approvato — ${c.modifiche.length} celle aggiornate.`)
      qc.invalidateQueries({ queryKey: ['cambi-turno'] })
      qc.invalidateQueries({ queryKey: ['cambi-turno-pending-count'] })
      qc.invalidateQueries({ queryKey: ['turni-modifica'] })
    } catch (e) {
      setErr('Errore in approvazione: ' + (e as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  // ── Rifiuta ────────────────────────────────────────────────────────
  async function handleRifiutaConferma() {
    if (!rejectFor) return
    setBusyId(rejectFor.id); setErr(null); setMsg(null)
    try {
      const { data: authData } = await supabase.auth.getUser()
      const { error } = await supabase.from('cambi_turno')
        .update({
          stato:            'rejected',
          resolved_at:      new Date().toISOString(),
          resolved_by:      authData.user?.id ?? null,
          rejection_reason: rejectMsg.trim() || null,
        })
        .eq('id', rejectFor.id)
      if (error) throw error

      setMsg('Cambio turno rifiutato.')
      qc.invalidateQueries({ queryKey: ['cambi-turno'] })
      qc.invalidateQueries({ queryKey: ['cambi-turno-pending-count'] })
      setRejectFor(null); setRejectMsg('')
    } catch (e) {
      setErr('Errore nel rifiuto: ' + (e as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  // ── Render di una richiesta ────────────────────────────────────────
  function RichiestaCard({ c }: { c: CambioTurno }) {
    const richiedente = mediciById.get(c.medico_richiedente_id)
    const isPending = c.stato === 'pending'
    const isApproved = c.stato === 'approved'

    return (
      <div className="rounded-lg border p-3 shadow-sm bg-white"
        style={{ borderColor: isPending ? '#d97706' : isApproved ? '#9ab488' : '#c0b8a8' }}>
        {/* Header: richiedente + data + stato */}
        <div className="flex items-start justify-between gap-3 mb-2">
          <div>
            <div className="flex items-center gap-2">
              <ArrowRightLeft size={14} style={{ color: '#476540' }} />
              <span className="font-semibold text-sm text-stone-800">
                {richiedente?.nome ?? '?'}
              </span>
              <span className="text-xs text-stone-500">
                richiede cambio turno · {fmtData(c.created_at.slice(0, 10))}
              </span>
            </div>
            {c.motivo && (
              <div className="mt-1 flex items-start gap-1.5 text-xs text-stone-600">
                <MessageSquare size={11} className="mt-0.5 shrink-0" />
                <span className="italic">{c.motivo}</span>
              </div>
            )}
          </div>

          {/* Stato badge */}
          <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider shrink-0"
            style={
              isPending  ? { background: '#fef3c7', color: '#92400e' } :
              isApproved ? { background: '#dcfce7', color: '#166534' } :
                           { background: '#fee2e2', color: '#991b1b' }
            }>
            {c.stato}
          </span>
        </div>

        {/* Tabellina delle modifiche */}
        <div className="rounded border border-stone-200 overflow-hidden text-xs">
          <table className="w-full">
            <thead>
              <tr style={{ background: '#f4f1ea' }}>
                <th className="px-2 py-1 text-left font-semibold text-stone-700">Medico</th>
                <th className="px-2 py-1 text-left font-semibold text-stone-700">Data</th>
                <th className="px-2 py-1 text-left font-semibold text-stone-700">Da</th>
                <th className="px-2 py-1 text-left font-semibold text-stone-700">A</th>
              </tr>
            </thead>
            <tbody>
              {c.modifiche.map((m, i) => {
                const med = mediciById.get(m.medico_id)
                const cambia = diversa(m)
                return (
                  <tr key={i} className="border-t border-stone-200"
                    style={cambia ? {} : { opacity: 0.55 }}>
                    <td className="px-2 py-1 font-medium">{med?.nome ?? '?'}</td>
                    <td className="px-2 py-1">{fmtData(m.data)}</td>
                    <td className="px-2 py-1 text-stone-500">{fmtCellaCompatta(m.da)}</td>
                    <td className="px-2 py-1 font-semibold text-stone-800">
                      {fmtCellaCompatta(m.a)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Azioni */}
        {isPending && (
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={() => handleApprova(c)}
              disabled={busyId === c.id}
              className="flex items-center gap-1 px-3 py-1.5 rounded text-xs font-semibold text-white transition-colors"
              style={{ background: '#16a34a', opacity: busyId === c.id ? 0.6 : 1 }}
            >
              <Check size={13} /> Approva
            </button>
            <button
              onClick={() => { setRejectFor(c); setRejectMsg('') }}
              disabled={busyId === c.id}
              className="flex items-center gap-1 px-3 py-1.5 rounded text-xs font-semibold text-white transition-colors"
              style={{ background: '#dc2626', opacity: busyId === c.id ? 0.6 : 1 }}
            >
              <X size={13} /> Rifiuta
            </button>
          </div>
        )}

        {/* Audit per archivio */}
        {!isPending && c.resolved_at && (
          <div className="mt-2 text-[10px] text-stone-500 flex items-center gap-1">
            <Clock size={10} />
            Risolto il {fmtData(c.resolved_at.slice(0, 10))}
            {c.rejection_reason && <span className="ml-2 italic">— {c.rejection_reason}</span>}
          </div>
        )}
      </div>
    )
  }

  // ── Render principale ──────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-stone-800 flex items-center gap-2">
          <ArrowRightLeft size={20} style={{ color: '#476540' }} />
          Cambi turno
        </h2>
        <p className="text-sm text-stone-600 mt-0.5">
          Richieste di cambio turno aperte dai medici. <strong>Approva</strong> per applicare
          automaticamente le modifiche al calendario, <strong>Rifiuta</strong> per archiviare
          senza modifiche.
        </p>
      </div>

      {/* Messaggi */}
      {msg && (
        <div className="px-3 py-2 rounded-lg text-sm font-medium"
          style={{ background: '#dcfce7', color: '#166534' }}>
          {msg}
        </div>
      )}
      {err && (
        <div className="px-3 py-2 rounded-lg text-sm font-medium flex items-start gap-2"
          style={{ background: '#fee2e2', color: '#991b1b' }}>
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          {err}
        </div>
      )}

      {isLoading && (
        <div className="text-stone-500 text-sm">Caricamento richieste…</div>
      )}

      {/* In attesa */}
      <section>
        <h3 className="text-sm font-bold text-stone-700 mb-2 flex items-center gap-2">
          <Clock size={14} style={{ color: '#d97706' }} />
          In attesa di approvazione
          {pending.length > 0 && (
            <span className="text-xs font-normal text-stone-500">
              ({pending.length})
            </span>
          )}
        </h3>
        {pending.length === 0 ? (
          <div className="text-stone-500 text-xs italic">Nessuna richiesta in attesa.</div>
        ) : (
          <div className="space-y-2">
            {pending.map(c => <RichiestaCard key={c.id} c={c} />)}
          </div>
        )}
      </section>

      {/* Archivio */}
      {archivio.length > 0 && (
        <section>
          <h3 className="text-sm font-bold text-stone-700 mb-2 flex items-center gap-2">
            <Check size={14} style={{ color: '#9ab488' }} />
            Archivio
            <span className="text-xs font-normal text-stone-500">
              ({archivio.length})
            </span>
          </h3>
          <div className="space-y-2">
            {archivio.map(c => <RichiestaCard key={c.id} c={c} />)}
          </div>
        </section>
      )}

      {/* Modal di rifiuto: chiede motivo opzionale */}
      {rejectFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(2px)' }}
          onClick={() => setRejectFor(null)}>
          <div className="bg-white rounded-2xl shadow-2xl p-5 w-full max-w-md"
            onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-stone-800 mb-2 flex items-center gap-2">
              <X size={18} style={{ color: '#dc2626' }} />
              Rifiuta cambio turno
            </h3>
            <p className="text-sm text-stone-600 mb-3">
              Vuoi indicare un motivo? Sara visibile al medico richiedente.
            </p>
            <textarea
              value={rejectMsg}
              onChange={e => setRejectMsg(e.target.value)}
              placeholder="Motivo opzionale…"
              rows={3}
              className="w-full px-3 py-2 rounded border border-stone-300 text-sm
                         focus:outline-none focus:ring-2 focus:ring-red-300"
              autoFocus
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setRejectFor(null)}
                className="px-3 py-1.5 rounded text-xs font-semibold border border-stone-300 text-stone-700"
              >
                Annulla
              </button>
              <button
                onClick={handleRifiutaConferma}
                disabled={busyId === rejectFor.id}
                className="px-3 py-1.5 rounded text-xs font-semibold text-white"
                style={{ background: '#dc2626', opacity: busyId === rejectFor.id ? 0.6 : 1 }}
              >
                Conferma rifiuto
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal {...confirmState.opts} open={confirmState.open}
        onConfirm={confirmState.onConfirm} onCancel={confirmState.onCancel} />
    </div>
  )
}
