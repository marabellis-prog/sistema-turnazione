/**
 * MessaggiModal
 *
 * Casella di posta personale per i medici turnisti. Si apre dall'icona busta
 * nella NavBar. Mostra i messaggi del medico loggato in ordine cronologico
 * inverso (piu` recente in cima), paginati a 20 per pagina.
 *
 * Funzionalita`:
 *   - Click su un messaggio non letto → marca come letto (UPDATE messaggi.letto)
 *   - "Marca tutti come letti" → bulk update di tutti i non letti
 *   - Paginazione: prev/next con numero pagina visibile
 *   - Icona + colore per tipo (cambio ✓/✗/⟲ vs ferie 🌴 ✓/✗)
 *
 * NB: l'INSERT su messaggi e` riservato all'admin via policy m_insert.
 *     Qui l'utente fa solo SELECT e UPDATE.letto, gia` consentiti dalla
 *     policy m_select/m_update.
 */

import { useState, useMemo, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Mail, Check, X, RotateCcw, Plane, ChevronLeft, ChevronRight,
  CheckCheck, Loader2, Clock, ArrowRightLeft, ArrowRight,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useFerieRealtime } from '../hooks/useFerieRealtime'
import { useCambiTurnoRealtime } from '../hooks/useCambiTurnoRealtime'
import type {
  Medico, Messaggio, TipoMessaggio, Ferie, CambioTurno,
} from '../types'

const PAGE_SIZE = 20

interface Props {
  medico:  Medico
  onClose: () => void
}

/** Configurazione visiva per ogni tipo di messaggio. */
const TIPO_CONFIG: Record<TipoMessaggio, {
  Icon:  typeof Check
  color: string
  bg:    string
  label: string
}> = {
  cambio_approvato:    { Icon: Check,     color: '#166534', bg: '#dcfce7', label: 'Cambio turno approvato' },
  cambio_rifiutato:    { Icon: X,         color: '#991b1b', bg: '#fee2e2', label: 'Cambio turno rifiutato' },
  cambio_ripristinato: { Icon: RotateCcw, color: '#a16207', bg: '#fef3c7', label: 'Cambio turno ripristinato' },
  ferie_approvate:     { Icon: Plane,     color: '#166534', bg: '#dcfce7', label: 'Ferie approvate' },
  ferie_rifiutate:     { Icon: Plane,     color: '#991b1b', bg: '#fee2e2', label: 'Ferie rifiutate' },
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

export function MessaggiModal({ medico, onClose }: Props) {
  const qc = useQueryClient()
  const [page,    setPage]    = useState(0)
  const [marking, setMarking] = useState<string | null>(null)
  const [bulkLoading, setBulkLoading] = useState(false)

  // Realtime su ferie e cambi turno: cosi` se il medico apre il modal e
  // submitta una nuova richiesta (es. da un'altra tab) o viene approvata
  // dall'admin, le sezioni "in attesa" si aggiornano automaticamente.
  useFerieRealtime()
  useCambiTurnoRealtime()

  // ── Query messaggi del medico ─────────────────────────────────────
  // Tutti in una sola fetch (max ~poche centinaia in pratica). La
  // paginazione e` client-side per semplicita`. Se in futuro i volumi
  // crescono molto, si puo` passare a range/offset DB.
  const { data: messaggi = [], isLoading } = useQuery<Messaggio[]>({
    queryKey: ['messaggi', medico.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('messaggi').select('*')
        .eq('medico_id', medico.id)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as Messaggio[]
    },
    staleTime: 0,
    refetchOnMount: 'always',
  })

  // ── Richieste in attesa del medico (ferie + cambi turno) ──────────
  // QueryKey con prefisso 'ferie' / 'cambi-turno' cosi` le invalidazioni
  // partial-match dei realtime hook (useFerieRealtime / useCambiTurnoRealtime)
  // toccano anche queste query. L'utente vede le proprie pending in cima
  // alla lista, indipendentemente dalla data di inserimento.
  const { data: feriePending = [] } = useQuery<Ferie[]>({
    queryKey: ['ferie', 'pending-mie', medico.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ferie').select('*')
        .eq('medico_id', medico.id)
        .eq('approvate', false)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data ?? []
    },
    staleTime: 0,
    refetchOnMount: 'always',
  })
  const { data: cambiPending = [] } = useQuery<CambioTurno[]>({
    queryKey: ['cambi-turno', 'pending-miei', medico.id],
    queryFn: async () => {
      // RLS ct_select filtra gia` per medico_richiedente_id = my_medico_id().
      // L'eq('medico_richiedente_id') e` superfluo ma esplicito per chiarezza.
      const { data, error } = await supabase
        .from('cambi_turno').select('*')
        .eq('medico_richiedente_id', medico.id)
        .eq('stato', 'pending')
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as CambioTurno[]
    },
    staleTime: 0,
    refetchOnMount: 'always',
  })

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
      qc.invalidateQueries({ queryKey: ['messaggi', medico.id] })
      qc.invalidateQueries({ queryKey: ['messaggi-unread-count', medico.id] })
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
      const { error } = await supabase.from('messaggi')
        .update({ letto: true })
        .eq('medico_id', medico.id)
        .eq('letto',     false)
      if (error) throw error
      qc.invalidateQueries({ queryKey: ['messaggi', medico.id] })
      qc.invalidateQueries({ queryKey: ['messaggi-unread-count', medico.id] })
    } catch (e) {
      console.error('[messaggi] bulk mark-as-read:', (e as Error).message)
    } finally {
      setBulkLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3"
      style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(2px)' }}
      onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl flex flex-col w-full"
        style={{ maxWidth: 'min(96vw, 680px)', maxHeight: '92vh' }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-stone-200 shrink-0">
          <div className="flex items-center gap-3">
            <Mail size={20} style={{ color: '#476540' }} />
            <div>
              <h3 className="font-bold text-stone-800 text-base">Casella messaggi</h3>
              <p className="text-xs text-stone-500">
                {messaggi.length === 0
                  ? 'Nessun messaggio'
                  : `${messaggi.length} messagg${messaggi.length === 1 ? 'io' : 'i'}`}
                {unreadCount > 0 && <span className="ml-1 font-semibold" style={{ color: '#d97706' }}>
                  · {unreadCount} non lett{unreadCount === 1 ? 'o' : 'i'}
                </span>}
                {(feriePending.length + cambiPending.length) > 0 && (
                  <span className="ml-1 font-semibold" style={{ color: '#a16207' }}>
                    · {feriePending.length + cambiPending.length} in attesa
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
              Nessun messaggio. Le notifiche su cambi turno e ferie compariranno qui.
            </div>
          ) : (
            <>
              {/* ── Sezione "In attesa di approvazione" — SEMPRE in cima ── */}
              {(feriePending.length > 0 || cambiPending.length > 0) && (
                <div className="mb-4">
                  <div className="flex items-center gap-1.5 mb-2 text-[11px] font-bold uppercase tracking-wider px-1"
                    style={{ color: '#a16207' }}>
                    <Clock size={12} />
                    In attesa di approvazione ({feriePending.length + cambiPending.length})
                  </div>
                  <div className="space-y-2">
                    {/* Ferie pending */}
                    {feriePending.map(f => (
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
                                Richiesta ferie in attesa
                              </span>
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider shrink-0"
                                style={{ background: '#fbbf24', color: '#78350f' }}>
                                IN ATTESA
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
                          </div>
                        </div>
                      </div>
                    ))}
                    {/* Cambi turno pending */}
                    {cambiPending.map(c => (
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
                                Richiesta cambio turno in attesa
                              </span>
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider shrink-0"
                                style={{ background: '#fbbf24', color: '#78350f' }}>
                                IN ATTESA
                              </span>
                            </div>
                            <p className="text-xs text-stone-700 mt-1">
                              {c.modifiche.length} modific{c.modifiche.length === 1 ? 'a' : 'he'} proposta{c.modifiche.length === 1 ? '' : ''}
                              {c.motivo && <span className="block italic text-stone-600 mt-0.5">"{c.motivo}"</span>}
                            </p>
                            {/* Dettagli sintetici delle modifiche (TC da → a) */}
                            <div className="mt-2 space-y-0.5">
                              {c.modifiche.slice(0, 3).map((mod, idx) => (
                                <div key={idx} className="text-[10px] text-stone-600 flex items-center gap-1.5">
                                  <span className="font-mono">{fmtDataBreve(mod.data)}</span>
                                  <span className="font-mono px-1 rounded bg-white border border-stone-200">
                                    {mod.da.tc || '—'}
                                  </span>
                                  <ArrowRight size={9} />
                                  <span className="font-mono px-1 rounded bg-white border border-stone-300 font-semibold">
                                    {mod.a.tc || '—'}
                                  </span>
                                </div>
                              ))}
                              {c.modifiche.length > 3 && (
                                <div className="text-[10px] italic text-stone-500">
                                  …e altre {c.modifiche.length - 3} modific{c.modifiche.length - 3 === 1 ? 'a' : 'he'}
                                </div>
                              )}
                            </div>
                            <p className="text-[10px] text-stone-500 mt-1 font-mono">
                              Inviata il {fmtDataOra(c.created_at)}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
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

        {/* Footer: paginazione */}
        {messaggi.length > PAGE_SIZE && (
          <div className="px-4 py-2 border-t border-stone-200 flex items-center justify-between shrink-0">
            <button onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold disabled:opacity-30 transition-opacity">
              <ChevronLeft size={13} /> Prec
            </button>
            <span className="text-xs text-stone-600">
              Pagina <strong>{page + 1}</strong> di <strong>{totPagine}</strong>
            </span>
            <button onClick={() => setPage(p => Math.min(totPagine - 1, p + 1))}
              disabled={page >= totPagine - 1}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold disabled:opacity-30 transition-opacity">
              Succ <ChevronRight size={13} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
