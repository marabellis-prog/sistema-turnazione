import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Shield, User, Lock, UserPlus } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useConfirm } from '../../hooks/useConfirm'
import { ConfirmModal } from '../../components/ConfirmModal'
import type { UtenteAutorizzato, Medico } from '../../types'

// Email dell'admin permanente (non eliminabile)
const ADMIN_PERMANENTE = 'marabelli.s@gmail.com'

export function GestioneUtentiPage() {
  const qc = useQueryClient()
  const { confirm, confirmState } = useConfirm()

  // Stato per aggiunta manuale
  const [email,   setEmail]   = useState('')
  const [nome,    setNome]    = useState('')
  const [ruolo,   setRuolo]   = useState<'user' | 'admin'>('user')
  const [errore,  setErrore]  = useState('')
  const [saving,  setSaving]  = useState(false)

  // Stato per aggiunta veloce da medico (key = medico.id → email digitata)
  const [emailMedico, setEmailMedico] = useState<Record<string, string>>({})

  // ── Queries ──────────────────────────────────────────────────
  const { data: utenti = [], isLoading: loadingUtenti } = useQuery<UtenteAutorizzato[]>({
    queryKey: ['utenti_autorizzati'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('utenti_autorizzati').select('*').order('created_at')
      if (error) throw error
      return data
    },
  })

  const { data: medici = [] } = useQuery<Medico[]>({
    queryKey: ['medici'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('medici').select('*').eq('attivo', true).order('numero_ordine')
      if (error) throw error
      return data
    },
  })

  // Medici che NON hanno ancora un account (confronto per nome, case-insensitive)
  // Esclude automaticamente MARABELLI se è già admin
  const mediciSenzaAccount = useMemo(() => {
    const nomiConAccount = new Set(
      utenti.map(u => (u.nome ?? '').toUpperCase().trim()).filter(Boolean)
    )
    return medici.filter(m => !nomiConAccount.has(m.nome.toUpperCase().trim()))
  }, [medici, utenti])

  // ── Azioni ───────────────────────────────────────────────────

  async function aggiungiManuale() {
    if (!email.trim()) { setErrore("Inserisci un'email."); return }
    setSaving(true); setErrore('')
    const { error } = await supabase.from('utenti_autorizzati').insert({
      email: email.trim().toLowerCase(),
      nome:  nome.trim().toUpperCase() || null,
      ruolo, attivo: true,
    })
    setSaving(false)
    if (error) { setErrore(error.message); return }
    setEmail(''); setNome('')
    qc.invalidateQueries({ queryKey: ['utenti_autorizzati'] })
  }

  async function aggiungiDaMedico(m: Medico) {
    const mail = (emailMedico[m.id] ?? '').trim().toLowerCase()
    if (!mail) return
    setSaving(true)
    const { error } = await supabase.from('utenti_autorizzati').insert({
      email: mail, nome: m.nome, ruolo: 'user', attivo: true,
    })
    setSaving(false)
    if (error) { setErrore(error.message); return }
    setEmailMedico(prev => { const n = { ...prev }; delete n[m.id]; return n })
    qc.invalidateQueries({ queryKey: ['utenti_autorizzati'] })
  }

  async function cambiaRuolo(u: UtenteAutorizzato) {
    if (u.email === ADMIN_PERMANENTE) return
    const nuovoRuolo = u.ruolo === 'admin' ? 'user' : 'admin'
    await supabase.from('utenti_autorizzati').update({ ruolo: nuovoRuolo }).eq('id', u.id)
    qc.invalidateQueries({ queryKey: ['utenti_autorizzati'] })
  }

  async function elimina(u: UtenteAutorizzato) {
    if (u.email === ADMIN_PERMANENTE) return   // protezione extra
    const ok = await confirm({
      title:        `Rimuovi ${u.nome ?? u.email}`,
      message:      `L'utente non potrà più accedere all'applicazione. Continuare?`,
      confirmLabel: 'Rimuovi',
      danger:       true,
    })
    if (!ok) return
    await supabase.from('utenti_autorizzati').delete().eq('id', u.id)
    qc.invalidateQueries({ queryKey: ['utenti_autorizzati'] })
  }

  // ─────────────────────────────────────────────────────────────
  return (
    <div className="max-w-2xl space-y-6">
      <ConfirmModal {...confirmState.opts} open={confirmState.open}
        onConfirm={confirmState.onConfirm} onCancel={confirmState.onCancel} />

      <div>
        <h2 className="text-xl font-bold text-gray-800">Utenti Autorizzati</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Solo gli account Google in questa lista possono accedere all'app.
        </p>
      </div>

      {errore && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {errore}
        </div>
      )}

      {/* ══ UTENTI ESISTENTI ═══════════════════════════════════ */}
      <div className="card overflow-hidden">
        <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200">
          <h3 className="font-semibold text-gray-700 text-sm">Account attivi</h3>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">Email</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">Nome</th>
              <th className="px-3 py-2 text-center text-xs font-semibold text-gray-500 w-20">Ruolo</th>
              <th className="px-3 py-2 w-16" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loadingUtenti && (
              <tr><td colSpan={4} className="px-3 py-4 text-center text-gray-400">Caricamento...</td></tr>
            )}
            {utenti.map(u => {
              const isPermanente = u.email === ADMIN_PERMANENTE
              return (
                <tr key={u.id} className={`hover:bg-gray-50 ${isPermanente ? 'bg-blue-50/40' : ''}`}>
                  <td className="px-3 py-2 font-mono text-xs text-gray-600">{u.email}</td>
                  <td className="px-3 py-2 font-medium text-gray-800 uppercase">
                    {u.nome || '—'}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <button
                      onClick={() => cambiaRuolo(u)}
                      disabled={isPermanente}
                      title={isPermanente ? 'Admin permanente — non modificabile' : 'Clicca per cambiare ruolo'}
                      className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded font-medium
                        ${u.ruolo === 'admin'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-blue-100 text-blue-800'}
                        ${isPermanente ? 'cursor-default opacity-80' : 'hover:opacity-80 cursor-pointer'}`}
                    >
                      {isPermanente
                        ? <Lock size={10} />
                        : u.ruolo === 'admin' ? <Shield size={10} /> : <User size={10} />
                      }
                      {u.ruolo}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {isPermanente ? (
                      <span className="text-xs text-blue-300 flex items-center gap-1 justify-end">
                        <Lock size={11} /> permanente
                      </span>
                    ) : (
                      <button
                        onClick={() => elimina(u)}
                        className="text-gray-300 hover:text-red-500 p-1 transition-colors"
                        title="Rimuovi utente"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
            {utenti.length === 0 && !loadingUtenti && (
              <tr><td colSpan={4} className="px-3 py-4 text-center text-gray-400 text-sm">Nessun utente</td></tr>
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
              <div key={m.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50">
                {/* Badge con numero ordine */}
                <span className="w-7 h-7 rounded-full bg-gray-200 text-gray-600 text-xs
                                 font-bold flex items-center justify-center shrink-0">
                  {m.numero_ordine}
                </span>

                {/* Nome medico */}
                <span className="font-semibold text-gray-800 uppercase text-sm w-32 shrink-0">
                  {m.nome}
                </span>

                {/* Input email */}
                <input
                  type="email"
                  placeholder="email@gmail.com"
                  value={emailMedico[m.id] ?? ''}
                  onChange={e => setEmailMedico(prev => ({ ...prev, [m.id]: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && aggiungiDaMedico(m)}
                  className="input flex-1 text-sm py-1"
                />

                {/* Bottone aggiungi */}
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
        <h3 className="font-semibold text-gray-700 text-sm">Aggiungi account manualmente</h3>
        <p className="text-xs text-gray-400">
          Per aggiungere un account non presente tra i medici (es. un osservatore, un sostituto, ecc.)
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label text-xs">Email Google *</label>
            <input value={email} onChange={e => setEmail(e.target.value)}
              placeholder="esempio@gmail.com" type="email" className="input text-sm" />
          </div>
          <div>
            <label className="label text-xs">Nome (opzionale)</label>
            <input value={nome} onChange={e => setNome(e.target.value.toUpperCase())}
              placeholder="NOME COGNOME" className="input text-sm uppercase" />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div>
            <label className="label text-xs">Ruolo</label>
            <select value={ruolo} onChange={e => setRuolo(e.target.value as 'user' | 'admin')}
              className="input text-sm w-48">
              <option value="user">User – solo consultazione</option>
              <option value="admin">Admin – gestione completa</option>
            </select>
          </div>
          <button onClick={aggiungiManuale} disabled={saving || !email.trim()}
            className="btn-primary text-sm mt-5">
            <Plus size={15} /> Aggiungi
          </button>
        </div>
      </div>

      {/* Legenda ruoli */}
      <div className="text-xs text-gray-400 space-y-1 px-1">
        <p className="flex items-center gap-1.5">
          <Lock size={11} className="text-blue-400" /> Admin permanente: non eliminabile dall'interfaccia
        </p>
        <p className="flex items-center gap-1.5">
          <Shield size={11} className="text-amber-500" /> Admin: accesso completo a tutti i pannelli
        </p>
        <p className="flex items-center gap-1.5">
          <User size={11} className="text-blue-500" /> User: solo visualizzazione calendario
        </p>
        <p className="text-gray-300 italic mt-1">
          Nota: un medico può essere rimosso dall'elenco medici senza perdere l'accesso come utente, e viceversa.
        </p>
      </div>
    </div>
  )
}
