import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Save, X, Trash2, AlertTriangle, RefreshCw } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useConfirm } from '../../hooks/useConfirm'
import { ConfirmModal } from '../../components/ConfirmModal'
import type { Medico } from '../../types'

// ─────────────────────────────────────────────────────────────────
// NOTA ARCHITETTURALE — dipendenze di un medico nel sistema:
//
//   medici (id, numero_ordine, nome)
//     ↓ ON DELETE CASCADE
//   turni (medico_id)          → eliminati automaticamente
//   ferie (medico_id)          → eliminati automaticamente
//
//   schemi_modello (numero_medico_mattina/pomeriggio/rm/rp)
//     → numeri interi, NON foreign key → azzerati manualmente
//
// Modifica numero_ordine → il calendario va rigenerato perché
// l'algoritmo di rotazione usa l'indice posizionale dei medici.
// ─────────────────────────────────────────────────────────────────

const CAMPI_SCHEMA = [
  'numero_medico_mattina',
  'numero_medico_pomeriggio',
  'numero_medico_rm',
  'numero_medico_rp',
] as const

export function GestioneMediciPage() {
  const qc = useQueryClient()
  const { confirm, confirmState } = useConfirm()

  // Stato editing inline
  const [editId,      setEditId]      = useState<string | null>(null)
  const [editNome,    setEditNome]    = useState('')
  const [editOrdine,  setEditOrdine]  = useState(0)
  const [editOrigOrd, setEditOrigOrd] = useState(0)  // per rilevare cambio ordine
  const [editRep,     setEditRep]     = useState(false)

  // Stato aggiungi
  const [nuovoNome,   setNuovoNome]   = useState('')

  // Feedback
  const [errore,      setErrore]      = useState('')
  const [avviso,      setAvviso]      = useState('')  // rigenera calendario
  const [saving,      setSaving]      = useState(false)

  // ── Query ────────────────────────────────────────────────────
  const { data: medici = [], isLoading } = useQuery<Medico[]>({
    queryKey: ['medici-tutti'],                // usa key separata per vedere anche inattivi
    queryFn: async () => {
      const { data, error } = await supabase
        .from('medici').select('*').order('numero_ordine')
      if (error) throw error
      return data
    },
  })

  // ── Avvia editing ────────────────────────────────────────────
  function startEdit(m: Medico) {
    setEditId(m.id)
    setEditNome(m.nome)
    setEditOrdine(m.numero_ordine)
    setEditOrigOrd(m.numero_ordine)
    setEditRep(m.is_reperibilita)
    setErrore('')
  }

  // ── Salva modifica ───────────────────────────────────────────
  async function saveEdit() {
    const nome = editNome.trim().toUpperCase()
    if (!nome) { setErrore('Il nome non può essere vuoto.'); return }
    setSaving(true); setErrore('')

    const { error } = await supabase
      .from('medici')
      .update({ nome, numero_ordine: editOrdine, is_reperibilita: editRep })
      .eq('id', editId!)

    setSaving(false)
    if (error) { setErrore(error.message); return }

    setEditId(null)
    // Se l'ordine è cambiato → il calendario va rigenerato
    if (editOrdine !== editOrigOrd) {
      setAvviso(
        `Il numero d'ordine di ${nome} è cambiato (${editOrigOrd} → ${editOrdine}). ` +
        'Rigenera il calendario per riflettere la nuova posizione nella rotazione.'
      )
    }

    // Invalida tutto ciò che dipende dai medici
    qc.invalidateQueries({ queryKey: ['medici'] })
    qc.invalidateQueries({ queryKey: ['medici-tutti'] })
  }

  // ── Elimina medico con cascade ───────────────────────────────
  async function eliminaMedico(m: Medico) {
    const ok = await confirm({
      title:        `Elimina ${m.nome}`,
      message:
        `Il medico verrà eliminato definitivamente insieme a:\n` +
        `• tutti i suoi turni nel calendario\n` +
        `• tutte le sue ferie\n` +
        `• le sue presenze nello schema (azzeramento slots)\n\n` +
        `Questa operazione NON può essere annullata. Dopo l'eliminazione rigenera il calendario.`,
      confirmLabel: 'Elimina definitivamente',
      danger:       true,
    })
    if (!ok) return

    setSaving(true)
    try {
      // 1. Azzera il numero del medico in tutti gli slot dello schema
      //    (schemi_modello usa numeri interi, non FK → nessun cascade automatico)
      for (const campo of CAMPI_SCHEMA) {
        await supabase
          .from('schemi_modello')
          .update({ [campo]: null })
          .eq(campo, m.numero_ordine)
      }

      // 2. Elimina il medico
      //    → cascade automatico su: turni, ferie (ON DELETE CASCADE nel DB)
      const { error } = await supabase
        .from('medici').delete().eq('id', m.id)

      if (error) throw error

      setAvviso(
        `${m.nome} eliminato. Le sue presenze nello schema sono state azzerate. ` +
        'Rigenera il calendario per aggiornare il calendario.'
      )

      // Invalida tutte le query dipendenti
      qc.invalidateQueries({ queryKey: ['medici'] })
      qc.invalidateQueries({ queryKey: ['medici-tutti'] })
      qc.invalidateQueries({ queryKey: ['schemi_modello'] })
      qc.invalidateQueries({ queryKey: ['turni'] })

    } catch (e: unknown) {
      setErrore((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  // ── Aggiungi medico ──────────────────────────────────────────
  async function aggiungi() {
    const nome = nuovoNome.trim().toUpperCase()
    if (!nome) return
    const nextOrdine = medici.length > 0
      ? Math.max(...medici.map(m => m.numero_ordine)) + 1
      : 1

    const { error } = await supabase.from('medici').insert({
      nome, numero_ordine: nextOrdine,
      is_reperibilita: false, attivo: true,
    })
    if (error) { setErrore(error.message); return }

    setNuovoNome('')
    setAvviso(`${nome} aggiunto con numero d'ordine ${nextOrdine}. Rigenera il calendario per includerlo.`)
    qc.invalidateQueries({ queryKey: ['medici'] })
    qc.invalidateQueries({ queryKey: ['medici-tutti'] })
  }

  // ─────────────────────────────────────────────────────────────
  return (
    <div className="max-w-xl space-y-5">
      <ConfirmModal {...confirmState.opts} open={confirmState.open}
        onConfirm={confirmState.onConfirm} onCancel={confirmState.onCancel} />

      <div>
        <h2 className="text-xl font-bold text-gray-800">Gestione Medici</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          L'ordine (n°) determina la posizione nella rotazione.
          Dopo modifiche o eliminazioni <strong>rigenera il calendario</strong>.
        </p>
      </div>

      {/* Errore */}
      {errore && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {errore}
        </div>
      )}

      {/* Avviso rigenera */}
      {avviso && (
        <div className="flex gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
          <div className="flex-1">
            <p>{avviso}</p>
          </div>
          <button onClick={() => setAvviso('')}
            className="text-amber-500 hover:text-amber-700 shrink-0">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Lista medici */}
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-3 py-2 text-left font-semibold text-gray-500 w-12">N°</th>
              <th className="px-3 py-2 text-left font-semibold text-gray-500">Nome</th>
              <th className="px-3 py-2 text-center font-semibold text-gray-500 w-14">REP</th>
              <th className="px-3 py-2 w-20" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading && (
              <tr><td colSpan={4} className="px-3 py-4 text-center text-gray-400">Caricamento...</td></tr>
            )}

            {medici.map(m => editId === m.id ? (
              /* ── Riga in editing ── */
              <tr key={m.id} className="bg-blue-50">
                <td className="px-2 py-1.5">
                  <input
                    type="number" min={1} max={99}
                    value={editOrdine}
                    onChange={e => setEditOrdine(+e.target.value)}
                    className="input w-14 py-0.5 text-sm text-center"
                  />
                </td>
                <td className="px-2 py-1.5">
                  <input
                    value={editNome}
                    onChange={e => setEditNome(e.target.value.toUpperCase())}
                    className="input py-0.5 text-sm uppercase w-full"
                    autoFocus
                    onKeyDown={e => e.key === 'Enter' && saveEdit()}
                  />
                </td>
                <td className="px-2 py-1.5 text-center">
                  <input type="checkbox" checked={editRep}
                    onChange={e => setEditRep(e.target.checked)}
                    className="w-4 h-4 accent-red-500" title="Reperibilità" />
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
            ) : (
              /* ── Riga normale ── */
              <tr key={m.id} className="hover:bg-gray-50 group">
                <td className="px-3 py-2 text-gray-400 font-mono font-semibold">
                  {m.numero_ordine}
                </td>
                <td className="px-3 py-2 font-semibold text-gray-800 uppercase">
                  {m.nome}
                </td>
                <td className="px-3 py-2 text-center">
                  {m.is_reperibilita && (
                    <span className="badge-rep text-[10px]">REP</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <div className="flex gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => startEdit(m)}
                      className="p-1.5 rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                      title="Modifica">
                      <Pencil size={14} />
                    </button>
                    <button onClick={() => eliminaMedico(m)} disabled={saving}
                      className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                      title="Elimina">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Aggiungi nuovo medico */}
      <div className="card p-4">
        <h3 className="font-semibold text-gray-700 mb-3 text-sm">Aggiungi medico</h3>
        <div className="flex gap-2">
          <input
            value={nuovoNome}
            onChange={e => setNuovoNome(e.target.value.toUpperCase())}
            onKeyDown={e => e.key === 'Enter' && aggiungi()}
            placeholder="COGNOME NOME..."
            className="input flex-1 text-sm uppercase"
          />
          <button onClick={aggiungi} disabled={!nuovoNome.trim()} className="btn-primary text-sm">
            <Plus size={15} /> Aggiungi
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-2">
          Viene aggiunto come ultimo in ordine (n° {medici.length > 0 ? Math.max(...medici.map(m => m.numero_ordine)) + 1 : 1}).
          Modifica il n° per riposizionarlo nella rotazione.
        </p>
      </div>

      {/* Legenda */}
      <div className="text-xs text-gray-400 space-y-1 px-1">
        <p className="flex items-center gap-1.5">
          <RefreshCw size={11} className="text-amber-500" />
          Dopo ogni modifica/eliminazione: <strong>Admin → Genera Calendario</strong> per aggiornare i turni
        </p>
        <p className="flex items-center gap-1.5">
          <Trash2 size={11} className="text-red-400" />
          L'eliminazione rimuove il medico da turni, ferie e schema in modo permanente
        </p>
      </div>
    </div>
  )
}
