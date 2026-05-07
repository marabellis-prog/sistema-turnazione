import { useState, useMemo, useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Save, RotateCcw, Plus, X, Trash2 } from 'lucide-react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useConfirm } from '../../hooks/useConfirm'
import { ConfirmModal } from '../../components/ConfirmModal'
import { usePendingActions } from '../../contexts/PendingActionsContext'
import type { SchemaModello, Medico } from '../../types'

// ── Colori pastello (uno per turnista) ───────────────────────────
const PASTEL: { bg: string; fg: string }[] = [
  { bg: '#fecdd3', fg: '#9f1239' },
  { bg: '#fed7aa', fg: '#9a3412' },
  { bg: '#fef9c3', fg: '#713f12' },
  { bg: '#bbf7d0', fg: '#14532d' },
  { bg: '#a5f3fc', fg: '#164e63' },
  { bg: '#bfdbfe', fg: '#2b3c24' },
  { bg: '#ddd6fe', fg: '#4c1d95' },
  { bg: '#f5d0fe', fg: '#701a75' },
  { bg: '#fbcfe8', fg: '#831843' },
  { bg: '#d1fae5', fg: '#064e3b' },
  { bg: '#ccfbf1', fg: '#134e4a' },
  { bg: '#e0e7ff', fg: '#3730a3' },
]

const GIORNI_IT  = ['','Lunedì','Martedì','Mercoledì','Giovedì','Venerdì','Sabato','Domenica']
const COLONNE_PRESET = ['M', 'P', 'RM', 'RP']
const REP_BG = '#fee2e2'

interface SlotRow {
  id:   string | null
  slot: number
  vals: Record<string, number | null>
  REP:  boolean
}

function emptySlot(slot: number, colonne: string[]): SlotRow {
  const vals: Record<string, number | null> = {}
  colonne.forEach(c => { vals[c] = null })
  return { id: null, slot, vals, REP: false }
}

function isSlotVuoto(r: SlotRow) {
  return Object.values(r.vals).every(v => v === null) && !r.REP
}

// ── Cella (drag source + drop target) ───────────────────────────
// - Se ha valore: draggable (per spostare/scambiare)
// - Drop su vuota: sposta qui, svuota sorgente
// - Drop su occupata: scambia i due valori
function Cella({
  valore, bg, fg, onDrop, onClear, isRep, onDragStart,
}: {
  valore:      number | null
  bg:          string
  fg:          string
  isRep:       boolean
  onDrop:      () => void
  onClear:     () => void
  onDragStart: () => void
}) {
  const [over, setOver] = useState(false)

  return (
    <td
      draggable={!!valore}
      onDragStart={e => {
        if (!valore) { e.preventDefault(); return }
        e.dataTransfer.effectAllowed = 'move'
        onDragStart()
      }}
      style={{
        width: 46, minWidth: 46, height: 30,
        background: isRep ? REP_BG : (valore ? bg : over ? '#e8f0e0' : '#fff'),
        outline: over ? '2px solid #9ab488' : undefined,
        outlineOffset: over ? '-2px' : undefined,
        cursor: valore ? 'grab' : 'default',
        textAlign: 'center',
        verticalAlign: 'middle',
        borderRight: '1px solid #e5e7eb',
        borderBottom: '1px solid #e5e7eb',
        transition: 'background 0.1s',
        userSelect: 'none',
      }}
      onDragOver={e => { e.preventDefault(); setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={e => { e.preventDefault(); setOver(false); onDrop() }}
      onDoubleClick={onClear}
      title={valore
        ? `${valore} — trascina per spostare/scambiare · doppio clic per svuotare`
        : 'Trascina un turnista qui'}
    >
      {valore
        ? <span style={{ color: fg, fontWeight: 700, fontSize: 13 }}>{valore}</span>
        : <span style={{ color: '#8a8070', fontSize: 11 }}>—</span>
      }
    </td>
  )
}

// ════════════════════════════════════════════════════════════════
export function GestioneSchemaPage() {
  const qc = useQueryClient()

  const [schemaNum,  setSchemaNum]  = useState(1)
  const [tipoSchema, setTipoSchema] = useState<'weekly' | 'custom'>('weekly')
  const [colonne,    setColonne]    = useState<string[]>(['M', 'P'])
  const [giorni,     setGiorni]     = useState<number[]>([1,2,3,4,5,6,7])
  const [nuovaCol,   setNuovaCol]   = useState('')
  const [addColOpen, setAddColOpen] = useState(false)
  const [griglia,    setGriglia]    = useState<Record<number, SlotRow[]>>({})
  const [saving,     setSaving]     = useState(false)
  const [msg,        setMsg]        = useState('')

  // ── Hook dipendenze esterne (devono essere prima degli useEffect) ──
  const { confirm, confirmState } = useConfirm()
  const { setNeedsRegen, registerNavGuard } = usePendingActions()
  const navigate = useNavigate()

  // ── Modifiche non salvate ─────────────────────────────────────
  const [hasUnsaved, setHasUnsaved] = useState(false)
  const [navPending, setNavPending] = useState<string | null>(null)

  // Blocca chiusura/refresh tab (dialog nativo del browser)
  useEffect(() => {
    if (!hasUnsaved) return
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [hasUnsaved])

  // Registra/de-registra il guard nel context globale
  useEffect(() => {
    if (hasUnsaved) {
      registerNavGuard((to: string) => {
        setNavPending(to)
        return false  // blocca — il modal gestirà la navigazione
      })
    } else {
      registerNavGuard(null)
    }
    return () => registerNavGuard(null)   // cleanup al dismount
  }, [hasUnsaved, registerNavGuard])

  // Helper: marca modifiche presenti
  const markUnsaved = () => setHasUnsaved(true)

  // ── Sorgente del drag ─────────────────────────────────────────
  const dragSource = useRef<{
    num:           number
    fromGiorno?:   number
    fromSlotIdx?:  number
    fromCol?:      string
  } | null>(null)

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

  const colorMap = useMemo(() => {
    const m: Record<number, { bg: string; fg: string }> = {}
    medici.forEach((med, i) => { m[med.numero_ordine] = PASTEL[i % PASTEL.length] })
    return m
  }, [medici])

  // ── Contatore dinamico: quante celle ha ogni turnista ────────────
  const contatori = useMemo(() => {
    const counts: Record<number, number> = {}
    medici.forEach(m => { counts[m.numero_ordine] = 0 })
    for (const slots of Object.values(griglia)) {
      for (const row of slots) {
        for (const val of Object.values(row.vals)) {
          if (val !== null) counts[val] = (counts[val] ?? 0) + 1
        }
      }
    }
    return counts
  }, [griglia, medici])

  // ── Carica dal DB ─────────────────────────────────────────────
  useEffect(() => {
    const data = schemi.filter(s => s.schema_num === schemaNum)
    if (data.length === 0) {
      const days = tipoSchema === 'weekly' ? [1,2,3,4,5,6,7] : []
      const g: Record<number, SlotRow[]> = {}
      days.forEach(d => { g[d] = [emptySlot(0, colonne)] })
      setGriglia(g)
      if (tipoSchema === 'weekly') setGiorni([1,2,3,4,5,6,7])
      return
    }
    const colUsate = new Set<string>()
    data.forEach(r => {
      if (r.numero_medico_mattina    !== null) colUsate.add('M')
      if (r.numero_medico_pomeriggio !== null) colUsate.add('P')
      if (r.numero_medico_rm         !== null) colUsate.add('RM')
      if (r.numero_medico_rp         !== null) colUsate.add('RP')
    })
    const colList = ['M','P','RM','RP'].filter(c => colUsate.has(c))
    if (colList.length > 0) setColonne(colList)

    const g: Record<number, SlotRow[]> = {}
    const giorniUsati = new Set<number>()
    data.forEach(r => {
      giorniUsati.add(r.giorno_settimana)
      if (!g[r.giorno_settimana]) g[r.giorno_settimana] = []
      g[r.giorno_settimana].push({
        id: r.id, slot: r.slot,
        vals: { M: r.numero_medico_mattina, P: r.numero_medico_pomeriggio,
                RM: r.numero_medico_rm,     RP: r.numero_medico_rp },
        REP: r.is_reperibilita,
      })
    })
    Object.values(g).forEach(rows => rows.sort((a,b) => a.slot - b.slot))
    setGriglia(g)
    const sorted = [...giorniUsati].sort((a,b) => a - b)
    setGiorni(sorted)
    if (sorted.length < 7) setTipoSchema('custom')
    setHasUnsaved(false)  // ← caricamento da DB: nessuna modifica pendente
  }, [schemi, schemaNum])

  // ── Azioni ───────────────────────────────────────────────────
  function aggiungiGiorno(g: number) {
    if (giorni.includes(g)) return
    markUnsaved()
    const nuovi = [...giorni, g].sort((a,b) => a - b)
    setGiorni(nuovi)
    setGriglia(prev => ({ ...prev, [g]: [emptySlot(0, colonne)] }))
  }
  function rimuoviGiorno(g: number) {
    markUnsaved()
    setGiorni(prev => prev.filter(d => d !== g))
    setGriglia(prev => { const n = { ...prev }; delete n[g]; return n })
  }

  function aggiungiSlot(giorno: number) {
    markUnsaved()
    setGriglia(prev => {
      const rows = prev[giorno] ?? []
      const next = rows.length > 0 ? Math.max(...rows.map(r => r.slot)) + 1 : 0
      return { ...prev, [giorno]: [...rows, emptySlot(next, colonne)] }
    })
  }

  async function rimuoviSlot(giorno: number, idx: number) {
    const row = (griglia[giorno] ?? [])[idx]
    if (!row) return
    if (!isSlotVuoto(row)) {
      const ok = await confirm({
        title:        'Elimina slot',
        message:      'Lo slot contiene dati. Vuoi eliminarlo comunque?',
        confirmLabel: 'Elimina',
        danger:       true,
      })
      if (!ok) return
    }
    markUnsaved()
    setGriglia(prev => {
      const rows = [...(prev[giorno] ?? [])]
      rows.splice(idx, 1)
      return { ...prev, [giorno]: rows }
    })
  }

  function aggiungiColonna(nome: string) {
    const n = nome.trim().toUpperCase()
    if (!n || colonne.includes(n)) return
    markUnsaved()
    setColonne(prev => [...prev, n])
    setGriglia(prev => {
      const g: Record<number, SlotRow[]> = {}
      Object.entries(prev).forEach(([d, rows]) => {
        g[+d] = rows.map(r => ({ ...r, vals: { ...r.vals, [n]: null } }))
      })
      return g
    })
    setNuovaCol(''); setAddColOpen(false)
  }

  async function rimuoviColonna(col: string) {
    const ok = await confirm({
      title:        `Elimina colonna "${col}"`,
      message:      'I dati di questa colonna andranno persi. Continuare?',
      confirmLabel: 'Elimina',
      danger:       true,
    })
    if (!ok) return
    markUnsaved()
    setColonne(prev => prev.filter(c => c !== col))
    setGriglia(prev => {
      const g: Record<number, SlotRow[]> = {}
      Object.entries(prev).forEach(([d, rows]) => {
        g[+d] = rows.map(r => { const v = { ...r.vals }; delete v[col]; return { ...r, vals: v } })
      })
      return g
    })
  }

  function handleDrop(toGiorno: number, toIdx: number, toCol: string) {
    const src = dragSource.current
    if (!src) return
    markUnsaved()
    setGriglia(prev => {
      // Helper: copia profonda di una riga
      const cloneRow = (r: SlotRow) => ({ ...r, vals: { ...r.vals } })

      // Copia le righe dei giorni coinvolti
      const next = { ...prev }
      next[toGiorno] = [...(prev[toGiorno] ?? [])].map(cloneRow)

      const targetOldVal = next[toGiorno][toIdx]?.vals[toCol] ?? null

      // Stessa cella: nessuna modifica
      if (
        src.fromGiorno === toGiorno &&
        src.fromSlotIdx === toIdx &&
        src.fromCol === toCol
      ) return prev

      // Scrive il valore sorgente nella cella di destinazione
      next[toGiorno][toIdx].vals[toCol] = src.num

      // Se la sorgente è una cella (non la strip dei turnisti)
      if (src.fromGiorno !== undefined && src.fromSlotIdx !== undefined && src.fromCol !== undefined) {
        const fG = src.fromGiorno, fI = src.fromSlotIdx, fC = src.fromCol

        // Se il giorno sorgente è diverso, copia anche quelle righe
        if (fG !== toGiorno) next[fG] = [...(prev[fG] ?? [])].map(cloneRow)

        if (targetOldVal !== null) {
          // Cella occupata → SCAMBIA
          next[fG][fI].vals[fC] = targetOldVal
        } else {
          // Cella vuota → SPOSTA (svuota sorgente)
          next[fG][fI].vals[fC] = null
        }
      }

      return next
    })
  }

  function clearCella(giorno: number, idx: number, col: string) {
    markUnsaved()
    setGriglia(prev => {
      const rows = [...(prev[giorno] ?? [])]
      rows[idx] = { ...rows[idx], vals: { ...rows[idx].vals, [col]: null } }
      return { ...prev, [giorno]: rows }
    })
  }

  function toggleRep(giorno: number, idx: number) {
    markUnsaved()
    setGriglia(prev => {
      const rows = [...(prev[giorno] ?? [])]
      rows[idx] = { ...rows[idx], REP: !rows[idx].REP }
      return { ...prev, [giorno]: rows }
    })
  }

  async function azzera() {
    const ok = await confirm({
      title:        'Azzera schema',
      message:      'Tutte le celle verranno svuotate. Questa operazione non può essere annullata.',
      confirmLabel: 'Azzera',
      danger:       true,
    })
    if (!ok) return
    markUnsaved()
    setGriglia(prev => {
      const g: Record<number, SlotRow[]> = {}
      Object.entries(prev).forEach(([d, rows]) => {
        g[+d] = rows.map(r => ({
          ...r, REP: false,
          vals: Object.fromEntries(Object.keys(r.vals).map(c => [c, null])),
        }))
      })
      return g
    })
  }

  async function salva() {
    setSaving(true); setMsg('')
    try {
      const { error: delErr } = await supabase.from('schemi_modello')
        .delete().eq('schema_num', schemaNum)
      if (delErr) throw delErr
      const rows: Omit<SchemaModello, 'id'>[] = []
      for (const [dStr, slots] of Object.entries(griglia)) {
        slots.forEach((r, idx) => {
          rows.push({
            schema_num: schemaNum, giorno_settimana: +dStr, slot: idx,
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
      setMsg(`✓ Schema ${schemaNum} salvato (${rows.length} slot)`)
      setHasUnsaved(false)  // ← salvato: nessuna modifica pendente
      // 🔴 Schema modificato → rotazione cambiata → rigenera
      setNeedsRegen(`Schema ${schemaNum} modificato (${rows.length} slot)`)
      qc.invalidateQueries({ queryKey: ['schemi_modello'] })
    } catch (e: unknown) {
      setMsg('Errore: ' + (e as Error).message)
    } finally {
      setSaving(false)
      setTimeout(() => setMsg(''), 4000)
    }
  }

  // ─────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-[calc(100vh-112px)] overflow-hidden gap-2">

      {/* Modal di conferma globale */}
      <ConfirmModal {...confirmState.opts} open={confirmState.open}
        onConfirm={confirmState.onConfirm} onCancel={confirmState.onCancel} />

      {/* Modal blocco navigazione — modifiche non salvate */}
      <ConfirmModal
        open={navPending !== null}
        title="Modifiche non salvate"
        message="Hai modifiche allo schema non ancora salvate. Se esci ora andranno perse."
        confirmLabel="Rimani e salvo"
        cancelLabel="Esci senza salvare"
        danger={false}
        onConfirm={() => setNavPending(null)}
        onCancel={() => {
          const dest = navPending!
          setHasUnsaved(false)   // resetta: non riapparirà fino a nuove modifiche
          setNavPending(null)
          navigate(dest)
        }}
      />

      {/* ═══ CONFIG BAR ════════════════════════════════════════ */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 shrink-0
                      bg-white border border-stone-200 rounded-lg px-3 py-2">
        {/* Schema */}
        <div className="flex items-center gap-1">
          <span className="text-xs font-medium" style={{ color: '#5a5a4a' }}>Schema:</span>
          {[1,2,3].map(n => (
            <button key={n} onClick={() => { setSchemaNum(n); setGriglia({}) }}
              className="w-6 h-6 rounded text-xs font-bold border transition-colors"
              style={schemaNum === n
                ? { background: '#476540', color: '#fff', borderColor: '#374f30' }
                : { background: '#faf8f3', color: '#3a3d30', borderColor: '#c0b8a8' }}>
              {n}
            </button>
          ))}
        </div>

        {/* Tipo */}
        <div className="flex items-center gap-1">
          <span className="text-xs font-medium" style={{ color: '#5a5a4a' }}>Tipo:</span>
          {(['weekly','custom'] as const).map(t => (
            <button key={t} onClick={() => {
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
              className="px-2 py-0.5 rounded text-xs font-medium border transition-colors"
              style={tipoSchema === t
                ? { background: '#476540', color: '#fff', borderColor: '#374f30' }
                : { background: '#faf8f3', color: '#3a3d30', borderColor: '#c0b8a8' }}>
              {t === 'weekly' ? '7 giorni' : 'Personalizzato'}
            </button>
          ))}
        </div>

        {/* Colonne */}
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-xs text-stone-600 font-medium">Colonne:</span>
          {colonne.map(col => (
            <span key={col} className="inline-flex items-center gap-0.5 bg-stone-100 text-stone-700
                           text-xs px-1.5 py-0.5 rounded-full border border-stone-200">
              {col}
              <button onClick={() => rimuoviColonna(col)} className="text-stone-500 hover:text-red-500 ml-0.5 leading-none">
                <X size={9} />
              </button>
            </span>
          ))}
          {addColOpen ? (
            <div className="flex items-center gap-1">
              <input value={nuovaCol} onChange={e => setNuovaCol(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === 'Enter' && aggiungiColonna(nuovaCol)}
                placeholder="es. RM" autoFocus
                className="border border-olive-400 rounded px-1 py-0.5 text-xs w-16 focus:outline-none" />
              {COLONNE_PRESET.filter(c => !colonne.includes(c)).map(c => (
                <button key={c} onClick={() => aggiungiColonna(c)}
                  className="bg-olive-100 text-olive-700 text-xs px-1 py-0.5 rounded hover:bg-olive-200">{c}</button>
              ))}
              <button onClick={() => setAddColOpen(false)} className="text-stone-500 hover:text-gray-600"><X size={12} /></button>
            </div>
          ) : (
            <button onClick={() => setAddColOpen(true)}
              className="text-olive-600 hover:text-olive-800 flex items-center gap-0.5 text-xs">
              <Plus size={11} /> aggiungi
            </button>
          )}
        </div>

        {/* Aggiungi giorno (solo custom) */}
        {tipoSchema === 'custom' && (
          <div className="flex items-center gap-1">
            <span className="text-xs text-stone-600">+Giorno:</span>
            {[1,2,3,4,5,6,7].filter(g => !giorni.includes(g)).map(g => (
              <button key={g} onClick={() => aggiungiGiorno(g)}
                className="text-xs bg-stone-100 hover:bg-olive-100 text-stone-600
                           hover:text-olive-700 px-1.5 py-0.5 rounded border border-stone-200">
                {GIORNI_IT[g].slice(0,3)}
              </button>
            ))}
          </div>
        )}

        {/* Bottoni azione */}
        <div className="ml-auto flex items-center gap-1.5">
          {msg && (
            <span className={`text-xs px-2 py-0.5 rounded ${
              msg.startsWith('✓') ? 'text-green-700 bg-green-50' : 'text-red-700 bg-red-50'
            }`}>{msg}</span>
          )}
          {/* Badge modifiche non salvate */}
          {hasUnsaved && !saving && (
            <span className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-0.5 rounded-full"
              style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #fbbf24' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#f59e0b', display: 'inline-block', flexShrink: 0 }} />
              Modifiche non salvate
            </span>
          )}
          <button onClick={azzera} className="btn-secondary py-1 px-2 text-xs gap-1">
            <RotateCcw size={12} /> Azzera
          </button>
          <button onClick={salva} disabled={saving} className="btn-primary py-1 px-2 text-xs gap-1">
            <Save size={12} /> {saving ? 'Salvo...' : 'Salva schema'}
          </button>
        </div>
      </div>

      {/* ═══ STRIP TURNISTI (vicino alla tabella) ══════════════ */}
      <div className="flex flex-wrap items-center gap-1.5 shrink-0
                      bg-stone-50 border border-stone-200 rounded-lg px-3 py-1.5">
        <span className="text-[10px] font-bold text-stone-500 uppercase tracking-wider mr-1">
          Turnisti →
        </span>
        {medici.map((med, i) => {
          const color = PASTEL[i % PASTEL.length]
          return (
            <div
              key={med.id}
              draggable
              onDragStart={e => {
                e.dataTransfer.setData('doctorNum', String(med.numero_ordine))
                // Dalla strip: solo numero, nessuna posizione sorgente
                dragSource.current = { num: med.numero_ordine }
              }}
              className="flex items-center gap-1 rounded-md px-2 py-0.5
                         cursor-grab active:cursor-grabbing select-none
                         shadow-sm border border-white/60 hover:scale-105 transition-transform"
              style={{ background: color.bg, color: color.fg }}
              title={`Trascina ${med.nome} (${med.numero_ordine}) in una cella`}
            >
              <span className="text-[10px] font-medium">{med.nome.slice(0, 9)}</span>
              <span className="font-black text-xs ml-0.5">[{med.numero_ordine}]</span>
            </div>
          )
        })}
        <span className="ml-auto text-[10px] text-stone-500 italic">
          doppio clic su cella per svuotare
        </span>
      </div>

      {/* ═══ GRIGLIA + CONTATORE (affiancati) ═══════════════════ */}
      <div className="flex gap-2 flex-1 overflow-hidden">
      <div className="flex-1 overflow-auto">
        <table style={{ borderCollapse: 'collapse', fontSize: 12 }}>
          {/* Header colonne */}
          <thead>
            <tr>
              <th style={{
                background: '#2b3c24', color: '#fff', fontSize: 11, fontWeight: 700,
                padding: '4px 8px', textAlign: 'left', width: 86,
                border: '1px solid #1e40af', position: 'sticky', top: 0, zIndex: 10,
              }}>
                Giorno
              </th>
              {colonne.map(col => (
                <th key={col} style={{
                  background: '#2b3c24', color: '#fff', fontSize: 11, fontWeight: 700,
                  padding: '4px 2px', textAlign: 'center', width: 46,
                  border: '1px solid #1e40af', position: 'sticky', top: 0, zIndex: 10,
                }}>
                  {col}
                </th>
              ))}
              <th style={{
                background: '#2b3c24', color: '#fca5a5', fontSize: 10, fontWeight: 700,
                padding: '4px 2px', textAlign: 'center', width: 34,
                border: '1px solid #1e40af', position: 'sticky', top: 0, zIndex: 10,
              }}>
                REP
              </th>
              <th style={{
                background: '#2b3c24', width: 22,
                border: '1px solid #1e40af', position: 'sticky', top: 0, zIndex: 10,
              }} />
            </tr>
          </thead>

          <tbody>
            {giorni.map(giorno => {
              const slots = griglia[giorno] ?? []
              if (slots.length === 0) return (
                <tr key={`g${giorno}-e`}>
                  <td style={{
                    background: '#374f30', color: '#fff', fontWeight: 700, fontSize: 11,
                    padding: '3px 6px', border: '1px solid #1e40af', textAlign: 'center',
                  }}>
                    {GIORNI_IT[giorno].slice(0,3).toUpperCase()}
                  </td>
                  <td colSpan={colonne.length + 2} style={{
                    border: '1px solid #e5e7eb', padding: '3px 8px', color: '#9ca3af',
                  }}>
                    <button onClick={() => aggiungiSlot(giorno)}
                      className="flex items-center gap-1 text-olive-400 hover:text-olive-600 text-xs">
                      <Plus size={11} /> Aggiungi slot
                    </button>
                  </td>
                </tr>
              )

              return slots.map((row, idx) => {
                const isRep = row.REP
                // Alterna bianco / grigio chiaro (ma REP prevale sempre)
                const rowBg = isRep ? REP_BG : (idx % 2 === 0 ? '#fff' : '#f9fafb')

                return (
                  <tr key={`${giorno}-${idx}`} style={{ background: rowBg }}>
                    {/* Cella giorno (rowspan) */}
                    {idx === 0 && (
                      <td rowSpan={slots.length} style={{
                        background: '#374f30', color: '#fff', fontWeight: 700, fontSize: 11,
                        padding: '3px 5px', border: '1px solid #1e40af',
                        textAlign: 'center', verticalAlign: 'middle',
                      }}>
                        <div>{GIORNI_IT[giorno].slice(0,3).toUpperCase()}</div>
                        <button onClick={() => aggiungiSlot(giorno)}
                          style={{ fontSize: 9, color: '#93c5fd', marginTop: 3,
                                   display: 'flex', alignItems: 'center', gap: 2, margin: '3px auto 0' }}>
                          <Plus size={9} /> slot
                        </button>
                        {tipoSchema === 'custom' && (
                          <button onClick={() => rimuoviGiorno(giorno)}
                            style={{ fontSize: 9, color: '#93c5fd', marginTop: 2 }}>
                            ✕
                          </button>
                        )}
                      </td>
                    )}

                    {/* Celle turno */}
                    {colonne.map(col => (
                      <Cella
                        key={col}
                        valore={row.vals[col] ?? null}
                        bg={row.vals[col] ? (colorMap[row.vals[col]!]?.bg ?? '#f3f4f6') : '#fff'}
                        fg={row.vals[col] ? (colorMap[row.vals[col]!]?.fg ?? '#374151') : '#374151'}
                        isRep={isRep}
                        onDrop={() => handleDrop(giorno, idx, col)}
                        onClear={() => clearCella(giorno, idx, col)}
                        onDragStart={() => {
                          // Dalla cella: numero + posizione sorgente per swap
                          dragSource.current = {
                            num:          row.vals[col]!,
                            fromGiorno:   giorno,
                            fromSlotIdx:  idx,
                            fromCol:      col,
                          }
                        }}
                      />
                    ))}

                    {/* REP checkbox */}
                    <td style={{
                      width: 34, textAlign: 'center', verticalAlign: 'middle',
                      borderRight: '1px solid #e5e7eb', borderBottom: '1px solid #e5e7eb',
                      background: isRep ? REP_BG : rowBg,
                    }}>
                      <input type="checkbox" checked={isRep}
                        onChange={() => toggleRep(giorno, idx)}
                        style={{ accentColor: '#ef4444', width: 12, height: 12, cursor: 'pointer' }}
                        title="Reperibilità" />
                    </td>

                    {/* Elimina slot */}
                    <td style={{
                      width: 22, textAlign: 'center', verticalAlign: 'middle',
                      borderBottom: '1px solid #e5e7eb',
                      background: isRep ? REP_BG : rowBg,
                    }}>
                      <button onClick={() => rimuoviSlot(giorno, idx)}
                        style={{ color: '#8a8070', padding: 2 }}
                        onMouseEnter={e => (e.currentTarget.style.color = '#f87171')}
                        onMouseLeave={e => (e.currentTarget.style.color = '#8a8070')}
                        title="Elimina slot">
                        <Trash2 size={10} />
                      </button>
                    </td>
                  </tr>
                )
              })
            })}
          </tbody>
        </table>
      </div>
      {/* Contatore — subito a destra della tabella */}
      <div className="w-40 shrink-0 flex flex-col overflow-hidden">
      <div className="card flex-1 overflow-y-auto">
        <div className="px-3 pt-3 pb-2 border-b border-stone-200 shrink-0">
          <h3 className="text-xs font-bold uppercase tracking-wider" style={{ color: '#476540' }}>
            Contatore
          </h3>
          <p className="text-[10px] text-stone-500 mt-0.5">Celle assegnate</p>
        </div>
        <div className="divide-y divide-stone-100">
          {medici.map((med, i) => {
            const count = contatori[med.numero_ordine] ?? 0
            const color = PASTEL[i % PASTEL.length]
            return (
              <div key={med.id} className="flex items-center gap-2 px-3 py-1.5">
                {/* Badge colorato */}
                <span className="w-6 h-6 rounded shrink-0 flex items-center justify-center
                                 text-xs font-bold"
                  style={{ background: color.bg, color: color.fg }}>
                  {med.numero_ordine}
                </span>
                {/* Nome */}
                <span className="text-xs text-stone-600 flex-1 truncate leading-tight">
                  {med.nome}
                </span>
                {/* Contatore */}
                <span className="text-sm font-bold shrink-0 min-w-[20px] text-right"
                  style={{ color: count > 0 ? '#374f30' : '#7a7a6a' }}>
                  {count}
                </span>
              </div>
            )
          })}
        </div>
        {/* Totale */}
        <div className="px-3 py-2 border-t border-stone-200 mt-1">
          <div className="flex justify-between text-xs font-semibold" style={{ color: '#476540' }}>
            <span>Totale celle</span>
            <span>{Object.values(contatori).reduce((s, n) => s + n, 0)}</span>
          </div>
        </div>
      </div>
      </div>
      </div>
    </div>
  )
}
