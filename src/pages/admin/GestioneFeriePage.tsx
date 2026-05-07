import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, CheckCircle, XCircle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { MESI_IT } from '../../lib/algorithm'
import { useConfirm } from '../../hooks/useConfirm'
import { ConfirmModal } from '../../components/ConfirmModal'
import { usePendingActions } from '../../contexts/PendingActionsContext'
import type { Medico, Ferie } from '../../types'

export function GestioneFeriePage() {
  const qc = useQueryClient()
  const { confirm, confirmState } = useConfirm()
  const { setNeedsRefresh } = usePendingActions()
  const [medicoId, setMedicoId]     = useState('')
  const [dataInizio, setDataInizio] = useState('')
  const [dataFine, setDataFine]     = useState('')
  const [note, setNote]             = useState('')
  const [errore, setErrore]         = useState('')
  const [saving, setSaving]         = useState(false)

  const { data: medici = [] } = useQuery<Medico[]>({
    queryKey: ['medici'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('medici').select('*').eq('attivo', true).order('numero_ordine')
      if (error) throw error
      return data
    },
  })

  const { data: ferie = [] } = useQuery<(Ferie & { medico: Medico })[]>({
    queryKey: ['ferie'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ferie')
        .select('*, medico:medici(*)')
        .order('data_inizio')
      if (error) throw error
      return data as (Ferie & { medico: Medico })[]
    },
  })

  async function aggiungi() {
    if (!medicoId || !dataInizio || !dataFine) {
      setErrore('Compila tutti i campi obbligatori.')
      return
    }
    if (dataFine < dataInizio) {
      setErrore('La data fine deve essere uguale o successiva alla data inizio.')
      return
    }
    setSaving(true)
    setErrore('')

    // 1. Inserisce il record ferie
    const { error } = await supabase.from('ferie').insert({
      medico_id:   medicoId,
      data_inizio: dataInizio,
      data_fine:   dataFine,
      note:        note.trim() || null,
      approvate:   true,
    })

    if (error) { setSaving(false); setErrore(error.message); return }

    // 2. Aggiorna i turni esistenti nel periodo come is_ferie=true
    const { error: err2 } = await supabase
      .from('turni')
      .update({ is_ferie: true })
      .eq('medico_id', medicoId)
      .gte('data', dataInizio)
      .lte('data', dataFine)

    setSaving(false)
    if (err2) { setErrore(err2.message); return }

    setMedicoId(''); setDataInizio(''); setDataFine(''); setNote('')
    qc.invalidateQueries({ queryKey: ['ferie'] })
    qc.invalidateQueries({ queryKey: ['turni'] })
    // 🟠 Ferie inserite → aggiornamento calendario (non rigenera)
    const medNome = medici.find(m => m.id === medicoId)?.nome ?? medicoId
    setNeedsRefresh(`Ferie inserite per ${medNome} (${dataInizio} → ${dataFine})`)
  }

  async function elimina(f: Ferie & { medico: Medico }) {
    const ok = await confirm({
      title:        `Elimina ferie di ${f.medico.nome}`,
      message:      `Le ferie dal ${formatDataIt(f.data_inizio)} al ${formatDataIt(f.data_fine)} verranno rimosse e le celle del calendario ripristinate.`,
      confirmLabel: 'Elimina',
      danger:       true,
    })
    if (!ok) return
    await supabase.from('ferie').delete().eq('id', f.id)
    // Rimuove il flag is_ferie dai turni
    await supabase
      .from('turni')
      .update({ is_ferie: false })
      .eq('medico_id', f.medico_id)
      .gte('data', f.data_inizio)
      .lte('data', f.data_fine)
    qc.invalidateQueries({ queryKey: ['ferie'] })
    qc.invalidateQueries({ queryKey: ['turni'] })
  }

  function formatDataIt(iso: string) {
    const [y, m, d] = iso.split('-')
    return `${d}/${m}/${y}`
  }

  return (
    <div className="max-w-2xl space-y-6">
      <ConfirmModal {...confirmState.opts} open={confirmState.open}
        onConfirm={confirmState.onConfirm} onCancel={confirmState.onCancel} />
      <div>
        <h2 className="text-xl font-bold text-stone-800">Gestione Ferie</h2>
        <p className="text-sm text-stone-600">
          Le celle del calendario vengono colorate di verde nelle date di ferie.
        </p>
      </div>

      {errore && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{errore}</div>
      )}

      {/* Elenco ferie esistenti */}
      {ferie.length > 0 && (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 border-b border-stone-200">
              <tr>
                <th className="px-3 py-2 text-left font-semibold text-gray-600">Medico</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-600">Da</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-600">A</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-600">Note</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {ferie.map(f => (
                <tr key={f.id} className="hover:bg-stone-50">
                  <td className="px-3 py-2 font-medium">{f.medico.nome}</td>
                  <td className="px-3 py-2 text-gray-600">{formatDataIt(f.data_inizio)}</td>
                  <td className="px-3 py-2 text-gray-600">{formatDataIt(f.data_fine)}</td>
                  <td className="px-3 py-2 text-stone-500 text-xs">{f.note || '—'}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => elimina(f)}
                      className="text-gray-300 hover:text-red-500 p-1"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Form inserimento */}
      <div className="card p-4 space-y-3">
        <h3 className="font-semibold text-stone-700">Inserisci periodo ferie</h3>

        <div>
          <label className="label">Medico *</label>
          <select value={medicoId} onChange={e => setMedicoId(e.target.value)} className="input">
            <option value="">Seleziona medico...</option>
            {medici.map(m => (
              <option key={m.id} value={m.id}>{m.nome}</option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Data inizio *</label>
            <input type="date" value={dataInizio} onChange={e => setDataInizio(e.target.value)} className="input" />
          </div>
          <div>
            <label className="label">Data fine *</label>
            <input type="date" value={dataFine} onChange={e => setDataFine(e.target.value)} className="input" />
          </div>
        </div>

        <div>
          <label className="label">Note (opzionale)</label>
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="es. Ferie estive" className="input" />
        </div>

        <button onClick={aggiungi} disabled={saving} className="btn-primary">
          <Plus size={16} /> Aggiungi Ferie
        </button>
      </div>
    </div>
  )
}
