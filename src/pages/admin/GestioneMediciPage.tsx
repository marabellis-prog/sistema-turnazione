import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Save, X, Trash2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import type { Medico } from '../../types'

export function GestioneMediciPage() {
  const qc = useQueryClient()
  const [editId, setEditId]         = useState<string | null>(null)
  const [editNome, setEditNome]     = useState('')
  const [editOrdine, setEditOrdine] = useState(0)
  const [editRep, setEditRep]       = useState(false)
  const [nuovoNome, setNuovoNome]   = useState('')
  const [errore, setErrore]         = useState('')
  const [saving, setSaving]         = useState(false)

  const { data: medici = [], isLoading } = useQuery<Medico[]>({
    queryKey: ['medici'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('medici').select('*').order('numero_ordine')
      if (error) throw error
      return data
    },
  })

  function startEdit(m: Medico) {
    setEditId(m.id)
    setEditNome(m.nome)
    setEditOrdine(m.numero_ordine)
    setEditRep(m.is_reperibilita)
    setErrore('')
  }

  async function saveEdit() {
    if (!editNome.trim()) { setErrore('Il nome non può essere vuoto.'); return }
    setSaving(true)
    const { error } = await supabase
      .from('medici')
      .update({ nome: editNome.trim(), numero_ordine: editOrdine, is_reperibilita: editRep })
      .eq('id', editId!)
    setSaving(false)
    if (error) { setErrore(error.message); return }
    setEditId(null)
    qc.invalidateQueries({ queryKey: ['medici'] })
  }

  async function toggleAttivo(m: Medico) {
    await supabase.from('medici').update({ attivo: !m.attivo }).eq('id', m.id)
    qc.invalidateQueries({ queryKey: ['medici'] })
  }

  async function aggiungi() {
    if (!nuovoNome.trim()) return
    const nextOrdine = (medici[medici.length - 1]?.numero_ordine ?? 0) + 1
    const { error } = await supabase.from('medici').insert({
      nome: nuovoNome.trim(),
      numero_ordine: nextOrdine,
      is_reperibilita: false,
      attivo: true,
    })
    if (error) { setErrore(error.message); return }
    setNuovoNome('')
    qc.invalidateQueries({ queryKey: ['medici'] })
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-800">Gestione Medici</h2>
        <p className="text-sm text-gray-500">L'ordine (numero_ordine) determina la posizione nella rotazione.</p>
      </div>

      {errore && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {errore}
        </div>
      )}

      {/* Lista medici */}
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-3 py-2 text-left font-semibold text-gray-600">#</th>
              <th className="px-3 py-2 text-left font-semibold text-gray-600">Nome</th>
              <th className="px-3 py-2 text-center font-semibold text-gray-600">REP</th>
              <th className="px-3 py-2 text-center font-semibold text-gray-600">Attivo</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading && (
              <tr><td colSpan={5} className="px-3 py-4 text-center text-gray-400">Caricamento...</td></tr>
            )}
            {medici.map(m => (
              <tr key={m.id} className={`hover:bg-gray-50 ${!m.attivo ? 'opacity-40' : ''}`}>
                {editId === m.id ? (
                  <>
                    <td className="px-3 py-1">
                      <input
                        type="number" min={1} max={99}
                        value={editOrdine}
                        onChange={e => setEditOrdine(+e.target.value)}
                        className="input w-16 py-0.5 text-sm"
                      />
                    </td>
                    <td className="px-3 py-1">
                      <input
                        value={editNome}
                        onChange={e => setEditNome(e.target.value)}
                        className="input py-0.5 text-sm"
                        autoFocus
                      />
                    </td>
                    <td className="px-3 py-1 text-center">
                      <input
                        type="checkbox" checked={editRep}
                        onChange={e => setEditRep(e.target.checked)}
                      />
                    </td>
                    <td></td>
                    <td className="px-3 py-1 flex gap-1 justify-end">
                      <button onClick={saveEdit} disabled={saving} className="btn-primary py-0.5 px-2 text-xs">
                        <Save size={12} /> Salva
                      </button>
                      <button onClick={() => setEditId(null)} className="btn-secondary py-0.5 px-2 text-xs">
                        <X size={12} />
                      </button>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="px-3 py-2 text-gray-500 font-mono">{m.numero_ordine}</td>
                    <td className="px-3 py-2 font-medium text-gray-800">{m.nome}</td>
                    <td className="px-3 py-2 text-center">
                      {m.is_reperibilita && <span className="badge-rep text-[10px]">REP</span>}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <button
                        onClick={() => toggleAttivo(m)}
                        className={`text-xs px-1.5 py-0.5 rounded font-medium
                          ${m.attivo ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}
                      >
                        {m.attivo ? 'Sì' : 'No'}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button onClick={() => startEdit(m)} className="text-gray-400 hover:text-blue-600 p-1">
                        <Pencil size={14} />
                      </button>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Aggiungi medico */}
      <div className="card p-4">
        <h3 className="font-semibold text-gray-700 mb-3">Aggiungi medico</h3>
        <div className="flex gap-2">
          <input
            value={nuovoNome}
            onChange={e => setNuovoNome(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && aggiungi()}
            placeholder="Cognome / Nome..."
            className="input flex-1"
          />
          <button onClick={aggiungi} disabled={!nuovoNome.trim()} className="btn-primary">
            <Plus size={16} /> Aggiungi
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-2">
          Il nuovo medico viene aggiunto come ultimo in ordine. Modifica il numero_ordine per riposizionarlo.
        </p>
      </div>
    </div>
  )
}
