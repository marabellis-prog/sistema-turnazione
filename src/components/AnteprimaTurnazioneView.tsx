/**
 * AnteprimaTurnazioneView
 *
 * Vista di una bozza di turnazione (snapshot). Per ogni turnista DUE righe:
 *   - SOPRA: la NUOVA turnazione (colorata, editabile in admin). Sfondo
 *     ARANCIONE sui turni scambiati vs basale (click = mostra l'originario);
 *     ferie approvate in VERDE.
 *   - SOTTO: la VECCHIA turnazione continuata, tutta su sfondo GRIGIO e con
 *     etichetta "turno originario" sotto il nome. Bordo BLU sui turni diversi.
 *
 * La colonna da cui parte la nuova turnazione (stacco) e' evidenziata in ROSA.
 * L'header (mese + giorno) e' sticky: resta fisso sullo scroll verticale.
 * La tabella di ricerca NON viene mostrata.
 */

import { useMemo, Fragment } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { fetchAllRows } from '../lib/fetchAll'
import { nomeBreve } from '../lib/nomeTurnista'
import { isFestivo } from '../lib/holidays'
import { MESI_IT } from '../lib/algorithm'
import { soglieForDay } from '../lib/soglieImpostazioni'
import { LegendaCalendario, DRAG_MIME } from './LegendaCalendario'
import { placementBg } from '../lib/placementColors'
import type {
  Medico, Turno, ColonnaCal, SlotPlacement, TurnazioneAnteprima, Ferie, Configurazione,
} from '../types'

const CELL_COLORS: Record<string, { bg: string; fg: string }> = {
  M:  { bg: '#dde8d5', fg: '#2e4a28' }, P: { bg: '#d5e0e8', fg: '#253a4a' },
  L:  { bg: '#ece5d5', fg: '#4a3a1a' }, REP: { bg: '#e8d5d5', fg: '#5a2a2a' },
  EM: { bg: '#dbe4e8', fg: '#36495a' }, EP: { bg: '#dbe4e8', fg: '#36495a' }, EL: { bg: '#dbe4e8', fg: '#36495a' },
}
// #48: palette dei piazzamenti centralizzata in lib/placementColors.
const SUPPORTO_BG = '#d4d4d4'
const DAY_LETTERS = ['D', 'L', 'M', 'M', 'G', 'V', 'S']
const MONTH_END_BORDER = '2px solid #1a1a1a'

const FERIE_BG      = '#bbf7d0'   // verde ferie approvate
const DIVERSO_BLU   = 'inset 0 0 0 2px #2563eb'  // bordo blu: giorno con cambio
const OLD_ROW_BG    = '#ededeb'   // grigio riga vecchia
const CUTOVER_BG      = '#fce7f3' // rosa colonna di stacco (celle piane)
const CUTOVER_HEAD_BG = '#fbcfe8' // rosa header colonna di stacco
const CUTOVER_BORDER  = '3px solid #db2777'

const H_MONTH = 23   // altezza riga header MESE (px) → offset sticky riga giorni

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
  const half = (s: SlotPlacement) => placementBg(s) ?? SUPPORTO_BG
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

/** TC in grigio/nero (riga vecchia, sola lettura). */
function LabelVecchio({ tc }: { tc: string }) {
  if (!tc) return null
  return <span style={{ fontSize: tc.length > 1 ? 9 : 11, fontWeight: 700, color: '#44403c' }}>{tc}</span>
}

/** Cella di riepilogo "attuale/atteso" con barra di copertura.
 *  e===0 = nessuna soglia impostata → mostra solo il numero. */
function StatCell({ a, e }: { a: number; e: number }) {
  const color = e === 0 ? '#9ca3af' : a === e ? '#16a34a' : a < e ? '#dc2626' : '#d97706'
  const pct = e > 0 ? Math.min(100, Math.round((a / e) * 100)) : 0
  return (
    <div style={{ fontSize: 9, lineHeight: 1.1, padding: '1px' }}>
      <div style={{ fontWeight: 800, color }}>{e > 0 ? `${a}/${e}` : a}</div>
      {e > 0 && (
        <div style={{ height: 3, background: '#e5e7eb', borderRadius: 2, marginTop: 1 }}>
          <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 2 }} />
        </div>
      )}
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
  /** true = calendario lineare a tutta altezza (come "Calendario"), scorre
   *  dx/sx senza box con scrollbar. false = box con maxHeight (admin). */
  fullHeight?:         boolean
  /** Reparto DINAMICO: riga SINGOLA sola-lettura (niente riga "turno
   *  originario"); mostra il turno ATTUALE (coi cambi) e sui cambi dal cutover
   *  un bordo BLU + tooltip. Legenda dinamica. */
  dinamico?:           boolean
  tipiTurnoLeg?:       { sigla: string; nome: string; colore_bg: string; colore_fg: string; is_reperibilita: boolean }[]
  proprietaLeg?:       { sigla: string; nome: string; colore_bg: string }[]
  /** Atteso (fabbisogno) per giorno da schema_fabbisogno → footer copertura. */
  attesoDin?:          (data: string) => { sub: number; med: number; sup: number }
  /** Nodo riepilogo dinamico (RiepilogoTurni) reso sotto il calendario. */
  riepilogoNode?:      React.ReactNode
}

export function AnteprimaTurnazioneView({ turni, meta, medici, festivitaCustomSet, editable, onDropCell, fullHeight, dinamico, tipiTurnoLeg, proprietaLeg, attesoDin, riepilogoNode }: Props) {
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
    // Paginato anti-1000 (#43): ferie cross-reparto (poi filtrate per medico in ferieApproved).
    queryFn: () =>
      fetchAllRows<Pick<Ferie, 'medico_id' | 'data_inizio' | 'data_fine' | 'approvate'>>((from, to) =>
        supabase.from('ferie').select('medico_id, data_inizio, data_fine, approvate').order('id').range(from, to)),
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

  // Config (soglie) per il footer di riepilogo "attuale/atteso".
  const { data: config } = useQuery<Configurazione | null>({
    queryKey: ['configurazione'],
    queryFn: async () => {
      const { data, error } = await supabase.from('configurazione').select('*')
        .order('updated_at', { ascending: false }).limit(1).maybeSingle()
      if (error) throw error
      return data
    },
  })

  // Riepilogo per colonna: SUB/MED/Supporto attuali (esclude ferie) vs attesi
  // (soglie del giorno: feriale/sabato/festivo). Totale = somma dei tre.
  const colStats = useMemo(() => {
    const map = new Map<string, {
      total: number
      sub: { a: number; e: number }; med: { a: number; e: number }; sup: { a: number; e: number }
    }>()
    for (const c of colonne) {
      let subA = 0, medA = 0, supA = 0
      for (const m of mediciOrd) {
        if (inFerie(ferieApproved, m.id, c.data)) continue
        const t = byKey.get(`${m.id}|${c.data}`)
        if (!t) continue
        const tc = t.turno_clinico ?? ''
        const attivaM = tc === 'M' || tc === 'L' || tc === 'EM' || tc === 'EL'
        const attivaP = tc === 'P' || tc === 'L' || tc === 'EP' || tc === 'EL'
        const sm = t.slot_mattina ?? null, sp = t.slot_pomeriggio ?? null
        if (sm === 'SUB') subA++
        else if (sm === 'MED') medA++
        else if (attivaM) supA++
        if (sp === 'SUB') subA++
        else if (sp === 'MED') medA++
        else if (attivaP) supA++
      }
      let subE: number, medE: number, supE: number
      if (dinamico && attesoDin) {
        // Fabbisogno DINAMICO da schema_fabbisogno (schema attivo di quel giorno).
        const a = attesoDin(c.data); subE = a.sub; medE = a.med; supE = a.sup
      } else {
        const s = soglieForDay(config, c.data)
        const isFest = c.isDomenica || c.isFestivo
        const isSab = !isFest && new Date(c.data + 'T00:00:00').getDay() === 6
        const pick = (fer: number, sab: number, fes: number) => isFest ? fes : isSab ? sab : fer
        subE = pick(s.sub_mattina_feriale, s.sub_mattina_sabato, s.sub_mattina_festivo)
             + pick(s.sub_pomeriggio_feriale, s.sub_pomeriggio_sabato, s.sub_pomeriggio_festivo)
        medE = pick(s.med_mattina_feriale, s.med_mattina_sabato, s.med_mattina_festivo)
             + pick(s.med_pomeriggio_feriale, s.med_pomeriggio_sabato, s.med_pomeriggio_festivo)
        supE = pick(s.sup_mattina_feriale, s.sup_mattina_sabato, s.sup_mattina_festivo)
             + pick(s.sup_pomeriggio_feriale, s.sup_pomeriggio_sabato, s.sup_pomeriggio_festivo)
      }
      map.set(c.data, { total: subA + medA + supA, sub: { a: subA, e: subE }, med: { a: medA, e: medE }, sup: { a: supA, e: supE } })
    }
    return map
  }, [colonne, mediciOrd, byKey, ferieApproved, config, dinamico, attesoDin])

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

  const footLabelStyle: React.CSSProperties = {
    width: 150, minWidth: 150, position: 'sticky', left: 0, zIndex: 3, background: '#f1f5f9',
    fontSize: 10, fontWeight: 700, color: '#334155', padding: '2px 8px', border: '1px solid #cbd5e1', whiteSpace: 'nowrap',
  }
  const footCellStyle: React.CSSProperties = {
    width: 32, minWidth: 32, background: '#f8fafc', textAlign: 'center', verticalAlign: 'middle', padding: 0, border: '1px solid #d8d2c4',
  }
  const RIEP_ROWS = [
    ['SUB', '#fecaca', '#dc2626', 'sub'],
    ['MED', '#bae6fd', '#0284c7', 'med'],
    ['Supporto', '#d4d4d4', '#6b7280', 'sup'],
  ] as const

  if (colonne.length === 0 || mediciOrd.length === 0) {
    return <div className="text-xs text-stone-500 italic p-4">Anteprima vuota o nessun medico attivo.</div>
  }

  return (
    <div className={fullHeight ? 'flex flex-col h-full min-h-0 gap-3' : 'space-y-3'}>
      {/* Legenda: DINAMICA (turni/proprietà dello schema) anche in sola-lettura;
          classica trascinabile per l'editing (11N). */}
      {dinamico
        ? <div className="shrink-0"><LegendaCalendario variant="pubblica" tipiTurno={tipiTurnoLeg} proprieta={proprietaLeg} /></div>
        : editable && <div className="shrink-0"><LegendaCalendario variant="admin" /></div>}

      {/* Legenda colori */}
      <div className="text-[11px] text-stone-500 flex flex-wrap gap-x-4 gap-y-1 shrink-0">
        <span><span style={{ boxShadow: DIVERSO_BLU, padding: '0 6px', borderRadius: 3 }}>blu</span> = {dinamico ? 'turno cambiato (clicca per il dettaglio)' : 'giorno con cambio (riga "turno originario")'}</span>
        <span><span style={{ background: FERIE_BG, padding: '0 6px', borderRadius: 3 }}>verde</span> = ferie</span>
        <span><span style={{ background: CUTOVER_HEAD_BG, padding: '0 6px', borderRadius: 3 }}>rosa</span> = inizio nuova turnazione</span>
      </div>

      {/* Tabella clinica a doppia riga (header sticky) */}
      <div className={`overflow-auto rounded-lg border border-stone-300 bg-white${fullHeight ? ' flex-1 min-h-0' : ''}`}
        style={fullHeight ? undefined : { maxHeight: '64vh' }}>
        <table className="border-collapse" style={{ tableLayout: 'fixed', borderSpacing: 0 }}>
          <thead>
            <tr>
              <th rowSpan={2} style={{ width: 150, minWidth: 150, position: 'sticky', left: 0, top: 0, zIndex: 5,
                background: '#456b3a', color: '#fff', fontSize: 11, fontWeight: 700, padding: '6px 8px',
                border: '1px solid #2b3c24', textAlign: 'left', verticalAlign: 'middle' }}>
                Medico — Clinica
              </th>
              {monthSpans.map((m, i) => (
                <th key={`${m.anno}-${m.mese}`} colSpan={m.span} style={{ position: 'sticky', top: 0, zIndex: 4,
                  background: '#f0ece4', color: '#3a3d30', fontSize: 11, fontWeight: 700, padding: '4px 6px', height: H_MONTH,
                  border: '1px solid #c0b8a8', borderRight: i < monthSpans.length - 1 ? MONTH_END_BORDER : '1px solid #c0b8a8',
                  textAlign: 'center', textTransform: 'uppercase' }}>
                  {MESI_IT[m.mese] ?? '?'} {m.anno}
                </th>
              ))}
            </tr>
            <tr>
              {colonne.map(c => {
                const red = c.isDomenica || c.isFestivo
                const monthEnd = lastDaysOfMonth.has(c.data)
                const isCut = c.data === meta.cutover
                return (
                  <th key={c.data} style={{ width: 32, minWidth: 32, position: 'sticky', top: H_MONTH, zIndex: 4,
                    background: isCut ? CUTOVER_HEAD_BG : red ? '#fef3c7' : '#f0ece4',
                    color: red ? '#854d0e' : '#3a3d30', fontSize: 10, padding: '2px 0',
                    border: '1px solid #c0b8a8', borderLeft: isCut ? CUTOVER_BORDER : '1px solid #c0b8a8',
                    borderRight: monthEnd ? MONTH_END_BORDER : '1px solid #c0b8a8', lineHeight: 1.1 }}>
                    <div style={{ fontWeight: 700 }}>{c.giorno}</div>
                    <div style={{ fontSize: 8, fontWeight: 400, opacity: 0.75 }}>{dayLetter(c.data)}</div>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {mediciOrd.map(m => (
              <Fragment key={m.id}>
                {/* Riga NUOVA (editabile) */}
                <tr>
                  <td style={{ width: 150, minWidth: 150, position: 'sticky', left: 0, zIndex: 3, background: '#fff',
                    fontSize: 11, padding: '4px 8px', borderTop: '1px solid #d5ccb8', borderLeft: '1px solid #d5ccb8',
                    borderRight: '1px solid #d5ccb8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    fontWeight: 600, color: '#3a3d30' }}>
                    {nomeBreve(m.cognome, m.nome_proprio, m.nome)}
                  </td>
                  {colonne.map(c => {
                    const t = byKey.get(`${m.id}|${c.data}`)
                    const red = c.isDomenica || c.isFestivo
                    const monthEnd = lastDaysOfMonth.has(c.data)
                    const isCut = c.data === meta.cutover
                    const ferie = inFerie(ferieApproved, m.id, c.data)
                    const bg = ferie ? FERIE_BG : isCut ? CUTOVER_BG : red ? '#fef3c7' : '#fefefe'
                    // Dinamico: mostra il turno ATTUALE (coi cambi); bordo blu +
                    // tooltip sui cambi (turno ≠ base) dal cutover. Classico: la
                    // rotazione pulita (turno_clinico_base), niente bordo qui.
                    const cambio = !!dinamico && !!t
                      && (t.turno_clinico ?? '') !== (t.turno_clinico_base ?? '') && c.data >= meta.cutover
                    const tcShow = (dinamico
                      ? (t?.turno_clinico ?? '')
                      : (t?.turno_clinico_base ?? t?.turno_clinico ?? '')) as string
                    return (
                      <td key={c.data}
                        {...dropHandlers(m.id, c.data)}
                        title={cambio ? `turno cambiato in ${t?.turno_clinico || '—'} (era ${t?.turno_clinico_base || '—'})` : undefined}
                        style={{ width: 32, minWidth: 32, height: 26, background: bg,
                          borderTop: '1px solid #c0b8a8',
                          borderBottom: dinamico ? '1px solid #c0b8a8' : '1px dashed #cfc8ba',
                          borderRight: monthEnd ? MONTH_END_BORDER : '1px solid #c0b8a8',
                          borderLeft: isCut ? CUTOVER_BORDER : '1px solid #c0b8a8',
                          boxShadow: cambio ? DIVERSO_BLU : undefined,
                          textAlign: 'center', verticalAlign: 'middle', padding: 0,
                          cursor: editable && !dinamico ? 'copy' : undefined }}>
                        <LabelClinico tc={tcShow} sm={t?.slot_mattina} sp={t?.slot_pomeriggio} />
                      </td>
                    )
                  })}
                </tr>
                {/* Riga VECCHIA (grigia) — SOLO classico (11N); i dinamici hanno
                    una riga sola coi cambi già bordati di blu. */}
                {!dinamico && (
                <tr>
                  <td style={{ width: 150, minWidth: 150, position: 'sticky', left: 0, zIndex: 3, background: OLD_ROW_BG,
                    fontSize: 9, fontStyle: 'italic', padding: '1px 8px 3px', borderBottom: '1px solid #d5ccb8',
                    borderLeft: '1px solid #d5ccb8', borderRight: '1px solid #d5ccb8',
                    whiteSpace: 'nowrap', color: '#78716c' }}>
                    turno originario
                  </td>
                  {colonne.map(c => {
                    const t = byKey.get(`${m.id}|${c.data}`)
                    const vecchio = t?.turno_clinico_vecchio ?? ''
                    const monthEnd = lastDaysOfMonth.has(c.data)
                    const isCut = c.data === meta.cutover
                    // Cambio = la cella ha uno scambio rispetto alla rotazione
                    // pulita (turno_clinico != turno_clinico_base): bordo blu.
                    const cambio = !!t && (t.turno_clinico ?? '') !== (t.turno_clinico_base ?? '')
                    return (
                      <td key={c.data} style={{ width: 32, minWidth: 32, height: 20, background: OLD_ROW_BG,
                        borderBottom: '1px solid #cfc8ba',
                        borderRight: monthEnd ? MONTH_END_BORDER : '1px solid #d8d2c4',
                        borderLeft: isCut ? CUTOVER_BORDER : '1px solid #d8d2c4',
                        boxShadow: cambio ? DIVERSO_BLU : undefined,
                        textAlign: 'center', verticalAlign: 'middle', padding: 0 }}>
                        <LabelVecchio tc={vecchio} />
                      </td>
                    )
                  })}
                </tr>
                )}
              </Fragment>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td style={{ ...footLabelStyle, background: '#e2e8f0', borderTop: '2px solid #94a3b8' }}>Totale turni</td>
              {colonne.map(c => {
                const st = colStats.get(c.data)
                const isCut = c.data === meta.cutover
                const monthEnd = lastDaysOfMonth.has(c.data)
                return (
                  <td key={c.data} style={{ ...footCellStyle, background: '#eef2f7', borderTop: '2px solid #94a3b8',
                    borderLeft: isCut ? CUTOVER_BORDER : '1px solid #d8d2c4',
                    borderRight: monthEnd ? MONTH_END_BORDER : '1px solid #d8d2c4',
                    fontWeight: 800, fontSize: 11, color: '#1f2937' }}>
                    {st?.total ?? 0}
                  </td>
                )
              })}
            </tr>
            {RIEP_ROWS.map(([label, dot, dotBorder, key]) => (
              <tr key={label}>
                <td style={footLabelStyle}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ width: 9, height: 9, borderRadius: '50%', background: dot, border: `1px solid ${dotBorder}`, display: 'inline-block' }} />
                    {label}
                  </span>
                </td>
                {colonne.map(c => {
                  const st = colStats.get(c.data)
                  const v = st ? st[key] : { a: 0, e: 0 }
                  const isCut = c.data === meta.cutover
                  const monthEnd = lastDaysOfMonth.has(c.data)
                  return (
                    <td key={c.data} style={{ ...footCellStyle,
                      borderLeft: isCut ? CUTOVER_BORDER : '1px solid #d8d2c4',
                      borderRight: monthEnd ? MONTH_END_BORDER : '1px solid #d8d2c4' }}>
                      <StatCell a={v.a} e={v.e} />
                    </td>
                  )
                })}
              </tr>
            ))}
          </tfoot>
        </table>
      </div>

      {/* Riepilogo DINAMICO (righe = turnisti) sotto il calendario. */}
      {dinamico && riepilogoNode && <div className="shrink-0">{riepilogoNode}</div>}
    </div>
  )
}
