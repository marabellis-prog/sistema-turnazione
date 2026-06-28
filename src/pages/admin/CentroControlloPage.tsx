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

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Building2, Plus, Trash2, Pencil, Save, X, UserCog, Power, Lock,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useConfirm } from '../../hooks/useConfirm'
import { ConfirmModal } from '../../components/ConfirmModal'
import { GestioneUtentiPage } from './GestioneUtentiPage'
import { REPARTO_11N } from '../../contexts/RepartoContext'
import type { Reparto, RepartoResponsabile, UtenteAutorizzato } from '../../types'

function RepartiSection() {
  const qc = useQueryClient()
  const { confirm, confirmState } = useConfirm()
  const [nuovoNome, setNuovoNome] = useState('')
  const [editId, setEditId]       = useState<string | null>(null)
  const [editNome, setEditNome]   = useState('')
  const [addRespFor, setAddRespFor] = useState<string | null>(null)
  const [err, setErr]             = useState('')

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
    const { error } = await supabase.from('reparti').insert({ nome })
    if (error) { setErr(error.message); return }
    setNuovoNome(''); reload()
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
    const { error } = await supabase.from('reparti').update({ attivo: !r.attivo }).eq('id', r.id)
    if (error) { setErr(error.message); return }
    reload()
  }
  async function elimina(r: Reparto) {
    if (r.id === REPARTO_11N) return
    const ok = await confirm({
      title:        `Elimina reparto "${r.nome}"`,
      message:      'Possibile solo se il reparto non ha dati collegati (turnisti, turni…). Altrimenti disattivalo.',
      confirmLabel: 'Elimina', danger: true,
    })
    if (!ok) return
    setErr('')
    const { error } = await supabase.from('reparti').delete().eq('id', r.id)
    if (error) {
      setErr('Impossibile eliminare: il reparto ha ancora dati collegati. Disattivalo invece.')
      return
    }
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
                    </span>
                    <div className="ml-auto flex items-center gap-1">
                      <button onClick={() => { setEditId(r.id); setEditNome(r.nome) }}
                        className="p-1.5 rounded text-stone-500 hover:text-blue-600 hover:bg-blue-50" title="Rinomina">
                        <Pencil size={14} />
                      </button>
                      <button onClick={() => toggleAttivo(r)}
                        className="p-1.5 rounded text-stone-500 hover:text-amber-600 hover:bg-amber-50"
                        title={r.attivo ? 'Disattiva' : 'Riattiva'}>
                        <Power size={14} />
                      </button>
                      {r.id !== REPARTO_11N && (
                        <button onClick={() => elimina(r)}
                          className="p-1.5 rounded text-stone-500 hover:text-red-600 hover:bg-red-50" title="Elimina">
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
                        className="hover:text-red-600" title="Rimuovi">
                        <X size={11} />
                      </button>
                    </span>
                  )
                })}
                {addRespFor === r.id ? (
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
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function CentroControlloPage() {
  return (
    <div className="space-y-8 max-w-3xl">
      <RepartiSection />
      <div className="border-t-2 border-stone-200" />
      <GestioneUtentiPage />
    </div>
  )
}
