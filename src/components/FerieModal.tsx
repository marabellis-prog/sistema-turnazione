/**
 * FerieModal
 *
 * Modal calendario interattivo per la gestione delle ferie di un medico.
 * Usato in due contesti:
 *
 * 1. **Admin** (GestioneFeriePage) — apre il modal per qualsiasi medico,
 *    può aggiungere/rimuovere giorni a piacere, sia su ferie approvate
 *    che pending.
 * 2. **Self** (CalendarioPage → "Richiedi ferie") — l'utente loggato
 *    apre il modal per il medico associato a sé. Può aggiungere giorni
 *    nuovi (entrano come richieste pending) o cancellare le sue richieste
 *    pending. Non può toccare le ferie già approvate (decisione admin).
 *
 * Il prop `mode` controlla questo comportamento:
 *   - 'admin' (default): tutto cliccabile, nessuna restrizione
 *   - 'self': click bloccato sui giorni già approvati
 */

import { useState, useMemo } from 'react'
import { Check, X, ChevronLeft, ChevronRight } from 'lucide-react'
import { MESI_IT } from '../lib/algorithm'
import type { Medico, Ferie } from '../types'

// ════════════════════════════════════════════════════════════════════
// HELPERS — esportati anche per riuso esterno (es. handleSaveChanges)
// ════════════════════════════════════════════════════════════════════

/** Espande un range di date in un array di singole date ISO (YYYY-MM-DD) */
export function expandRange(start: string, end: string): string[] {
  const days: string[] = []
  const cur = new Date(start + 'T00:00:00')
  const fin = new Date(end   + 'T00:00:00')
  while (cur <= fin) {
    // ⚠️ NON usare toISOString(): converte in UTC, con fuso CEST/CET
    // mezzanotte locale diventa il giorno prima → ogni data esplosa
    // verrebbe shiftata di 1 giorno indietro.
    const y = cur.getFullYear()
    const m = String(cur.getMonth() + 1).padStart(2, '0')
    const d = String(cur.getDate()).padStart(2, '0')
    days.push(`${y}-${m}-${d}`)
    cur.setDate(cur.getDate() + 1)
  }
  return days
}

/** Raggruppa date singole in range contigui */
export function toRanges(days: string[]): { start: string; end: string }[] {
  if (!days.length) return []
  const sorted = [...new Set(days)].sort()
  const result: { start: string; end: string }[] = []
  let rs = sorted[0], prev = sorted[0]
  for (let i = 1; i < sorted.length; i++) {
    const diff = (new Date(sorted[i] + 'T00:00:00').getTime()
                - new Date(prev     + 'T00:00:00').getTime()) / 86_400_000
    if (diff === 1) { prev = sorted[i] }
    else { result.push({ start: rs, end: prev }); rs = sorted[i]; prev = sorted[i] }
  }
  result.push({ start: rs, end: prev })
  return result
}

function addMonths(d: Date, n: number): Date {
  const r = new Date(d); r.setDate(1); r.setMonth(r.getMonth() + n); return r
}

// ── Festività italiane ───────────────────────────────────────────

/** Calcola la domenica di Pasqua (algoritmo di Gauss) */
function getEaster(year: number): Date {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const ii = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * ii - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day   = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(year, month - 1, day)
}

function getItalianHolidays(year: number): Set<string> {
  const pad = (n: number) => String(n).padStart(2, '0')
  const iso  = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`

  const fixed = [
    iso(year, 1,  1),   // Capodanno
    iso(year, 1,  6),   // Epifania
    iso(year, 4, 25),   // Liberazione
    iso(year, 5,  1),   // Festa del lavoro
    iso(year, 6,  2),   // Repubblica
    iso(year, 8, 15),   // Ferragosto
    iso(year, 11, 1),   // Tutti i Santi
    iso(year, 12, 8),   // Immacolata
    iso(year, 12, 25),  // Natale
    iso(year, 12, 26),  // Santo Stefano
  ]

  // ⚠️ Usa getter locali (getFullYear/Month/Date) — NON toISOString():
  // toISOString() converte in UTC e con il fuso italiano (UTC+1/+2)
  // mezzanotte locale diventa il giorno prima in UTC → data sbagliata.
  const localIso = (d: Date) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

  const easter    = getEaster(year)
  const easterMon = new Date(easter.getFullYear(), easter.getMonth(), easter.getDate() + 1)

  return new Set([
    ...fixed,
    localIso(easter),       // Pasqua
    localIso(easterMon),    // Lunedì dell'Angelo
  ])
}

// ════════════════════════════════════════════════════════════════════
// TIPI & STILI
// ════════════════════════════════════════════════════════════════════

export type DayChange = 'add' | 'remove'
export type DayState  = 'none' | 'approved' | 'pending' | 'new-add' | 'del-approved' | 'del-pending'

function getDayState(
  dateStr: string,
  approved: Set<string>,
  pending:  Set<string>,
  changes:  Map<string, DayChange>,
): DayState {
  const change = changes.get(dateStr)
  if (change === 'remove') return approved.has(dateStr) ? 'del-approved' : 'del-pending'
  if (change === 'add')    return 'new-add'
  if (approved.has(dateStr)) return 'approved'
  if (pending.has(dateStr))  return 'pending'
  return 'none'
}

const DAY_STYLE: Record<DayState, React.CSSProperties> = {
  none: { background: '#faf8f3', color: '#3a3d30', border: '1px solid #e5e7eb' },
  approved: { background: '#4ade80', color: '#14532d', border: 'none' },
  pending: {
    background: 'repeating-linear-gradient(-45deg,#4ade80 0px,#4ade80 4px,#bbf7d0 4px,#bbf7d0 8px)',
    color: '#14532d', border: 'none',
  },
  'new-add': {
    background: 'repeating-linear-gradient(-45deg,#86efac 0px,#86efac 4px,#dcfce7 4px,#dcfce7 8px)',
    color: '#166534', border: 'none',
  },
  'del-approved': {
    background: 'repeating-linear-gradient(-45deg,#f87171 0px,#f87171 4px,#fecaca 4px,#fecaca 8px)',
    color: '#7f1d1d', textDecoration: 'line-through', border: 'none',
  },
  'del-pending': {
    background: 'repeating-linear-gradient(-45deg,#f87171 0px,#f87171 4px,#fecaca 4px,#fecaca 8px)',
    color: '#7f1d1d', textDecoration: 'line-through', border: 'none',
  },
}

// ════════════════════════════════════════════════════════════════════
// MONTH BLOCK
// ════════════════════════════════════════════════════════════════════

const DOW = ['L','M','M','G','V','S','D']

function MonthBlock({ year, month, approved, pending, changes, onDayClick, mode }: {
  year: number; month: number   // month 0-based
  approved: Set<string>; pending: Set<string>
  changes: Map<string, DayChange>
  onDayClick: (d: string) => void
  mode: 'admin' | 'self'
}) {
  // Festività italiane per questo anno (Pasqua calcolata)
  const holidays = useMemo(() => getItalianHolidays(year), [year])

  const firstDow    = (new Date(year, month, 1).getDay() + 6) % 7  // 0=Mon
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: (number | null)[] = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  while (cells.length % 7 !== 0) cells.push(null)

  return (
    <div style={{ minWidth: 190 }}>
      <p className="text-xs font-bold text-center mb-2" style={{ color: '#374f30' }}>
        {MESI_IT[month + 1].toUpperCase()} {year}
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 26px)', gap: 2 }}>
        {/* Header giorni: solo D (domenica, indice 6) è rosso */}
        {DOW.map((d, i) => (
          <div key={i} style={{
            textAlign: 'center', fontSize: 9, fontWeight: 700, height: 16,
            color: i === 6 ? '#b91c1c' : '#9ca3af',
          }}>{d}</div>
        ))}
        {cells.map((day, i) => {
          if (!day) return <div key={`e${i}`} style={{ height: 26 }} />
          const mm  = String(month + 1).padStart(2, '0')
          const dd  = String(day).padStart(2, '0')
          const iso = `${year}-${mm}-${dd}`
          const state     = getDayState(iso, approved, pending, changes)
          const isSunday  = (i % 7) === 6
          const isHoliday = holidays.has(iso)
          // Il numero è rosso per domeniche e festivi; il colore del bg viene dallo stato ferie
          const numColor  = (isSunday || isHoliday) ? '#b91c1c' : (DAY_STYLE[state].color as string)

          // In modalità self: i giorni già approvati sono read-only (decisione admin)
          const isLocked = mode === 'self' && state === 'approved'

          return (
            <button key={iso}
              onClick={isLocked ? undefined : () => onDayClick(iso)}
              disabled={isLocked}
              title={isLocked ? `${iso} — ferie già approvate (non modificabili)` : iso}
              style={{
                ...DAY_STYLE[state],
                color: numColor,
                width: 26, height: 26,
                borderRadius: 4,
                fontSize: 10, fontWeight: (isSunday || isHoliday) ? 800 : 600,
                cursor: isLocked ? 'not-allowed' : 'pointer',
                transition: 'opacity .1s, transform .1s',
              }}
              onMouseEnter={e => {
                if (isLocked) return
                e.currentTarget.style.opacity = '.75'
                e.currentTarget.style.transform = 'scale(1.08)'
              }}
              onMouseLeave={e => {
                if (isLocked) return
                e.currentTarget.style.opacity = '1'
                e.currentTarget.style.transform = 'scale(1)'
              }}
            >{day}</button>
          )
        })}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════
// FERIE MODAL
// ════════════════════════════════════════════════════════════════════

type ViewMode = 'monthly' | 'quarterly' | 'semestral' | 'annual'
const N_MONTHS:  Record<ViewMode, number> = { monthly:1, quarterly:3, semestral:6, annual:12 }
const VIEW_LBL:  Record<ViewMode, string> = {
  monthly:'Mensile', quarterly:'Trimestrale', semestral:'Semestrale', annual:'Annuale'
}

/** Il modal usa solo questi tre campi: accettiamo qualsiasi struttura compatibile */
type FerieDisplay = Pick<Ferie, 'data_inizio' | 'data_fine' | 'approvate'>

interface FerieModalProps {
  medico:    Medico
  ferie:     FerieDisplay[]
  onSave:    (changes: Map<string, DayChange>) => Promise<void>
  onClose:   () => void
  /** Default 'admin' = nessuna restrizione. 'self' = ferie approvate read-only. */
  mode?:     'admin' | 'self'
  /** Override del titolo del modal (default: medico.nome) */
  title?:    string
  /** Sottotitolo personalizzato (es. "Stai richiedendo ferie per…") */
  subtitle?: string
}

export function FerieModal({
  medico, ferie, onSave, onClose,
  mode = 'admin', title, subtitle,
}: FerieModalProps) {
  const [view,    setView]    = useState<ViewMode>('quarterly')
  const [anchor,  setAnchor]  = useState(() => { const d = new Date(); d.setDate(1); return d })
  const [changes, setChanges] = useState<Map<string, DayChange>>(new Map())
  const [saving,  setSaving]  = useState(false)

  const approved = useMemo(() => {
    const s = new Set<string>()
    ferie.filter(f => f.approvate).forEach(f => expandRange(f.data_inizio, f.data_fine).forEach(d => s.add(d)))
    return s
  }, [ferie])

  const pending = useMemo(() => {
    const s = new Set<string>()
    ferie.filter(f => !f.approvate).forEach(f => expandRange(f.data_inizio, f.data_fine).forEach(d => s.add(d)))
    return s
  }, [ferie])

  function handleDayClick(iso: string) {
    setChanges(prev => {
      const next = new Map(prev)
      if (next.has(iso)) {
        next.delete(iso)  // annulla modifica pendente
      } else if (approved.has(iso) || pending.has(iso)) {
        next.set(iso, 'remove')
      } else {
        next.set(iso, 'add')
      }
      return next
    })
  }

  const months = useMemo(() => {
    const n = N_MONTHS[view]
    return Array.from({ length: n }, (_, i) => {
      const d = addMonths(anchor, i)
      return { year: d.getFullYear(), month: d.getMonth() }
    })
  }, [view, anchor])

  const anchorEnd = addMonths(anchor, N_MONTHS[view] - 1)

  async function handleSave() {
    if (changes.size === 0) { onClose(); return }
    setSaving(true)
    await onSave(changes)
    setSaving(false)
    onClose()
  }

  const cols = view === 'annual' ? 4 : 3

  // In modalità 'self' rimuoviamo dalla legenda gli stati che l'utente
  // non può creare (es. del-approved → non può cancellare approvate).
  const LEGEND_FULL = [
    { state: 'approved'    as DayState, label: 'Approvate' },
    { state: 'pending'     as DayState, label: 'Richieste (non approvate)' },
    { state: 'new-add'     as DayState, label: 'Da aggiungere' },
    { state: 'del-approved'as DayState, label: 'Da cancellare' },
  ]
  const LEGEND_SELF = [
    { state: 'approved'    as DayState, label: 'Approvate (bloccate)' },
    { state: 'pending'     as DayState, label: 'In attesa' },
    { state: 'new-add'     as DayState, label: 'Da richiedere' },
    { state: 'del-pending' as DayState, label: 'Annulla richiesta' },
  ]
  const LEGEND = mode === 'self' ? LEGEND_SELF : LEGEND_FULL

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-auto"
      style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(2px)' }}
      onClick={onClose}>
      <div className="relative bg-white rounded-2xl shadow-2xl flex flex-col"
        style={{ maxWidth: 'min(92vw, 880px)', maxHeight: '92vh', width: 'fit-content' }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-4 pb-3 border-b border-stone-200 shrink-0">
          <div>
            <h3 className="font-bold text-stone-800 text-base">{title ?? medico.nome}</h3>
            <p className="text-xs text-stone-500 mt-0.5">
              {subtitle ?? 'Clicca un giorno per aggiungere/rimuovere ferie · clicca di nuovo per annullare'}
            </p>
          </div>
          <button onClick={onClose} className="ml-6 text-stone-400 hover:text-stone-600 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Toolbar: vista + navigazione */}
        <div className="flex flex-wrap items-center gap-3 px-6 py-2.5 border-b border-stone-100 shrink-0"
          style={{ background: '#faf8f3' }}>
          {/* Vista */}
          <div className="flex gap-1">
            {(Object.keys(N_MONTHS) as ViewMode[]).map(v => (
              <button key={v} onClick={() => setView(v)}
                className="px-2.5 py-0.5 rounded text-xs font-medium transition-colors"
                style={view === v
                  ? { background: '#476540', color: '#fff' }
                  : { background: '#e8e3d8', color: '#5a5a4a' }}>
                {VIEW_LBL[v]}
              </button>
            ))}
          </div>
          {/* Navigazione */}
          <div className="flex items-center gap-2 ml-2">
            <button onClick={() => setAnchor(d => addMonths(d, -N_MONTHS[view]))}
              className="p-1 rounded hover:bg-stone-200 transition-colors">
              <ChevronLeft size={16} />
            </button>
            <span className="text-xs font-semibold text-stone-600 min-w-[180px] text-center">
              {MESI_IT[anchor.getMonth() + 1]} {anchor.getFullYear()}
              {view !== 'monthly' && (
                <> → {MESI_IT[anchorEnd.getMonth() + 1]} {anchorEnd.getFullYear()}</>
              )}
            </span>
            <button onClick={() => setAnchor(d => addMonths(d, N_MONTHS[view]))}
              className="p-1 rounded hover:bg-stone-200 transition-colors">
              <ChevronRight size={16} />
            </button>
          </div>
          {/* Oggi */}
          <button onClick={() => setAnchor(() => { const d = new Date(); d.setDate(1); return d })}
            className="text-xs text-stone-500 hover:text-stone-700 ml-auto underline underline-offset-2">
            oggi
          </button>
        </div>

        {/* Griglia mesi */}
        <div className="overflow-auto flex-1 p-5">
          <div style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${view === 'monthly' ? 1 : cols}, auto)`,
            gap: 24,
          }}>
            {months.map(({ year, month }) => (
              <MonthBlock key={`${year}-${month}`}
                year={year} month={month}
                approved={approved} pending={pending}
                changes={changes} onDayClick={handleDayClick}
                mode={mode} />
            ))}
          </div>
        </div>

        {/* Legenda + contatore modifiche */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-6 py-2.5 border-t border-stone-100 shrink-0"
          style={{ background: '#faf8f3' }}>
          {LEGEND.map(({ state, label }) => (
            <span key={state} className="flex items-center gap-1.5 text-xs text-stone-600">
              <span style={{
                ...DAY_STYLE[state],
                display: 'inline-block', width: 16, height: 16, borderRadius: 3, flexShrink: 0,
                textDecoration: 'none',
              }} />
              {label}
            </span>
          ))}
          {changes.size > 0 && (
            <span className="ml-auto text-xs font-semibold px-2 py-0.5 rounded-full"
              style={{ background: '#fef3c7', color: '#92400e' }}>
              {changes.size} modifica{changes.size !== 1 ? 'he' : ''} da salvare
            </span>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-6 py-3 border-t border-stone-200 shrink-0">
          <button onClick={onClose} className="btn-secondary py-1.5 px-4 text-sm">
            Annulla
          </button>
          <button onClick={handleSave} disabled={saving || changes.size === 0}
            className="btn-primary py-1.5 px-4 text-sm gap-1.5">
            <Check size={14} />
            {saving ? 'Salvataggio…'
              : changes.size > 0
                ? (mode === 'self' ? `Invia richiesta (${changes.size})` : `Salva (${changes.size})`)
                : 'Nessuna modifica'}
          </button>
        </div>
      </div>
    </div>
  )
}
