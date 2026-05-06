import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Shield, User } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useConfirm } from '../../hooks/useConfirm'
import { ConfirmModal } from '../../components/ConfirmModal'
import type { UtenteAutorizzato } from '../../types'

export function GestioneUtentiPage() {
  const qc = useQueryClient()
  const { confirm, confirmState } = useConfirm()
  const [email, setEmail]   = useState('')
  const [nome, setNome]     = useState('')
  const [ruolo, setRuolo]   = useState<'user' | 'admin'>('user')
  const [errore, setErrore] = useState('')
  const [saving, setSaving] = useState(false)

  const { data: utenti = [], isLoading } = useQuery<UtenteAutorizzato[]>({
    queryKey: ['utenti_autorizzati'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('utenti_autorizzati')
        .select('*')
        .order('created_at')
      if (error) throw error
      return data
    },
  })

  async function aggiungi() {
    if (!email.trim()) { setErrore('Inserisci un\'email.'); return }
    setSaving(true)
    setErrore('')
    const { error } = await supabase.from('utenti_autorizzati').insert({
      email: email.trim().toLowerCase(),
      nome:  nome.trim() || null,
      ruolo,
      attivo: true,
    })
    setSaving(false)
    if (error) { setErrore(error.message); return }
    setEmail(''); setNome('')
    qc.invalidateQueries({ queryKey: ['utenti_autorizzati'] })
  }

  async function toggleAttivo(u: UtenteAutorizzato) {
    await supabase.from('utenti_autorizzati').update({ attivo: !u.attivo }).eq('id', u.id)
    qc.invalidateQueries({ queryKey: ['utenti_autorizzati'] })
  }

  async function cambiaRuolo(u: UtenteAutorizzato) {
    const nuovoRuolo = u.ruolo === 'admin' ? 'user' : 'admin'
    await supabase.from('utenti_autorizzati').update({ ruolo: nuovoRuolo }).eq('id', u.id)
    qc.invalidateQueries({ queryKey: ['utenti_autorizzati'] })
  }

  async function elimina(id: string) {
    const ok = await confirm({
      title:        'Rimuovi utente',
      message:      'L\'utente non potrà più accedere all\'applicazione. Continuare?',
      confirmLabel: 'Rimuovi',
      danger:       true,
    })
    if (!ok) return
    await supabase.from('utenti_autorizzati').delete().eq('id', id)
    qc.invalidateQueries({ queryKey: ['utenti_autorizzati'] })
  }

  return (
    <div className="max-w-2xl space-y-6">
      <ConfirmModal {...confirmState.opts} open={confirmState.open}
        onConfirm={confirmState.onConfirm} onCancel={confirmState.onCancel} />
      <div>
        <h2 className="text-xl font-bold text-gray-800">Utenti Autorizzati</h2>
        <p className="text-sm text-gray-500">
          Solo gli account Google in questa lista possono accedere all'app.
        </p>
      </div>

      {errore && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{errore}</div>
      )}

      {/* Lista utenti */}
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-3 py-2 text-left font-semibold text-gray-600">Email</th>
              <th className="px-3 py-2 text-left font-semibold text-gray-600">Nome</th>
              <th className="px-3 py-2 text-center font-semibold text-gray-600">Ruolo</th>
              <th className="px-3 py-2 text-center font-semibold text-gray-600">Attivo</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading && (
              <tr><td colSpan={5} className="px-3 py-4 text-center text-gray-400">Caricamento...</td></tr>
            )}
            {utenti.map(u => (
              <tr key={u.id} className={`hover:bg-gray-50 ${!u.attivo ? 'opacity-40' : ''}`}>
                <td className="px-3 py-2 text-gray-800 font-mono text-xs">{u.email}</td>
                <td className="px-3 py-2 text-gray-600">{u.nome || '—'}</td>
                <td className="px-3 py-2 text-center">
                  <button
                    onClick={() => cambiaRuolo(u)}
                    className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded font-medium
                      ${u.ruolo === 'admin'
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-blue-100 text-blue-800'
                      }`}
                    title="Clicca per cambiare ruolo"
                  >
                    {u.ruolo === 'admin' ? <Shield size={11} /> : <User size={11} />}
                    {u.ruolo}
                  </button>
                </td>
                <td className="px-3 py-2 text-center">
                  <button
                    onClick={() => toggleAttivo(u)}
                    className={`text-xs px-1.5 py-0.5 rounded font-medium
                      ${u.attivo ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}
                  >
                    {u.attivo ? 'Sì' : 'No'}
                  </button>
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    onClick={() => elimina(u.id)}
                    className="text-gray-300 hover:text-red-500 p-1"
                    title="Rimuovi"
                  >
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Aggiungi utente */}
      <div className="card p-4 space-y-3">
        <h3 className="font-semibold text-gray-700">Aggiungi utente</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Email Google *</label>
            <input
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="esempio@gmail.com"
              type="email"
              className="input"
            />
          </div>
          <div>
            <label className="label">Nome (opzionale)</label>
            <input
              value={nome}
              onChange={e => setNome(e.target.value)}
              placeholder="Nome Cognome"
              className="input"
            />
          </div>
        </div>
        <div>
          <label className="label">Ruolo</label>
          <select value={ruolo} onChange={e => setRuolo(e.target.value as 'user' | 'admin')} className="input">
            <option value="user">User – solo consultazione</option>
            <option value="admin">Admin – gestione completa</option>
          </select>
        </div>
        <button onClick={aggiungi} disabled={saving || !email.trim()} className="btn-primary">
          <Plus size={16} /> Aggiungi
        </button>
      </div>
    </div>
  )
}
