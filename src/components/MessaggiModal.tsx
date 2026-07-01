/**
 * MessaggiModal
 *
 * Casella di posta personale.
 *
 * Due modalita`:
 *   - mode='medico' (default): l'utente loggato e` un medico turnista.
 *     Vede i propri messaggi (medico_id = me) ordinati cronologicamente,
 *     piu` le proprie richieste pending in cima.
 *
 *   - mode='admin': l'utente loggato e` un admin. Vede i messaggi
 *     destinatario_ruolo='admin' (broadcast a tutti gli admin), piu`
 *     TUTTE le richieste pending del sistema (ferie + cambi turno) cosi`
 *     puo` saltare alle pagine /admin/ferie o /admin/cambi per gestirle.
 *
 * Funzionalita`:
 *   - Click su un messaggio non letto → marca come letto (UPDATE messaggi.letto)
 *   - "Marca tutti come letti" → bulk update di tutti i non letti
 *   - Paginazione: prev/next con numero pagina visibile
 *   - Icona + colore per tipo
 *
 * Permessi RLS:
 *   - SELECT/UPDATE: medico vede/marca i propri; admin vede/marca i broadcast
 *   - INSERT: admin sempre; medico solo broadcast admin con tipi consentiti
 */

import { useState, useMemo, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Mail, Check, X, RotateCcw, Plane, ChevronLeft, ChevronRight,
  ChevronsLeft, ChevronsRight,
  CheckCheck, Loader2, Clock, ArrowRightLeft, ArrowRight,
  Send, Trash2, Shield,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useFerieRealtime } from '../hooks/useFerieRealtime'
import { useCambiTurnoRealtime } from '../hooks/useCambiTurnoRealtime'
import type {
  Medico, Messaggio, TipoMessaggio, Ferie, CambioTurno,
} from '../types'

// Numero di messaggi per pagina nella sezione "Storico". Le richieste in
// attesa (pending) sono SEMPRE visibili sopra senza paginazione: questa
// constante riguarda solo la lista dei messaggi della tabella `messaggi`.
const PAGE_SIZE = 5

/** Window di numeri pagina centrati sulla corrente, max `windowSize`.
 *  Es. (current=10, total=20, windowSize=5) → [8,9,10,11,12]
 *  Adjusts at boundaries: vicino a 0 → [0..4], vicino a total-1 → [total-5..total-1]. */
function getPageWindow(current: number, total: number, windowSize: number): number[] {
  if (total <= 0) return []
  if (total <= windowSize) return Array.from({ length: total }, (_, i) => i)
  const half = Math.floor(windowSize / 2)
  let start = Math.max(0, current - half)
  const end = Math.min(total - 1, start + windowSize - 1)
  start = Math.max(0, end - windowSize + 1)
  const out: number[] = []
  for (let i = start; i <= end; i++) out.push(i)
  return out
}

interface Props {
  /** 'medico' = casella personale del medico (richiede `medici`);
   *  'admin'  = casella admin con broadcast e richieste pending del sistema. */
  mode:    'medico' | 'admin'
  /** Richiesto se mode='medico'. TUTTI i medici del turnista (uno per reparto):
   *  la casella aggrega messaggi e richieste di tutti i suoi reparti. */
  medici?: Medico[]
  /** Se valorizzata (turnista in più reparti), mostra il reparto di
   *  provenienza accanto a ogni messaggio/richiesta. Chiave = medico_id. */
  repartoNomeByMedicoId?: Map<string, string>
  onClose: () => void
}

/** Configurazione visiva per ogni tipo di messaggio. */
const TIPO_CONFIG: Record<TipoMessaggio, {
  Icon:  typeof Check
  color: string
  bg:    string
  label: string
}> = {
  // medico ← admin
  cambio_approvato:    { Icon: Check,         color: '#166534', bg: '#dcfce7', label: 'Cambio turno approvato' },
  cambio_rifiutato:    { Icon: X,             color: '#991b1b', bg: '#fee2e2', label: 'Cambio turno rifiutato' },
  cambio_ripristinato: { Icon: RotateCcw,     color: '#a16207', bg: '#fef3c7', label: 'Cambio turno ripristinato' },
  ferie_approvate:     { Icon: Plane,         color: '#166534', bg: '#dcfce7', label: 'Ferie approvate' },
  ferie_rifiutate:     { Icon: Plane,         color: '#991b1b', bg: '#fee2e2', label: 'Ferie rifiutate' },
  // admin ← medico
  ferie_richiesta:     { Icon: Send,          color: '#1d4ed8', bg: '#dbeafe', label: 'Richiesta ferie' },
  ferie_annullata:     { Icon: Trash2,        color: '#7c2d12', bg: '#fed7aa', label: 'Ferie annullate dal medico' },
  cambio_richiesto:    { Icon: Send,          color: '#1d4ed8', bg: '#dbeafe', label: 'Richiesta cambio turno' },
  cambio_annullato:    { Icon: Trash2,        color: '#7c2d12', bg: '#fed7aa', label: 'Cambio annullato dal medico' },
  // admin ← admin
  admin_azione:        { Icon: Shield,        color: '#475569', bg: '#e2e8f0', label: 'Log azione admin' },
}

/** Formatta una data ISO in "dd/mm/yy hh:mm" (formato breve italiano). */
function fmtDataOra(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Formatta una data SQL "YYYY-MM-DD" in dd/mm (anno omesso se = corrente). */
function fmtDataBreve(sqlDate: string): string {
  const [y, m, d] = sqlDate.split('-')
  const curY = String(new Date().getFullYear())
  return y !== curY ? `${d}/${m}/${y.slice(2)}` : `${d}/${m}`
}

export function MessaggiModal({ mode, medici, repartoNomeByMedicoId, onClose }: Props) {
  const qc = useQueryClient()
  const [page,    setPage]    = useState(0)
  const [marking, setMarking] = useState<string | null>(null)
  const [bulkLoading, setBulkLoading] = useState(false)

  // Id di TUTTI i medici del turnista (uno per reparto). Ordinati → query-key
  // stabile a prescindere dall'ordine di caricamento.
  const mediciIds = useMemo(() => (medici ?? []).map(m => m.id).sort(), [medici])
  // Reparto di provenienza (etichetta) per un medico_id, se fornito.
  const repartoLabel = (medicoId: string | null | undefined): string | null =>
    (medicoId != null ? repartoNomeByMedicoId?.get(medicoId) : null) ?? null

  // Identita` per le query/invalidations: per il medico usiamo l'insieme dei
  // suoi id; per l'admin una stringa fissa cosi` ['messaggi', 'admin'] e
  // ['messaggi-unread-count', 'admin'] non si scontrano con quelle medico.
  const queryScopeId = mode === 'medico' ? mediciIds.join(',') : 'admin'

  // Realtime su ferie e cambi turno: cosi` se il modal e` aperto e
  // arrivano nuove richieste (medico) o azioni dell'admin (altrove),
  // le sezioni "in attesa" si aggiornano automaticamente.
  useFerieRealtime()
  useCambiTurnoRealtime()

  // ── Query messaggi ────────────────────────────────────────────────
  // Per il medico: filtra per medico_id. Per l'admin: filtra per
  // destinatario_ruolo='admin' (broadcast).
  const { data: messaggi = [], isLoading } = useQuery<Messaggio[]>({
    queryKey: ['messaggi', queryScopeId],
    queryFn: async () => {
      let q = supabase.from('messaggi').select('*')
      if (mode === 'medico') {
        if (mediciIds.length === 0) return []
        q = q.in('medico_id', mediciIds)
      } else {
        q = q.eq('destinatario_ruolo', 'admin')
      }
      const { data, error } = await q.order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as Messaggio[]
    },
    enabled:                     mode === 'admin' || mediciIds.length > 0,
    staleTime:                   0,
    refetchOnMount:              'always',
    refetchOnWindowFocus:        true,    // safety net se realtime non arriva
    refetchInterval:             30_000,
    refetchIntervalInBackground: false,
  })

  // ── Richieste pending visibili nel modal ─────────────────────────
  // Medico: SOLO le proprie. Admin: TUTTE le pending del sistema.
  const { data: feriePending = [] } = useQuery<Ferie[]>({
    queryKey: ['ferie', mode === 'admin' ? 'pending-tutte' : 'pending-mie', queryScopeId],
    queryFn: async () => {
      let q = supabase.from('ferie').select('*').eq('approvate', false)
      if (mode === 'medico') q = q.in('medico_id', mediciIds)
      const { data, error } = await q.order('created_at', { ascending: false })
      if (error) throw error
      return data ?? []
    },
    enabled: mode === 'admin' || mediciIds.length > 0,
    staleTime: 0,
    refetchOnMount: 'always',
  })
  const { data: cambiPending = [] } = useQuery<CambioTurno[]>({
    queryKey: ['cambi-turno', mode === 'admin' ? 'pending-tutti' : 'pending-miei', queryScopeId],
    queryFn: async () => {
      let q = supabase.from('cambi_turno').select('*').eq('stato', 'pending')
      if (mode === 'medico') q = q.in('medico_richiedente_id', mediciIds)
      const { data, error } = await q.order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as CambioTurno[]
    },
    enabled: mode === 'admin' || mediciIds.length > 0,
    staleTime: 0,
    refetchOnMount: 'always',
  })

  // Lookup nome medico per id. In admin mode serve sia per le pending
  // (mostrare CHI ha richiesto) sia per i medici coinvolti nei cambi.
  const { data: tuttiMedici = [] } = useQuery<{ id: string; nome: string }[]>({
    queryKey: ['medici'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('medici').select('id, nome').eq('attivo', true)
      if (error) throw error
      return data ?? []
    },
  })
  const mediciById = useMemo(() => {
    const m = new Map<string, string>()
    for (const x of tuttiMedici) m.set(x.id, x.nome)
    return m
  }, [tuttiMedici])

  const totPagine = Math.max(1, Math.ceil(messaggi.length / PAGE_SIZE))
  const pageSlice = useMemo(
    () => messaggi.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
    [messaggi, page]
  )
  const unreadCount = useMemo(
    () => messaggi.filter(m => !m.letto).length,
    [messaggi]
  )

  // Riposiziono a pagina 0 se i messaggi cambiano e la pagina corrente diventa vuota
  useEffect(() => {
    if (page > 0 && page >= totPagine) setPage(Math.max(0, totPagine - 1))
  }, [page, totPagine])

  // ── Marca singolo messaggio come letto (al click) ─────────────────
  async function handleMarkRead(m: Messaggio) {
    if (m.letto) return
    setMarking(m.id)
    try {
      const { error } = await supabase.from('messaggi')
        .update({ letto: true })
        .eq('id', m.id)
      if (error) throw error
      qc.invalidateQueries({ queryKey: ['messaggi', queryScopeId] })
      qc.invalidateQueries({ queryKey: ['messaggi-unread-count'] })
    } catch (e) {
      console.error('[messaggi] mark-as-read:', (e as Error).message)
    } finally {
      setMarking(null)
    }
  }

  // ── Marca TUTTI i messaggi come letti ────────────────────────────
  async function handleMarkAllRead() {
    if (unreadCount === 0) return
    setBulkLoading(true)
    try {
      let q = supabase.from('messaggi').update({ letto: true }).eq('letto', false)
      if (mode === 'medico') {
        q = q.in('medico_id', mediciIds)
      } else {
        q = q.eq('destinatario_ruolo', 'admin')
      }
      const { error } = await q
      if (error) throw error
      qc.invalidateQueries({ queryKey: ['messaggi', queryScopeId] })
      qc.invalidateQueries({ queryKey: ['messaggi-unread-count'] })
    } catch (e) {
      console.error('[messaggi] bulk mark-as-read:', (e as Error).message)
    } finally {
      setBulkLoading(false)
    }
  }

  // Copy header dinamico
  const headerTitle = mode === 'admin' ? 'Notifiche admin' : 'Casella messaggi'
  const headerSubtitleEmpty = mode === 'admin'
    ? 'Nessuna notifica'
    : 'Nessun messaggio'
  const pendingHeading = mode === 'admin'
    ? 'Richieste da approvare'
    : 'In attesa di approvazione'
  const emptyTotalText = mode === 'admin'
    ? 'Nessuna notifica. Le richieste dei medici e i log delle azioni admin compariranno qui.'
    : 'Nessun messaggio. Le notifiche su cambi turno e ferie compariranno qui.'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3"
      style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(2px)' }}
      onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl flex flex-col w-full"
        style={{
          maxWidth:  'min(94vw, 680px)',
          maxHeight: 'min(88dvh, 720px)',   // dvh per iOS Safari + cap
        }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-stone-200 shrink-0">
          <div className="flex items-center gap-3">
            {mode === 'admin'
              ? <Shield size={20} style={{ color: '#476540' }} />
              : <Mail   size={20} style={{ color: '#476540' }} />}
            <div>
              <h3 className="font-bold text-stone-800 text-base">{headerTitle}</h3>
              <p className="text-xs text-stone-500">
                {messaggi.length === 0
                  ? headerSubtitleEmpty
                  : `${messaggi.length} ${mode === 'admin' ? 'notific' : 'messagg'}${messaggi.length === 1 ? (mode === 'admin' ? 'a' : 'io') : (mode === 'admin' ? 'he' : 'i')}`}
                {unreadCount > 0 && <span className="ml-1 font-semibold" style={{ color: '#d97706' }}>
                  · {unreadCount} non lett{unreadCount === 1 ? 'o' : 'i'}
                </span>}
                {(feriePending.length + cambiPending.length) > 0 && (
                  <span className="ml-1 font-semibold" style={{ color: '#a16207' }}>
                    · {feriePending.length + cambiPending.length} {mode === 'admin' ? 'da gestire' : 'in attesa'}
                  </span>
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllRead}
                disabled={bulkLoading}
                className="flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-semibold transition-colors"
                style={{ background: '#e0e8d8', color: '#456b3a', opacity: bulkLoading ? 0.6 : 1 }}
                title="Segna tutti i messaggi come letti">
                {bulkLoading ? <Loader2 size={12} className="animate-spin" /> : <CheckCheck size={12} />}
                Segna tutti come letti
              </button>
            )}
            <button onClick={onClose}
              className="text-stone-400 hover:text-stone-600 transition-colors p-1">
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="overflow-auto p-4 flex-1">
          {isLoading ? (
            <div className="text-stone-500 text-sm flex items-center justify-center py-8">
              <Loader2 size={18} className="animate-spin mr-2" /> Caricamento…
            </div>
          ) : (messaggi.length === 0 && feriePending.length === 0 && cambiPending.length === 0) ? (
            <div className="text-stone-500 text-sm text-center py-10">
              <Mail size={32} className="mx-auto mb-2 opacity-30" />
              {emptyTotalText}
            </div>
          ) : (
            <>
              {/* ── Sezione "In attesa di approvazione" / "Da approvare" ── */}
              {(feriePending.length > 0 || cambiPending.length > 0) && (
                <div className="mb-4">
                  <div className="flex items-center gap-1.5 mb-2 text-[11px] font-bold uppercase tracking-wider px-1"
                    style={{ color: '#a16207' }}>
                    <Clock size={12} />
                    {pendingHeading} ({feriePending.length + cambiPending.length})
                  </div>
                  <div className="space-y-2">
                    {/* Ferie pending */}
                    {feriePending.map(f => {
                      const richiedente = mode === 'admin'
                        ? (mediciById.get(f.medico_id) ?? '?')
                        : null
                      return (
                        <div key={`fp-${f.id}`} className="rounded-lg border-2 p-3"
                          style={{ background: '#fef3c7', borderColor: '#fbbf24' }}>
                          <div className="flex items-start gap-3">
                            <div className="rounded-full p-1.5 shrink-0"
                              style={{ background: '#fde68a' }}>
                              <Plane size={13} style={{ color: '#a16207' }} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-baseline justify-between gap-2">
                                <span className="text-sm font-semibold text-stone-800 truncate">
                                  {mode === 'admin'
                                    ? <>Richiesta ferie da <strong>{richiedente}</strong></>
                                    : 'Richiesta ferie in attesa'}
                                </span>
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider shrink-0"
                                  style={{ background: '#fbbf24', color: '#78350f' }}>
                                  {mode === 'admin' ? 'DA APPROVARE' : 'IN ATTESA'}
                                </span>
                              </div>
                              <p className="text-xs text-stone-700 mt-1">
                                {f.data_inizio === f.data_fine
                                  ? <>Per il <strong>{fmtDataBreve(f.data_inizio)}</strong></>
                                  : <>Dal <strong>{fmtDataBreve(f.data_inizio)}</strong> al <strong>{fmtDataBreve(f.data_fine)}</strong></>}
                              </p>
                              <p className="text-[10px] text-stone-500 mt-1 font-mono">
                                Inviata il {fmtDataOra(f.created_at)}
                              </p>
                              {repartoLabel(f.medico_id) && (
                                <span className="inline-block mt-1 text-[10px] font-semibold px-1.5 py-0.5 rounded"
                                  style={{ background: '#e0e8d8', color: '#456b3a' }}>
                                  {repartoLabel(f.medico_id)}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                    {/* Cambi turno pending */}
                    {cambiPending.map(c => {
                      const richiedente = mediciById.get(c.medico_richiedente_id) ?? '?'
                      return (
                        <div key={`cp-${c.id}`} className="rounded-lg border-2 p-3"
                          style={{ background: '#fef3c7', borderColor: '#fbbf24' }}>
                          <div className="flex items-start gap-3">
                            <div className="rounded-full p-1.5 shrink-0"
                              style={{ background: '#fde68a' }}>
                              <ArrowRightLeft size={13} style={{ color: '#a16207' }} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-baseline justify-between gap-2">
                                <span className="text-sm font-semibold text-stone-800 truncate">
                                  {mode === 'admin'
                                    ? <>Richiesta cambio da <strong>{richiedente}</strong></>
                                    : 'Richiesta cambio turno in attesa'}
                                </span>
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider shrink-0"
                                  style={{ background: '#fbbf24', color: '#78350f' }}>
                                  {mode === 'admin' ? 'DA APPROVARE' : 'IN ATTESA'}
                                </span>
                              </div>
                              <p className="text-xs text-stone-700 mt-1">
                                {c.modifiche.length} modific{c.modifiche.length === 1 ? 'a' : 'he'} proposta{c.modifiche.length === 1 ? '' : ''}
                                {c.motivo && <span className="block italic text-stone-600 mt-0.5">"{c.motivo}"</span>}
                              </p>
                              {/* Dettagli sintetici delle modifiche (medico + data + TC da → a) */}
                              <div className="mt-2 space-y-0.5">
                                {c.modifiche.slice(0, 4).map((mod, idx) => (
                                  <div key={idx} className="text-[10px] text-stone-700 flex items-center gap-1.5 flex-wrap">
                                    <span className="font-semibold">
                                      {mediciById.get(mod.medico_id) ?? '?'}
                                    </span>
                                    <span className="font-mono text-stone-500">
                                      {fmtDataBreve(mod.data)}
                                    </span>
                                    <span className="font-mono px-1 rounded bg-white border border-stone-200">
                                      {mod.da.tc || '—'}
                                    </span>
                                    <ArrowRight size={9} />
                                    <span className="font-mono px-1 rounded bg-white border border-stone-300 font-semibold">
                                      {mod.a.tc || '—'}
                                    </span>
                                  </div>
                                ))}
                                {c.modifiche.length > 4 && (
                                  <div className="text-[10px] italic text-stone-500">
                                    …e altre {c.modifiche.length - 4} modific{c.modifiche.length - 4 === 1 ? 'a' : 'he'}
                                  </div>
                                )}
                              </div>
                              <p className="text-[10px] text-stone-500 mt-1 font-mono">
                                Inviata il {fmtDataOra(c.created_at)}
                              </p>
                              {repartoLabel(c.medico_richiedente_id) && (
                                <span className="inline-block mt-1 text-[10px] font-semibold px-1.5 py-0.5 rounded"
                                  style={{ background: '#e0e8d8', color: '#456b3a' }}>
                                  {repartoLabel(c.medico_richiedente_id)}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Header sezione "Storico messaggi" — visibile solo se ci sono
                  sia pending che messaggi (altrimenti la lista parla da sola) */}
              {(feriePending.length + cambiPending.length) > 0 && messaggi.length > 0 && (
                <div className="text-[11px] font-bold uppercase tracking-wider px-1 mb-2 text-stone-500">
                  Storico
                </div>
              )}

              {/* Lista messaggi paginati */}
              <div className="space-y-2">
              {pageSlice.map(m => {
                const cfg = TIPO_CONFIG[m.tipo]
                const Icon = cfg.Icon
                const isUnread = !m.letto
                return (
                  <button
                    key={m.id}
                    onClick={() => handleMarkRead(m)}
                    disabled={marking === m.id}
                    className="w-full text-left rounded-lg border p-3 transition-all hover:shadow-md"
                    style={{
                      background: isUnread ? '#fffbeb' : '#fafaf7',
                      borderColor: isUnread ? '#fbbf24' : '#e7e5e4',
                      cursor:      isUnread ? 'pointer' : 'default',
                      opacity:     marking === m.id ? 0.6 : 1,
                    }}>
                    <div className="flex items-start gap-3">
                      {/* Pallino non-letto + icona tipo */}
                      <div className="flex flex-col items-center gap-1 shrink-0 pt-0.5">
                        {isUnread && (
                          <span className="block w-2 h-2 rounded-full" style={{ background: '#d97706' }} />
                        )}
                        <div className="rounded-full p-1.5" style={{ background: cfg.bg }}>
                          <Icon size={13} style={{ color: cfg.color }} />
                        </div>
                      </div>
                      {/* Titolo + corpo + data */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-sm font-semibold text-stone-800 truncate">
                            {m.titolo}
                          </span>
                          <span className="text-[10px] text-stone-500 shrink-0 font-mono">
                            {fmtDataOra(m.created_at)}
                          </span>
                        </div>
                        {repartoLabel(m.medico_id) && (
                          <span className="inline-block mt-1 text-[10px] font-semibold px-1.5 py-0.5 rounded"
                            style={{ background: '#e0e8d8', color: '#456b3a' }}>
                            {repartoLabel(m.medico_id)}
                          </span>
                        )}
                        {m.corpo && (
                          <p className="text-xs text-stone-600 mt-1 leading-relaxed whitespace-pre-wrap">
                            {m.corpo}
                          </p>
                        )}
                      </div>
                    </div>
                  </button>
                )
              })}
              </div>
            </>
          )}
        </div>

        {/* Footer: paginazione compatta — << < [1] [2] (3) [4] [5] > >>
            Mostra max 5 numeri pagina centrati sulla corrente. Prima/ultima
            pagina come scorciatoie per liste lunghe.
            La sezione Pending (sopra) non e` interessata da questa paginazione.

            Stile bottoni icona: sfondo crema chiaro + bordo + color esplicito
            scuro cosi` si distinguono nettamente dallo sfondo bianco del modal.
            Prima erano transparent senza bordo → invisibili. */}
        {messaggi.length > PAGE_SIZE && (
          <div className="px-3 py-2 border-t border-stone-200 flex items-center justify-center gap-1.5 shrink-0">
            {/* Prima pagina */}
            <button onClick={() => setPage(0)}
              disabled={page === 0}
              className="flex items-center justify-center w-8 h-8 rounded border text-xs font-semibold disabled:opacity-30 transition-colors"
              style={{ background: '#faf8f3', borderColor: '#d5ccb8', color: '#3a3d30' }}
              onMouseEnter={e => { if (page !== 0) (e.currentTarget as HTMLElement).style.background = '#e0e8d8' }}
              onMouseLeave={e => { if (page !== 0) (e.currentTarget as HTMLElement).style.background = '#faf8f3' }}
              title="Prima pagina">
              <ChevronsLeft size={15} />
            </button>
            {/* Precedente */}
            <button onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="flex items-center justify-center w-8 h-8 rounded border text-xs font-semibold disabled:opacity-30 transition-colors"
              style={{ background: '#faf8f3', borderColor: '#d5ccb8', color: '#3a3d30' }}
              onMouseEnter={e => { if (page !== 0) (e.currentTarget as HTMLElement).style.background = '#e0e8d8' }}
              onMouseLeave={e => { if (page !== 0) (e.currentTarget as HTMLElement).style.background = '#faf8f3' }}
              title="Precedente">
              <ChevronLeft size={15} />
            </button>
            {/* Window di max 5 numeri pagina centrati sulla corrente */}
            {getPageWindow(page, totPagine, 5).map(p => {
              const isCurrent = p === page
              return (
                <button key={p}
                  onClick={() => setPage(p)}
                  className="flex items-center justify-center min-w-[32px] h-8 rounded border text-xs font-semibold transition-colors px-1.5"
                  style={isCurrent
                    ? { background: '#476540', borderColor: '#2b3c24', color: '#fff' }
                    : { background: '#faf8f3', borderColor: '#d5ccb8', color: '#3a3d30' }}
                  onMouseEnter={e => { if (!isCurrent) (e.currentTarget as HTMLElement).style.background = '#e0e8d8' }}
                  onMouseLeave={e => { if (!isCurrent) (e.currentTarget as HTMLElement).style.background = '#faf8f3' }}
                  title={`Pagina ${p + 1}`}>
                  {p + 1}
                </button>
              )
            })}
            {/* Successiva */}
            <button onClick={() => setPage(p => Math.min(totPagine - 1, p + 1))}
              disabled={page >= totPagine - 1}
              className="flex items-center justify-center w-8 h-8 rounded border text-xs font-semibold disabled:opacity-30 transition-colors"
              style={{ background: '#faf8f3', borderColor: '#d5ccb8', color: '#3a3d30' }}
              onMouseEnter={e => { if (page < totPagine - 1) (e.currentTarget as HTMLElement).style.background = '#e0e8d8' }}
              onMouseLeave={e => { if (page < totPagine - 1) (e.currentTarget as HTMLElement).style.background = '#faf8f3' }}
              title="Successiva">
              <ChevronRight size={15} />
            </button>
            {/* Ultima pagina */}
            <button onClick={() => setPage(totPagine - 1)}
              disabled={page >= totPagine - 1}
              className="flex items-center justify-center w-8 h-8 rounded border text-xs font-semibold disabled:opacity-30 transition-colors"
              style={{ background: '#faf8f3', borderColor: '#d5ccb8', color: '#3a3d30' }}
              onMouseEnter={e => { if (page < totPagine - 1) (e.currentTarget as HTMLElement).style.background = '#e0e8d8' }}
              onMouseLeave={e => { if (page < totPagine - 1) (e.currentTarget as HTMLElement).style.background = '#faf8f3' }}
              title="Ultima pagina">
              <ChevronsRight size={15} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
