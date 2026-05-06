import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Zap, AlertTriangle, CheckCircle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { calcolaCalendarioCompleto } from '../../lib/algorithm'
import type { Configurazione, Medico, SchemaModello } from '../../types'

export function GeneraCalendarioPage() {
  const qc = useQueryClient()
  const [stato, setStato] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle')
  const [messaggio, setMessaggio] = useState('')
  const [conferma, setConferma] = useState(false)

  const { data: config } = useQuery<Configurazione>({
    queryKey: ['configurazione'],
    queryFn: async () => {
      const { data, error } = await supabase.from('configurazione')
        .select('*').order('updated_at', { ascending: false }).limit(1).single()
      if (error) throw error
      return data
    },
  })

  const { data: medici = [] } = useQuery<Medico[]>({
    queryKey: ['medici'],
    queryFn: async () => {
      const { data, error } = await supabase.from('medici')
        .select('*').eq('attivo', true).order('numero_ordine')
      if (error) throw error
      return data
    },
  })

  const { data: schemi = [] } = useQuery<SchemaModello[]>({
    queryKey: ['schemi_modello'],
    queryFn: async () => {
      const { data, error } = await supabase.from('schemi_modello').select('*')
      if (error) throw error
      return data
    },
  })

  async function genera() {
    if (!config || medici.length === 0 || schemi.length === 0) return
    setStato('loading')
    setConferma(false)

    try {
      // 1. Calcola turni teorici
      setMessaggio('Calcolo turni in corso...')
      const turniGenerati = calcolaCalendarioCompleto(config, schemi, medici)

      // 2. Cancella turni esistenti nel periodo tramite medico_id
      //    (filtro esplicito per superare eventuali restrizioni RLS)
      setMessaggio('Cancellazione turni precedenti...')
      const medicoIds = medici.map(m => m.id)
      const dataInizio = `${config.anno_inizio}-${String(config.mese_inizio).padStart(2,'0')}-01`
      const dataFine = new Date(config.anno_fine, config.mese_fine, 0).toISOString().split('T')[0]

      const { error: delErr } = await supabase
        .from('turni')
        .delete()
        .in('medico_id', medicoIds)
        .gte('data', dataInizio)
        .lte('data', dataFine)

      if (delErr) throw new Error(`Cancellazione fallita: ${delErr.message}`)

      // 3. Inserisce i nuovi turni con upsert (più robusto di insert)
      const BATCH = 400
      for (let i = 0; i < turniGenerati.length; i += BATCH) {
        const chunk = turniGenerati.slice(i, i + BATCH)
        setMessaggio(`Salvataggio ${Math.min(i + BATCH, turniGenerati.length)} / ${turniGenerati.length} turni...`)

        const { error: insErr } = await supabase
          .from('turni')
          .upsert(chunk, { onConflict: 'medico_id,data' })

        if (insErr) throw new Error(`Inserimento fallito al batch ${i/BATCH + 1}: ${insErr.message}`)
      }

      setStato('ok')
      setMessaggio(`✓ Generati ${turniGenerati.length} turni per ${medici.length} medici.`)
      qc.invalidateQueries({ queryKey: ['turni'] })

    } catch (e: unknown) {
      setStato('error')
      setMessaggio((e as Error).message)
    }
  }

  if (!config) {
    return (
      <div className="card p-6 max-w-lg">
        <p className="text-gray-500">Configura prima il sistema nella sezione Configurazione.</p>
      </div>
    )
  }

  const dataInizio = `${String(config.mese_inizio).padStart(2,'0')}/${config.anno_inizio}`
  const dataFine   = `${String(config.mese_fine).padStart(2,'0')}/${config.anno_fine}`

  return (
    <div className="max-w-lg space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-800 mb-1">Genera Calendario</h2>
        <p className="text-sm text-gray-500">
          Calcola e salva tutti i turni teorici in base allo schema di rotazione.
        </p>
      </div>

      <div className="card p-4 space-y-2 text-sm">
        <h3 className="font-semibold text-gray-700">Parametri attuali</h3>
        <div className="grid grid-cols-2 gap-2 text-gray-600">
          <span>Periodo:</span>
          <span className="font-medium">{dataInizio} → {dataFine}</span>
          <span>Schema:</span>
          <span className="font-medium">{config.schema_attivo}</span>
          <span>Medici attivi:</span>
          <span className="font-medium">{medici.length}</span>
          <span>Slot schema:</span>
          <span className="font-medium">
            {schemi.filter(s => s.schema_num === config.schema_attivo).length} righe
          </span>
        </div>
      </div>

      <div className="flex gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
        <AlertTriangle size={18} className="shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold mb-1">Attenzione</p>
          <p>
            Cancella tutti i turni esistenti del periodo e li ricalcola da zero.
            Le modifiche manuali andranno perse.
          </p>
        </div>
      </div>

      {stato === 'idle' && (
        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={conferma}
            onChange={e => setConferma(e.target.checked)}
            className="rounded"
          />
          Ho capito, voglio procedere con la generazione
        </label>
      )}

      {stato === 'idle' && (
        <button onClick={genera} disabled={!conferma} className="btn-primary">
          <Zap size={16} />
          Genera Calendario
        </button>
      )}

      {stato === 'loading' && (
        <div className="flex items-center gap-3 text-blue-700">
          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-700" />
          <span className="text-sm">{messaggio}</span>
        </div>
      )}

      {(stato === 'ok' || stato === 'error') && (
        <div className={`flex items-start gap-3 p-4 rounded-xl text-sm
          ${stato === 'ok'
            ? 'bg-green-50 border border-green-200 text-green-800'
            : 'bg-red-50 border border-red-200 text-red-800'}`}
        >
          {stato === 'ok'
            ? <CheckCircle size={18} className="shrink-0 mt-0.5" />
            : <AlertTriangle size={18} className="shrink-0 mt-0.5" />}
          <div>
            <p>{messaggio}</p>
            <button
              onClick={() => { setStato('idle'); setMessaggio('') }}
              className="mt-2 text-xs underline opacity-70 hover:opacity-100"
            >
              Torna indietro
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
