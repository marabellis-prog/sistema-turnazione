import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Save, Plus, Trash2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import type { SchemaModello, Medico } from '../../types'

const GIORNI_LABEL = ['', 'LUNEDÌ', 'MARTEDÌ', 'MERCOLEDÌ', 'GIOVEDÌ', 'VENERDÌ', 'SABATO', 'DOMENICA']
const GIORNI_SHORT = ['', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom']

// ─── Cella editabile ──────────────────────────────────────────────
function CellaNumero({
  value,
  nome,
  isRep,
  onChange,
}: {
  value:    number | null
  nome:     string | undefined
  isRep:    boolean
  onChange: (v: number | null) => void
}) {
  const [editing, setEditing] = useState(false)

  if (editing) {
    return (
      <input
        type="number" min={1} max={99}
        defaultValue={value ?? ''}
        autoFocus
        className="w-14 rounded border-2 border-blue-400 px-1 py-0.5 text-center text-sm
                   focus:outline-none"
        onBlur={e => {
          const v = e.target.value === '' ? null : +e.target.value
          onChange(v)
          setEditing(false)
        }}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === 'Escape') {
            const v = (e.target as HTMLInputElement).value === ''
              ? null : +(e.target as HTMLInputElement).value
            onChange(v)
            setEditing(false)
          }
        }}
      />
    )
  }

  return (
    <div
      onClick={() => setEditing(true)}
      className={`cursor-pointer rounded px-2 py-0.5 text-center leading-tight
        hover:ring-2 hover:ring-blue-300 transition-all select-none
        ${value ? 'min-w-[40px]' : 'min-w-[40px] text-gray-300'}`}
      title="Clicca per modificare"
    >
      {value ? (
        <>
          <div className={`text-sm font-bold ${isRep ? 'text-red-700' : 'text-gray-800'}`}>
            {value}
          </div>
          {nome && (
            <div className="text-[9px] text-gray-400 uppercase tracking-tight leading-none mt-0.5">
              {nome.slice(0, 8)}
            </div>
          )}
        </>
      ) : (
        <span className="text-xs text-gray-200">—</span>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────

export function GestioneSchemaPage() {
  const qc = useQueryClient()
  const [schemaNum, setSchemaNum] = useState(1)
  // modifiche pendenti: id slot → patch parziale
  const [changes, setChanges]   = useState<Record<string, Partial<SchemaModello>>>({})
  const [saving, setSaving]     = useState(false)
  const [messaggio, setMessaggio] = useState('')

  // ── Dati ──────────────────────────────────────────────────────
  const { data: schemi = [], isLoading } = useQuery<SchemaModello[]>({
    queryKey: ['schemi_modello'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('schemi_modello').select('*')
        .order('giorno_settimana').order('slot')
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

  const nomeMap = useMemo(() => {
    const m: Record<number, string> = {}
    medici.forEach(med => { m[med.numero_ordine] = med.nome })
    return m
  }, [medici])

  const schemiCorrenti = useMemo(() =>
    schemi.filter(s => s.schema_num === schemaNum),
  [schemi, schemaNum])

  const perGiorno = useMemo(() => {
    const map: Record<number, SchemaModello[]> = {}
    for (let g = 1; g <= 7; g++) {
      map[g] = schemiCorrenti.filter(s => s.giorno_settimana === g)
        .sort((a, b) => a.slot - b.slot)
    }
    return map
  }, [schemiCorrenti])

  // ── Helpers ──────────────────────────────────────────────────
  function getVal<K extends keyof SchemaModello>(s: SchemaModello, field: K): SchemaModello[K] {
    const ch = changes[s.id]
    if (ch && field in ch) return (ch as Record<string, unknown>)[field as string] as SchemaModello[K]
    return s[field]
  }

  function setVal(s: SchemaModello, field: keyof SchemaModello, val: unknown) {
    setChanges(prev => ({
      ...prev,
      [s.id]: { ...prev[s.id], [field]: val },
    }))
  }

  // ── Aggiungi slot ─────────────────────────────────────────────
  async function aggiungiSlot(giorno: number) {
    const slots = perGiorno[giorno]
    const nextSlot = slots.length > 0 ? Math.max(...slots.map(s => s.slot)) + 1 : 0
    const { error } = await supabase.from('schemi_modello').insert({
      schema_num: schemaNum, giorno_settimana: giorno, slot: nextSlot,
      numero_medico_mattina: null, numero_medico_pomeriggio: null,
      numero_medico_rm: null, numero_medico_rp: null, is_reperibilita: false,
    })
    if (error) { setMessaggio('Errore: ' + error.message); return }
    qc.invalidateQueries({ queryKey: ['schemi_modello'] })
  }

  // ── Elimina slot ──────────────────────────────────────────────
  async function eliminaSlot(s: SchemaModello) {
    if (!confirm(`Eliminare questo slot da ${GIORNI_SHORT[s.giorno_settimana]}?`)) return
    await supabase.from('schemi_modello').delete().eq('id', s.id)
    setChanges(prev => { const n = { ...prev }; delete n[s.id]; return n })
    qc.invalidateQueries({ queryKey: ['schemi_modello'] })
  }

  // ── Salva modifiche ───────────────────────────────────────────
  async function salva() {
    const ids = Object.keys(changes)
    if (ids.length === 0) { setMessaggio('Nessuna modifica.'); return }
    setSaving(true); setMessaggio('')
    let err = 0

    for (const id of ids) {
      const { error } = await supabase
        .from('schemi_modello').update(changes[id]).eq('id', id)
      if (error) err++
    }

    setSaving(false)
    if (err > 0) {
      setMessaggio(`Salvato con ${err} errori.`)
    } else {
      setChanges({})
      setMessaggio(`✓ Salvati ${ids.length} slot`)
      qc.invalidateQueries({ queryKey: ['schemi_modello'] })
      setTimeout(() => setMessaggio(''), 3000)
    }
  }

  const numPendenti = Object.keys(changes).length

  // ─────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-800">Schema Turni</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Clicca su un numero per modificarlo · Invio/clic fuori per confermare
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={schemaNum}
            onChange={e => { setSchemaNum(+e.target.value); setChanges({}) }}
            className="input w-32 text-sm"
          >
            {[1,2,3].map(n => <option key={n} value={n}>Schema {n}</option>)}
          </select>
          <button
            onClick={salva}
            disabled={saving || numPendenti === 0}
            className="btn-primary text-sm py-1.5"
          >
            <Save size={14} />
            {saving ? 'Salvo...' : `Salva${numPendenti > 0 ? ` (${numPendenti})` : ''}`}
          </button>
        </div>
      </div>

      {/* Feedback */}
      {messaggio && (
        <div className={`text-sm px-3 py-1.5 rounded-lg border ${
          messaggio.startsWith('✓')
            ? 'bg-green-50 text-green-700 border-green-200'
            : 'bg-amber-50 text-amber-700 border-amber-200'
        }`}>{messaggio}</div>
      )}

      {isLoading && <p className="text-gray-400 text-sm py-4">Caricamento schema...</p>}

      {/* ── Tabella stile Excel ─────────────────────────────────── */}
      {!isLoading && (
        <div className="card overflow-x-auto">
          <table className="w-full border-collapse text-sm" style={{ minWidth: 520 }}>
            <thead>
              <tr className="bg-gray-800 text-white text-xs">
                <th className="border border-gray-600 px-3 py-2 text-left w-28">Giorno</th>
                <th className="border border-gray-600 px-2 py-2 text-center w-24">
                  <div>MATTINA</div>
                  <div className="font-normal opacity-60 text-[10px]">cM</div>
                </th>
                <th className="border border-gray-600 px-2 py-2 text-center w-24">
                  <div>POMERIGGIO</div>
                  <div className="font-normal opacity-60 text-[10px]">cP</div>
                </th>
                <th className="border border-gray-600 px-2 py-2 text-center w-24">
                  <div>RIC. MAT.</div>
                  <div className="font-normal opacity-60 text-[10px]">cRM</div>
                </th>
                <th className="border border-gray-600 px-2 py-2 text-center w-24">
                  <div>RIC. POM.</div>
                  <div className="font-normal opacity-60 text-[10px]">cRP</div>
                </th>
                <th className="border border-gray-600 px-2 py-2 text-center w-10 text-[10px]">REP</th>
                <th className="border border-gray-600 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {[1,2,3,4,5,6,7].map(giorno => {
                const slots = perGiorno[giorno] ?? []
                const numSlots = Math.max(slots.length, 1)

                return slots.length === 0
                  // Riga giorno vuota
                  ? (
                    <tr key={`g${giorno}`} className="bg-white">
                      <td
                        className="border border-gray-300 px-3 py-2 font-bold text-xs
                                   bg-blue-50 text-blue-800 align-middle text-center"
                      >
                        {GIORNI_LABEL[giorno]}
                      </td>
                      <td colSpan={5} className="border border-gray-300 px-3 py-2 text-gray-300 text-xs text-center">
                        nessuno slot
                      </td>
                      <td className="border border-gray-300 px-1 py-1 text-center">
                        <button
                          onClick={() => aggiungiSlot(giorno)}
                          className="text-blue-400 hover:text-blue-600"
                          title="Aggiungi slot"
                        >
                          <Plus size={13} />
                        </button>
                      </td>
                    </tr>
                  )
                  // Righe giorno con slot
                  : slots.map((s, idx) => {
                    const m   = getVal(s, 'numero_medico_mattina')    as number | null
                    const p   = getVal(s, 'numero_medico_pomeriggio') as number | null
                    const rm  = getVal(s, 'numero_medico_rm')         as number | null
                    const rp  = getVal(s, 'numero_medico_rp')         as number | null
                    const rep = getVal(s, 'is_reperibilita')           as boolean
                    const changed = !!changes[s.id]

                    // Colori riga
                    const rowBg = rep
                      ? 'bg-red-50'
                      : changed
                        ? 'bg-blue-50'
                        : idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'

                    return (
                      <tr key={s.id} className={rowBg}>
                        {/* Cella giorno (solo prima riga del gruppo, con rowspan) */}
                        {idx === 0 && (
                          <td
                            rowSpan={numSlots}
                            className="border border-gray-300 px-2 py-1 font-bold text-xs
                                       bg-blue-700 text-white text-center align-middle"
                          >
                            <div>{GIORNI_LABEL[giorno]}</div>
                            <button
                              onClick={() => aggiungiSlot(giorno)}
                              className="mt-2 flex items-center gap-0.5 text-blue-200
                                         hover:text-white text-[10px] mx-auto"
                              title="Aggiungi slot"
                            >
                              <Plus size={10} /> slot
                            </button>
                          </td>
                        )}

                        {/* M */}
                        <td className={`border border-gray-200 px-1 py-1 text-center
                          ${rep ? 'bg-red-50' : ''}`}>
                          <CellaNumero
                            value={m}
                            nome={m ? nomeMap[m] : undefined}
                            isRep={rep}
                            onChange={v => setVal(s, 'numero_medico_mattina', v)}
                          />
                        </td>

                        {/* P */}
                        <td className={`border border-gray-200 px-1 py-1 text-center
                          ${rep ? 'bg-red-50' : ''}`}>
                          <CellaNumero
                            value={p}
                            nome={p ? nomeMap[p] : undefined}
                            isRep={false}
                            onChange={v => setVal(s, 'numero_medico_pomeriggio', v)}
                          />
                        </td>

                        {/* RM */}
                        <td className="border border-gray-200 px-1 py-1 text-center bg-violet-50/30">
                          <CellaNumero
                            value={rm}
                            nome={rm ? nomeMap[rm] : undefined}
                            isRep={false}
                            onChange={v => setVal(s, 'numero_medico_rm', v)}
                          />
                        </td>

                        {/* RP */}
                        <td className="border border-gray-200 px-1 py-1 text-center bg-pink-50/30">
                          <CellaNumero
                            value={rp}
                            nome={rp ? nomeMap[rp] : undefined}
                            isRep={false}
                            onChange={v => setVal(s, 'numero_medico_rp', v)}
                          />
                        </td>

                        {/* REP checkbox */}
                        <td className="border border-gray-200 px-1 py-1 text-center">
                          <input
                            type="checkbox"
                            checked={!!rep}
                            onChange={e => setVal(s, 'is_reperibilita', e.target.checked)}
                            className="accent-red-500 w-3.5 h-3.5"
                            title="Slot reperibilità"
                          />
                        </td>

                        {/* Elimina */}
                        <td className="border border-gray-200 px-1 py-1 text-center">
                          <button
                            onClick={() => eliminaSlot(s)}
                            className="text-gray-300 hover:text-red-400"
                            title="Elimina slot"
                          >
                            <Trash2 size={12} />
                          </button>
                        </td>
                      </tr>
                    )
                  })
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Legenda */}
      <div className="flex flex-wrap gap-4 text-xs text-gray-500 pt-1">
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-red-100 border border-red-300 inline-block" />
          Reperibilità
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-violet-100 inline-block" />
          Ricerca mattina
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-pink-100 inline-block" />
          Ricerca pomeriggio
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-blue-50 border border-blue-200 inline-block" />
          Modificata
        </span>
        <span>· Stesso numero in M e P = turno lungo (L)</span>
      </div>
    </div>
  )
}
