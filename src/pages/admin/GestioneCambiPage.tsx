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
  ArrowRightLeft, Check, X, Clock, AlertTriangle, MessageSquare, Trash2,
  RotateCcw,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useReparto } from '../../contexts/RepartoContext'
import { useConfigReparto } from '../../hooks/useConfigReparto'
import { useConfirm } from '../../hooks/useConfirm'
import { useCambiTurnoRealtime } from '../../hooks/useCambiTurnoRealtime'
import { ConfirmModal } from '../../components/ConfirmModal'
import { eseguiRicalcoloGiorno, generaColonne } from '../../lib/algorithm'
import { useFestivitaCustom } from '../../hooks/useFestivitaCustom'
import type {
  Medico, CambioTurno, ModificaCambio, TurnoClinico, TurnoRicerca,
  SlotPlacement, Configurazione, SchemaModello, Turno,
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
  const { repartoAttivo } = useReparto()
  const { confirm, confirmState } = useConfirm()
  const [msg,        setMsg]        = useState<string | null>(null)
  const [err,        setErr]        = useState<string | null>(null)
  const [busyId,     setBusyId]     = useState<string | null>(null)
  const [rejectFor,  setRejectFor]  = useState<CambioTurno | null>(null)
  const [rejectMsg,  setRejectMsg]  = useState('')

  useCambiTurnoRealtime()

  // ── Query: tutte le richieste ──────────────────────────────────────
  const { data: cambi = [], isLoading } = useQuery<CambioTurno[]>({
    queryKey: ['cambi-turno', repartoAttivo],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cambi_turno').select('*')
        .eq('reparto_id', repartoAttivo)
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

  // ── Dati di contesto per il ricalcolo RM/RP post-approvazione ─────
  // Servono solo al click "Approva" ma li precarico cosi` l'azione e`
  // istantanea senza fetch in volo.
  const { data: config } = useConfigReparto()
  const { data: schemi = [] } = useQuery<SchemaModello[]>({
    queryKey: ['schemi_modello', repartoAttivo],
    queryFn: async () => {
      const { data, error } = await supabase.from('schemi_modello').select('*')
        .eq('reparto_id', repartoAttivo)
        .order('giorno_settimana').order('slot')
      if (error) throw error
      return data ?? []
    },
  })
  const { set: festivitaCustomSet } = useFestivitaCustom(repartoAttivo)
  const colonne = useMemo(
    () => config ? generaColonne(config, festivitaCustomSet) : [],
    [config, festivitaCustomSet]
  )

  const pending  = cambi.filter(c => c.stato === 'pending')
  const archivio = cambi.filter(c => c.stato !== 'pending')

  // ── Helper: genera messaggi per TUTTI i medici coinvolti in un cambio ─
  // I medici coinvolti = richiedente + tutti i medico_id presenti nelle
  // modifiche JSONB (dedup via Set). Ogni medico riceve un suo messaggio
  // nella casella di posta. Inoltre viene generato UN messaggio broadcast
  // di tipo `admin_azione` per tutti gli admin, cosi` il log dell'azione
  // e` visibile nella loro casella (utile se piu` admin gestiscono).
  async function insertCambioMessaggi(
    c: CambioTurno,
    tipo: 'cambio_approvato' | 'cambio_rifiutato' | 'cambio_ripristinato',
    titolo: string,
    corpo: string,
  ): Promise<void> {
    const mediciCoinvolti = new Set<string>([c.medico_richiedente_id])
    for (const m of c.modifiche) mediciCoinvolti.add(m.medico_id)
    const rows = Array.from(mediciCoinvolti).map(medicoId => ({
      medico_id:          medicoId,
      destinatario_ruolo: 'medico' as const,
      tipo,
      titolo,
      corpo,
      cambio_turno_id:    c.id,
    }))
    const { error } = await supabase.from('messaggi').insert(rows)
    if (error) throw error

    // Log broadcast admin (tipo 'admin_azione')
    const azione = tipo === 'cambio_approvato'    ? 'approvato'
                 : tipo === 'cambio_rifiutato'    ? 'rifiutato'
                 :                                  'ripristinato'
    const richiedenteNome =
      medici.find(m => m.id === c.medico_richiedente_id)?.nome ?? '—'
    const { error: e2 } = await supabase.from('messaggi').insert({
      medico_id:          null,
      destinatario_ruolo: 'admin',
      tipo:               'admin_azione',
      titolo:             `Cambio turno ${azione} — ${richiedenteNome}`,
      corpo:              `La richiesta di cambio turno di ${richiedenteNome} (${c.modifiche.length} modific${c.modifiche.length === 1 ? 'a' : 'he'}) e' stata ${azione} dall'admin.`,
      cambio_turno_id:    c.id,
    })
    if (e2) console.error('[cambi] insert log admin:', e2.message)
  }

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

      // 1.5) Ricalcola automaticamente RM/RP per i giorni toccati
      // Il modal di richiesta cambio salva m.a.tr preservato dalla "DA";
      // dopo aver cambiato il TC quel TR puo` essere fuori regola
      // (es. "P + RP" non e` valido: RP va a chi fa M, non chi fa P).
      // Qui eseguiamo `eseguiRicalcoloGiorno` per ogni giorno toccato
      // dal cambio, leggiamo lo stato turni AGGIORNATO (dopo l'upsert
      // sopra), e applichiamo le correzioni RM/RP via un secondo upsert
      // — preservando TC e SUB/MED che sono gli output dell'admin.
      let cellsRicalcolate = 0
      if (config && schemi.length > 0 && medici.length > 0) {
        // a) Fetch stato turni aggiornato per i giorni toccati
        const dateToccate = Array.from(new Set(c.modifiche.map(m => m.data)))
        const { data: turniAggiornati, error: fetchErr } = await supabase
          .from('turni').select('*')
          .in('data', dateToccate)
        if (fetchErr) throw fetchErr
        const turniByKey = new Map<string, Turno>()
        for (const t of (turniAggiornati ?? []) as Turno[]) {
          turniByKey.set(`${t.medico_id}|${t.data}`, t)
        }

        // b) Per ogni giorno, ricalcola e accumula le celle da aggiornare
        const ricalcRows: Array<{
          medico_id: string; data: string;
          turno_clinico: TurnoClinico; turno_ricerca: TurnoRicerca;
          modificato_manualmente: boolean;
          slot_mattina: SlotPlacement; slot_pomeriggio: SlotPlacement;
          is_sub: boolean; is_med: boolean; is_ferie: boolean;
        }> = []
        for (const data of dateToccate) {
          const result = eseguiRicalcoloGiorno({
            config, schemi, medici, colonne, turniByKey,
            data,
            tcOverrides: new Map(),  // nessun override: usiamo lo stato gia` aggiornato
          })
          for (const [medId, newCell] of result) {
            const key = `${medId}|${data}`
            const dbT = turniByKey.get(key)
            const dbTc = (dbT?.turno_clinico ?? '') as TurnoClinico
            const dbTr = (dbT?.turno_ricerca  ?? '') as TurnoRicerca
            const dbSm = dbT?.slot_mattina    ?? null
            const dbSp = dbT?.slot_pomeriggio ?? null
            // Preservo TC e SUB/MED dal DB (gia` aggiornati con il cambio),
            // aggiorno solo TR se cambiato.
            if (newCell.tr === dbTr) continue
            ricalcRows.push({
              medico_id: medId, data,
              turno_clinico:          dbTc,
              turno_ricerca:          newCell.tr,
              modificato_manualmente: dbT?.modificato_manualmente ?? true,
              slot_mattina:           dbSm,
              slot_pomeriggio:        dbSp,
              is_sub: dbSm === 'SUB' || dbSp === 'SUB',
              is_med: dbSm === 'MED' || dbSp === 'MED',
              is_ferie: dbT?.is_ferie ?? false,
            })
          }
        }
        if (ricalcRows.length > 0) {
          const { error: rcErr } = await supabase.from('turni')
            .upsert(ricalcRows, { onConflict: 'medico_id,data' })
          if (rcErr) throw rcErr
          cellsRicalcolate = ricalcRows.length
        }
      }

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

      // 3) Genera un messaggio per ogni medico coinvolto
      await insertCambioMessaggi(c, 'cambio_approvato',
        'Cambio turno approvato',
        `Una richiesta di cambio turno che ti coinvolge e stata approvata dall'admin. Il calendario e stato aggiornato.`)

      setMsg(`✓ Cambio turno approvato — ${c.modifiche.length} celle aggiornate${cellsRicalcolate > 0 ? `, ${cellsRicalcolate} RM/RP ricalcolati` : ''}.`)
      qc.invalidateQueries({ queryKey: ['cambi-turno'] })
      qc.invalidateQueries({ queryKey: ['cambi-turno-pending-count'] })
      qc.invalidateQueries({ queryKey: ['turni-modifica'] })
      qc.invalidateQueries({ queryKey: ['messaggi'] })
      qc.invalidateQueries({ queryKey: ['messaggi-unread-count'] })
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

      // Genera messaggio per tutti i medici coinvolti
      const motivoTxt = rejectMsg.trim()
      await insertCambioMessaggi(rejectFor, 'cambio_rifiutato',
        'Cambio turno rifiutato',
        motivoTxt
          ? `Una richiesta di cambio turno che ti coinvolge e stata rifiutata: ${motivoTxt}`
          : `Una richiesta di cambio turno che ti coinvolge e stata rifiutata dall'admin.`)

      setMsg('Cambio turno rifiutato.')
      qc.invalidateQueries({ queryKey: ['cambi-turno'] })
      qc.invalidateQueries({ queryKey: ['cambi-turno-pending-count'] })
      qc.invalidateQueries({ queryKey: ['messaggi'] })
      qc.invalidateQueries({ queryKey: ['messaggi-unread-count'] })
      setRejectFor(null); setRejectMsg('')
    } catch (e) {
      setErr('Errore nel rifiuto: ' + (e as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  // ── Ripristina (rollback) cambio turno approvato ────────────────────
  // Per ogni modifica del cambio: upsert sui turni col valore "da" (cioe`
  // il valore originale precedente al cambio). Lo stato passa a 'restored'
  // e resta in archivio. Tutti i medici coinvolti ricevono un messaggio.
  // Disponibile SOLO per cambi in stato 'approved' (non ha senso ripristinare
  // un cambio mai applicato).
  async function handleRipristina(c: CambioTurno) {
    if (c.stato !== 'approved') return    // safety net
    const ok = await confirm({
      title:   'Ripristinare il cambio turno?',
      message: `Annullerai il cambio approvato il ${fmtData(c.resolved_at?.slice(0, 10) ?? c.created_at.slice(0, 10))}. ${c.modifiche.length} cell${c.modifiche.length === 1 ? 'a' : 'e'} del calendario verranno riportate ai valori originali. La richiesta passa in archivio come "RIPRISTINATO".`,
      confirmLabel: 'Ripristina',
      danger: true,
    })
    if (!ok) return

    setBusyId(c.id); setErr(null); setMsg(null)
    try {
      // 1) Upsert ROLLBACK: applica m.da (i valori originali) ai turni
      const turniRows = c.modifiche.map(m => ({
        medico_id:               m.medico_id,
        data:                    m.data,
        turno_clinico:           m.da.tc,
        turno_ricerca:           m.da.tr,
        modificato_manualmente:  true,
        slot_mattina:            m.da.slot_mattina,
        slot_pomeriggio:         m.da.slot_pomeriggio,
        is_sub: m.da.slot_mattina === 'SUB' || m.da.slot_pomeriggio === 'SUB',
        is_med: m.da.slot_mattina === 'MED' || m.da.slot_pomeriggio === 'MED',
        is_ferie: false,
      }))
      const { error: upErr } = await supabase.from('turni')
        .upsert(turniRows, { onConflict: 'medico_id,data' })
      if (upErr) throw upErr

      // 2) Setta stato 'restored'
      const { data: authData } = await supabase.auth.getUser()
      const { error: rsErr } = await supabase.from('cambi_turno')
        .update({
          stato:       'restored',
          resolved_at: new Date().toISOString(),
          resolved_by: authData.user?.id ?? null,
        })
        .eq('id', c.id)
      if (rsErr) throw rsErr

      // 3) Genera messaggio per tutti i medici coinvolti
      await insertCambioMessaggi(c, 'cambio_ripristinato',
        'Cambio turno ripristinato',
        `Un cambio turno precedentemente approvato che ti coinvolge e stato annullato dall'admin. I tuoi turni sono stati riportati ai valori originali.`)

      setMsg(`Cambio turno ripristinato — ${c.modifiche.length} cell${c.modifiche.length === 1 ? 'a' : 'e'} riportate ai valori originali.`)
      qc.invalidateQueries({ queryKey: ['cambi-turno'] })
      qc.invalidateQueries({ queryKey: ['turni-modifica'] })
      qc.invalidateQueries({ queryKey: ['messaggi'] })
      qc.invalidateQueries({ queryKey: ['messaggi-unread-count'] })
    } catch (e) {
      setErr('Errore nel ripristino: ' + (e as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  // ── Elimina richiesta dall'archivio (solo per richieste risolte) ───
  // Le pending non si cancellano qui — vanno prima Approvate o Rifiutate.
  // L'eliminazione e` definitiva e NON tocca i turni gia` applicati: serve
  // solo a tenere pulito l'archivio.
  async function handleElimina(c: CambioTurno) {
    if (c.stato === 'pending') return    // safety net
    const richiedente = mediciById.get(c.medico_richiedente_id)
    const ok = await confirm({
      title:   'Eliminare la richiesta dall\'archivio?',
      message: `La richiesta di ${richiedente?.nome ?? 'medico sconosciuto'} del ${fmtData(c.created_at.slice(0, 10))} verra rimossa definitivamente. Questa azione NON modifica i turni gia applicati al calendario.`,
      confirmLabel: 'Elimina',
      danger: true,
    })
    if (!ok) return
    setBusyId(c.id); setErr(null); setMsg(null)
    try {
      const { error } = await supabase.from('cambi_turno').delete().eq('id', c.id)
      if (error) throw error
      setMsg('Richiesta eliminata dall\'archivio.')
      qc.invalidateQueries({ queryKey: ['cambi-turno'] })
      qc.invalidateQueries({ queryKey: ['cambi-turno-pending-count'] })
    } catch (e) {
      setErr('Errore eliminazione: ' + (e as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  // ── Render di una richiesta ────────────────────────────────────────
  function RichiestaCard({ c }: { c: CambioTurno }) {
    const richiedente = mediciById.get(c.medico_richiedente_id)
    const isPending  = c.stato === 'pending'
    const isApproved = c.stato === 'approved'
    const isRejected = c.stato === 'rejected'
    const isRestored = c.stato === 'restored'

    // Colore del bordo card per stato:
    //   pending → arancione, approved → verde, restored → ambra, rejected → grigio
    const borderColor =
      isPending  ? '#d97706' :
      isApproved ? '#9ab488' :
      isRestored ? '#a16207' :   // ambra/oro = "annullato dopo approvazione"
                   '#c0b8a8'     // rejected

    return (
      <div className="rounded-lg border p-3 shadow-sm bg-white"
        style={{ borderColor }}>
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
              isRestored ? { background: '#fef3c7', color: '#a16207' } :
                           { background: '#fee2e2', color: '#991b1b' }
            }>
            {isRestored ? 'ripristinato' : c.stato}
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

        {/* Audit + Azioni per archivio (Ripristina + Elimina) */}
        {!isPending && (
          <div className="mt-2 flex items-center justify-between gap-2">
            <div className="text-[10px] text-stone-500 flex items-center gap-1 flex-1 min-w-0">
              {c.resolved_at && (
                <>
                  <Clock size={10} className="shrink-0" />
                  {isRestored ? 'Ripristinato' : 'Risolto'} il {fmtData(c.resolved_at.slice(0, 10))}
                  {c.rejection_reason && (
                    <span className="ml-2 italic truncate">— {c.rejection_reason}</span>
                  )}
                </>
              )}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {/* Ripristina: solo per cambi approvati (annulla l'effetto) */}
              {isApproved && (
                <button
                  onClick={() => handleRipristina(c)}
                  disabled={busyId === c.id}
                  className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold transition-colors"
                  style={{
                    background: '#fef3c7', color: '#a16207',
                    border: '1px solid #fde68a',
                    opacity: busyId === c.id ? 0.6 : 1,
                  }}
                  title="Annulla il cambio approvato e ripristina i turni originali">
                  <RotateCcw size={11} /> Ripristina
                </button>
              )}
              <button
                onClick={() => handleElimina(c)}
                disabled={busyId === c.id}
                className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold transition-colors"
                style={{
                  background: '#fee2e2', color: '#991b1b',
                  border: '1px solid #fecaca',
                  opacity: busyId === c.id ? 0.6 : 1,
                }}
                title="Elimina questa richiesta dall'archivio">
                <Trash2 size={11} /> Elimina
              </button>
            </div>
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
