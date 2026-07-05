/**
 * CentroControlloPage (solo admin)
 *
 * Hub di amministrazione del gestionale multi-reparto:
 *  1. Reparti  — crea / rinomina / attiva-disattiva / elimina i reparti
 *                (mondi isolati) + assegna i Responsabili (utenti globali).
 *  2. Utenti   — gestione utenti globali con livello (riusa GestioneUtentiPage).
 *
 * I Reparti hanno RLS modify = is_super_admin → solo l'admin opera qui.
 */

import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Building2, Plus, Trash2, Pencil, Save, X, UserCog, Power, Lock, Copy,
  AlertTriangle, Calendar, RefreshCw, RotateCcw, ChevronLeft, ChevronRight,
  History, Loader2, Construction,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { registraEventoCentro, type CentroEvento, type CentroEventoTipo } from '../../lib/centroLog'
import { useConfirm } from '../../hooks/useConfirm'
import { ConfirmModal } from '../../components/ConfirmModal'
import { Navigate } from 'react-router-dom'
import { GestioneUtentiPage } from './GestioneUtentiPage'
import { DatabaseStatsBox } from '../../components/DatabaseStatsBox'
import { ImpostazioniBackupBox } from '../../components/ImpostazioniBackupBox'
import { REPARTO_11N, useReparto } from '../../contexts/RepartoContext'
import type { Reparto, RepartoResponsabile, UtenteAutorizzato } from '../../types'

/** Parola casuale 4-10 caratteri alfanumerici (niente speciali, niente
 *  caratteri ambigui) da riscrivere a mano per confermare un'eliminazione. */
function generaParolaConferma(): string {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789'   // no 0/o/1/l ambigui
  const len = 4 + Math.floor(Math.random() * 7)      // 4..10
  let w = ''
  for (let i = 0; i < len; i++) w += chars[Math.floor(Math.random() * chars.length)]
  return w
}

function RepartiSection() {
  const qc = useQueryClient()
  const { confirm, confirmState } = useConfirm()
  const [nuovoNome, setNuovoNome] = useState('')
  const [editId, setEditId]       = useState<string | null>(null)
  const [editNome, setEditNome]   = useState('')
  const [addRespFor, setAddRespFor] = useState<string | null>(null)
  const [copyFor, setCopyFor]       = useState<string | null>(null)
  const [err, setErr]             = useState('')
  // Modal eliminazione reparto: 2 passi (avviso → riscrivi-parola).
  const [delFor, setDelFor]       = useState<Reparto | null>(null)
  const [delStep, setDelStep]     = useState<'warn' | 'confirm'>('warn')
  const [delWord, setDelWord]     = useState('')
  const [delTyped, setDelTyped]   = useState('')
  const [delBusy, setDelBusy]     = useState(false)

  const { data: reparti = [] } = useQuery<Reparto[]>({
    queryKey: ['reparti'],
    queryFn: async () => {
      const { data, error } = await supabase.from('reparti').select('*')
        .order('attivo', { ascending: false }).order('nome')
      if (error) throw error
      return (data ?? []) as Reparto[]
    },
  })
  const { data: responsabili = [] } = useQuery<RepartoResponsabile[]>({
    queryKey: ['reparto_responsabili'],
    queryFn: async () => {
      const { data, error } = await supabase.from('reparto_responsabili').select('*')
      if (error) throw error
      return (data ?? []) as RepartoResponsabile[]
    },
  })
  const { data: utenti = [] } = useQuery<UtenteAutorizzato[]>({
    queryKey: ['utenti_autorizzati'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_all_utenti_autorizzati')
      if (error) throw error
      return (data ?? []) as UtenteAutorizzato[]
    },
    staleTime: 0,
  })

  const utenteById = (id: string) => utenti.find(u => u.id === id)
  const reload = () => {
    qc.invalidateQueries({ queryKey: ['reparti'] })
    qc.invalidateQueries({ queryKey: ['reparto_responsabili'] })
  }

  async function crea() {
    const nome = nuovoNome.trim()
    if (!nome) return
    setErr('')
    // Reparto NUOVO = vuoto (niente copia automatica). Il setup si copia poi
    // a richiesta con l'icona "Copia da reparto".
    const { data, error } = await supabase.from('reparti').insert({ nome }).select('id').single()
    if (error) { setErr(error.message); return }
    await registraEventoCentro('reparto_creato', data?.id ?? null, nome, `Creato il reparto "${nome}".`)
    setNuovoNome(''); reload(); qc.invalidateQueries({ queryKey: ['centro-eventi'] })
  }
  async function salvaNome(id: string) {
    const nome = editNome.trim(); if (!nome) return
    setErr('')
    const { error } = await supabase.from('reparti').update({ nome }).eq('id', id)
    if (error) { setErr(error.message); return }
    setEditId(null); reload()
  }
  async function toggleAttivo(r: Reparto) {
    setErr('')
    const nuovoAttivo = !r.attivo
    const { error } = await supabase.from('reparti').update({ attivo: nuovoAttivo }).eq('id', r.id)
    if (error) { setErr(error.message); return }
    // Log SOLO della disattivazione (da spec). La riattivazione non è tracciata.
    if (!nuovoAttivo) {
      await registraEventoCentro('reparto_disattivato', r.id, r.nome, `Disattivato il reparto "${r.nome}".`)
      qc.invalidateQueries({ queryKey: ['centro-eventi'] })
    }
    reload()
  }
  // Modalità manutenzione: le viste pubbliche del reparto mostrano un messaggio
  // a tutti tranne super-admin e responsabili del reparto (gate lato viste).
  async function toggleManutenzione(r: Reparto) {
    setErr('')
    const { error } = await supabase.from('reparti')
      .update({ in_manutenzione: !r.in_manutenzione }).eq('id', r.id)
    if (error) { setErr(error.message); return }
    reload()
  }
  // Eliminazione reparto: apre il modal a 2 passi (avviso → riscrivi-parola).
  // NIENTE più blocco "svuotalo prima": il reparto viene eliminato con TUTTI i
  // suoi dati (solo suoi) tramite la RPC elimina_reparto, dietro conferma forte.
  function apriElimina(r: Reparto) {
    if (r.id === REPARTO_11N) return
    setErr('')
    setDelFor(r); setDelStep('warn'); setDelWord(generaParolaConferma()); setDelTyped('')
  }
  async function confermaElimina() {
    if (!delFor) return
    if (delTyped.trim().toLowerCase() !== delWord.toLowerCase()) return
    setDelBusy(true); setErr('')
    const { error } = await supabase.rpc('elimina_reparto', { p_reparto: delFor.id })
    setDelBusy(false)
    if (error) { setErr(error.message); return }
    setDelFor(null); setDelStep('warn'); setDelTyped('')
    qc.invalidateQueries({ queryKey: ['reparti-gestiti'] })
    qc.invalidateQueries({ queryKey: ['centro-eventi'] })
    reload()
  }

  async function copiaSetup(targetId: string, sourceId: string) {
    const src = reparti.find(x => x.id === sourceId)
    const ok = await confirm({
      title:        'Copia setup da reparto',
      message:      `Copia da "${src?.nome}" in questo reparto: turnisti e ospiti, festività, tipi di turno, proprietà e schemi. NON copia i turni (il calendario va generato dopo) né ferie/cambi. Procedere?`,
      confirmLabel: 'Copia',
    })
    if (!ok) return
    setErr('')
    const { error } = await supabase.rpc('copia_setup_reparto', { p_target: targetId, p_source: sourceId })
    if (error) { setErr(error.message); return }
    setCopyFor(null)
    qc.invalidateQueries({ queryKey: ['tipi_turno'] })
    qc.invalidateQueries({ queryKey: ['proprieta_turno'] })
    qc.invalidateQueries({ queryKey: ['schemi_modello'] })
    qc.invalidateQueries({ queryKey: ['configurazione'] })
    reload()
  }
  async function aggiungiResp(repId: string, utenteId: string) {
    setErr('')
    const { error } = await supabase.from('reparto_responsabili')
      .insert({ reparto_id: repId, utente_id: utenteId })
    if (error) { setErr(error.message); return }
    setAddRespFor(null); reload()
  }
  async function rimuoviResp(repId: string, utenteId: string) {
    setErr('')
    const { error } = await supabase.from('reparto_responsabili')
      .delete().eq('reparto_id', repId).eq('utente_id', utenteId)
    if (error) { setErr(error.message); return }
    reload()
  }

  return (
    <div className="space-y-4">
      <ConfirmModal {...confirmState.opts} open={confirmState.open}
        onConfirm={confirmState.onConfirm} onCancel={confirmState.onCancel} />

      {/* Modal eliminazione reparto — 2 passi: avviso pericolosità → riscrivi
          la parola a mano (copia-incolla disabilitato) → Cancella. */}
      {delFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3"
          style={{ background: 'rgba(0,0,0,0.55)' }}
          onClick={() => !delBusy && setDelFor(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-5"
            onClick={e => e.stopPropagation()}>
            {delStep === 'warn' ? (
              <>
                <h3 className="font-bold text-red-700 text-base mb-2 flex items-center gap-2">
                  <AlertTriangle size={18} /> Elimina "{delFor.nome}"
                </h3>
                <div className="text-sm text-stone-700 space-y-2 mb-4">
                  <p>Stai per eliminare <strong>definitivamente</strong> il reparto <strong>"{delFor.nome}"</strong> e <strong>tutti i suoi dati</strong>:</p>
                  <ul className="list-disc pl-5 text-xs text-stone-600 space-y-0.5">
                    <li>turnisti, ospiti e responsabili</li>
                    <li>turni, ferie e cambi turno</li>
                    <li>schemi, tipi/proprietà di turno e festività</li>
                    <li>anteprime, backup e notifiche del reparto</li>
                  </ul>
                  <p className="text-red-700 font-semibold">L'azione è irreversibile e riguarda SOLO questo reparto: gli altri reparti non vengono toccati.</p>
                  {delFor.attivo && (
                    <p className="text-amber-700 text-xs bg-amber-50 border border-amber-200 rounded px-2 py-1">
                      ⚠️ Il reparto è ancora <strong>attivo</strong>: valuta se disattivarlo prima.
                    </p>
                  )}
                </div>
                <div className="flex justify-end gap-2">
                  <button onClick={() => setDelFor(null)} className="btn-secondary text-sm py-2 px-4">Annulla</button>
                  <button onClick={() => setDelStep('confirm')}
                    className="inline-flex items-center gap-1.5 text-sm py-2 px-4 rounded-lg font-semibold text-white transition-opacity hover:opacity-90"
                    style={{ background: '#dc2626' }}>
                    Continua <ChevronRight size={15} />
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3 className="font-bold text-red-700 text-base mb-2 flex items-center gap-2">
                  <AlertTriangle size={18} /> Conferma eliminazione
                </h3>
                <p className="text-sm text-stone-700 mb-1">
                  Per confermare l'eliminazione di <strong>"{delFor.nome}"</strong>, riscrivi <strong>a mano</strong> questa parola
                  <span className="text-stone-500"> (copia-incolla disabilitato)</span>:
                </p>
                <div className="text-center my-3">
                  <span className="inline-block px-4 py-2 rounded-lg text-lg font-mono font-bold select-none"
                    style={{ background: '#fee2e2', color: '#991b1b', letterSpacing: '0.35em' }}>
                    {delWord}
                  </span>
                </div>
                <input
                  value={delTyped}
                  onChange={e => setDelTyped(e.target.value)}
                  onPaste={e => e.preventDefault()}
                  onDrop={e => e.preventDefault()}
                  onContextMenu={e => e.preventDefault()}
                  autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
                  placeholder="Riscrivi qui la parola"
                  className="input text-sm w-full text-center font-mono tracking-widest" autoFocus />
                <div className="flex justify-end gap-2 mt-4">
                  <button onClick={() => setDelFor(null)} disabled={delBusy} className="btn-secondary text-sm py-2 px-4">Annulla</button>
                  <button onClick={confermaElimina}
                    disabled={delBusy || delTyped.trim().toLowerCase() !== delWord.toLowerCase()}
                    className="inline-flex items-center gap-1.5 text-sm py-2 px-4 rounded-lg font-semibold text-white disabled:opacity-40"
                    style={{ background: '#dc2626' }}>
                    {delBusy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Cancella definitivamente
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <div>
        <h2 className="text-xl font-bold text-stone-800 flex items-center gap-2">
          <Building2 size={20} style={{ color: '#476540' }} />
          Reparti
        </h2>
        <p className="text-sm text-stone-600 mt-0.5">
          Ogni reparto è un mondo a sé: turni e turnisti propri. Assegna i Responsabili che lo gestiranno.
        </p>
      </div>

      {err && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{err}</div>
      )}

      {/* Crea reparto */}
      <div className="card p-3 flex items-end gap-2">
        <div className="flex-1">
          <label className="label text-xs">Nuovo reparto</label>
          <input value={nuovoNome} onChange={e => setNuovoNome(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && crea()}
            placeholder="Es. Sub-intensiva, Pronto Soccorso…" className="input text-sm" />
        </div>
        <button onClick={crea} disabled={!nuovoNome.trim()} className="btn-primary text-sm">
          <Plus size={15} /> Crea
        </button>
      </div>

      {/* Lista reparti */}
      <div className="space-y-2">
        {reparti.map(r => {
          const resp = responsabili.filter(x => x.reparto_id === r.id)
          const utentiDisponibili = utenti.filter(u =>
            u.attivo && !resp.some(x => x.utente_id === u.id))
          // Reparto disattivato = "congelato": l'UNICO pulsante cliccabile è
          // Riattiva (Power). Rinomina/Manutenzione/Copia/Elimina e la gestione
          // Responsabili restano visibili ma disabilitati finché non si riattiva.
          const bloccato = !r.attivo
          return (
            <div key={r.id} className="card p-3" style={{ opacity: r.attivo ? 1 : 0.6 }}>
              <div className="flex items-center gap-2">
                {editId === r.id ? (
                  <>
                    <input value={editNome} onChange={e => setEditNome(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && salvaNome(r.id)}
                      className="input text-sm py-1 flex-1" autoFocus />
                    <button onClick={() => salvaNome(r.id)} className="btn-primary py-1 px-2 text-xs gap-1">
                      <Save size={12} /> Salva
                    </button>
                    <button onClick={() => setEditId(null)} className="btn-secondary py-1 px-1.5 text-xs">
                      <X size={12} />
                    </button>
                  </>
                ) : (
                  <>
                    <span className="font-bold text-stone-800 flex items-center gap-2">
                      {r.nome}
                      {r.id === REPARTO_11N && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-stone-200 text-stone-600 inline-flex items-center gap-1">
                          <Lock size={9} /> principale
                        </span>
                      )}
                      {!r.attivo && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">disattivato</span>
                      )}
                      {r.in_manutenzione && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded inline-flex items-center gap-1"
                          style={{ background: '#fef08a', color: '#854d0e' }}>
                          <Construction size={9} /> in manutenzione
                        </span>
                      )}
                    </span>
                    <div className="ml-auto flex items-center gap-1">
                      <button onClick={() => { setEditId(r.id); setEditNome(r.nome) }}
                        disabled={bloccato}
                        className={`p-1.5 rounded ${bloccato ? 'text-stone-300 cursor-not-allowed' : 'text-stone-500 hover:text-blue-600 hover:bg-blue-50'}`}
                        title={bloccato ? 'Reparto disattivato — riattivalo per gestirlo' : 'Rinomina'}>
                        <Pencil size={14} />
                      </button>
                      {/* Riattiva (Power): SEMPRE cliccabile, anche su reparto disattivato. */}
                      <button onClick={() => toggleAttivo(r)}
                        className="p-1.5 rounded text-stone-500 hover:text-amber-600 hover:bg-amber-50"
                        title={r.attivo ? 'Disattiva' : 'Riattiva'}>
                        <Power size={14} />
                      </button>
                      <button onClick={() => toggleManutenzione(r)}
                        disabled={bloccato}
                        className="p-1.5 rounded transition-colors"
                        style={bloccato
                          ? { color: '#d6d3d1', cursor: 'not-allowed' }
                          : r.in_manutenzione ? { color: '#fff', background: '#eab308' } : { color: '#78716c' }}
                        onMouseEnter={e => { if (!bloccato && !r.in_manutenzione) { e.currentTarget.style.color = '#ca8a04'; e.currentTarget.style.background = '#fefce8' } }}
                        onMouseLeave={e => { if (!bloccato && !r.in_manutenzione) { e.currentTarget.style.color = '#78716c'; e.currentTarget.style.background = 'transparent' } }}
                        title={bloccato ? 'Reparto disattivato — riattivalo per gestirlo' : r.in_manutenzione ? 'Manutenzione ATTIVA — clicca per disattivare' : 'Attiva modalità manutenzione (i turnisti vedono un avviso)'}>
                        <Construction size={14} />
                      </button>
                      {r.id !== REPARTO_11N && (
                        <button onClick={() => setCopyFor(copyFor === r.id ? null : r.id)}
                          disabled={bloccato}
                          className={`p-1.5 rounded ${bloccato ? 'text-stone-300 cursor-not-allowed' : 'text-stone-500 hover:text-green-700 hover:bg-green-50'}`}
                          title={bloccato ? 'Reparto disattivato — riattivalo per gestirlo' : 'Copia turnisti, festività, tipi, proprietà e schemi da un altro reparto (non i turni)'}>
                          <Copy size={14} />
                        </button>
                      )}
                      {r.id !== REPARTO_11N && (
                        <button onClick={() => apriElimina(r)}
                          disabled={bloccato}
                          className={`p-1.5 rounded ${bloccato ? 'text-stone-300 cursor-not-allowed' : 'text-stone-500 hover:text-red-600 hover:bg-red-50'}`}
                          title={bloccato ? 'Reparto disattivato — riattivalo per gestirlo' : 'Elimina'}>
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>

              {/* Responsabili */}
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-stone-500 inline-flex items-center gap-1">
                  <UserCog size={12} /> Responsabili:
                </span>
                {resp.length === 0 && <span className="text-[11px] text-stone-400 italic">nessuno</span>}
                {resp.map(x => {
                  const u = utenteById(x.utente_id)
                  return (
                    <span key={x.utente_id}
                      className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full"
                      style={{ background: '#e8f0e0', color: '#2b4a28' }}>
                      {u?.nome || u?.email || '—'}
                      <button onClick={() => rimuoviResp(r.id, x.utente_id)}
                        disabled={bloccato}
                        className={bloccato ? 'text-stone-300 cursor-not-allowed' : 'hover:text-red-600'}
                        title={bloccato ? 'Reparto disattivato' : 'Rimuovi'}>
                        <X size={11} />
                      </button>
                    </span>
                  )
                })}
                {/* Su reparto disattivato niente aggiunta responsabili. */}
                {bloccato ? null : addRespFor === r.id ? (
                  <select autoFocus defaultValue=""
                    onChange={e => e.target.value && aggiungiResp(r.id, e.target.value)}
                    onBlur={() => setAddRespFor(null)}
                    className="input text-[11px] py-0.5 w-44">
                    <option value="" disabled>Scegli utente…</option>
                    {utentiDisponibili.map(u => (
                      <option key={u.id} value={u.id}>{u.nome || u.email}</option>
                    ))}
                  </select>
                ) : (
                  <button onClick={() => setAddRespFor(r.id)}
                    className="inline-flex items-center gap-0.5 text-[11px] px-1.5 py-0.5 rounded-full border border-dashed border-stone-300 text-stone-500 hover:bg-stone-50">
                    <Plus size={11} /> aggiungi
                  </button>
                )}
              </div>

              {/* Copia setup da un altro reparto (per reparti nuovi/vuoti) */}
              {copyFor === r.id && !bloccato && (
                <div className="mt-2 flex items-center gap-2 text-xs bg-green-50 border border-green-200 rounded p-2">
                  <Copy size={13} className="text-green-700 shrink-0" />
                  <span className="text-stone-600">Copia tipi/schemi/regole da:</span>
                  <select autoFocus defaultValue=""
                    onChange={e => e.target.value && copiaSetup(r.id, e.target.value)}
                    className="input text-xs py-0.5 w-44">
                    <option value="" disabled>Scegli reparto…</option>
                    {reparti.filter(x => x.id !== r.id).map(x => (
                      <option key={x.id} value={x.id}>{x.nome}</option>
                    ))}
                  </select>
                  <button onClick={() => setCopyFor(null)} className="text-stone-400 hover:text-stone-700">
                    <X size={13} />
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Log eventi (notifiche di sistema) ────────────────────────────────────────
const EVENTO_CFG: Record<CentroEventoTipo, { Icon: typeof Plus; color: string; bg: string; label: string }> = {
  reparto_creato:          { Icon: Plus,      color: '#166534', bg: '#dcfce7', label: 'Reparto creato' },
  calendario_generato:     { Icon: Calendar,  color: '#1d4ed8', bg: '#dbeafe', label: 'Calendario generato' },
  aggiornamento_approvato: { Icon: RefreshCw, color: '#0e7490', bg: '#cffafe', label: 'Aggiornamento approvato' },
  backup_ripristinato:     { Icon: RotateCcw, color: '#7c3aed', bg: '#ede9fe', label: 'Backup ripristinato' },
  reparto_disattivato:     { Icon: Power,     color: '#a16207', bg: '#fef3c7', label: 'Reparto disattivato' },
  reparto_eliminato:       { Icon: Trash2,    color: '#991b1b', bg: '#fee2e2', label: 'Reparto eliminato' },
}
const fmtEventoData = (iso: string) => {
  const d = new Date(iso); const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)} ${p(d.getHours())}:${p(d.getMinutes())}`
}
const LOG_PER_PAGE = 10

function CentroLogSection() {
  const [page, setPage] = useState(0)
  const { data: eventi = [], isLoading } = useQuery<CentroEvento[]>({
    queryKey: ['centro-eventi'],
    queryFn: async () => {
      const { data, error } = await supabase.from('centro_eventi').select('*')
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as CentroEvento[]
    },
    staleTime: 0, refetchOnMount: 'always',
  })
  const totPag  = Math.max(1, Math.ceil(eventi.length / LOG_PER_PAGE))
  const curPage = Math.min(page, totPag - 1)
  const slice   = useMemo(
    () => eventi.slice(curPage * LOG_PER_PAGE, (curPage + 1) * LOG_PER_PAGE),
    [eventi, curPage],
  )

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-xl font-bold text-stone-800 flex items-center gap-2">
          <History size={20} style={{ color: '#476540' }} />
          Notifiche di sistema
        </h2>
        <p className="text-sm text-stone-600 mt-0.5">
          Registro degli eventi importanti: creazione, generazione del calendario, aggiornamenti approvati,
          ripristino di backup, disattivazione ed eliminazione dei reparti. Resta traccia anche dei reparti eliminati.
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-stone-500 text-sm py-6">
          <Loader2 size={16} className="animate-spin" /> Caricamento…
        </div>
      ) : eventi.length === 0 ? (
        <div className="card p-6 text-sm text-stone-500 text-center">
          Nessun evento registrato finora.
        </div>
      ) : (
        <>
          <div className="rounded-lg border border-stone-200 divide-y divide-stone-100 bg-white">
            {slice.map(ev => {
              const cfg = EVENTO_CFG[ev.tipo] ?? { Icon: History, color: '#57534e', bg: '#e7e5e4', label: ev.tipo }
              const Icon = cfg.Icon
              return (
                <div key={ev.id} className="flex items-start gap-3 px-3 py-2.5">
                  <div className="rounded-full p-1.5 shrink-0 mt-0.5" style={{ background: cfg.bg }}>
                    <Icon size={13} style={{ color: cfg.color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-semibold text-stone-800 truncate">
                        {cfg.label} · <span className="font-normal text-stone-600">{ev.reparto_nome}</span>
                      </span>
                      <span className="text-[10px] text-stone-400 font-mono shrink-0">{fmtEventoData(ev.created_at)}</span>
                    </div>
                    {ev.descrizione && (
                      <p className="text-xs text-stone-600 mt-0.5 leading-relaxed">{ev.descrizione}</p>
                    )}
                    {ev.autore && (
                      <p className="text-[10px] text-stone-400 mt-0.5 font-mono">{ev.autore}</p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {eventi.length > LOG_PER_PAGE && (
            <div className="flex items-center justify-center gap-2">
              <button onClick={() => setPage(Math.max(0, curPage - 1))} disabled={curPage === 0}
                className="flex items-center justify-center w-8 h-8 rounded border text-xs disabled:opacity-30"
                style={{ background: '#faf8f3', borderColor: '#d5ccb8', color: '#3a3d30' }}>
                <ChevronLeft size={15} />
              </button>
              <span className="text-xs text-stone-500 font-medium">
                Pagina {curPage + 1} di {totPag}
              </span>
              <button onClick={() => setPage(Math.min(totPag - 1, curPage + 1))} disabled={curPage >= totPag - 1}
                className="flex items-center justify-center w-8 h-8 rounded border text-xs disabled:opacity-30"
                style={{ background: '#faf8f3', borderColor: '#d5ccb8', color: '#3a3d30' }}>
                <ChevronRight size={15} />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export function CentroControlloPage() {
  const { isSuperAdmin } = useReparto()
  // Solo il super-admin: gestione reparti, utenti globali, responsabili.
  // Un responsabile (admin del suo reparto) NON deve vederlo.
  if (!isSuperAdmin) return <Navigate to="/admin/medici" replace />
  return (
    <div className="space-y-6">
      {/* Masonry a larghezza fissa: entrano quante più colonne possibili
          (larghezza minima ~620px = quella attuale +10%), altrimenti si va a
          capo. Sfrutta tutta la larghezza dell'area admin (che non ha cap).
          TUTTI i riquadri (Utenti compreso) sono nel masonry → riempiono anche
          lo spazio vuoto sotto le colonne più corte. */}
      <div className="columns-[620px] gap-6 [&>*]:mb-6 [&>*]:break-inside-avoid">
        {/* Ogni sezione in un riquadro con ombra + gradiente distinto: i card
            bianchi interni risaltano sul gradiente e le sezioni si distinguono. */}
        <div className="rounded-2xl shadow-lg p-4 border border-black/5" style={{ background: 'linear-gradient(135deg,#eef1f5 0%,#dfe6ee 100%)' }}>
          <DatabaseStatsBox />
        </div>
        <div className="rounded-2xl shadow-lg p-4 border border-black/5" style={{ background: 'linear-gradient(135deg,#eef7e8 0%,#dcecd0 100%)' }}>
          <RepartiSection />
        </div>
        <div className="rounded-2xl shadow-lg p-4 border border-black/5" style={{ background: 'linear-gradient(135deg,#eaf3fb 0%,#d7e7f6 100%)' }}>
          <CentroLogSection />
        </div>
        <div className="rounded-2xl shadow-lg p-4 border border-black/5" style={{ background: 'linear-gradient(135deg,#f3eefb 0%,#e5daf6 100%)' }}>
          <ImpostazioniBackupBox />
        </div>
        <div className="rounded-2xl shadow-lg p-4 border border-black/5" style={{ background: 'linear-gradient(135deg,#fbf5e8 0%,#f4e6cf 100%)' }}>
          <GestioneUtentiPage />
        </div>
      </div>
    </div>
  )
}
