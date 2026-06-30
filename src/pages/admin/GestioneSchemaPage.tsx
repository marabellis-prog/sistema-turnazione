import { useState, useMemo, useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Save, RotateCcw, Plus, X, Trash2, Eye, EyeOff, AlertTriangle, Copy } from 'lucide-react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useReparto } from '../../contexts/RepartoContext'
import { useConfigReparto } from '../../hooks/useConfigReparto'
import { useMediciReparto } from '../../hooks/useMediciReparto'
import { useConfirm } from '../../hooks/useConfirm'
import { ConfirmModal } from '../../components/ConfirmModal'
import { usePendingActions } from '../../contexts/PendingActionsContext'
import type { SchemaModello, Medico, Configurazione } from '../../types'

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
const REP_BG = '#fee2e2'

// ── Costanti layout anteprima calendario ─────────────────────────
const PV_LABEL_W = 56   // px — colonna nome medico
const PV_CELL_W  = 24   // px — cella giorno
// Colori celle anteprima (rispecchiano i badge dell'app)
const PV_CELL_COLORS: Record<string, { bg: string; fg: string }> = {
  M:   { bg: '#dde8d5', fg: '#2e4a28' },
  P:   { bg: '#d5e0e8', fg: '#253a4a' },
  L:   { bg: '#ece5d5', fg: '#4a3a1a' },
  REP: { bg: '#e8d5d5', fg: '#5a2a2a' },
  RM:  { bg: '#ddd8ea', fg: '#3a2858' },
  RP:  { bg: '#ead8e2', fg: '#582840' },
}

interface SlotRow {
  id:   string | null
  slot: number
  vals: Record<string, number | null>
  REP:  boolean
  SUB:  boolean
  MED:  boolean
  SUP:  boolean
}

function emptySlot(slot: number, colonne: string[]): SlotRow {
  const vals: Record<string, number | null> = {}
  colonne.forEach(c => { vals[c] = null })
  return { id: null, slot, vals, REP: false, SUB: false, MED: false, SUP: false }
}

function isSlotVuoto(r: SlotRow) {
  return Object.values(r.vals).every(v => v === null) && !r.REP && !r.SUB && !r.MED && !r.SUP
}

/**
 * Valida un drop secondo la regola "uno slot, un solo numero":
 * tutti i numeri non-null in una riga (M/P/RM/RP) devono essere identici.
 *
 * Casi gestiti:
 *  - drop dalla strip su cella → solo lo slot di destinazione viene controllato
 *  - swap intra-slot (stessa riga) → simulato e controllato
 *  - swap inter-slot → entrambi gli slot (origine e destinazione) controllati,
 *    perché lo scambio porta valori diversi su entrambi i lati
 *  - drop sulla stessa cella di origine → no-op, nessuna validazione
 *
 * Ritorna `{ ok: false, reason }` con un messaggio user-friendly se il drop
 * porterebbe a una riga con numeri diversi; `{ ok: true }` altrimenti.
 */
type DragSrc = {
  num:           number
  fromGiorno?:   number
  fromSlotIdx?:  number
  fromCol?:      string
}

function validateDrop(
  griglia:  Record<number, SlotRow[]>,
  src:      DragSrc,
  toGiorno: number,
  toIdx:    number,
  toCol:    string,
  giorniIt: string[],
): { ok: true } | { ok: false; reason: string } {
  const targetSlot = griglia[toGiorno]?.[toIdx]
  if (!targetSlot) return { ok: true }

  const targetOldVal = targetSlot.vals[toCol] ?? null

  // Stessa cella → no-op
  if (
    src.fromGiorno  === toGiorno &&
    src.fromSlotIdx === toIdx &&
    src.fromCol     === toCol
  ) return { ok: true }

  /** Estrae i numeri distinti non-null da una mappa di celle. */
  const distinctOf = (vals: Record<string, number | null>): number[] => {
    const s = new Set<number>()
    for (const v of Object.values(vals)) if (v !== null) s.add(v)
    return [...s].sort((a, b) => a - b)
  }

  // Caso: swap intra-slot (stessa riga, colonne diverse)
  const sameSlotSwap =
    src.fromGiorno  === toGiorno &&
    src.fromSlotIdx === toIdx &&
    src.fromCol !== undefined && src.fromCol !== toCol

  if (sameSlotSwap) {
    const future = {
      ...targetSlot.vals,
      [toCol]:        src.num,
      [src.fromCol!]: targetOldVal,
    }
    const distinct = distinctOf(future)
    if (distinct.length > 1) {
      return {
        ok: false,
        reason: `Lo slot ${giorniIt[toGiorno]} #${toIdx + 1} avrebbe numeri diversi (${distinct.join(', ')}). Sulla stessa riga deve esserci un solo turnista.`,
      }
    }
    return { ok: true }
  }

  // Caso normale (drop dalla strip o swap inter-slot): controlla la dest.
  const futureTarget = { ...targetSlot.vals, [toCol]: src.num }
  const targetDistinct = distinctOf(futureTarget)
  if (targetDistinct.length > 1) {
    return {
      ok: false,
      reason: `Lo slot ${giorniIt[toGiorno]} #${toIdx + 1} avrebbe numeri diversi (${targetDistinct.join(', ')}). Sulla stessa riga deve esserci un solo turnista.`,
    }
  }

  // Swap inter-slot: il source riceverà il vecchio valore della destinazione,
  // quindi anche lo slot sorgente deve restare coerente.
  if (
    targetOldVal     !== null &&
    src.fromGiorno   !== undefined &&
    src.fromSlotIdx  !== undefined &&
    src.fromCol      !== undefined &&
    !(src.fromGiorno === toGiorno && src.fromSlotIdx === toIdx)
  ) {
    const srcSlot = griglia[src.fromGiorno]?.[src.fromSlotIdx]
    if (srcSlot) {
      const futureSrc = { ...srcSlot.vals, [src.fromCol]: targetOldVal }
      const srcDistinct = distinctOf(futureSrc)
      if (srcDistinct.length > 1) {
        return {
          ok: false,
          reason: `Lo scambio porterebbe numeri diversi nello slot ${giorniIt[src.fromGiorno]} #${src.fromSlotIdx + 1} (${srcDistinct.join(', ')}).`,
        }
      }
    }
  }

  return { ok: true }
}

// ── Cella (drag source + drop target) ───────────────────────────
// - Se ha valore: draggable (per spostare/scambiare)
// - Drop su vuota: sposta qui, svuota sorgente
// - Drop su occupata: scambia i due valori
function Cella({
  valore, bg, fg, onDrop, onClear, isRep, onDragStart, onTouchStart,
  giorno, slotIdx, col, touchIsOver,
}: {
  valore:       number | null
  bg:           string
  fg:           string
  isRep:        boolean
  onDrop:       () => void
  onClear:      () => void
  onDragStart:  () => void
  onTouchStart: () => void
  giorno:       number
  slotIdx:      number
  col:          string
  touchIsOver:  boolean
}) {
  const [over, setOver] = useState(false)
  const highlighted = over || touchIsOver

  return (
    <td
      data-giorno={giorno}
      data-slot-idx={slotIdx}
      data-col={col}
      draggable={!!valore}
      onDragStart={e => {
        if (!valore) { e.preventDefault(); return }
        e.dataTransfer.effectAllowed = 'move'
        onDragStart()
      }}
      onTouchStart={() => { if (valore) onTouchStart() }}
      style={{
        width: 46, minWidth: 46, height: 30,
        background: isRep ? REP_BG : (valore ? bg : highlighted ? '#e8f0e0' : '#fff'),
        outline: highlighted ? '2px solid #9ab488' : undefined,
        outlineOffset: highlighted ? '-2px' : undefined,
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
  const { repartoAttivo } = useReparto()

  const [schemaNum,  setSchemaNum]  = useState(1)
  const [tipoSchema, setTipoSchema] = useState<'weekly' | 'custom'>('weekly')
  // Colonne fisse — il modello DB ha sempre M / P / RM / RP. Niente UI per aggiungere
  // o rimuovere colonne: lo schema lavora sempre con queste 4.
  const colonne: string[] = ['M', 'P', 'RM', 'RP']
  const [giorni,     setGiorni]     = useState<number[]>([1,2,3,4,5,6,7])
  const [griglia,    setGriglia]    = useState<Record<number, SlotRow[]>>({})
  const [saving,     setSaving]     = useState(false)
  const [msg,        setMsg]        = useState('')
  const [showPreview, setShowPreview] = useState(false)
  const [showHelp,   setShowHelp]   = useState(false)

  // ── Hook dipendenze esterne (devono essere prima degli useEffect) ──
  const { confirm, confirmState } = useConfirm()
  const { setNeedsRegen, registerNavGuard } = usePendingActions()
  const navigate = useNavigate()

  // ── Modifiche non salvate ─────────────────────────────────────
  const [hasUnsaved, setHasUnsaved] = useState(false)
  const [navPending, setNavPending] = useState<string | null>(null)

  // ── Toast di warning (validazione drop) ───────────────────────
  // Auto-dismiss dopo 3.5s, dismissable via X. Stato/timer separati
  // dal `msg` (che gestisce i messaggi di salvataggio).
  const [warningMsg, setWarningMsg] = useState<string | null>(null)
  const warningTimer = useRef<number | null>(null)
  const showWarning = (text: string) => {
    setWarningMsg(text)
    if (warningTimer.current) clearTimeout(warningTimer.current)
    warningTimer.current = window.setTimeout(() => setWarningMsg(null), 3500)
  }
  useEffect(() => () => {
    if (warningTimer.current) clearTimeout(warningTimer.current)
  }, [])

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

  // Misura la larghezza del contenitore anteprima per calcolare daysPerRow
  useEffect(() => {
    if (!showPreview) return
    const el = previewContainerRef.current
    if (!el) return
    setPreviewWidth(el.clientWidth)
    const ro = new ResizeObserver(([e]) => setPreviewWidth(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [showPreview])

  // Listener touchmove NON-PASSIVE: impedisce lo scroll durante il drag su Safari/iOS
  useEffect(() => {
    const el = schemaContainerRef.current
    if (!el) return
    const onMove = (e: TouchEvent) => {
      if (!touchActiveSch.current) return
      e.preventDefault()
      const t = e.touches[0]
      const target = document.elementFromPoint(t.clientX, t.clientY)
      const td = (target?.closest('[data-col]') as HTMLElement | null)
      if (td?.dataset.col && td.dataset.giorno !== undefined && td.dataset.slotIdx !== undefined) {
        setTouchOverKey(`${td.dataset.giorno}-${td.dataset.slotIdx}-${td.dataset.col}`)
      } else {
        setTouchOverKey(null)
      }
    }
    el.addEventListener('touchmove', onMove, { passive: false })
    return () => el.removeEventListener('touchmove', onMove)
  }, [])

  // Helper: marca modifiche presenti
  const markUnsaved = () => setHasUnsaved(true)

  // ── Anteprima: larghezza container (ResizeObserver) ──────────
  const [previewWidth, setPreviewWidth] = useState(800)
  const previewContainerRef = useRef<HTMLDivElement>(null)

  // ── Sorgente del drag (mouse) ────────────────────────────────
  const dragSource = useRef<{
    num:           number
    fromGiorno?:   number
    fromSlotIdx?:  number
    fromCol?:      string
  } | null>(null)

  // ── Touch drag (Safari/iOS) ───────────────────────────────────
  const touchActiveSch   = useRef(false)
  const schemaContainerRef = useRef<HTMLDivElement>(null)
  const [touchOverKey, setTouchOverKey] = useState<string | null>(null)

  // ── Queries ──────────────────────────────────────────────────
  const { data: schemi = [] } = useQuery<SchemaModello[]>({
    queryKey: ['schemi_modello', repartoAttivo],
    queryFn: async () => {
      const { data, error } = await supabase.from('schemi_modello').select('*')
        .eq('reparto_id', repartoAttivo)
        .order('giorno_settimana').order('slot')
      if (error) throw error
      return data
    },
  })

  const { data: medici = [] } = useMediciReparto()

  // Schema attualmente attivo (dal config): serve a decidere se segnalare
  // "Rigenera calendario" al salvataggio. Modificare uno schema NON attivo
  // non deve far comparire l'avviso di rigenerazione.
  const { data: config } = useConfigReparto()
  const schemaAttivo = config?.schema_attivo ?? 1

  // Menu "Copia da…" (apre la scelta di un altro schema come base)
  const [copyMenuOpen, setCopyMenuOpen] = useState(false)

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

  // ── Anteprima rotazione: celle[medicoIdx][dayIdx] ────────────
  // Genera N*7 giorni (N = n. medici) come calendario orizzontale.
  // Calcola il turno_clinico di ogni medico per ogni giorno 1…N*7.
  const previewCells = useMemo<(string | null)[][] | null>(() => {
    if (!showPreview) return null
    const nMedici = medici.length
    if (nMedici === 0) return []

    const totalDays = nMedici * 7

    return medici.map((_, mi) =>
      Array.from({ length: totalDays }, (_, di) => {
        const day      = di + 1
        const dayOfWk  = ((day - 1) % 7) + 1   // 1=Lun … 7=Dom
        const week     = Math.floor((day - 1) / 7)  // settimana 0-based
        // Numero-schema assegnato a questo medico questa settimana
        const calcNum  = ((mi + week) % nMedici) + 1

        if (!giorni.includes(dayOfWk)) return null   // giorno non nello schema

        const slots = griglia[dayOfWk] ?? []
        let turno = ''
        for (const slot of slots) {
          const inM  = slot.vals['M']  === calcNum
          const inP  = slot.vals['P']  === calcNum
          if (slot.REP && inM) { turno = 'REP'; break }
          if (inM && inP)      { turno = 'L';   break }
          if (inM)             { turno = 'M';   break }
          if (inP)             { turno = 'P';   break }
        }
        return turno   // '' = giorno in schema ma medico non assegnato
      })
    )
  }, [showPreview, medici, giorni, griglia])

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
    // Le colonne sono fisse (M/P/RM/RP), nessun filtro — sempre presenti.
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
        SUB: r.is_sub ?? false,
        MED: r.is_med ?? false,
        SUP: r.is_supporto ?? false,
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

  function handleDrop(toGiorno: number, toIdx: number, toCol: string) {
    const src = dragSource.current
    if (!src) return

    // Regola "uno slot, un solo numero": tutti i numeri non-null in una
    // riga (M/P/RM/RP) devono coincidere. Se il drop violerebbe la regola,
    // mostra il toast e annulla l'operazione (incluso il marcamento di
    // modifiche non salvate).
    const v = validateDrop(griglia, src, toGiorno, toIdx, toCol, GIORNI_IT)
    if (!v.ok) {
      showWarning(v.reason)
      dragSource.current = null
      return
    }

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

  function toggleSub(giorno: number, idx: number) {
    markUnsaved()
    setGriglia(prev => {
      const rows = [...(prev[giorno] ?? [])]
      const cur = rows[idx]
      const SUB = !cur.SUB
      // SUB/MED escludono Supporto.
      rows[idx] = { ...cur, SUB, SUP: SUB ? false : cur.SUP }
      return { ...prev, [giorno]: rows }
    })
  }

  function toggleMed(giorno: number, idx: number) {
    markUnsaved()
    setGriglia(prev => {
      const rows = [...(prev[giorno] ?? [])]
      const cur = rows[idx]
      const MED = !cur.MED
      rows[idx] = { ...cur, MED, SUP: MED ? false : cur.SUP }
      return { ...prev, [giorno]: rows }
    })
  }

  function toggleSup(giorno: number, idx: number) {
    markUnsaved()
    setGriglia(prev => {
      const rows = [...(prev[giorno] ?? [])]
      const cur = rows[idx]
      const SUP = !cur.SUP
      // Supporto (jolly) esclusivo con SUB/MED.
      rows[idx] = SUP ? { ...cur, SUP, SUB: false, MED: false } : { ...cur, SUP }
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
          ...r, REP: false, SUB: false, MED: false, SUP: false,
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
        .delete().eq('reparto_id', repartoAttivo).eq('schema_num', schemaNum)
      if (delErr) throw delErr
      const rows: Omit<SchemaModello, 'id'>[] = []
      for (const [dStr, slots] of Object.entries(griglia)) {
        slots.forEach((r, idx) => {
          rows.push({
            reparto_id: repartoAttivo,
            schema_num: schemaNum, giorno_settimana: +dStr, slot: idx,
            numero_medico_mattina:    r.vals['M']  ?? null,
            numero_medico_pomeriggio: r.vals['P']  ?? null,
            numero_medico_rm:         r.vals['RM'] ?? null,
            numero_medico_rp:         r.vals['RP'] ?? null,
            is_reperibilita:          r.REP,
            is_sub:                   r.SUB,
            is_med:                   r.MED,
            is_supporto:              r.SUP,
          })
        })
      }
      if (rows.length > 0) {
        const { error: insErr } = await supabase.from('schemi_modello').insert(rows)
        if (insErr) throw insErr
      }
      setHasUnsaved(false)  // ← salvato: nessuna modifica pendente
      // 🔴 Segnala "Rigenera calendario" SOLO se ho modificato lo schema
      // ATTUALMENTE ATTIVO: cambiare uno schema non attivo non incide sul
      // calendario generato, quindi nessun avviso di rigenerazione.
      if (schemaNum === schemaAttivo) {
        setNeedsRegen(`Schema ${schemaNum} (attivo) modificato (${rows.length} slot)`)
        setMsg(`✓ Schema ${schemaNum} salvato (${rows.length} slot)`)
      } else {
        setMsg(`✓ Schema ${schemaNum} salvato (${rows.length} slot) — non attivo, nessuna rigenerazione`)
      }
      qc.invalidateQueries({ queryKey: ['schemi_modello'] })
    } catch (e: unknown) {
      setMsg('Errore: ' + (e as Error).message)
    } finally {
      setSaving(false)
      setTimeout(() => setMsg(''), 4000)
    }
  }

  // ── Copia da un altro schema (base di partenza) ───────────────────
  // Carica IN MEMORIA i contenuti dello schema sorgente nello schema
  // corrente (id azzerati = righe nuove). L'utente puo` poi modificare e
  // salvare. Non scrive nulla finche` non si preme "Salva schema".
  async function copiaDaSchema(sourceNum: number) {
    setCopyMenuOpen(false)
    const rows = schemi.filter(s => s.schema_num === sourceNum)
    if (rows.length === 0) {
      showWarning(`Lo schema ${sourceNum} e' vuoto: niente da copiare.`)
      return
    }
    const ok = await confirm({
      title:        `Copia dallo schema ${sourceNum}`,
      message:      `I contenuti dello schema ${schemaNum} verranno sostituiti con una copia dello schema ${sourceNum}. Potrai modificarli e poi salvare. Continuare?`,
      confirmLabel: 'Copia',
    })
    if (!ok) return

    const g: Record<number, SlotRow[]> = {}
    const giorniUsati = new Set<number>()
    rows.forEach(r => {
      giorniUsati.add(r.giorno_settimana)
      if (!g[r.giorno_settimana]) g[r.giorno_settimana] = []
      g[r.giorno_settimana].push({
        id: null,  // riga NUOVA per lo schema corrente (non riuso l'id sorgente)
        slot: r.slot,
        vals: { M: r.numero_medico_mattina, P: r.numero_medico_pomeriggio,
                RM: r.numero_medico_rm,     RP: r.numero_medico_rp },
        REP: r.is_reperibilita,
        SUB: r.is_sub ?? false,
        MED: r.is_med ?? false,
        SUP: r.is_supporto ?? false,
      })
    })
    Object.values(g).forEach(rs => rs.sort((a, b) => a.slot - b.slot))
    setGriglia(g)
    const sorted = [...giorniUsati].sort((a, b) => a - b)
    setGiorni(sorted)
    setTipoSchema(sorted.length < 7 ? 'custom' : 'weekly')
    markUnsaved()
    setMsg(`✓ Copiato dallo schema ${sourceNum} — ricordati di salvare`)
    setTimeout(() => setMsg(''), 4000)
  }

  // ─────────────────────────────────────────────────────────────
  return (
    <div
      ref={schemaContainerRef}
      className="flex flex-col h-[calc(100vh-112px)] overflow-hidden gap-2"
      onTouchEnd={e => {
        if (!touchActiveSch.current) return
        touchActiveSch.current = false
        setTouchOverKey(null)
        const t = e.changedTouches[0]
        const target = document.elementFromPoint(t.clientX, t.clientY)
        const td = target?.closest('[data-col]') as HTMLElement | null
        if (td?.dataset.col && td.dataset.giorno !== undefined && td.dataset.slotIdx !== undefined) {
          handleDrop(+td.dataset.giorno!, +td.dataset.slotIdx!, td.dataset.col!)
        } else {
          dragSource.current = null
        }
      }}
    >

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
                ? { background: '#476540', color: '#fff', borderColor: '#456b3a' }
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
                ? { background: '#476540', color: '#fff', borderColor: '#456b3a' }
                : { background: '#faf8f3', color: '#3a3d30', borderColor: '#c0b8a8' }}>
              {t === 'weekly' ? '7 giorni' : 'Personalizzato'}
            </button>
          ))}
        </div>

        {/* Colonne — fisse: M / P / RM / RP. Mostrate solo come info. */}
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-xs text-stone-600 font-medium">Colonne:</span>
          {colonne.map(col => (
            <span key={col} className="inline-flex items-center gap-0.5 bg-stone-100 text-stone-700
                           text-xs px-1.5 py-0.5 rounded-full border border-stone-200">
              {col}
            </span>
          ))}
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
          <button
            onClick={() => setShowPreview(v => !v)}
            className="btn-secondary py-1 px-2 text-xs gap-1"
            title="Genera anteprima locale della rotazione per N settimane (senza salvare)"
            style={showPreview ? { background: '#e0e8d8', borderColor: '#9ab488' } : undefined}
          >
            {showPreview ? <><EyeOff size={12} /> Chiudi anteprima</> : <><Eye size={12} /> Prova Schema</>}
          </button>
          {/* Copia da un altro schema (base di partenza) */}
          <div className="relative">
            <button
              onClick={() => setCopyMenuOpen(o => !o)}
              className="btn-secondary py-1 px-2 text-xs gap-1"
              title="Copia i contenuti di un altro schema come base di partenza"
              style={copyMenuOpen ? { background: '#e0e8d8', borderColor: '#9ab488' } : undefined}
            >
              <Copy size={12} /> Copia da…
            </button>
            {copyMenuOpen && (
              <>
                {/* Backdrop per chiudere cliccando fuori */}
                <div className="fixed inset-0 z-10" onClick={() => setCopyMenuOpen(false)} />
                <div className="absolute right-0 z-20 mt-1 rounded-lg border border-stone-200 bg-white shadow-lg py-1"
                  style={{ minWidth: 150 }}>
                  {[1, 2, 3].filter(n => n !== schemaNum).map(n => (
                    <button key={n} onClick={() => copiaDaSchema(n)}
                      className="w-full flex items-center gap-2 text-left px-3 py-1.5 text-xs text-stone-700 hover:bg-stone-50 transition-colors">
                      <Copy size={11} style={{ color: '#476540' }} />
                      Copia da Schema {n}
                      {n === schemaAttivo && (
                        <span className="ml-auto text-[9px] font-bold px-1 rounded"
                          style={{ background: '#e0e8d8', color: '#456b3a' }}>ATTIVO</span>
                      )}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
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
                dragSource.current = { num: med.numero_ordine }
              }}
              onTouchStart={() => {
                dragSource.current = { num: med.numero_ordine }
                touchActiveSch.current = true
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
        <button
          onClick={() => setShowHelp(v => !v)}
          className="ml-auto flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1
                     rounded-full border transition-colors shrink-0"
          style={showHelp
            ? { background: '#456b3a', color: '#fff', borderColor: '#2b3c24' }
            : { background: '#e0e8d8', color: '#456b3a', borderColor: '#9ab488' }}
          onMouseEnter={e => {
            if (!showHelp) e.currentTarget.style.background = '#c8d8b8'
          }}
          onMouseLeave={e => {
            if (!showHelp) e.currentTarget.style.background = '#e0e8d8'
          }}>
          {showHelp ? '▲ Nascondi guida' : '? Come funziona'}
        </button>
      </div>

      {/* ═══ ISTRUZIONI (collassabile) ═══════════════════════════ */}
      {showHelp && (
        <div className="shrink-0 rounded-lg border border-stone-200 bg-stone-50 px-4 py-3 text-xs"
          style={{ color: '#4a4a3a' }}>
          <div className="grid grid-cols-2 gap-x-8 gap-y-0.5 sm:grid-cols-2">

            {/* ── Colonna sinistra: comandi ── */}
            <div>
              <p className="font-bold uppercase tracking-wide mb-1.5" style={{ color: '#456b3a', fontSize: 10 }}>
                Comandi
              </p>
              <ul className="space-y-1 leading-snug">
                <li><span className="font-semibold">Trascina</span> un turnista (dalla strip, dal contatore o da una cella piena) su una cella vuota → <span className="font-semibold">sposta</span></li>
                <li><span className="font-semibold">Trascina</span> su una cella già occupata → <span className="font-semibold">scambia</span> i due valori</li>
                <li><span className="font-semibold">Doppio clic</span> su una cella → svuota</li>
                <li>Checkbox <span className="font-semibold text-red-600">REP</span> → marca lo slot come reperibilità</li>
                <li>Checkbox <span className="font-semibold" style={{ color: '#6b7280' }}>SUP</span> → <span className="font-semibold">Supporto</span> (pallino grigio): lo slot lavora senza SUB/MED. Esclude SUB/MED.</li>
                <li><span className="font-semibold">+ slot</span> nella cella giorno → aggiunge una riga per turni sovrapposti</li>
                <li><span className="font-semibold">Prova Schema</span> → anteprima locale del ciclo completo senza salvare</li>
              </ul>
            </div>

            {/* ── Colonna destra: logica rotazione ── */}
            <div>
              <p className="font-bold uppercase tracking-wide mb-1.5" style={{ color: '#456b3a', fontSize: 10 }}>
                Logica della rotazione
              </p>
              <ul className="space-y-1 leading-snug">
                <li>I <span className="font-semibold">numeri nelle celle</span> (1, 2, 3 …) sono <span className="font-semibold">posizioni di rotazione</span>, non medici fissi</li>
                <li><span className="font-semibold">Settimana 0</span>: medico 1 → posizione 1, medico 2 → posizione 2, ecc.</li>
                <li><span className="font-semibold">Settimana 1</span>: tutto si sposta di uno — medico 1 → posizione 2, medico 2 → posizione 3, ecc.</li>
                <li>Dopo <span className="font-semibold">N settimane</span> (N = numero medici) il ciclo si ripete identico</li>
                <li>L'<span className="font-semibold">ordine dei medici</span> nella lista determina il punto di partenza — modificalo in <em>Gestione Medici</em></li>
              </ul>
            </div>

          </div>
        </div>
      )}

      {/* ═══ GRIGLIA + CONTATORE (+ ANTEPRIMA a destra) ═════════ */}
      {/* flex-wrap: se l'anteprima non entra (< 400px) va a capo */}
      <div className="flex-1 min-h-0 flex flex-wrap gap-2 items-start overflow-y-auto">
      <div className="card shrink-0 overflow-auto">
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
                background: '#2b3c24', color: '#fca5a5', fontSize: 10, fontWeight: 700,
                padding: '4px 2px', textAlign: 'center', width: 34,
                border: '1px solid #1e40af', position: 'sticky', top: 0, zIndex: 10,
              }}
                title="Sub-intensiva: il turno clinico di questo slot sarà etichettato (sub) nei calendari">
                SUB
              </th>
              <th style={{
                background: '#2b3c24', color: '#7ec3e8', fontSize: 10, fontWeight: 700,
                padding: '4px 2px', textAlign: 'center', width: 34,
                border: '1px solid #1e40af', position: 'sticky', top: 0, zIndex: 10,
              }}
                title="Medicina: il turno clinico di questo slot sarà etichettato (med) nei calendari">
                MED
              </th>
              <th style={{
                background: '#2b3c24', color: '#cbd5e1', fontSize: 10, fontWeight: 700,
                padding: '4px 2px', textAlign: 'center', width: 34,
                border: '1px solid #1e40af', position: 'sticky', top: 0, zIndex: 10,
              }}
                title="Supporto (jolly grigio): lo slot lavora senza assegnazione SUB/MED">
                SUP
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
                    background: '#456b3a', color: '#fff', fontWeight: 700, fontSize: 11,
                    padding: '3px 6px', border: '1px solid #1e40af', textAlign: 'center',
                  }}>
                    {GIORNI_IT[giorno].slice(0,3).toUpperCase()}
                  </td>
                  <td colSpan={colonne.length + 4} style={{
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
                        background: '#456b3a', color: '#fff', fontWeight: 700, fontSize: 11,
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
                        giorno={giorno}
                        slotIdx={idx}
                        col={col}
                        touchIsOver={touchOverKey === `${giorno}-${idx}-${col}`}
                        onDrop={() => handleDrop(giorno, idx, col)}
                        onClear={() => clearCella(giorno, idx, col)}
                        onDragStart={() => {
                          dragSource.current = {
                            num:         row.vals[col]!,
                            fromGiorno:  giorno,
                            fromSlotIdx: idx,
                            fromCol:     col,
                          }
                        }}
                        onTouchStart={() => {
                          dragSource.current = {
                            num:         row.vals[col]!,
                            fromGiorno:  giorno,
                            fromSlotIdx: idx,
                            fromCol:     col,
                          }
                          touchActiveSch.current = true
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

                    {/* SUB checkbox — etichetta (sub) rossa nei calendari */}
                    <td style={{
                      width: 34, textAlign: 'center', verticalAlign: 'middle',
                      borderRight: '1px solid #e5e7eb', borderBottom: '1px solid #e5e7eb',
                      background: isRep ? REP_BG : rowBg,
                    }}>
                      <input type="checkbox" checked={row.SUB}
                        onChange={() => toggleSub(giorno, idx)}
                        style={{ accentColor: '#dc2626', width: 12, height: 12, cursor: 'pointer' }}
                        title="Sub-intensiva: aggiunge etichetta (sub) rossa al turno clinico" />
                    </td>

                    {/* MED checkbox — etichetta (med) azzurra nei calendari */}
                    <td style={{
                      width: 34, textAlign: 'center', verticalAlign: 'middle',
                      borderRight: '1px solid #e5e7eb', borderBottom: '1px solid #e5e7eb',
                      background: isRep ? REP_BG : rowBg,
                    }}>
                      <input type="checkbox" checked={row.MED}
                        onChange={() => toggleMed(giorno, idx)}
                        style={{ accentColor: '#0ea5e9', width: 12, height: 12, cursor: 'pointer' }}
                        title="Medicina: aggiunge etichetta (med) azzurra al turno clinico" />
                    </td>

                    {/* SUP checkbox — Supporto (pallino grigio nei calendari) */}
                    <td style={{
                      width: 34, textAlign: 'center', verticalAlign: 'middle',
                      borderRight: '1px solid #e5e7eb', borderBottom: '1px solid #e5e7eb',
                      background: isRep ? REP_BG : rowBg,
                    }}>
                      <input type="checkbox" checked={row.SUP}
                        onChange={() => toggleSup(giorno, idx)}
                        style={{ accentColor: '#6b7280', width: 12, height: 12, cursor: 'pointer' }}
                        title="Supporto: jolly grigio, lavora senza assegnazione SUB/MED" />
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
      {/* Contatore — a destra della tabella */}
      <div className="card w-40 shrink-0">
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
                {/* Badge colorato — draggable come i badge nella strip */}
                <span
                  draggable
                  onDragStart={e => {
                    e.dataTransfer.effectAllowed = 'move'
                    dragSource.current = { num: med.numero_ordine }
                  }}
                  onTouchStart={() => {
                    dragSource.current = { num: med.numero_ordine }
                    touchActiveSch.current = true
                  }}
                  className="w-6 h-6 rounded shrink-0 flex items-center justify-center
                             text-xs font-bold select-none hover:scale-110 transition-transform"
                  style={{ background: color.bg, color: color.fg, cursor: 'grab' }}
                  title={`Trascina ${med.nome} (${med.numero_ordine}) in una cella`}
                >
                  {med.numero_ordine}
                </span>
                {/* Nome */}
                <span className="text-xs text-stone-600 flex-1 truncate leading-tight">
                  {med.nome}
                </span>
                {/* Contatore */}
                <span className="text-sm font-bold shrink-0 min-w-[20px] text-right"
                  style={{ color: count > 0 ? '#456b3a' : '#7a7a6a' }}>
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

      {/* ═══ ANTEPRIMA CALENDARIO — a destra del contatore ══════ */}
      {showPreview && previewCells && (
        <div className="card overflow-hidden flex flex-col"
             style={{ flex: '1 1 400px', minWidth: 400 }}
             ref={previewContainerRef}>
          {/* Header */}
          <div className="px-3 pt-2 pb-1.5 border-b border-stone-200 shrink-0 flex items-center justify-between">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider" style={{ color: '#476540' }}>
                Prova Schema — rotazione completa
              </h3>
              <p className="text-[10px] text-stone-500 mt-0.5">
                {medici.length} medici · {medici.length * 7} giorni totali
                {previewWidth > 0 && ` · ${Math.max(1, Math.floor((previewWidth - PV_LABEL_W - 8) / (7 * PV_CELL_W))) * 7} giorni per riga`}
              </p>
            </div>
            <button onClick={() => setShowPreview(false)}
              className="text-stone-400 hover:text-stone-600 transition-colors ml-4 shrink-0">
              <X size={13} />
            </button>
          </div>

          {/* Corpo scrollabile */}
          <div className="p-2 flex flex-col gap-3">
            {previewCells.length === 0 ? (
              <p className="text-xs text-stone-400 italic p-2">Nessun medico attivo.</p>
            ) : (() => {
              const nMedici  = medici.length
              const totalDays = nMedici * 7
              // Quante settimane intere entrano in larghezza?
              const weeksPerRow = Math.max(1, Math.floor((previewWidth - PV_LABEL_W - 8) / (7 * PV_CELL_W)))
              const daysPerRow  = weeksPerRow * 7
              const numChunks   = Math.ceil(totalDays / daysPerRow)

              return Array.from({ length: numChunks }, (_, ci) => {
                const startDay = ci * daysPerRow + 1
                const endDay   = Math.min(startDay + daysPerRow - 1, totalDays)
                const days     = Array.from({ length: endDay - startDay + 1 }, (_, i) => startDay + i)

                return (
                  <div key={ci} style={{
                    border: '1px solid #e5e7eb', borderRadius: 6, overflow: 'hidden',
                    width: 'fit-content',
                  }}>
                    {/* Riga numeri giorno */}
                    <div className="flex" style={{ borderBottom: '1px solid #d1d5db' }}>
                      <div style={{
                        width: PV_LABEL_W, flexShrink: 0,
                        background: '#2b3c24',
                      }} />
                      {days.map(day => {
                        const isWe = ((day - 1) % 7) >= 5  // Sab/Dom
                        return (
                          <div key={day} style={{
                            width: PV_CELL_W, flexShrink: 0,
                            textAlign: 'center', fontSize: 9, fontWeight: 700,
                            padding: '2px 0',
                            background: isWe ? '#fee2e2' : '#f0f4ee',
                            color:      isWe ? '#9f1239' : '#2b3c24',
                            borderLeft: '1px solid #e5e7eb',
                          }}>
                            {day}
                          </div>
                        )
                      })}
                    </div>

                    {/* Righe medici */}
                    {medici.map((med, mi) => {
                      const color = PASTEL[mi % PASTEL.length]
                      return (
                        <div key={med.id} className="flex" style={{ borderBottom: '1px solid #f0f0f0' }}>
                          {/* Nome medico */}
                          <div style={{
                            width: PV_LABEL_W, flexShrink: 0,
                            padding: '1px 4px', fontSize: 9, fontWeight: 700,
                            background: color.bg, color: color.fg,
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            borderRight: '1px solid #e5e7eb',
                            display: 'flex', alignItems: 'center', gap: 3,
                          }}>
                            <span style={{
                              display: 'inline-block', width: 14, height: 14, borderRadius: 3,
                              background: 'rgba(0,0,0,0.12)', textAlign: 'center',
                              lineHeight: '14px', fontSize: 8, fontWeight: 900, flexShrink: 0,
                            }}>{med.numero_ordine}</span>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {med.nome.split(' ').slice(-1)[0]}
                            </span>
                          </div>

                          {/* Celle turno */}
                          {days.map(day => {
                            const cell  = previewCells[mi]?.[day - 1] ?? null
                            const isWe  = ((day - 1) % 7) >= 5
                            const clr   = cell && cell !== '' ? PV_CELL_COLORS[cell] : null
                            const bg    = clr?.bg ?? (isWe ? '#fdf9f9' : '#fff')
                            const fg    = clr?.fg ?? (cell === null ? '#d1d5db' : '#9ca3af')
                            const text  = cell === null ? '' : cell === '' ? '' : cell

                            return (
                              <div key={day} title={`Giorno ${day} — ${med.nome}: ${cell || '—'}`} style={{
                                width: PV_CELL_W, flexShrink: 0, height: 20,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                background: bg, color: fg,
                                fontSize: 9, fontWeight: 700,
                                borderLeft: '1px solid #f0f0f0',
                              }}>
                                {text}
                              </div>
                            )
                          })}
                        </div>
                      )
                    })}
                  </div>
                )
              })
            })()}
          </div>
        </div>
      )}
      </div>{/* /flex-wrap container */}

      {/* ═══ TOAST WARNING (validazione drop) ════════════════════
          Centrato sulla viewport (full-screen wrapper con flex center).
          pointer-events-none sul wrapper + auto sul toast → i click
          fuori dal toast passano attraverso e non bloccano la UI.
          Auto-dismiss in 3.5s o click sulla X. */}
      {warningMsg && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none px-4"
          role="alert">
          <div
            className="flex items-start gap-2.5 px-4 py-3 rounded-xl shadow-2xl"
            style={{
              background:     '#fef3c7',
              borderLeft:     '5px solid #d97706',
              color:          '#78350f',
              maxWidth:       460,
              pointerEvents:  'auto',
              animationName:  'fadeSlideIn',
              animationDuration: '180ms',
              animationTimingFunction: 'ease-out',
            }}>
            <AlertTriangle size={18} className="shrink-0 mt-0.5" style={{ color: '#b45309' }} />
            <span className="text-sm font-medium leading-snug flex-1">
              {warningMsg}
            </span>
            <button
              onClick={() => {
                if (warningTimer.current) clearTimeout(warningTimer.current)
                setWarningMsg(null)
              }}
              className="shrink-0 hover:opacity-70 transition-opacity"
              style={{ color: '#92400e' }}
              title="Chiudi">
              <X size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
