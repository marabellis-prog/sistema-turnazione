/**
 * AnteprimaTurnazioneView
 *
 * Vista di una bozza di turnazione (snapshot). Per ogni turnista mostra DUE
 * righe nella tabella clinica:
 *   - SOPRA: la NUOVA turnazione (colorata, editabile in admin). Sfondo
 *     ARANCIONE sui turni scambiati rispetto al basale (turno_clinico !=
 *     turno_clinico_base); ferie approvate in VERDE.
 *   - SOTTO: la VECCHIA turnazione continuata (bianco/nero, sola lettura).
 *     Bordo BLU solo sui turni DIVERSI rispetto alla riga sopra.
 *
 * In modalita' editabile (admin) le celle della riga superiore accettano il
 * drop dalla legenda (TC / TR / FLAG SUB-MED), aggiornando lo snapshot in
 * stato locale; il salvataggio e' gestito dalla pagina (bottone "Salva").
 */

import { useMemo, Fragment } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { isFestivo } from '../lib/holidays'
import { MESI_IT } from '../lib/algorithm'
import { LegendaCalendario, DRAG_MIME } from './LegendaCalendario'
import type {
  Medico, Turno, ColonnaCal, SlotPlacement, TurnazioneAnteprima, Ferie,
} from '../types'

const CELL_COLORS: Record<string, { bg: string; fg: string }> = {
  M:  { bg: '#dde8d5', fg: '#2e4a28' }, P: { bg: '#d5e0e8', fg: '#253a4a' },
  L:  { bg: '#ece5d5', fg: '#4a3a1a' }, REP: { bg: '#e8d5d5', fg: '#5a2a2a' },
  EM: { bg: '#dbe4e8', fg: '#36495a' }, EP: { bg: '#dbe4e8', fg: '#36495a' }, EL: { bg: '#dbe4e8', fg: '#36495a' },
  RM: { bg: '#ddd8ea', fg: '#3a2858' }, RP: { bg: '#ead8e2', fg: '#582840' },
}
const PLACEMENT_BG: Record<'SUB'|'MED'|'NONE', string> = { SUB: '#fecaca', MED: '#bae6fd', NONE: 'transparent' }
const SUPPORTO_BG = '#d4d4d4'
const DAY_LETTERS = ['D', 'L', 'M', 'M', 'G', 'V', 'S']
const MONTH_END_BORDER = '2px solid #1a1a1a'

const FERIE_BG     = '#bbf7d0'   // verde ferie approvate
const SCAMBIO_BG   = '#fed7aa'   // arancione: turno scambiato vs basale
const DIVERSO_BLU  = 'inset 0 0 0 2px #2563eb'  // bordo blu: diverso vs vecchia

function dayLetter(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return DAY_LETTERS[new Date(y, m - 1, d).getDay()]
}

/** Cerchio TC colorato (riga nuova). */
function LabelClinico({ tc, sm, sp }: { tc: string; sm?: SlotPlacement; sp?: SlotPlacement }) {
  if (!tc) return null
  const isTwoChar = tc === 'REP' || tc === 'EM' || tc === 'EP' || tc === 'EL'
  const fontSize = isTwoChar ? 10 : 12
  const color    = tc === 'REP' ? '#b91c1c' : (CELL_COLORS[tc]?.fg ?? '#3a3d30')
  const half = (s: SlotPlacement) => (s ? PLACEMENT_BG[s] : SUPPORTO_BG)
  let bg: string | undefined
  if (tc === 'M' || tc === 'EM') bg = half(sm ?? null)
  else if (tc === 'P' || tc === 'EP') bg = half(sp ?? null)
  else if (tc === 'L' || tc === 'EL') {
    const a = half(sm ?? null), b = half(sp ?? null)
    bg = a === b ? a : `linear-gradient(90deg, ${a} 0%, ${a} 50%, ${b} 50%, ${b} 100%)`
  }
  if (!bg) return <span style={{ fontSize, fontWeight: 700, color, letterSpacing: tc === 'REP' ? '-0.3px' : undefined }}>{tc}</span>
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: 22, height: 22, borderRadius: '50%', background: bg,
      fontSize, fontWeight: 800, color, letterSpacing: tc === 'REP' ? '-0.3px' : undefined, lineHeight: 1,
    }}>{tc}</span>
  )
}

/** TC in bianco/nero (riga vecchia, sola lettura). */
function LabelVecchio({ tc }: { tc: string }) {
  if (!tc) return null
  const isTwoChar = tc.length > 1
  return <span style={{ fontSize: isTwoChar ? 9 : 11, fontWeight: 700, color: '#44403c' }}>{tc}</span>
}

function LabelRicerca({ tr }: { tr: string }) {
  if (!tr) return null
  return (
    <div className="flex flex-col items-center leading-none gap-px">
      {tr.split('+').map(p => (
        <span key={p} style={{ fontSize: 9, fontWeight: 700, color: CELL_COLORS[p]?.fg ?? '#3a2858' }}>{p}</span>
      ))}
    </div>
  )
}

function buildColonne(turni: Turno[], festSet?: Set<string>): ColonnaCal[] {
  if (turni.length === 0) return []
  const dates = [...new Set(turni.map(t => t.data))].sort()
  const pad = (n: number) => String(n).padStart(2, '0')
  const cur = new Date(dates[0] + 'T00:00:00')
  const last = new Date(dates[dates.length - 1] + 'T00:00:00')
  const out: ColonnaCal[] = []
  while (cur <= last) {
    const iso = `${cur.getFullYear()}-${pad(cur.getMonth() + 1)}-${pad(cur.getDate())}`
    out.push({ data: iso, giorno: cur.getDate(), mese: cur.getMonth() + 1, anno: cur.getFullYear(),
      isDomenica: cur.getDay() === 0, isFestivo: isFestivo(cur, festSet) })
    cur.setDate(cur.getDate() + 1)
  }
  return out
}

function monthSpansFrom(colonne: ColonnaCal[]) {
  const out: Array<{ anno: number; mese: number; span: number }> = []
  let cm = -1, ca = -1, cs = 0
  for (const c of colonne) {
    if (c.anno !== ca || c.mese !== cm) { if (cs > 0) out.push({ anno: ca, mese: cm, span: cs }); ca = c.anno; cm = c.mese; cs = 1 }
    else cs++
  }
  if (cs > 0) out.push({ anno: ca, mese: cm, span: cs })
  return out
}

/** true se `data` cade in un range di ferie approvate del medico. */
function inFerie(ranges: Map<string, [string, string][]>, medicoId: string, data: string): boolean {
  const rs = ranges.get(medicoId)
  if (!rs) return false
  for (const [a, b] of rs) if (data >= a && data <= b) return true
  return false
}

interface Props {
  turni:               Turno[]
  meta:                TurnazioneAnteprima['meta']
  medici:              Medico[]
  festivitaCustomSet?: Set<string>
  editable?:           boolean
  onDropCell?:         (medicoId: string, data: string, payload: string) => void
}

export function AnteprimaTurnazioneView({ turni, meta, medici, festivitaCustomSet, editable, onDropCell }: Props) {
  const byKey = useMemo(() => {
    const m = new Map<string, Turno>()
    for (const t of turni) m.set(`${t.medico_id}|${t.data}`, t)
    return m
  }, [turni])

  const colonne   = useMemo(() => buildColonne(turni, festivitaCustomSet), [turni, festivitaCustomSet])
  const mediciOrd = useMemo(() => [...medici].filter(m => m.attivo).sort((a, b) => a.numero_ordine - b.numero_ordine), [medici])
  const monthSpans = useMemo(() => monthSpansFrom(colonne), [colonne])
  const lastDaysOfMonth = useMemo(() => {
    const s = new Set<string>()
    for (let i = 0; i < colonne.length - 1; i++) if (colonne[i + 1].mese !== colonne[i].mese || colonne[i + 1].anno !== colonne[i].anno) s.add(colonne[i].data)
    return s
  }, [colonne])

  // Ferie APPROVATE → verde.
  const { data: ferieDB = [] } = useQuery<Pick<Ferie, 'medico_id' | 'data_inizio' | 'data_fine' | 'approvate'>[]>({
    queryKey: ['ferie-ranges'],
    queryFn: async () => {
      const { data, error } = await supabase.from('ferie').select('medico_id, data_inizio, data_fine, approvate')
      if (error) throw error
      return data ?? []
    },
    staleTime: 0, refetchInterval: 15_000,
  })
  const ferieApproved = useMemo(() => {
    const map = new Map<string, [string, string][]>()
    for (const f of ferieDB) {
      if (!f.approvate) continue
      if (!map.has(f.medico_id)) map.set(f.medico_id, [])
      map.get(f.medico_id)!.push([f.data_inizio, f.data_fine])
    }
    return map
  }, [ferieDB])

  const cutoverLabel = (() => {
    const [y, m, d] = meta.cutover.split('-').map(Number)
    return `${d} ${MESI_IT[m]} ${y}`
  })()

  const dropHandlers = (medicoId: string, data: string) => editable && onDropCell ? {
    onDragOver: (e: React.DragEvent) => {
      const ts = Array.from(e.dataTransfer.types)
      if (ts.includes(DRAG_MIME) || ts.includes('text/plain')) e.preventDefault()
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault()
      const payload = e.dataTransfer.getData(DRAG_MIME) || e.dataTransfer.getData('text/plain')
      if (payload) onDropCell(medicoId, data, payload)
    },
  } : {}

  if (colonne.length === 0 || mediciOrd.length === 0) {
    return <div className="text-xs text-stone-500 italic p-4">Anteprima vuota o nessun medico attivo.</div>
  }

  const dayHeader = (
    <thead>
      <tr>
        <th rowSpan={2} style={{ width: 140, minWidth: 140, position: 'sticky', left: 0, zIndex: 2,
          background: '#456b3a', color: '#fff', fontSize: 11, fontWeight: 700, padding: '6px 8px',
          border: '1px solid #2b3c24', textAlign: 'left', verticalAlign: 'middle' }}>
          Medico — Clinica
        </th>
        {monthSpans.map((m, i) => (
          <th key={`${m.anno}-${m.mese}`} colSpan={m.span} style={{ background: '#f0ece4', color: '#3a3d30',
            fontSize: 11, fontWeight: 700, padding: '4px 6px', border: '1px solid #c0b8a8',
            borderRight: i < monthSpans.length - 1 ? MONTH_END_BORDER : '1px solid #c0b8a8',
            textAlign: 'center', textTransform: 'uppercase' }}>
            {MESI_IT[m.mese] ?? '?'} {m.anno}
          </th>
        ))}
      </tr>
      <tr>
        {colonne.map(c => {
          const red = c.isDomenica || c.isFestivo
          const monthEnd = lastDaysOfMonth.has(c.data)
          return (
            <th key={c.data} style={{ width: 32, minWidth: 32, background: red ? '#fef3c7' : '#f0ece4',
              color: red ? '#854d0e' : '#3a3d30', fontSize: 10, padding: '2px 0', border: '1px solid #c0b8a8',
              borderRight: monthEnd ? MONTH_END_BORDER : '1px solid #c0b8a8', lineHeight: 1.1 }}>
              <div style={{ fontWeight: 700 }}>{c.giorno}</div>
              <div style={{ fontSize: 8, fontWeight: 400, opacity: 0.75 }}>{dayLetter(c.data)}</div>
            </th>
          )
        })}
      </tr>
    </thead>
  )

  return (
    <div className="space-y-3">
      {/* Metadati */}
      <div className="rounded-lg border p-3 text-xs flex flex-wrap gap-x-5 gap-y-1"
        style={{ background: '#f0f7fb', borderColor: '#bfdde8', color: '#1f4a70' }}>
        <span><strong>Schema nuovo:</strong> {meta.schema_nuovo}</span>
        <span><strong>Stacco:</strong> {cutoverLabel} (primo lunedì)</span>
        <span><strong>Fino a:</strong> {MESI_IT[meta.mese_fine]} {meta.anno_fine}</span>
        <span><strong>Cambi:</strong> {meta.n_cambi}</span>
      </div>

      {/* Legenda trascinabile (solo admin/editabile) */}
      {editable && <LegendaCalendario variant="admin" />}

      {/* Legenda colori righe */}
      <div className="text-[11px] text-stone-500 flex flex-wrap gap-x-4 gap-y-1">
        <span><span style={{ background: SCAMBIO_BG, padding: '0 6px', borderRadius: 3 }}>arancione</span> = turno scambiato (riga nuova)</span>
        <span><span style={{ boxShadow: DIVERSO_BLU, padding: '0 6px', borderRadius: 3 }}>blu</span> = diverso dalla vecchia (riga sotto, B/N)</span>
        <span><span style={{ background: FERIE_BG, padding: '0 6px', borderRadius: 3 }}>verde</span> = ferie approvate</span>
      </div>

      {/* Tabella clinica a doppia riga + ricerca */}
      <div className="overflow-auto rounded-lg border border-stone-300 bg-white" style={{ maxHeight: '64vh' }}>
        <table className="border-collapse" style={{ tableLayout: 'fixed', borderSpacing: 0 }}>
          {dayHeader}
          <tbody>
            {mediciOrd.map(m => (
              <Fragment key={m.id}>
                {/* Riga NUOVA (editabile) */}
                <tr>
                  <td rowSpan={2} style={{ width: 140, minWidth: 140, position: 'sticky', left: 0, zIndex: 1,
                    background: '#fff', fontSize: 11, padding: '4px 8px', border: '1px solid #d5ccb8',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 500, color: '#3a3d30' }}>
                    {m.nome}
                  </td>
                  {colonne.map(c => {
                    const t = byKey.get(`${m.id}|${c.data}`)
                    const tc = t?.turno_clinico ?? ''
                    const red = c.isDomenica || c.isFestivo
                    const monthEnd = lastDaysOfMonth.has(c.data)
                    const ferie = inFerie(ferieApproved, m.id, c.data)
                    const scambio = !!t && (t.turno_clinico ?? '') !== (t.turno_clinico_base ?? '')
                    const bg = ferie ? FERIE_BG : scambio ? SCAMBIO_BG : red ? '#fef3c7' : '#fefefe'
                    return (
                      <td key={c.data} {...dropHandlers(m.id, c.data)} style={{ width: 32, minWidth: 32, height: 26,
                        background: bg, border: '1px solid #c0b8a8',
                        borderRight: monthEnd ? MONTH_END_BORDER : '1px solid #c0b8a8',
                        borderBottom: '1px dashed #d8d2c4',
                        textAlign: 'center', verticalAlign: 'middle', padding: 0,
                        cursor: editable ? 'copy' : undefined }}>
                        <LabelClinico tc={tc} sm={t?.slot_mattina} sp={t?.slot_pomeriggio} />
                      </td>
                    )
                  })}
                </tr>
                {/* Riga VECCHIA (B/N, sola lettura) */}
                <tr>
                  {colonne.map(c => {
                    const t = byKey.get(`${m.id}|${c.data}`)
                    const vecchio = t?.turno_clinico_vecchio ?? ''
                    const nuovo = t?.turno_clinico ?? ''
                    const red = c.isDomenica || c.isFestivo
                    const monthEnd = lastDaysOfMonth.has(c.data)
                    const diverso = (vecchio ?? '') !== (nuovo ?? '')
                    return (
                      <td key={c.data} style={{ width: 32, minWidth: 32, height: 22,
                        background: red ? '#faf7ef' : '#fff', border: '1px solid #d8d2c4',
                        borderRight: monthEnd ? MONTH_END_BORDER : '1px solid #d8d2c4',
                        boxShadow: diverso ? DIVERSO_BLU : undefined,
                        textAlign: 'center', verticalAlign: 'middle', padding: 0 }}>
                        <LabelVecchio tc={vecchio} />
                      </td>
                    )
                  })}
                </tr>
              </Fragment>
            ))}
          </tbody>
        </table>

        {/* Tabella ricerca (sola lettura) */}
        <div style={{ height: 4 }} />
        <table className="border-collapse" style={{ tableLayout: 'fixed', borderSpacing: 0 }}>
          <thead>
            <tr>
              <th style={{ width: 140, minWidth: 140, position: 'sticky', left: 0, zIndex: 2, background: '#7a2233',
                color: '#fff', fontSize: 11, fontWeight: 700, padding: '6px 8px', border: '1px solid #5a1a26', textAlign: 'left' }}>
                Medico — Ricerca
              </th>
              {colonne.map(c => {
                const red = c.isDomenica || c.isFestivo
                const monthEnd = lastDaysOfMonth.has(c.data)
                return (
                  <th key={c.data} style={{ width: 32, minWidth: 32, background: red ? '#fef3c7' : '#f0ece4',
                    color: red ? '#854d0e' : '#3a3d30', fontSize: 10, padding: '2px 0', border: '1px solid #c0b8a8',
                    borderRight: monthEnd ? MONTH_END_BORDER : '1px solid #c0b8a8', lineHeight: 1.1 }}>
                    <div style={{ fontWeight: 700 }}>{c.giorno}</div>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {mediciOrd.map(m => (
              <tr key={`${m.id}-r`}>
                <td style={{ width: 140, minWidth: 140, position: 'sticky', left: 0, zIndex: 1, background: '#fff',
                  fontSize: 11, padding: '4px 8px', border: '1px solid #d5ccb8', whiteSpace: 'nowrap',
                  overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 500, color: '#3a3d30' }}>{m.nome}</td>
                {colonne.map(c => {
                  const t = byKey.get(`${m.id}|${c.data}`)
                  const tr = t?.turno_ricerca ?? ''
                  const red = c.isDomenica || c.isFestivo
                  const monthEnd = lastDaysOfMonth.has(c.data)
                  const first = tr.split('+')[0]
                  const bg = CELL_COLORS[first]?.bg ?? (red ? '#fef3c7' : '#fefefe')
                  return (
                    <td key={c.data} style={{ width: 32, minWidth: 32, height: 26, background: tr ? bg : (red ? '#fef3c7' : '#fefefe'),
                      border: '1px solid #c0b8a8', borderRight: monthEnd ? MONTH_END_BORDER : '1px solid #c0b8a8',
                      textAlign: 'center', verticalAlign: 'middle', padding: 0 }}>
                      <LabelRicerca tr={tr} />
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
