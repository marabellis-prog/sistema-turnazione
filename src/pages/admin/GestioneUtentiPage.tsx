import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Shield, User, Lock, UserPlus, Pencil, Save, X, UserCheck } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { emailValida } from '../../lib/email'
import { useConfirm } from '../../hooks/useConfirm'
import { ConfirmModal } from '../../components/ConfirmModal'
import type { UtenteAutorizzato, Medico } from '../../types'

const ADMIN_PERMANENTE = 'marabelli.s@gmail.com'

export function GestioneUtentiPage() {
  const qc = useQueryClient()
  const { confirm, confirmState } = useConfirm()

  // ── Editing inline utenti attivi ─────────────────────────────
  const [editId,    setEditId]    = useState<string | null>(null)
  const [editEmail, setEditEmail] = useState('')
  const [editCognome,     setEditCognome]     = useState('')
  const [editNomeProprio, setEditNomeProprio] = useState('')
  const [editRuolo, setEditRuolo] = useState<'user' | 'admin' | 'ospite'>('user')

  // ── Aggiunta veloce da medico ────────────────────────────────
  const [emailMedico, setEmailMedico] = useState<Record<string, string>>({})
  const [ruoloMedico, setRuoloMedico] = useState<Record<string, 'user' | 'admin' | 'ospite'>>({})

  // ── Aggiunta manuale ─────────────────────────────────────────
  const [email,      setEmail]      = useState('')
  const [cognomeNew, setCognomeNew] = useState('')
  const [nomeNew,    setNomeNew]    = useState('')
  const [ruolo,  setRuolo]  = useState<'user' | 'admin' | 'ospite'>('user')

  const [errore,  setErrore]  = useState('')
  const [saving,  setSaving]  = useState(false)

  // ── Queries ──────────────────────────────────────────────────
  const { data: utenti = [], isLoading: loadingUtenti } = useQuery<UtenteAutorizzato[]>({
    queryKey: ['utenti_autorizzati'],
    queryFn: async () => {
      // Usa RPC con SECURITY DEFINER per bypassare la RLS policy
      // che altrimenti permetterebbe di vedere solo la propria riga
      const { data, error } = await supabase.rpc('get_all_utenti_autorizzati')
      if (error) throw error
      return (data ?? []) as UtenteAutorizzato[]
    },
    staleTime: 0,
  })

  // Utenti ordinati per livello (admin → user → ospite) poi alfabetico.
  const utentiOrdinati = useMemo(() => {
    const rank: Record<string, number> = { admin: 0, user: 1, ospite: 2 }
    return [...utenti].sort((a, b) => {
      const r = (rank[a.ruolo] ?? 9) - (rank[b.ruolo] ?? 9)
      if (r !== 0) return r
      return (a.nome ?? a.email).localeCompare(b.nome ?? b.email, 'it', { sensitivity: 'base' })
    })
  }, [utenti])

  const { data: medici = [] } = useQuery<Medico[]>({
    queryKey: ['medici'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('medici').select('*').eq('attivo', true).order('numero_ordine')
      if (error) throw error
      return data
    },
  })

  // Medici non ancora in utenti_autorizzati (confronto per nome)
  const mediciSenzaAccount = useMemo(() => {
    const nomiConAccount = new Set(
      utenti.map(u => (u.nome ?? '').toUpperCase().trim()).filter(Boolean)
    )
    return medici.filter(m => !nomiConAccount.has(m.nome.toUpperCase().trim()))
  }, [medici, utenti])

  // ── Helper: forza refetch utenti ─────────────────────────────
  async function refetchUtenti() {
    await qc.refetchQueries({ queryKey: ['utenti_autorizzati'] })
  }

  // ── Editing inline (account attivi) ──────────────────────────
  function startEdit(u: UtenteAutorizzato) {
    setEditId(u.id)
    setEditEmail(u.email)
    setEditCognome(u.cognome ?? '')
    setEditNomeProprio(u.nome_proprio ?? '')
    setEditRuolo(u.ruolo)
    setErrore('')
  }

  async function saveEdit() {
    if (!editEmail.trim()) { setErrore('Email obbligatoria.'); return }
    if (!emailValida(editEmail)) { setErrore('Indirizzo email non valido (controlla la @ e il dominio).'); return }
    const cognome = editCognome.trim().toUpperCase()
    const nomeProprio = editNomeProprio.trim()
    const nomeComb = `${cognome} ${nomeProprio}`.replace(/\s+/g, ' ').trim()
    setSaving(true); setErrore('')
    // RPC bypassa RLS (UPDATE diretto bloccato silenziosamente dalla policy).
    // cognome/nome_proprio si propagano ai medici collegati tramite trigger.
    const { error } = await supabase.rpc('update_utente_autorizzato', {
      p_id:    editId!,
      p_email: editEmail.trim().toLowerCase(),
      p_nome:  nomeComb || null,
      p_ruolo: editRuolo,
      p_cognome:      cognome,
      p_nome_proprio: nomeProprio,
    })
    setSaving(false)
    if (error) { setErrore(error.message); return }
    setEditId(null)
    await refetchUtenti()
  }

  async function elimina(u: UtenteAutorizzato) {
    if (u.email === ADMIN_PERMANENTE) return
    const ok = await confirm({
      title:        `Rimuovi accesso a ${u.nome ?? u.email}`,
      message:      `L'utente non potrà più accedere all'applicazione. Il suo nominativo nell'elenco medici rimarrà invariato.`,
      confirmLabel: 'Rimuovi accesso',
      danger:       true,
    })
    if (!ok) return
    // RPC bypassa RLS
    await supabase.rpc('delete_utente_autorizzato', { p_id: u.id })
    await refetchUtenti()
  }

  // ── Aggiunta da medico ───────────────────────────────────────
  async function aggiungiDaMedico(m: Medico) {
    const mail = (emailMedico[m.id] ?? '').trim().toLowerCase()
    if (!mail) return
    const ruoloDaUsare = ruoloMedico[m.id] ?? 'user'
    setSaving(true); setErrore('')
    // RPC bypassa RLS
    const { error } = await supabase.rpc('insert_utente_autorizzato', {
      p_email: mail,
      p_nome:  m.nome,
      p_ruolo: ruoloDaUsare,
      p_cognome:      m.cognome ?? null,
      p_nome_proprio: m.nome_proprio ?? null,
    })
    setSaving(false)
    if (error) { setErrore(error.message); return }
    setEmailMedico(prev => { const n = { ...prev }; delete n[m.id]; return n })
    setRuoloMedico(prev => { const n = { ...prev }; delete n[m.id]; return n })
    await refetchUtenti()
  }

  // ── Aggiunta manuale ─────────────────────────────────────────
  async function aggiungiManuale() {
    if (!email.trim()) { setErrore("Inserisci un'email."); return }
    if (!emailValida(email)) { setErrore('Indirizzo email non valido (controlla la @ e il dominio).'); return }
    const cognome = cognomeNew.trim().toUpperCase()
    const nomeProprio = nomeNew.trim()
    const nomeComb = `${cognome} ${nomeProprio}`.replace(/\s+/g, ' ').trim()
    setSaving(true); setErrore('')
    const { error } = await supabase.rpc('insert_utente_autorizzato', {
      p_email: email.trim().toLowerCase(),
      p_nome:  nomeComb || null,
      p_ruolo: ruolo,
      p_cognome:      cognome || null,
      p_nome_proprio: nomeProprio || null,
    })
    setSaving(false)
    if (error) { setErrore(error.message); return }
    setEmail(''); setCognomeNew(''); setNomeNew('')
    await refetchUtenti()
  }

  // ─────────────────────────────────────────────────────────────
  return (
    <div className="max-w-2xl space-y-6">
      <ConfirmModal {...confirmState.opts} open={confirmState.open}
        onConfirm={confirmState.onConfirm} onCancel={confirmState.onCancel} />

      <div>
        <h2 className="text-xl font-bold text-stone-800 flex items-center gap-2">
          <UserCheck size={20} style={{ color: '#476540' }} />
          Utenti Autorizzati
        </h2>
        <p className="text-sm text-stone-600 mt-0.5">
          Solo gli account Google in questa lista possono accedere all'app.
        </p>
      </div>

      {errore && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {errore}
        </div>
      )}

      {/* ══ ACCOUNT ATTIVI ═════════════════════════════════════ */}
      <div className="card overflow-hidden">
        <div className="px-4 py-2.5 bg-stone-50 border-b border-stone-200">
          <h3 className="font-semibold text-stone-700 text-sm">Account attivi</h3>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-stone-50 border-b border-stone-200">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-semibold text-stone-600">Email</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-stone-600">Cognome e nome</th>
              <th className="px-3 py-2 text-center text-xs font-semibold text-stone-600 w-24">Ruolo</th>
              <th className="px-3 py-2 w-20" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loadingUtenti && (
              <tr><td colSpan={4} className="px-3 py-4 text-center text-stone-500">Caricamento...</td></tr>
            )}

            {utentiOrdinati.map(u => {
              const isPerm = u.email === ADMIN_PERMANENTE

              /* ── riga in editing ── */
              if (editId === u.id) return (
                <tr key={u.id} className="bg-blue-50">
                  <td className="px-2 py-1.5">
                    <input
                      value={editEmail}
                      onChange={e => setEditEmail(e.target.value)}
                      placeholder="email@gmail.com"
                      type="email"
                      className="input py-0.5 text-xs w-full"
                      autoFocus
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="flex gap-1">
                      <input
                        value={editCognome}
                        onChange={e => setEditCognome(e.target.value.toUpperCase())}
                        placeholder="COGNOME"
                        className="input py-0.5 text-xs w-full uppercase"
                      />
                      <input
                        value={editNomeProprio}
                        onChange={e => setEditNomeProprio(e.target.value)}
                        placeholder="Nome"
                        className="input py-0.5 text-xs w-full"
                      />
                    </div>
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <select
                      value={editRuolo}
                      onChange={e => setEditRuolo(e.target.value as 'user' | 'admin' | 'ospite')}
                      className="input py-0.5 text-xs w-full"
                    >
                      <option value="user">User</option>
                      <option value="admin">Admin</option>
                    </select>
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="flex gap-1 justify-end">
                      <button onClick={saveEdit} disabled={saving}
                        className="btn-primary py-0.5 px-2 text-xs gap-1">
                        <Save size={11} /> Salva
                      </button>
                      <button onClick={() => setEditId(null)}
                        className="btn-secondary py-0.5 px-1.5 text-xs">
                        <X size={11} />
                      </button>
                    </div>
                  </td>
                </tr>
              )

              /* ── riga normale ── */
              return (
                <tr key={u.id} className={`hover:bg-stone-50 group ${isPerm ? 'bg-blue-50/30' : ''}`}>
                  <td className="px-3 py-2 font-mono text-xs text-gray-600">{u.email}</td>
                  <td className="px-3 py-2 font-medium text-stone-800 uppercase">
                    {u.nome || '—'}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <span
                      className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded font-medium"
                      style={
                        u.ruolo === 'admin'
                          ? { background: '#fef3c7', color: '#92400e' }
                          : u.ruolo === 'ospite'
                            // Pattern azzurro a bande diagonali per distinguere a colpo d'occhio
                            ? {
                                background: 'repeating-linear-gradient(-45deg, #bfdbfe 0, #bfdbfe 4px, #93c5fd 4px, #93c5fd 8px)',
                                color: '#1e3a8a',
                              }
                            : { background: '#dbeafe', color: '#1e40af' }
                      }>
                      {isPerm
                        ? <Lock size={10} />
                        : u.ruolo === 'admin'  ? <Shield size={10} />
                        : u.ruolo === 'ospite' ? <User   size={10} />
                        : <User size={10} />
                      }
                      {u.ruolo}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {isPerm ? (
                      <span className="text-xs text-blue-300 flex items-center gap-1 justify-end">
                        <Lock size={11} /> permanente
                      </span>
                    ) : (
                      <div className="flex gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => startEdit(u)}
                          className="p-1.5 rounded text-stone-500 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                          title="Modifica">
                          <Pencil size={13} />
                        </button>
                        <button onClick={() => elimina(u)}
                          className="p-1.5 rounded text-stone-500 hover:text-red-600 hover:bg-red-50 transition-colors"
                          title="Rimuovi accesso">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}

            {utenti.length === 0 && !loadingUtenti && (
              <tr><td colSpan={4} className="px-3 py-4 text-center text-stone-500 text-sm">Nessun utente</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ══ MEDICI SENZA ACCOUNT ══════════════════════════════ */}
      {mediciSenzaAccount.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-4 py-2.5 bg-amber-50 border-b border-amber-100">
            <h3 className="font-semibold text-amber-800 text-sm flex items-center gap-2">
              <UserPlus size={15} />
              Medici senza account ({mediciSenzaAccount.length})
            </h3>
            <p className="text-xs text-amber-600 mt-0.5">
              Inserisci l'email Google di ogni medico per dargli accesso all'app.
            </p>
          </div>
          <div className="divide-y divide-gray-100">
            {mediciSenzaAccount.map(m => (
              <div key={m.id} className="flex items-center gap-2 px-4 py-2.5 hover:bg-stone-50">
                <span className="w-7 h-7 rounded-full bg-gray-200 text-gray-600 text-xs
                                 font-bold flex items-center justify-center shrink-0">
                  {m.numero_ordine}
                </span>
                <span className="font-semibold text-stone-800 uppercase text-sm w-28 shrink-0">
                  {m.nome}
                </span>
                <input
                  type="email"
                  placeholder="email@gmail.com"
                  value={emailMedico[m.id] ?? ''}
                  onChange={e => setEmailMedico(prev => ({ ...prev, [m.id]: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && aggiungiDaMedico(m)}
                  className="input flex-1 text-sm py-1"
                />
                <select
                  value={ruoloMedico[m.id] ?? 'user'}
                  onChange={e => setRuoloMedico(prev => ({ ...prev, [m.id]: e.target.value as 'user' | 'admin' | 'ospite' }))}
                  className="input text-sm py-1 w-24 shrink-0"
                >
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </select>
                <button
                  onClick={() => aggiungiDaMedico(m)}
                  disabled={!emailMedico[m.id]?.trim() || saving}
                  className="btn-primary py-1 px-3 text-xs gap-1 shrink-0"
                >
                  <Plus size={12} /> Aggiungi
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ══ AGGIUNGI MANUALMENTE ══════════════════════════════ */}
      <div className="card p-4 space-y-3">
        <h3 className="font-semibold text-stone-700 text-sm">Aggiungi account manualmente</h3>
        <p className="text-xs text-stone-500">Per account non presenti tra i medici (sostituti, osservatori, ecc.)</p>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="label text-xs">Email Google *</label>
            <input value={email} onChange={e => setEmail(e.target.value)}
              placeholder="esempio@gmail.com" type="email" className="input text-sm" />
          </div>
          <div>
            <label className="label text-xs">Cognome</label>
            <input value={cognomeNew} onChange={e => setCognomeNew(e.target.value.toUpperCase())}
              placeholder="COGNOME" className="input text-sm uppercase" />
          </div>
          <div>
            <label className="label text-xs">Nome</label>
            <input value={nomeNew} onChange={e => setNomeNew(e.target.value)}
              placeholder="Nome" className="input text-sm" />
          </div>
        </div>
        <div className="flex items-end gap-3">
          <div>
            <label className="label text-xs">Ruolo</label>
            <select value={ruolo} onChange={e => setRuolo(e.target.value as 'user' | 'admin' | 'ospite')}
              className="input text-sm w-48">
              <option value="user">User – solo consultazione</option>
              <option value="admin">Admin – gestione completa</option>
            </select>
          </div>
          <button onClick={aggiungiManuale} disabled={saving || !email.trim()} className="btn-primary text-sm">
            <Plus size={15} /> Aggiungi
          </button>
        </div>
      </div>

      {/* Legenda */}
      <div className="text-xs text-stone-500 space-y-1 px-1">
        <p className="flex items-center gap-1.5"><Lock size={11} className="text-blue-400" /> Admin permanente: non eliminabile</p>
        <p className="flex items-center gap-1.5"><Shield size={11} className="text-amber-500" /> Admin: accesso completo</p>
        <p className="flex items-center gap-1.5"><User size={11} className="text-blue-500" /> User: solo visualizzazione calendario</p>
        <p className="text-stone-500 italic">Eliminare un utente rimuove solo l'accesso, non il nominativo dai medici.</p>
      </div>
    </div>
  )
}
