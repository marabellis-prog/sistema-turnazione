import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Save, CheckCircle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { MESI_IT } from '../../lib/algorithm'
import type { Configurazione } from '../../types'

export function ConfigPage() {
  const qc = useQueryClient()
  const [form, setForm] = useState({
    anno_inizio: 2026, mese_inizio: 5,
    anno_fine:   2026, mese_fine:   10,
    schema_attivo: 1,
  })
  const [saving, setSaving] = useState(false)
  const [ok, setOk]         = useState(false)
  const [errore, setErrore] = useState('')

  const { data: config } = useQuery<Configurazione>({
    queryKey: ['configurazione'],
    queryFn: async () => {
      const { data, error } = await supabase.from('configurazione')
        .select('*').order('updated_at', { ascending: false }).limit(1).single()
      if (error && error.code !== 'PGRST116') throw error
      return data || null
    },
  })

  useEffect(() => {
    if (config) {
      setForm({
        anno_inizio: config.anno_inizio,
        mese_inizio: config.mese_inizio,
        anno_fine:   config.anno_fine,
        mese_fine:   config.mese_fine,
        schema_attivo: config.schema_attivo,
      })
    }
  }, [config])

  function set(key: string, val: number) {
    setForm(f => ({ ...f, [key]: val }))
  }

  async function salva() {
    setSaving(true); setOk(false); setErrore('')
    const payload = { ...form, updated_at: new Date().toISOString() }

    let error
    if (config?.id) {
      ({ error } = await supabase.from('configurazione').update(payload).eq('id', config.id))
    } else {
      ({ error } = await supabase.from('configurazione').insert(payload))
    }

    setSaving(false)
    if (error) { setErrore(error.message); return }
    setOk(true)
    setTimeout(() => setOk(false), 3000)
    qc.invalidateQueries({ queryKey: ['configurazione'] })
  }

  const ANNI = [2025, 2026, 2027, 2028]

  return (
    <div className="max-w-lg space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-800">Configurazione</h2>
        <p className="text-sm text-gray-500">Imposta il periodo e lo schema del calendario.</p>
      </div>

      {errore && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{errore}</div>}

      <div className="card p-5 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Mese inizio</label>
            <select value={form.mese_inizio} onChange={e => set('mese_inizio', +e.target.value)} className="input">
              {MESI_IT.slice(1).map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Anno inizio</label>
            <select value={form.anno_inizio} onChange={e => set('anno_inizio', +e.target.value)} className="input">
              {ANNI.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Mese fine</label>
            <select value={form.mese_fine} onChange={e => set('mese_fine', +e.target.value)} className="input">
              {MESI_IT.slice(1).map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Anno fine</label>
            <select value={form.anno_fine} onChange={e => set('anno_fine', +e.target.value)} className="input">
              {ANNI.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className="label">Schema attivo</label>
          <select value={form.schema_attivo} onChange={e => set('schema_attivo', +e.target.value)} className="input w-32">
            {[1,2,3].map(n => <option key={n} value={n}>Schema {n}</option>)}
          </select>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button onClick={salva} disabled={saving} className="btn-primary">
            <Save size={16} />
            {saving ? 'Salvataggio...' : 'Salva configurazione'}
          </button>
          {ok && (
            <span className="flex items-center gap-1 text-green-700 text-sm">
              <CheckCircle size={16} /> Salvato
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
