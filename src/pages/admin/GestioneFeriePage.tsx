import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Calendar, Check, X, ChevronLeft, ChevronRight, Plus, Clock } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useConfirm } from '../../hooks/useConfirm'
import { ConfirmModal } from '../../components/ConfirmModal'
import { MESI_IT } from '../../lib/algorithm'
import type { Medico, Ferie } from '../../types'

// ══════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ══════════════════════════════════════════════════════════════════

/** Espande un range di date in un array di singole date ISO (YYYY-MM-DD) */
function expandRange(start: string, end: string): string[] {
  const days: string[] = []
  const cur = new Date(start + 'T00:00:00')
  const fin = new Date(end   + 'T00:00:00')
  while (cur <= fin) {
    days.push(cur.toISOString().split('T')[0])
    cur.setDate(cur.getDate() + 1)
  }
  return days
}

/** Raggruppa date singole in range contigui */
function toRanges(days: string[]): { start: string; end: string }[] {
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

function fmtIt(iso: string): string {
  const [y, m, d] = iso.split('-')
  const curY = String(new Date().getFullYear())
  return y !== curY ? `${d}/${m}/${y.slice(2)}` : `${d}/${m}`
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

// ══════════════════════════════════════════════════════════════════
// DAY STATE & STYLES
// ══════════════════════════════════════════════════════════════════

type DayChange = 'add' | 'remove'
type DayState  = 'none' | 'approved' | 'pending' | 'new-add' | 'del-approved' | 'del-pending'

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

// ══════════════════════════════════════════════════════════════════
// MONTH BLOCK
// ══════════════════════════════════════════════════════════════════

const DOW = ['L','M','M','G','V','S','D']

function MonthBlock({ year, month, approved, pending, changes, onDayClick }: {
  year: number; month: number   // month 0-based
  approved: Set<string>; pending: Set<string>
  changes: Map<string, DayChange>
  onDayClick: (d: string) => void
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
          return (
            <button key={iso} onClick={() => onDayClick(iso)}
              title={iso}
              style={{
                ...DAY_STYLE[state],
                color: numColor,
                width: 26, height: 26,
                borderRadius: 4,
                fontSize: 10, fontWeight: (isSunday || isHoliday) ? 800 : 600,
                cursor: 'pointer',
                transition: 'opacity .1s, transform .1s',
              }}
              onMouseEnter={e => { e.currentTarget.style.opacity = '.75'; e.currentTarget.style.transform = 'scale(1.08)' }}
              onMouseLeave={e => { e.currentTarget.style.opacity = '1';   e.currentTarget.style.transform = 'scale(1)'    }}
            >{day}</button>
          )
        })}
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════
// FERIE MODAL
// ══════════════════════════════════════════════════════════════════

type ViewMode = 'monthly' | 'quarterly' | 'semestral' | 'annual'
const N_MONTHS:  Record<ViewMode, number> = { monthly:1, quarterly:3, semestral:6, annual:12 }
const VIEW_LBL:  Record<ViewMode, string> = {
  monthly:'Mensile', quarterly:'Trimestrale', semestral:'Semestrale', annual:'Annuale'
}

function FerieModal({ medico, ferie, onSave, onClose }: {
  medico:  Medico
  ferie:   Ferie[]
  onSave:  (changes: Map<string, DayChange>) => Promise<void>
  onClose: () => void
}) {
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

  const LEGEND = [
    { state: 'approved'    as DayState, label: 'Approvate' },
    { state: 'pending'     as DayState, label: 'Richieste (non approvate)' },
    { state: 'new-add'     as DayState, label: 'Da aggiungere' },
    { state: 'del-approved'as DayState, label: 'Da cancellare' },
  ]

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
            <h3 className="font-bold text-stone-800 text-base">{medico.nome}</h3>
            <p className="text-xs text-stone-500 mt-0.5">
              Clicca un giorno per aggiungere/rimuovere ferie · clicca di nuovo per annullare
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
                changes={changes} onDayClick={handleDayClick} />
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
            {saving ? 'Salvataggio…' : changes.size > 0 ? `Salva (${changes.size})` : 'Nessuna modifica'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════
// PAGINA PRINCIPALE
// ══════════════════════════════════════════════════════════════════

export function GestioneFeriePage() {
  const qc = useQueryClient()
  const { confirm, confirmState } = useConfirm()

  const [modalMedico,    setModalMedico]    = useState<Medico | null>(null)
  const [insertMedicoId, setInsertMedicoId] = useState('')
  const [errore,         setErrore]         = useState('')

  // ── Query ────────────────────────────────────────────────────
  const { data: medici = [] } = useQuery<Medico[]>({
    queryKey: ['medici-tutti'],
    queryFn: async () => {
      const { data, error } = await supabase.from('medici').select('*').order('numero_ordine')
      if (error) throw error
      return data
    },
  })

  const { data: ferie = [] } = useQuery<Ferie[]>({
    queryKey: ['ferie'],
    queryFn: async () => {
      const { data, error } = await supabase.from('ferie').select('*').order('data_inizio')
      if (error) throw error
      return data ?? []
    },
  })

  // ── Ferie raggruppate per medico ─────────────────────────────
  const ferieByMedico = useMemo(() => {
    const m = new Map<string, Ferie[]>()
    for (const f of ferie) {
      if (!m.has(f.medico_id)) m.set(f.medico_id, [])
      m.get(f.medico_id)!.push(f)
    }
    return m
  }, [ferie])

  const ferieInAttesa = useMemo(() => ferie.filter(f => !f.approvate), [ferie])

  // ── Salva modifiche da modal ─────────────────────────────────
  async function handleSaveChanges(medicoId: string, changes: Map<string, DayChange>) {
    setErrore('')
    try {
      const toRemove    = [...changes.entries()].filter(([,v]) => v === 'remove').map(([k]) => k)
      const toAdd       = [...changes.entries()].filter(([,v]) => v === 'add').map(([k]) => k)
      const toRemoveSet = new Set(toRemove)

      // ── Gestisci rimozioni ───────────────────────────────────
      const doctorFerie = ferieByMedico.get(medicoId) ?? []
      const affected    = doctorFerie.filter(f =>
        expandRange(f.data_inizio, f.data_fine).some(d => toRemoveSet.has(d))
      )

      for (const record of affected) {
        const allDays       = expandRange(record.data_inizio, record.data_fine)
        const removedFromThis = allDays.filter(d => toRemoveSet.has(d))
        const remaining       = allDays.filter(d => !toRemoveSet.has(d))

        const { error } = await supabase.from('ferie').delete().eq('id', record.id)
        if (error) throw error

        // Resetta is_ferie per i giorni rimossi (solo se erano approvati)
        if (record.approvate && removedFromThis.length > 0) {
          for (const { start, end } of toRanges(removedFromThis)) {
            await supabase.from('turni')
              .update({ is_ferie: false })
              .eq('medico_id', medicoId)
              .gte('data', start).lte('data', end)
          }
        }

        // Ricrea i giorni rimanenti come nuovi record (stesso approvate)
        for (const { start, end } of toRanges(remaining)) {
          await supabase.from('ferie').insert({
            medico_id: medicoId, data_inizio: start, data_fine: end,
            note: record.note, approvate: record.approvate,
          })
        }
      }

      // ── Gestisci aggiunte: crea richieste (approvate=false) ──
      for (const { start, end } of toRanges(toAdd)) {
        await supabase.from('ferie').insert({
          medico_id: medicoId, data_inizio: start, data_fine: end,
          note: null, approvate: false,
        })
      }

      qc.invalidateQueries({ queryKey: ['ferie'] })
      qc.invalidateQueries({ queryKey: ['ferie-ranges'] })
      qc.invalidateQueries({ queryKey: ['turni'] })
    } catch (e: unknown) {
      setErrore((e as Error).message)
    }
  }

  // ── Approva ferie ────────────────────────────────────────────
  async function approvaFerie(f: Ferie) {
    const { error } = await supabase.from('ferie').update({ approvate: true }).eq('id', f.id)
    if (error) { setErrore(error.message); return }
    await supabase.from('turni')
      .update({ is_ferie: true })
      .eq('medico_id', f.medico_id)
      .gte('data', f.data_inizio).lte('data', f.data_fine)
    qc.invalidateQueries({ queryKey: ['ferie'] })
    qc.invalidateQueries({ queryKey: ['ferie-ranges'] })
    qc.invalidateQueries({ queryKey: ['turni'] })
  }

  // ── Elimina ferie ────────────────────────────────────────────
  async function eliminaFerie(f: Ferie) {
    const ok = await confirm({
      title:        'Elimina richiesta ferie',
      message:      `Eliminare definitivamente le ferie dal ${fmtIt(f.data_inizio)} al ${fmtIt(f.data_fine)}?`,
      confirmLabel: 'Elimina', danger: true,
    })
    if (!ok) return
    await supabase.from('ferie').delete().eq('id', f.id)
    if (f.approvate) {
      await supabase.from('turni')
        .update({ is_ferie: false })
        .eq('medico_id', f.medico_id)
        .gte('data', f.data_inizio).lte('data', f.data_fine)
    }
    qc.invalidateQueries({ queryKey: ['ferie'] })
    qc.invalidateQueries({ queryKey: ['ferie-ranges'] })
    qc.invalidateQueries({ queryKey: ['turni'] })
  }

  // ── Helpers display ──────────────────────────────────────────
  function medNome(id: string) {
    return medici.find(m => m.id === id)?.nome ?? '—'
  }

  function ferieText(medicoId: string): string {
    const appr = (ferieByMedico.get(medicoId) ?? []).filter(f => f.approvate)
    if (!appr.length) return '—'
    return appr.map(f =>
      f.data_inizio === f.data_fine
        ? fmtIt(f.data_inizio)
        : `${fmtIt(f.data_inizio)}→${fmtIt(f.data_fine)}`
    ).join('  ·  ')
  }

  const insertMedico = medici.find(m => m.id === insertMedicoId) ?? null

  // ─────────────────────────────────────────────────────────────
  return (
    <div className="max-w-3xl space-y-5">
      <ConfirmModal {...confirmState.opts} open={confirmState.open}
        onConfirm={confirmState.onConfirm} onCancel={confirmState.onCancel} />

      {/* Modal calendario ferie */}
      {modalMedico && (
        <FerieModal
          medico={modalMedico}
          ferie={ferieByMedico.get(modalMedico.id) ?? []}
          onSave={changes => handleSaveChanges(modalMedico.id, changes)}
          onClose={() => { setModalMedico(null); setInsertMedicoId('') }}
        />
      )}

      <div>
        <h2 className="text-xl font-bold text-stone-800 flex items-center gap-2">
          <Calendar size={20} style={{ color: '#476540' }} />
          Gestione Ferie
        </h2>
        <p className="text-sm text-stone-600 mt-0.5">
          Inserisci e approva le ferie dei medici.
        </p>
      </div>

      {errore && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {errore}
        </div>
      )}

      {/* ══ 1 · FERIE DA APPROVARE ══════════════════════════════ */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-stone-200 flex items-center gap-2"
          style={{ background: '#fef9ec' }}>
          <Clock size={14} className="text-amber-500 shrink-0" />
          <h3 className="font-semibold text-stone-800 text-sm">Ferie da approvare</h3>
          {ferieInAttesa.length > 0 && (
            <span className="ml-auto text-xs font-bold px-2 py-0.5 rounded-full"
              style={{ background: '#f59e0b', color: '#fff' }}>
              {ferieInAttesa.length}
            </span>
          )}
        </div>

        {ferieInAttesa.length === 0 ? (
          <p className="px-4 py-8 text-sm text-stone-400 italic text-center">
            Nessuna richiesta in attesa di approvazione.
          </p>
        ) : (
          <div className="divide-y divide-stone-100">
            {ferieInAttesa.map(f => (
              <div key={f.id} className="flex items-center gap-3 px-4 py-3">
                <div className="w-2 h-2 rounded-full shrink-0"
                  style={{ background: '#f59e0b' }} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-stone-800">{medNome(f.medico_id)}</p>
                  <p className="text-xs text-stone-500 mt-0.5">
                    {fmtIt(f.data_inizio)} → {fmtIt(f.data_fine)}
                    {f.data_inizio !== f.data_fine && (
                      <span className="ml-1 text-stone-400">
                        ({expandRange(f.data_inizio, f.data_fine).length} giorni)
                      </span>
                    )}
                    {f.note && <span className="ml-2 italic text-stone-400">"{f.note}"</span>}
                  </p>
                </div>
                <button onClick={() => approvaFerie(f)}
                  className="btn-primary py-1 px-3 text-xs gap-1 shrink-0">
                  <Check size={12} /> Approva
                </button>
                <button onClick={() => eliminaFerie(f)}
                  className="p-1.5 rounded text-stone-400 hover:text-red-500 hover:bg-red-50 transition-colors shrink-0"
                  title="Elimina richiesta">
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ══ 2 · FERIE APPROVATE ═════════════════════════════════ */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-stone-200 flex items-center gap-2"
          style={{ background: '#f0f4ee' }}>
          <Check size={14} className="shrink-0" style={{ color: '#476540' }} />
          <h3 className="font-semibold text-stone-800 text-sm">Ferie approvate</h3>
          <span className="text-xs text-stone-500 ml-1">
            · clicca 📅 per modificare
          </span>
        </div>
        <div className="divide-y divide-stone-100">
          {medici.map(med => (
            <div key={med.id} className="flex items-center gap-3 px-4 py-2.5 group">
              <span className="text-sm font-semibold text-stone-800 w-36 shrink-0 truncate"
                title={med.nome}>
                {med.nome}
              </span>
              <input
                readOnly
                value={ferieText(med.id)}
                className="flex-1 text-xs text-stone-600 bg-stone-50 border border-stone-200
                           rounded px-2.5 py-1.5 focus:outline-none cursor-default min-w-0"
                style={{ fontFamily: 'ui-monospace, monospace' }}
              />
              <button
                onClick={() => setModalMedico(med)}
                className="p-1.5 rounded shrink-0 transition-colors"
                style={{ color: '#476540' }}
                onMouseEnter={e => (e.currentTarget.style.background = '#e0e8d8')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                title={`Gestisci ferie di ${med.nome}`}>
                <Calendar size={16} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* ══ 3 · INSERISCI MANUALMENTE ═══════════════════════════ */}
      <div className="card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Plus size={14} style={{ color: '#476540' }} />
          <h3 className="font-semibold text-stone-800 text-sm">Inserisci ferie manualmente</h3>
        </div>
        <div className="flex gap-3 items-center">
          <select
            value={insertMedicoId}
            onChange={e => setInsertMedicoId(e.target.value)}
            className="input flex-1 text-sm">
            <option value="">Seleziona turnista…</option>
            {medici.map(m => (
              <option key={m.id} value={m.id}>{m.nome}</option>
            ))}
          </select>
          <button
            onClick={() => insertMedico && setModalMedico(insertMedico)}
            disabled={!insertMedicoId}
            className="btn-primary py-2 px-4 text-sm gap-1.5 shrink-0">
            <Calendar size={14} /> Apri calendario
          </button>
        </div>
        <p className="text-xs text-stone-500 leading-relaxed">
          I giorni selezionati vengono salvati come <strong>richiesta</strong> (non ancora approvata) e
          appariranno in "Ferie da approvare" per conferma. Per approvare direttamente usa il pulsante
          nella sezione sopra.
        </p>
      </div>
    </div>
  )
}
