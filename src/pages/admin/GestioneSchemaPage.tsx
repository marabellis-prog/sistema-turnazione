import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Save, Plus, Trash2, Info } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import type { SchemaModello, Medico } from '../../types'

const GIORNI = ['', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica']

// ── Cella numerica editabile ──────────────────────────────────────
function NumCell({
  value, onChange, placeholder = '—',
}: { value: number | null; onChange: (v: number | null) => void; placeholder?: string }) {
  return (
    <input
      type="number" min={1} max={99}
      value={value ?? ''}
      onChange={e => onChange(e.target.value === '' ? null : +e.target.value)}
      placeholder={placeholder}
      className="w-14 rounded border border-gray-200 px-1 py-0.5 text-center text-sm
                 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
    />
  )
}

// ─────────────────────────────────────────────────────────────────

export function GestioneSchemaPage() {
  const qc = useQueryClient()
  const [schemaNum, setSchemaNum] = useState(1)
  const [changes, setChanges]     = useState<Record<string, Partial<SchemaModello>>>({})
  const [saving, setSaving]       = useState(false)
  const [messaggio, setMessaggio] = useState('')

  // ── Fetch schemi ──
  const { data: schemi = [], isLoading } = useQuery<SchemaModello[]>({
    queryKey: ['schemi_modello'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('schemi_modello').select('*').order('giorno_settimana').order('slot')
      if (error) throw error
      return data
    },
  })

  // ── Fetch medici (per mostrare i nomi) ──
  const { data: medici = [] } = useQuery<Medico[]>({
    queryKey: ['medici'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('medici').select('*').eq('attivo', true).order('numero_ordine')
      if (error) throw error
      return data
    },
  })

  // Mappa numero_ordine → nome
  const medicoNome = useMemo(() => {
    const m: Record<number, string> = {}
    medici.forEach(med => { m[med.numero_ordine] = med.nome })
    return m
  }, [medici])

  // ── Schemi filtrati per schema_num selezionato ──
  const schemiCorrenti = useMemo(() =>
    schemi.filter(s => s.schema_num === schemaNum),
  [schemi, schemaNum])

  // ── Raggruppati per giorno_settimana ──
  const perGiorno = useMemo(() => {
    const map: Record<number, SchemaModello[]> = {}
    for (let g = 1; g <= 7; g++) {
      map[g] = schemiCorrenti.filter(s => s.giorno_settimana === g)
        .sort((a, b) => a.slot - b.slot)
    }
    return map
  }, [schemiCorrenti])

  // ── Key univoca per uno slot ──
  function rowKey(s: SchemaModello) { return s.id }

  // ── Legge il valore corrente di un campo (locale o DB) ──
  function getVal(s: SchemaModello, field: keyof SchemaModello) {
    const ch = changes[rowKey(s)]
    if (ch && field in ch) return (ch as Record<string, unknown>)[field as string]
    return s[field]
  }

  // ── Aggiorna un campo localmente ──
  function setVal(s: SchemaModello, field: keyof SchemaModello, val: unknown) {
    setChanges(prev => ({
      ...prev,
      [rowKey(s)]: { ...prev[rowKey(s)], [field]: val },
    }))
  }

  // ── Aggiunge uno slot vuoto (solo localmente, salvato su "Salva") ──
  async function aggiungiSlot(giorno: number) {
    const slotsGiorno = perGiorno[giorno]
    const nextSlot = slotsGiorno.length > 0
      ? Math.max(...slotsGiorno.map(s => s.slot)) + 1
      : 0

    const { data, error } = await supabase.from('schemi_modello').insert({
      schema_num: schemaNum,
      giorno_settimana: giorno,
      slot: nextSlot,
      numero_medico_mattina: null,
      numero_medico_pomeriggio: null,
      numero_medico_rm: null,
      numero_medico_rp: null,
      is_reperibilita: false,
    }).select().single()

    if (error) { setMessaggio('Errore: ' + error.message); return }
    qc.invalidateQueries({ queryKey: ['schemi_modello'] })
  }

  // ── Elimina uno slot ──
  async function eliminaSlot(s: SchemaModello) {
    if (!confirm(`Eliminare slot ${s.slot} di ${GIORNI[s.giorno_settimana]}?`)) return
    await supabase.from('schemi_modello').delete().eq('id', s.id)
    setChanges(prev => {
      const n = { ...prev }; delete n[s.id]; return n
    })
    qc.invalidateQueries({ queryKey: ['schemi_modello'] })
  }

  // ── Salva tutti i cambiamenti ──
  async function salva() {
    const ids = Object.keys(changes)
    if (ids.length === 0) { setMessaggio('Nessuna modifica da salvare.'); return }
    setSaving(true); setMessaggio('')
    let errori = 0

    for (const id of ids) {
      const { error } = await supabase
        .from('schemi_modello')
        .update(changes[id])
        .eq('id', id)
      if (error) errori++
    }

    setSaving(false)
    if (errori > 0) {
      setMessaggio(`Salvato con ${errori} errori.`)
    } else {
      setChanges({})
      setMessaggio(`✓ Salvati ${ids.length} slot.`)
      qc.invalidateQueries({ queryKey: ['schemi_modello'] })
      setTimeout(() => setMessaggio(''), 3000)
    }
  }

  const numChanges = Object.keys(changes).length

  return (
    <div className="space-y-4 max-w-4xl">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-800">Gestione Schema</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Modifica la tabella di rotazione. Dopo aver salvato lo schema,
            vai su <strong>Genera Calendario</strong> per ricalcolare i turni.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <select
            value={schemaNum}
            onChange={e => { setSchemaNum(+e.target.value); setChanges({}) }}
            className="input w-32"
          >
            {[1, 2, 3].map(n => <option key={n} value={n}>Schema {n}</option>)}
          </select>

          <button
            onClick={salva}
            disabled={saving || numChanges === 0}
            className="btn-primary"
          >
            <Save size={15} />
            {saving ? 'Salvataggio...' : `Salva${numChanges > 0 ? ` (${numChanges})` : ''}`}
          </button>
        </div>
      </div>

      {/* Messaggio esito */}
      {messaggio && (
        <div className={`text-sm px-3 py-2 rounded-lg ${
          messaggio.startsWith('✓')
            ? 'bg-green-50 text-green-700 border border-green-200'
            : 'bg-amber-50 text-amber-700 border border-amber-200'
        }`}>
          {messaggio}
        </div>
      )}

      {/* Legenda */}
      <div className="flex flex-wrap gap-3 text-xs text-gray-500 bg-gray-50 px-3 py-2 rounded-lg border border-gray-200">
        <span className="flex items-center gap-1"><Info size={12} /> Legenda:</span>
        <span><strong>M</strong> = Mattina clinica</span>
        <span><strong>P</strong> = Pomeriggio clinico</span>
        <span><strong>RM</strong> = Ricerca mattina</span>
        <span><strong>RP</strong> = Ricerca pomeriggio</span>
        <span><strong>REP</strong> = slot reperibilità (chi ha quel numero è in REP)</span>
        <span>Il numero corrisponde a <em>numero_ordine</em> del medico</span>
      </div>

      {isLoading && <p className="text-gray-400 text-sm">Caricamento...</p>}

      {/* Tabella per ogni giorno */}
      {[1, 2, 3, 4, 5, 6, 7].map(giorno => {
        const slots = perGiorno[giorno] ?? []
        return (
          <div key={giorno} className="card overflow-hidden">
            {/* Header giorno */}
            <div className="flex items-center justify-between px-4 py-2 bg-blue-700 text-white">
              <span className="font-semibold text-sm">{GIORNI[giorno]}</span>
              <button
                onClick={() => aggiungiSlot(giorno)}
                className="flex items-center gap-1 text-xs bg-blue-600 hover:bg-blue-500
                           px-2 py-1 rounded transition-colors"
              >
                <Plus size={12} /> Aggiungi slot
              </button>
            </div>

            {/* Tabella slot */}
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-3 py-1.5 text-left text-xs font-semibold text-gray-500 w-12">Slot</th>
                  <th className="px-2 py-1.5 text-center text-xs font-semibold text-gray-500">Mattina (M)</th>
                  <th className="px-2 py-1.5 text-center text-xs font-semibold text-gray-500">Pomeriggio (P)</th>
                  <th className="px-2 py-1.5 text-center text-xs font-semibold text-gray-500">Ric. Mat (RM)</th>
                  <th className="px-2 py-1.5 text-center text-xs font-semibold text-gray-500">Ric. Pom (RP)</th>
                  <th className="px-2 py-1.5 text-center text-xs font-semibold text-gray-500">REP?</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {slots.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-3 text-center text-gray-400 text-xs">
                      Nessuno slot — clicca "+ Aggiungi slot"
                    </td>
                  </tr>
                )}
                {slots.map(s => {
                  const m   = getVal(s, 'numero_medico_mattina')    as number | null
                  const p   = getVal(s, 'numero_medico_pomeriggio') as number | null
                  const rm  = getVal(s, 'numero_medico_rm')         as number | null
                  const rp  = getVal(s, 'numero_medico_rp')         as number | null
                  const rep = getVal(s, 'is_reperibilita')           as boolean
                  const isChanged = !!changes[s.id]

                  return (
                    <tr key={s.id} className={`hover:bg-gray-50 ${isChanged ? 'bg-blue-50' : ''}`}>
                      <td className="px-3 py-1.5 text-gray-400 font-mono text-xs">{s.slot}</td>

                      {/* Mattina */}
                      <td className="px-2 py-1.5 text-center">
                        <div className="flex flex-col items-center gap-0.5">
                          <NumCell value={m} onChange={v => setVal(s, 'numero_medico_mattina', v)} />
                          {m && <span className="text-[10px] text-gray-400">{medicoNome[m] ?? '?'}</span>}
                        </div>
                      </td>

                      {/* Pomeriggio */}
                      <td className="px-2 py-1.5 text-center">
                        <div className="flex flex-col items-center gap-0.5">
                          <NumCell value={p} onChange={v => setVal(s, 'numero_medico_pomeriggio', v)} />
                          {p && <span className="text-[10px] text-gray-400">{medicoNome[p] ?? '?'}</span>}
                        </div>
                      </td>

                      {/* RM */}
                      <td className="px-2 py-1.5 text-center">
                        <NumCell value={rm} onChange={v => setVal(s, 'numero_medico_rm', v)} />
                      </td>

                      {/* RP */}
                      <td className="px-2 py-1.5 text-center">
                        <NumCell value={rp} onChange={v => setVal(s, 'numero_medico_rp', v)} />
                      </td>

                      {/* REP */}
                      <td className="px-2 py-1.5 text-center">
                        <input
                          type="checkbox"
                          checked={!!rep}
                          onChange={e => setVal(s, 'is_reperibilita', e.target.checked)}
                          className="w-4 h-4 accent-red-500"
                          title="Questo slot è reperibilità"
                        />
                      </td>

                      {/* Elimina */}
                      <td className="px-2 py-1.5 text-right">
                        <button
                          onClick={() => eliminaSlot(s)}
                          className="text-gray-300 hover:text-red-500 p-0.5"
                          title="Elimina slot"
                        >
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )
      })}
    </div>
  )
}
