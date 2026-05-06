import { useState, useMemo, useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Save, RotateCcw, Plus, X, Trash2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import type { SchemaModello, Medico } from '../../types'

// ── Colori pastello (uno per turnista, deterministici per indice) ─
const PASTEL: { bg: string; fg: string }[] = [
  { bg: '#fecdd3', fg: '#9f1239' }, // rosa
  { bg: '#fed7aa', fg: '#9a3412' }, // arancio
  { bg: '#fef9c3', fg: '#713f12' }, // giallo
  { bg: '#bbf7d0', fg: '#14532d' }, // verde
  { bg: '#a5f3fc', fg: '#164e63' }, // ciano
  { bg: '#bfdbfe', fg: '#1e3a8a' }, // blu
  { bg: '#ddd6fe', fg: '#4c1d95' }, // viola
  { bg: '#f5d0fe', fg: '#701a75' }, // fucsia
  { bg: '#fbcfe8', fg: '#831843' }, // pink
  { bg: '#d1fae5', fg: '#064e3b' }, // smeraldo
  { bg: '#ccfbf1', fg: '#134e4a' }, // teal
  { bg: '#e0e7ff', fg: '#3730a3' }, // indaco
]

// ── Mappatura nomi colonna → campo DB ────────────────────────────
const CAMPO: Record<string, 'numero_medico_mattina' | 'numero_medico_pomeriggio' | 'numero_medico_rm' | 'numero_medico_rp'> = {
  M:  'numero_medico_mattina',
  P:  'numero_medico_pomeriggio',
  RM: 'numero_medico_rm',
  RP: 'numero_medico_rp',
}
const COLONNE_PRESET = ['M', 'P', 'RM', 'RP']

const GIORNI_IT  = ['','Lunedì','Martedì','Mercoledì','Giovedì','Venerdì','Sabato','Domenica']

// ── Tipi interni ─────────────────────────────────────────────────
interface SlotRow {
  id:   string | null  // null = non ancora salvato su DB
  slot: number
  vals: Record<string, number | null>  // colonna → numero medico
  REP:  boolean
}

function emptySlot(slot: number, colonne: string[]): SlotRow {
  const vals: Record<string, number | null> = {}
  colonne.forEach(c => { vals[c] = null })
  return { id: null, slot, vals, REP: false }
}

// ── Componente Cella (drop target) ───────────────────────────────
function Cella({
  valore, colore, testo, onDrop, onClear,
}: {
  valore:  number | null
  colore:  { bg: string; fg: string } | null
  testo:   string
  onDrop:  () => void
  onClear: () => void
}) {
  const [over, setOver] = useState(false)

  return (
    <td
      className={`border border-gray-200 align-middle text-center
        transition-all duration-100 cursor-pointer select-none
        ${over ? 'ring-2 ring-blue-400 ring-inset' : ''}
      `}
      style={{
        width: 72, minWidth: 72, height: 52,
        background: valore && colore ? colore.bg : over ? '#eff6ff' : '#fafafa',
      }}
      onDragOver={e => { e.preventDefault(); setOver(true) }}
      onDragLeave={()  => setOver(false)}
      onDrop={e => { e.preventDefault(); setOver(false); onDrop() }}
      onDoubleClick={onClear}
      title={valore ? `${testo} — doppio clic per svuotare` : 'Trascina un turnista qui'}
    >
      {valore ? (
        <div className="flex flex-col items-center leading-tight">
          <span
            className="font-bold text-base"
            style={{ color: colore?.fg }}
          >
            {valore}
          </span>
          <span className="text-[9px] uppercase tracking-tight opacity-70"
            style={{ color: colore?.fg }}>
            {testo.slice(0, 7)}
          </span>
        </div>
      ) : (
        <span className="text-gray-200 text-xs">—</span>
      )}
    </td>
  )
}

// ── Componente chip turnista (draggable) ─────────────────────────
function ChipTurnista({
  medico, color, onDragStart,
}: {
  medico:      Medico
  color:       { bg: string; fg: string }
  onDragStart: () => void
}) {
  return (
    <div className="flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-gray-50">
      {/* Info medico */}
      <div
        className="flex-1 rounded px-2 py-0.5 text-xs font-medium truncate"
        style={{ background: color.bg, color: color.fg }}
      >
        {medico.nome}
      </div>

      {/* Chip draggabile */}
      <div
        draggable
        onDragStart={e => {
          e.dataTransfer.setData('doctorNum', String(medico.numero_ordine))
          e.dataTransfer.effectAllowed = 'copy'
          onDragStart()
        }}
        className="rounded-md w-10 h-8 flex items-center justify-center
                   font-bold text-sm cursor-grab active:cursor-grabbing
                   shadow-sm border border-white/60 shrink-0
                   hover:scale-110 transition-transform"
        style={{ background: color.bg, color: color.fg }}
        title={`Trascina il numero ${medico.numero_ordine} (${medico.nome}) in una cella`}
      >
        {medico.numero_ordine}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// Pagina principale
// ════════════════════════════════════════════════════════════════
export function GestioneSchemaPage() {
  const qc = useQueryClient()

  // Config schema
  const [schemaNum,  setSchemaNum]  = useState(1)
  const [tipoSchema, setTipoSchema] = useState<'weekly' | 'custom'>('weekly')
  const [colonne,    setColonne]    = useState<string[]>(['M', 'P'])
  const [giorni,     setGiorni]     = useState<number[]>([1,2,3,4,5,6,7])
  const [nuovaCol,   setNuovaCol]   = useState('')
  const [addColOpen, setAddColOpen] = useState(false)

  // Dati griglia
  const [griglia,  setGriglia]  = useState<Record<number, SlotRow[]>>({})
  const [saving,   setSaving]   = useState(false)
  const [messaggio,setMessaggio] = useState('')

  // Drag state (ref per evitare re-render inutili)
  const draggingNum = useRef<number | null>(null)

  // ── Queries ──────────────────────────────────────────────────
  const { data: schemi = [] } = useQuery<SchemaModello[]>({
    queryKey: ['schemi_modello'],
    queryFn: async () => {
      const { data, error } = await supabase.from('schemi_modello').select('*')
        .order('giorno_settimana').order('slot')
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

  // Mappa numero_ordine → nome
  const nomeMap = useMemo(() => {
    const m: Record<number, string> = {}
    medici.forEach(med => { m[med.numero_ordine] = med.nome })
    return m
  }, [medici])

  // Mappa numero_ordine → colore pastello
  const colorMap = useMemo(() => {
    const m: Record<number, { bg: string; fg: string }> = {}
    medici.forEach((med, i) => { m[med.numero_ordine] = PASTEL[i % PASTEL.length] })
    return m
  }, [medici])

  // ── Carica schema dal DB ──────────────────────────────────────
  useEffect(() => {
    const data = schemi.filter(s => s.schema_num === schemaNum)

    if (data.length === 0) {
      // Schema vuoto — crea struttura iniziale
      const g: Record<number, SlotRow[]> = {}
      const days = tipoSchema === 'weekly' ? [1,2,3,4,5,6,7] : []
      days.forEach(d => { g[d] = [emptySlot(0, colonne)] })
      setGriglia(g)
      if (tipoSchema === 'weekly') setGiorni([1,2,3,4,5,6,7])
      return
    }

    // Rileva le colonne usate nello schema
    const colUsate = new Set<string>(['M', 'P'])
    data.forEach(r => {
      if (r.numero_medico_rm  !== null) colUsate.add('RM')
      if (r.numero_medico_rp  !== null) colUsate.add('RP')
    })
    const colList = COLONNE_PRESET.filter(c => colUsate.has(c))
    setColonne(colList)

    // Popola griglia
    const g: Record<number, SlotRow[]> = {}
    const giorniUsati = new Set<number>()
    data.forEach(r => {
      giorniUsati.add(r.giorno_settimana)
      if (!g[r.giorno_settimana]) g[r.giorno_settimana] = []
      const vals: Record<string, number | null> = {
        M:  r.numero_medico_mattina,
        P:  r.numero_medico_pomeriggio,
        RM: r.numero_medico_rm,
        RP: r.numero_medico_rp,
      }
      g[r.giorno_settimana].push({ id: r.id, slot: r.slot, vals, REP: r.is_reperibilita })
    })

    // Ordina per slot
    Object.values(g).forEach(rows => rows.sort((a, b) => a.slot - b.slot))

    setGriglia(g)
    const giorniOrdinati = [...giorniUsati].sort((a, b) => a - b)
    setGiorni(giorniOrdinati)
    if (giorniOrdinati.length < 7) setTipoSchema('custom')
  }, [schemi, schemaNum])

  // ── Gestione giorni ──────────────────────────────────────────
  function aggiungiGiorno(g: number) {
    if (giorni.includes(g)) return
    const nuovi = [...giorni, g].sort((a, b) => a - b)
    setGiorni(nuovi)
    setGriglia(prev => ({
      ...prev,
      [g]: [emptySlot(0, colonne)],
    }))
  }

  function rimuoviGiorno(g: number) {
    setGiorni(prev => prev.filter(d => d !== g))
    setGriglia(prev => {
      const n = { ...prev }; delete n[g]; return n
    })
  }

  // ── Gestione slot ─────────────────────────────────────────────
  function aggiungiSlot(giorno: number) {
    setGriglia(prev => {
      const rows = prev[giorno] ?? []
      const nextSlot = rows.length > 0 ? Math.max(...rows.map(r => r.slot)) + 1 : 0
      return { ...prev, [giorno]: [...rows, emptySlot(nextSlot, colonne)] }
    })
  }

  function rimuoviSlot(giorno: number, slotIdx: number) {
    setGriglia(prev => {
      const rows = [...(prev[giorno] ?? [])]
      rows.splice(slotIdx, 1)
      return { ...prev, [giorno]: rows }
    })
  }

  // ── Gestione colonne ─────────────────────────────────────────
  function aggiungiColonna(nome: string) {
    const n = nome.trim().toUpperCase()
    if (!n || colonne.includes(n)) return
    setColonne(prev => [...prev, n])
    // Aggiunge la nuova colonna a tutti gli slot esistenti
    setGriglia(prev => {
      const g: Record<number, SlotRow[]> = {}
      Object.entries(prev).forEach(([giorno, rows]) => {
        g[+giorno] = rows.map(r => ({
          ...r,
          vals: { ...r.vals, [n]: null },
        }))
      })
      return g
    })
    setNuovaCol(''); setAddColOpen(false)
  }

  function rimuoviColonna(col: string) {
    setColonne(prev => prev.filter(c => c !== col))
    setGriglia(prev => {
      const g: Record<number, SlotRow[]> = {}
      Object.entries(prev).forEach(([giorno, rows]) => {
        g[+giorno] = rows.map(r => {
          const v = { ...r.vals }; delete v[col]
          return { ...r, vals: v }
        })
      })
      return g
    })
  }

  // ── Drop su cella ─────────────────────────────────────────────
  function handleDrop(giorno: number, slotIdx: number, col: string) {
    const num = draggingNum.current
    if (!num) return
    setGriglia(prev => {
      const rows = [...(prev[giorno] ?? [])]
      rows[slotIdx] = {
        ...rows[slotIdx],
        vals: { ...rows[slotIdx].vals, [col]: num },
      }
      return { ...prev, [giorno]: rows }
    })
  }

  function clearCella(giorno: number, slotIdx: number, col: string) {
    setGriglia(prev => {
      const rows = [...(prev[giorno] ?? [])]
      rows[slotIdx] = {
        ...rows[slotIdx],
        vals: { ...rows[slotIdx].vals, [col]: null },
      }
      return { ...prev, [giorno]: rows }
    })
  }

  function toggleRep(giorno: number, slotIdx: number) {
    setGriglia(prev => {
      const rows = [...(prev[giorno] ?? [])]
      rows[slotIdx] = { ...rows[slotIdx], REP: !rows[slotIdx].REP }
      return { ...prev, [giorno]: rows }
    })
  }

  // ── Azzera schema ─────────────────────────────────────────────
  function azzera() {
    if (!confirm('Azzerare tutte le celle dello schema corrente?')) return
    setGriglia(prev => {
      const g: Record<number, SlotRow[]> = {}
      Object.entries(prev).forEach(([giorno, rows]) => {
        g[+giorno] = rows.map(r => ({
          ...r,
          vals: Object.fromEntries(Object.keys(r.vals).map(c => [c, null])),
          REP: false,
        }))
      })
      return g
    })
  }

  // ── Salva schema su DB ────────────────────────────────────────
  async function salva() {
    setSaving(true); setMessaggio('')
    try {
      // 1. Cancella tutti gli slot esistenti per questo schema
      const { error: delErr } = await supabase
        .from('schemi_modello')
        .delete()
        .eq('schema_num', schemaNum)
      if (delErr) throw delErr

      // 2. Inserisce tutti gli slot correnti
      const rows: Omit<SchemaModello, 'id'>[] = []
      for (const [giornoStr, slots] of Object.entries(griglia)) {
        const giorno = +giornoStr
        slots.forEach((r, idx) => {
          rows.push({
            schema_num:               schemaNum,
            giorno_settimana:         giorno,
            slot:                     idx,
            numero_medico_mattina:    r.vals['M']  ?? null,
            numero_medico_pomeriggio: r.vals['P']  ?? null,
            numero_medico_rm:         r.vals['RM'] ?? null,
            numero_medico_rp:         r.vals['RP'] ?? null,
            is_reperibilita:          r.REP,
          })
        })
      }

      if (rows.length > 0) {
        const { error: insErr } = await supabase.from('schemi_modello').insert(rows)
        if (insErr) throw insErr
      }

      setMessaggio(`✓ Schema ${schemaNum} salvato (${rows.length} slot)`)
      qc.invalidateQueries({ queryKey: ['schemi_modello'] })
    } catch (e: unknown) {
      setMessaggio('Errore: ' + (e as Error).message)
    } finally {
      setSaving(false)
      setTimeout(() => setMessaggio(''), 4000)
    }
  }

  // ─────────────────────────────────────────────────────────────
  return (
    <div className="flex gap-4 h-[calc(100vh-112px)] overflow-hidden">

      {/* ════ SEZIONE GRIGLIA (sinistra) ═══════════════════════ */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* ── Config bar ── */}
        <div className="flex flex-wrap items-center gap-3 pb-3 mb-3 border-b border-gray-200 shrink-0">
          {/* Schema selector */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-500 font-medium">Schema</span>
            {[1,2,3].map(n => (
              <button
                key={n}
                onClick={() => { setSchemaNum(n); setGriglia({}) }}
                className={`w-7 h-7 rounded text-xs font-bold border transition-colors
                  ${schemaNum === n
                    ? 'bg-blue-700 text-white border-blue-700'
                    : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}
              >
                {n}
              </button>
            ))}
          </div>

          {/* Tipo schema */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-500 font-medium">Tipo</span>
            {(['weekly','custom'] as const).map(t => (
              <button
                key={t}
                onClick={() => {
                  setTipoSchema(t)
                  if (t === 'weekly') {
                    setGiorni([1,2,3,4,5,6,7])
                    setGriglia(g => {
                      const n: typeof g = {}
                      for (let d = 1; d <= 7; d++) n[d] = g[d] ?? [emptySlot(0, colonne)]
                      return n
                    })
                  }
                }}
                className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors
                  ${tipoSchema === t
                    ? 'bg-blue-700 text-white border-blue-700'
                    : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}
              >
                {t === 'weekly' ? '7 giorni fissi' : 'Personalizzato'}
              </button>
            ))}
          </div>

          {/* Colonne */}
          <div className="flex items-center gap-1 flex-wrap">
            <span className="text-xs text-gray-500 font-medium">Colonne turno:</span>
            {colonne.map(col => (
              <span key={col}
                className="inline-flex items-center gap-0.5 bg-gray-100 text-gray-700
                           text-xs px-2 py-0.5 rounded-full border border-gray-200">
                {col}
                <button onClick={() => rimuoviColonna(col)} className="text-gray-400 hover:text-red-500 ml-0.5">
                  <X size={10} />
                </button>
              </span>
            ))}
            {addColOpen ? (
              <div className="flex items-center gap-1">
                <input
                  value={nuovaCol}
                  onChange={e => setNuovaCol(e.target.value.toUpperCase())}
                  onKeyDown={e => e.key === 'Enter' && aggiungiColonna(nuovaCol)}
                  placeholder="es. RM"
                  autoFocus
                  className="border border-blue-400 rounded px-1.5 py-0.5 text-xs w-20 focus:outline-none"
                />
                <div className="flex gap-1">
                  {COLONNE_PRESET.filter(c => !colonne.includes(c)).map(c => (
                    <button key={c} onClick={() => aggiungiColonna(c)}
                      className="bg-blue-100 text-blue-700 text-xs px-1.5 py-0.5 rounded hover:bg-blue-200">
                      {c}
                    </button>
                  ))}
                </div>
                <button onClick={() => aggiungiColonna(nuovaCol)}
                  className="text-blue-600 hover:text-blue-800"><Plus size={13} /></button>
                <button onClick={() => setAddColOpen(false)}
                  className="text-gray-400 hover:text-gray-600"><X size={13} /></button>
              </div>
            ) : (
              <button onClick={() => setAddColOpen(true)}
                className="text-blue-500 hover:text-blue-700 flex items-center gap-0.5 text-xs">
                <Plus size={12} /> aggiungi
              </button>
            )}
          </div>

          {/* Aggiungi giorno (solo custom) */}
          {tipoSchema === 'custom' && (
            <div className="flex items-center gap-1">
              <span className="text-xs text-gray-500">+Giorno:</span>
              {[1,2,3,4,5,6,7].filter(g => !giorni.includes(g)).map(g => (
                <button key={g} onClick={() => aggiungiGiorno(g)}
                  className="text-xs bg-gray-100 hover:bg-blue-100 text-gray-600
                             hover:text-blue-700 px-1.5 py-0.5 rounded border border-gray-200">
                  {GIORNI_IT[g].slice(0,3)}
                </button>
              ))}
            </div>
          )}

          {/* Azioni */}
          <div className="ml-auto flex items-center gap-2">
            <button onClick={azzera} className="btn-secondary py-1 text-xs gap-1">
              <RotateCcw size={13} /> Azzera
            </button>
            <button onClick={salva} disabled={saving} className="btn-primary py-1 text-xs gap-1">
              <Save size={13} /> {saving ? 'Salvo...' : 'Salva schema'}
            </button>
          </div>
        </div>

        {/* Feedback */}
        {messaggio && (
          <div className={`text-xs px-3 py-1.5 rounded-lg mb-2 shrink-0 ${
            messaggio.startsWith('✓')
              ? 'bg-green-50 text-green-700 border border-green-200'
              : 'bg-red-50 text-red-700 border border-red-200'
          }`}>{messaggio}</div>
        )}

        {/* ── Griglia ── */}
        <div className="overflow-auto flex-1">
          <table className="border-collapse" style={{ minWidth: 320 }}>
            {/* Header colonne */}
            <thead>
              <tr>
                <th className="bg-gray-800 text-white text-xs px-3 py-2 text-left border border-gray-600 w-28">
                  Giorno
                </th>
                {colonne.map(col => (
                  <th key={col}
                    className="bg-gray-800 text-white text-xs px-2 py-2 text-center
                               border border-gray-600"
                    style={{ width: 72 }}>
                    {col}
                  </th>
                ))}
                <th className="bg-gray-800 text-white text-xs px-2 py-2 text-center
                               border border-gray-600 w-10">
                  REP
                </th>
                <th className="bg-gray-800 border border-gray-600 w-7" />
              </tr>
            </thead>

            <tbody>
              {giorni.map(giorno => {
                const slots = griglia[giorno] ?? []
                const bgGiorno = 'bg-blue-700'

                return slots.length === 0 ? (
                  <tr key={`g${giorno}-empty`}>
                    <td className={`${bgGiorno} text-white text-xs font-bold px-2 py-2 border border-blue-600`}>
                      <div>{GIORNI_IT[giorno]}</div>
                      {tipoSchema === 'custom' && (
                        <button onClick={() => rimuoviGiorno(giorno)}
                          className="text-blue-200 hover:text-white text-[10px] mt-0.5">
                          ✕ rimuovi
                        </button>
                      )}
                    </td>
                    <td colSpan={colonne.length + 2}
                      className="border border-gray-200 text-center text-gray-300 text-xs py-2">
                      <button onClick={() => aggiungiSlot(giorno)}
                        className="text-blue-400 hover:text-blue-600 flex items-center gap-1 mx-auto text-xs">
                        <Plus size={12} /> Aggiungi slot
                      </button>
                    </td>
                  </tr>
                ) : (
                  slots.map((row, slotIdx) => {
                    const isRep = row.REP
                    const rowBg = isRep ? '#fff1f2' : slotIdx % 2 === 0 ? '#ffffff' : '#f9fafb'

                    return (
                      <tr key={`${giorno}-${slotIdx}`} style={{ background: rowBg }}>
                        {/* Cella giorno con rowspan */}
                        {slotIdx === 0 && (
                          <td
                            rowSpan={slots.length}
                            className={`${bgGiorno} text-white text-xs font-bold px-2 py-2
                                       border border-blue-600 text-center align-middle`}
                            style={{ verticalAlign: 'middle' }}
                          >
                            <div>{GIORNI_IT[giorno]}</div>
                            <button
                              onClick={() => aggiungiSlot(giorno)}
                              className="mt-2 flex items-center gap-0.5 text-blue-200
                                         hover:text-white text-[10px] mx-auto"
                            >
                              <Plus size={10} /> slot
                            </button>
                            {tipoSchema === 'custom' && (
                              <button onClick={() => rimuoviGiorno(giorno)}
                                className="mt-1 text-blue-300 hover:text-white text-[10px]">
                                ✕
                              </button>
                            )}
                          </td>
                        )}

                        {/* Celle per ogni colonna */}
                        {colonne.map(col => (
                          <Cella
                            key={col}
                            valore={row.vals[col] ?? null}
                            colore={row.vals[col] ? (colorMap[row.vals[col]!] ?? null) : null}
                            testo={row.vals[col] ? (nomeMap[row.vals[col]!] ?? String(row.vals[col])) : ''}
                            onDrop={() => handleDrop(giorno, slotIdx, col)}
                            onClear={() => clearCella(giorno, slotIdx, col)}
                          />
                        ))}

                        {/* REP checkbox */}
                        <td className={`border border-gray-200 text-center
                          ${isRep ? 'bg-red-50' : ''}`}
                          style={{ width: 40 }}>
                          <input
                            type="checkbox"
                            checked={isRep}
                            onChange={() => toggleRep(giorno, slotIdx)}
                            className="accent-red-500 w-3.5 h-3.5"
                            title="Slot reperibilità"
                          />
                        </td>

                        {/* Elimina slot */}
                        <td className="border border-gray-200 text-center" style={{ width: 28 }}>
                          <button
                            onClick={() => rimuoviSlot(giorno, slotIdx)}
                            className="text-gray-200 hover:text-red-400 p-0.5"
                          >
                            <Trash2 size={11} />
                          </button>
                        </td>
                      </tr>
                    )
                  })
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Istruzioni */}
        <div className="shrink-0 pt-2 text-xs text-gray-400 border-t border-gray-100 mt-2">
          💡 <strong>Trascina</strong> un turnista sulla cella · <strong>Doppio clic</strong> sulla cella per svuotarla ·
          Stesso numero in M e P = turno lungo (L)
        </div>
      </div>

      {/* ════ PANNELLO TURNISTI (destra) ════════════════════════ */}
      <div className="w-56 shrink-0 flex flex-col overflow-hidden">
        <div className="card flex-1 overflow-y-auto">
          <div className="px-3 pt-3 pb-2 border-b border-gray-100">
            <h3 className="text-xs font-bold text-gray-600 uppercase tracking-wider">
              Turnisti
            </h3>
            <p className="text-[10px] text-gray-400 mt-0.5">
              Trascina il quadratino colorato nelle celle
            </p>
          </div>

          <div className="p-1">
            {medici.map(med => (
              <ChipTurnista
                key={med.id}
                medico={med}
                color={colorMap[med.numero_ordine] ?? PASTEL[0]}
                onDragStart={() => { draggingNum.current = med.numero_ordine }}
              />
            ))}
          </div>

          {/* Legenda */}
          <div className="px-3 py-2 border-t border-gray-100 text-[10px] text-gray-400 space-y-0.5">
            <p>• Numero = posizione nella rotazione</p>
            <p>• REP = reperibilità (flag sulla riga)</p>
            <p>• Dopo salvataggio → rigenera il calendario</p>
          </div>
        </div>
      </div>

    </div>
  )
}
