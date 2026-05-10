/**
 * SettimanaleAltPage — vista settimanale/mensile alternativa "tabellone"
 *
 * Per ogni giorno produce N righe in tabella:
 *  - una riga per ogni LUNGO (TC=L) → cella unica che spanna le colonne
 *    Mattina+Pomeriggio (colspan=2)
 *  - poi una riga per ogni coppia di BREVI: medico M nella colonna
 *    Mattina, medico P nella colonna Pomeriggio (accoppiati per indice
 *    a numero_ordine ascendente)
 *
 * Le colonne Data, Giorno, RM Mattina, RM Pomeriggio, Reperibile sono
 * rowspan sull'intera altezza del giorno.
 *
 * Source dati: tabella `turni` del DB (no rotazione teorica), realtime
 * via useTurniRealtime + useFerieRealtime + polling 15s. Navigazione
 * limitata al periodo configurato del calendario. Accessibile a tutti
 * i loggati, ospiti inclusi.
 */

import { useState, useMemo, useEffect, Fragment } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, CalendarDays, Info } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { getDayOfWeek, formatDate, MESI_IT } from '../lib/algorithm'
import { useTurniRealtime } from '../hooks/useTurniRealtime'
import { useFerieRealtime } from '../hooks/useFerieRealtime'
import type { Configurazione, Medico, Turno, Ferie, SlotPlacement } from '../types'

const GIORNI_FULL = ['', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica']
const MESI_ABBR  = ['', 'Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic']
const GIORNO_BG  = ['#f0f4ee', '#ecf3e0', '#fef3c7', '#fee0c0', '#e8e0f5', '#f0f0f0', '#fde0e0']

const FERIE_STRIPE  = 'repeating-linear-gradient(45deg, #ffffff 0, #ffffff 7px, #fed7aa 7px, #fed7aa 14px)'
const FERIE_TOOLTIP = 'Turno non ancora coperto per turnista in ferie'

function startOfWeek(d: Date): Date {
  const r = new Date(d); r.setHours(0, 0, 0, 0)
  const dow = (r.getDay() + 6) % 7
  r.setDate(r.getDate() - dow); return r
}
function addDays(d: Date, n: number): Date {
  const r = new Date(d); r.setDate(r.getDate() + n); return r
}
function firstOfMonth(d: Date): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), 1); r.setHours(0, 0, 0, 0); return r
}
function fmtDataLunga(d: Date): string {
  const giorno = GIORNI_FULL[getDayOfWeek(d)]
  const dd     = String(d.getDate()).padStart(2, '0')
  const mon    = MESI_ABBR[d.getMonth() + 1]
  const yy     = String(d.getFullYear()).slice(2)
  return `${giorno} ${dd}-${mon}-${yy}`
}

type Vista = 'settimana' | 'mese'

function normalizeAnchor(d: Date, vista: Vista): Date {
  return vista === 'settimana' ? startOfWeek(d) : firstOfMonth(d)
}
function computeGiorni(anchor: Date, vista: Vista): Date[] {
  if (vista === 'settimana') return Array.from({ length: 7 }, (_, i) => addDays(anchor, i))
  const year = anchor.getFullYear(), month = anchor.getMonth()
  const lastDay = new Date(year, month + 1, 0).getDate()
  return Array.from({ length: lastDay }, (_, i) => {
    const r = new Date(year, month, i + 1); r.setHours(0, 0, 0, 0); return r
  })
}
function shiftAnchor(anchor: Date, vista: Vista, dir: 1 | -1): Date {
  if (vista === 'settimana') return addDays(anchor, 7 * dir)
  return firstOfMonth(new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1))
}

interface LungoEntry {
  medico:          Medico
  slot_mattina:    SlotPlacement
  slot_pomeriggio: SlotPlacement
  inFerie:         boolean
}
interface BreveEntry {
  medico:    Medico
  /** slot_mattina per i breve-mattina · slot_pomeriggio per i breve-pomeriggio */
  placement: SlotPlacement
  inFerie:   boolean
}
interface RicercaEntry {
  medico:    Medico
  /** TC del medico — se 'L' marca la presenza di un turno lungo. */
  tcMain:    string
  placement: SlotPlacement
  inFerie:   boolean
}
interface DayDisplay {
  data:    Date
  dataISO: string
  inPeriod: boolean
  /** Lunghi ordinati per numero_ordine — appaiono per primi nel tabellone. */
  lunghi:  LungoEntry[]
  /** Brevi solo mattina (TC=M), per numero_ordine. */
  breviM:  BreveEntry[]
  /** Brevi solo pomeriggio (TC=P), per numero_ordine. */
  breviP:  BreveEntry[]
  ricercaMattina:    RicercaEntry[]
  ricercaPomeriggio: RicercaEntry[]
  reperibile:        { medico: Medico; inFerie: boolean } | null
  emptyByDesign:     boolean
}

export function SettimanaleAltPage() {
  const [vista, setVista] = useState<Vista>('settimana')
  const [anchorWeek, setAnchorWeek] = useState<Date>(() => startOfWeek(new Date()))
  const [mostraLegenda, setMostraLegenda] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 640px)').matches,
  )

  useTurniRealtime()
  useFerieRealtime()

  const { data: config } = useQuery<Configurazione | null>({
    queryKey: ['configurazione'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('configurazione').select('*')
        .order('updated_at', { ascending: false }).limit(1).maybeSingle()
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
      return data ?? []
    },
  })

  const periodo = useMemo(() => {
    if (!config) return null
    const min = new Date(config.anno_inizio, config.mese_inizio - 1, 1)
    const max = new Date(config.anno_fine,   config.mese_fine,        0)
    min.setHours(0, 0, 0, 0); max.setHours(23, 59, 59, 999)
    return { min, max }
  }, [config])

  useEffect(() => {
    if (!periodo) return
    if (anchorWeek < periodo.min)      setAnchorWeek(normalizeAnchor(periodo.min, vista))
    else if (anchorWeek > periodo.max) setAnchorWeek(normalizeAnchor(periodo.max, vista))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodo])

  function changeVista(newVista: Vista) {
    setVista(newVista)
    setAnchorWeek(prev => {
      let n = normalizeAnchor(prev, newVista)
      if (periodo) {
        if (n < periodo.min) n = normalizeAnchor(periodo.min, newVista)
        else if (n > periodo.max) n = normalizeAnchor(periodo.max, newVista)
      }
      return n
    })
  }

  const giorni = useMemo(() => computeGiorni(anchorWeek, vista), [anchorWeek, vista])

  const periodoView = useMemo(() => {
    if (giorni.length === 0) return null
    return { di: formatDate(giorni[0]), df: formatDate(giorni[giorni.length - 1]) }
  }, [giorni])

  const { data: turni = [] } = useQuery<Turno[]>({
    queryKey: ['turni', 'settimanale-alt', periodoView?.di, periodoView?.df],
    queryFn: async () => {
      if (!periodoView) return []
      const { data, error } = await supabase
        .from('turni').select('*')
        .gte('data', periodoView.di).lte('data', periodoView.df)
      if (error) throw error
      return data ?? []
    },
    enabled: !!periodoView,
    staleTime: 0, refetchOnMount: 'always',
    refetchInterval: 15_000, refetchIntervalInBackground: false,
  })

  const { data: ferieDB = [] } = useQuery<Pick<Ferie, 'medico_id' | 'data_inizio' | 'data_fine' | 'approvate'>[]>({
    queryKey: ['ferie-ranges'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ferie').select('medico_id, data_inizio, data_fine, approvate')
      if (error) throw error
      return data ?? []
    },
    staleTime: 0, refetchOnMount: 'always',
    refetchInterval: 15_000, refetchIntervalInBackground: false,
  })

  const turniByKey = useMemo(() => {
    const m = new Map<string, Turno>()
    for (const t of turni) m.set(`${t.medico_id}|${t.data}`, t)
    return m
  }, [turni])

  const ferieRanges = useMemo(() => {
    const m = new Map<string, [string, string][]>()
    for (const f of ferieDB) {
      if (!f.approvate) continue
      if (!m.has(f.medico_id)) m.set(f.medico_id, [])
      m.get(f.medico_id)!.push([f.data_inizio, f.data_fine])
    }
    return m
  }, [ferieDB])

  function isInFerie(medicoId: string, dataISO: string): boolean {
    const ranges = ferieRanges.get(medicoId)
    if (!ranges) return false
    return ranges.some(([di, df]) => dataISO >= di && dataISO <= df)
  }

  function nomeBreve(m: Medico): string {
    return m.nome.split(' ').slice(-1)[0].toUpperCase()
  }

  // ── Build display per giorno ──────────────────────────────────────
  const giorniDisplay = useMemo<DayDisplay[]>(() => {
    if (!periodo) return []
    return giorni.map(data => {
      const dataISO  = formatDate(data)
      const inPeriod = data >= periodo.min && data <= periodo.max

      const lunghi:            LungoEntry[]   = []
      const breviM:            BreveEntry[]   = []
      const breviP:            BreveEntry[]   = []
      const ricercaMattina:    RicercaEntry[] = []
      const ricercaPomeriggio: RicercaEntry[] = []
      let reperibile: DayDisplay['reperibile'] = null

      if (inPeriod) {
        // medici è già ordinato per numero_ordine — push in ordine.
        for (const medico of medici) {
          const t = turniByKey.get(`${medico.id}|${dataISO}`)
          if (!t) continue
          const tc = t.turno_clinico ?? ''
          const tr = t.turno_ricerca ?? ''
          const sm = t.slot_mattina    ?? null
          const sp = t.slot_pomeriggio ?? null
          const inFerie = !!t.is_ferie || isInFerie(medico.id, dataISO)

          if      (tc === 'L')   lunghi.push({ medico, slot_mattina: sm, slot_pomeriggio: sp, inFerie })
          else if (tc === 'M')   breviM.push({ medico, placement: sm, inFerie })
          else if (tc === 'P')   breviP.push({ medico, placement: sp, inFerie })
          else if (tc === 'REP') reperibile = { medico, inFerie }

          if (tr.includes('RM')) ricercaMattina.push(   { medico, tcMain: tc, placement: sm, inFerie })
          if (tr.includes('RP')) ricercaPomeriggio.push({ medico, tcMain: tc, placement: sp, inFerie })
        }
      }

      const emptyByDesign = inPeriod &&
        lunghi.length === 0 && breviM.length === 0 && breviP.length === 0 &&
        ricercaMattina.length === 0 && ricercaPomeriggio.length === 0 &&
        !reperibile

      return {
        data, dataISO, inPeriod,
        lunghi, breviM, breviP, ricercaMattina, ricercaPomeriggio, reperibile,
        emptyByDesign,
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [giorni, medici, turniByKey, ferieRanges, periodo])

  // ── Navigation ────────────────────────────────────────────────────
  const canGoPrev = useMemo(() => {
    if (!periodo) return false
    const newAnchor = shiftAnchor(anchorWeek, vista, -1)
    const ng = computeGiorni(newAnchor, vista)
    if (ng.length === 0) return false
    return ng[ng.length - 1] >= periodo.min && ng[0] <= periodo.max
  }, [anchorWeek, vista, periodo])
  const canGoNext = useMemo(() => {
    if (!periodo) return false
    const newAnchor = shiftAnchor(anchorWeek, vista, +1)
    const ng = computeGiorni(newAnchor, vista)
    if (ng.length === 0) return false
    return ng[ng.length - 1] >= periodo.min && ng[0] <= periodo.max
  }, [anchorWeek, vista, periodo])
  const todayInRange = useMemo(() => {
    if (!periodo) return false
    const t = new Date(); t.setHours(0, 0, 0, 0)
    return t >= periodo.min && t <= periodo.max
  }, [periodo])
  const goPrev = () => { if (canGoPrev) setAnchorWeek(shiftAnchor(anchorWeek, vista, -1)) }
  const goNext = () => { if (canGoNext) setAnchorWeek(shiftAnchor(anchorWeek, vista, +1)) }
  const goOggi = () => { if (todayInRange) setAnchorWeek(normalizeAnchor(new Date(), vista)) }

  // ── Render helpers ───────────────────────────────────────────────
  /** "(SUB)" o "(MED)" colorato. Per i lunghi misti restituisce
   *  "(SUB→MED)" o "(MED→SUB)" con i due colori. */
  function PlacementTag({ placement }: { placement: SlotPlacement }) {
    if (!placement) return null
    const color = placement === 'SUB' ? '#9f1239' : '#0c4a6e'
    return (
      <span style={{ marginLeft: 4, fontSize: 10, fontWeight: 800, color }}>
        ({placement})
      </span>
    )
  }
  function MixedPlacementTag({ sm, sp }: { sm: SlotPlacement; sp: SlotPlacement }) {
    if (!sm && !sp) return null
    if (sm === sp) return <PlacementTag placement={sm} />
    // Misto
    const colSm = sm === 'SUB' ? '#9f1239' : sm === 'MED' ? '#0c4a6e' : '#9ca3af'
    const colSp = sp === 'SUB' ? '#9f1239' : sp === 'MED' ? '#0c4a6e' : '#9ca3af'
    return (
      <span style={{ marginLeft: 4, fontSize: 10, fontWeight: 800 }}>
        (<span style={{ color: colSm }}>{sm ?? '—'}</span>
        <span style={{ color: '#6b7280' }}>→</span>
        <span style={{ color: colSp }}>{sp ?? '—'}</span>)
      </span>
    )
  }

  /** Cella con sfondo a strisce + tooltip se in ferie. */
  const ferieWrap = (inFerie: boolean): React.CSSProperties =>
    inFerie
      ? { display: 'inline-flex', alignItems: 'center', gap: 3,
          padding: '2px 6px', borderRadius: 4, background: FERIE_STRIPE }
      : { display: 'inline-flex', alignItems: 'center', gap: 3 }

  function NomeBarrato({ medico, inFerie }: { medico: Medico; inFerie: boolean }) {
    return (
      <span style={inFerie ? { textDecoration: 'line-through', color: '#9ca3af' } : undefined}>
        {nomeBreve(medico)}
      </span>
    )
  }
  const FerieMark = ({ show }: { show: boolean }) =>
    show ? <span style={{ color: '#b45309', fontWeight: 800, fontSize: 9 }}>(F)</span> : null

  // ── Render giorno: ritorna 1+ righe ───────────────────────────────
  function renderGiorno(d: DayDisplay, idx: number): React.ReactNode {
    const bgGiorno = GIORNO_BG[idx % GIORNO_BG.length]

    // Caso fuori periodo / vuoto: una sola riga compatta
    if (!d.inPeriod || d.emptyByDesign) {
      const msg = !d.inPeriod ? '(fuori periodo del calendario)' : 'riposo / nessun turno'
      return (
        <tr key={d.dataISO} style={{ borderTop: '2px solid #1e3a8a' }}>
          <td style={{ ...cellDataDay, background: bgGiorno }}>{fmtDataLunga(d.data)}</td>
          <td colSpan={5} style={{
            padding: '8px', textAlign: 'center', color: '#9ca3af',
            fontStyle: 'italic', fontSize: 11,
            background: '#f9fafb', border: '1px solid #d1d5db',
          }}>{msg}</td>
        </tr>
      )
    }

    const numPaired   = Math.max(d.breviM.length, d.breviP.length)
    const totalRows   = Math.max(1, d.lunghi.length + numPaired)
    const rowsOutput: React.ReactNode[] = []

    const cellRicercaM = (
      <td rowSpan={totalRows} style={{ ...cellRicerca }}>
        {d.ricercaMattina.length === 0
          ? <span style={emptyDash}>—</span>
          : d.ricercaMattina.map((r, i) => (
              <div key={`rm-${i}`} title={r.inFerie ? FERIE_TOOLTIP : undefined}
                style={ferieWrap(r.inFerie)}>
                <NomeBarrato medico={r.medico} inFerie={r.inFerie} />
                {r.tcMain === 'L' && <span style={lBadgeSmall}>L</span>}
                <PlacementTag placement={r.placement} />
                <FerieMark show={r.inFerie} />
              </div>
            ))}
      </td>
    )
    const cellRicercaP = (
      <td rowSpan={totalRows} style={{ ...cellRicerca }}>
        {d.ricercaPomeriggio.length === 0
          ? <span style={emptyDash}>—</span>
          : d.ricercaPomeriggio.map((r, i) => (
              <div key={`rp-${i}`} title={r.inFerie ? FERIE_TOOLTIP : undefined}
                style={ferieWrap(r.inFerie)}>
                <NomeBarrato medico={r.medico} inFerie={r.inFerie} />
                {r.tcMain === 'L' && <span style={lBadgeSmall}>L</span>}
                <PlacementTag placement={r.placement} />
                <FerieMark show={r.inFerie} />
              </div>
            ))}
      </td>
    )
    const cellReperibile = (
      <td rowSpan={totalRows} style={{ ...cellReperibileStyle, background: bgGiorno }}>
        {d.reperibile ? (
          <span title={d.reperibile.inFerie ? FERIE_TOOLTIP : undefined}
            style={ferieWrap(d.reperibile.inFerie)}>
            <NomeBarrato medico={d.reperibile.medico} inFerie={d.reperibile.inFerie} />
            <FerieMark show={d.reperibile.inFerie} />
          </span>
        ) : '—'}
      </td>
    )
    const cellDataNode = (
      <td rowSpan={totalRows} style={{ ...cellDataDay, background: bgGiorno }}>
        {fmtDataLunga(d.data)}
      </td>
    )

    let isFirst = true

    // Riga lunghi (cella unica colspan=2). Il contenuto è centrato
    // orizzontalmente tramite un wrapper flex (justifyContent: center)
    // così il nome sta proprio in mezzo alla cella unita Matt+Pom.
    d.lunghi.forEach((l, i) => {
      rowsOutput.push(
        <tr key={`${d.dataISO}-l-${i}`} style={isFirst ? { borderTop: '2px solid #1e3a8a' } : undefined}>
          {isFirst && cellDataNode}
          <td colSpan={2} style={cellLungo}>
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
              <span title={l.inFerie ? FERIE_TOOLTIP : undefined}
                style={ferieWrap(l.inFerie)}>
                <NomeBarrato medico={l.medico} inFerie={l.inFerie} />
                <MixedPlacementTag sm={l.slot_mattina} sp={l.slot_pomeriggio} />
                <FerieMark show={l.inFerie} />
              </span>
            </div>
          </td>
          {isFirst && cellRicercaM}
          {isFirst && cellRicercaP}
          {isFirst && cellReperibile}
        </tr>
      )
      isFirst = false
    })

    // Righe brevi accoppiate
    for (let i = 0; i < numPaired; i++) {
      const m = d.breviM[i] ?? null
      const p = d.breviP[i] ?? null
      rowsOutput.push(
        <tr key={`${d.dataISO}-p-${i}`} style={isFirst ? { borderTop: '2px solid #1e3a8a' } : undefined}>
          {isFirst && cellDataNode}
          <td style={cellMezza}>
            {m ? (
              <span title={m.inFerie ? FERIE_TOOLTIP : undefined} style={ferieWrap(m.inFerie)}>
                <NomeBarrato medico={m.medico} inFerie={m.inFerie} />
                <PlacementTag placement={m.placement} />
                <FerieMark show={m.inFerie} />
              </span>
            ) : <span style={emptyDash}>—</span>}
          </td>
          <td style={cellMezza}>
            {p ? (
              <span title={p.inFerie ? FERIE_TOOLTIP : undefined} style={ferieWrap(p.inFerie)}>
                <NomeBarrato medico={p.medico} inFerie={p.inFerie} />
                <PlacementTag placement={p.placement} />
                <FerieMark show={p.inFerie} />
              </span>
            ) : <span style={emptyDash}>—</span>}
          </td>
          {isFirst && cellRicercaM}
          {isFirst && cellRicercaP}
          {isFirst && cellReperibile}
        </tr>
      )
      isFirst = false
    }

    // Edge case: solo reperibile o solo RM/RP (no operativi)
    if (d.lunghi.length === 0 && numPaired === 0) {
      rowsOutput.push(
        <tr key={`${d.dataISO}-empty`} style={{ borderTop: '2px solid #1e3a8a' }}>
          {cellDataNode}
          <td colSpan={2} style={{ ...cellLungo, color: '#9ca3af', fontStyle: 'italic' }}>
            <span style={emptyDash}>—</span>
          </td>
          {cellRicercaM}
          {cellRicercaP}
          {cellReperibile}
        </tr>
      )
    }

    return <Fragment key={d.dataISO}>{rowsOutput}</Fragment>
  }

  const labelRange = (() => {
    if (vista === 'settimana') {
      const fine = addDays(anchorWeek, 6)
      return `${anchorWeek.getDate()} ${MESI_IT[anchorWeek.getMonth() + 1]} → ${fine.getDate()} ${MESI_IT[fine.getMonth() + 1]} ${fine.getFullYear()}`
    }
    return `${MESI_IT[anchorWeek.getMonth() + 1]} ${anchorWeek.getFullYear()}`
  })()

  return (
    <div className="flex flex-col gap-3 p-4 mx-auto" style={{ maxWidth: 1200, width: '100%' }}>
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-xl font-bold text-stone-800 flex items-center gap-2">
          <CalendarDays size={20} style={{ color: '#476540' }} />
          Tabellone Turni — Vista {vista === 'settimana' ? 'settimanale' : 'mensile'}
        </h2>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex rounded-lg overflow-hidden border border-stone-300">
            <button onClick={() => changeVista('settimana')}
              className="px-3 py-1.5 text-xs font-medium transition-colors"
              style={vista === 'settimana'
                ? { background: '#476540', color: '#fff' }
                : { background: '#faf8f3', color: '#5a5a4a' }}>Settimana</button>
            <button onClick={() => changeVista('mese')}
              className="px-3 py-1.5 text-xs font-medium transition-colors"
              style={vista === 'mese'
                ? { background: '#476540', color: '#fff' }
                : { background: '#faf8f3', color: '#5a5a4a' }}>Mese</button>
          </div>
          <button onClick={goPrev} disabled={!canGoPrev}
            className="btn-secondary py-1 px-2 text-xs flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
            title={canGoPrev ? (vista === 'settimana' ? 'Settimana precedente' : 'Mese precedente') : "Sei all'inizio del periodo"}>
            <ChevronLeft size={14} /> Prec.
          </button>
          <span className="text-sm font-semibold text-stone-700 min-w-[220px] text-center">{labelRange}</span>
          <button onClick={goNext} disabled={!canGoNext}
            className="btn-secondary py-1 px-2 text-xs flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
            title={canGoNext ? (vista === 'settimana' ? 'Settimana successiva' : 'Mese successivo') : 'Sei alla fine del periodo'}>
            Succ. <ChevronRight size={14} />
          </button>
          <button onClick={goOggi} disabled={!todayInRange}
            className="btn-secondary py-1 px-2 text-xs disabled:opacity-40 disabled:cursor-not-allowed"
            title={todayInRange ? 'Vai a oggi' : 'Oggi è fuori dal periodo'}>Oggi</button>
          <button onClick={() => setMostraLegenda(v => !v)}
            className="btn-secondary py-1 px-2 text-xs flex items-center gap-1"
            style={mostraLegenda ? { background: '#e0e8d8', borderColor: '#9ab488' } : undefined}
            title={mostraLegenda ? 'Nascondi legenda' : 'Mostra legenda'}>
            <Info size={13} /> Legenda
          </button>
        </div>
      </div>

      {/* Legenda */}
      {mostraLegenda && (
        <div className="rounded-lg border px-3 py-2"
          style={{ background: '#f0ece4', borderColor: '#d5ccb8' }}>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 items-center text-xs"
            style={{ color: '#5a5a4a' }}>
            <span className="flex items-center gap-1">
              <span style={{ color: '#9f1239', fontWeight: 800, fontSize: 11 }}>(SUB)</span>
              <span>Sub-intensiva</span>
            </span>
            <span className="flex items-center gap-1">
              <span style={{ color: '#0c4a6e', fontWeight: 800, fontSize: 11 }}>(MED)</span>
              <span>Medicina</span>
            </span>
            <span style={{ width: 1, height: 14, background: '#c0b8a8', display: 'inline-block' }} />
            <span>Lunghi (M+P) — riga unica con cella M+P unita, sopra ai turni brevi.</span>
            <span style={{ width: 1, height: 14, background: '#c0b8a8', display: 'inline-block' }} />
            <span>Brevi accoppiati: M a sinistra, P a destra, ordinati per turnista.</span>
            <span style={{ width: 1, height: 14, background: '#c0b8a8', display: 'inline-block' }} />
            <span className="flex items-center gap-1.5" title={FERIE_TOOLTIP}>
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 3,
                padding: '2px 6px', borderRadius: 4,
                background: FERIE_STRIPE, border: '1px solid #fed7aa',
              }}>
                <span style={{ textDecoration: 'line-through', color: '#9ca3af', fontSize: 10, fontWeight: 600 }}>
                  ROSSI
                </span>
                <span style={{ color: '#b45309', fontWeight: 800, fontSize: 9 }}>(F)</span>
              </span>
              <span>Turno non ancora coperto (medico in ferie)</span>
            </span>
          </div>
        </div>
      )}

      {!config && <p className="text-sm text-stone-500">Caricamento configurazione…</p>}
      {config && medici.length === 0 && (
        <p className="text-sm text-stone-500">Nessun medico attivo trovato.</p>
      )}

      {config && medici.length > 0 && (
        <div className="overflow-auto rounded-lg border border-stone-300 bg-white">
          <table className="border-collapse text-xs" style={{ borderSpacing: 0, width: '100%', minWidth: 980 }}>
            <thead>
              <tr>
                <th style={hData}>Data</th>
                <th style={hMattina}>Mattina</th>
                <th style={hMattina}>Pomeriggio</th>
                <th style={hRicerca}>RM Mattina</th>
                <th style={hRicerca}>RM Pomeriggio</th>
                <th style={hReperibile}>Reperibile</th>
              </tr>
            </thead>
            <tbody>
              {giorniDisplay.map((d, idx) => {
                // In vista mese, ripeti l'header di colonne all'inizio di ogni
                // settimana (lunedì) tranne il primo per migliorare la lettura.
                const dWeek = getDayOfWeek(d.data)
                const insertSubHeader = vista === 'mese' && dWeek === 1 && idx > 0
                return (
                  <Fragment key={`grp-${d.dataISO}`}>
                    {insertSubHeader && (
                      <tr>
                        <th style={hDataSub}>Data</th>
                        <th style={hMattinaSub}>Mattina</th>
                        <th style={hMattinaSub}>Pomeriggio</th>
                        <th style={hRicercaSub}>RM Mattina</th>
                        <th style={hRicercaSub}>RM Pomeriggio</th>
                        <th style={hReperibileSub}>Reperibile</th>
                      </tr>
                    )}
                    {renderGiorno(d, idx)}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {config && periodo && (
        <p className="text-xs text-stone-500 text-center">
          Periodo del calendario: {MESI_IT[config.mese_inizio]} {config.anno_inizio}
          {' → '}{MESI_IT[config.mese_fine]} {config.anno_fine}
          {!todayInRange && ' · oggi è fuori dal periodo'}
        </p>
      )}
    </div>
  )
}

// ─── Stili tabella estratti ──────────────────────────────────────────
const hData: React.CSSProperties = {
  padding: '6px 4px', background: '#374151', color: '#fff',
  border: '1px solid #1f2937', minWidth: 130, fontWeight: 700, fontSize: 11,
  letterSpacing: '0.02em',
}
const hMattina: React.CSSProperties = {
  padding: '6px 4px', background: '#456b3a', color: '#fff',
  border: '1px solid #2b3c24', fontWeight: 700, fontSize: 11,
  letterSpacing: '0.02em',
}
const hRicerca: React.CSSProperties = {
  padding: '6px 4px', background: '#7a2233', color: '#fff',
  border: '1px solid #5a1a26', fontWeight: 700, fontSize: 11,
  letterSpacing: '0.02em',
}
const hReperibile: React.CSSProperties = {
  padding: '6px 4px', background: '#16a34a', color: '#fff',
  border: '1px solid #14532d', fontWeight: 700, fontSize: 11,
  letterSpacing: '0.02em',
}

// Versioni "sub" (più piccole) per gli header ripetuti settimanali
const hDataSub:       React.CSSProperties = { ...hData, padding: '3px 4px', fontSize: 10, opacity: 0.85 }
const hMattinaSub:    React.CSSProperties = { ...hMattina, padding: '3px 4px', fontSize: 10, opacity: 0.85 }
const hRicercaSub:    React.CSSProperties = { ...hRicerca, padding: '3px 4px', fontSize: 10, opacity: 0.85 }
const hReperibileSub: React.CSSProperties = { ...hReperibile, padding: '3px 4px', fontSize: 10, opacity: 0.85 }

const cellDataDay: React.CSSProperties = {
  fontWeight: 700, fontSize: 12, textAlign: 'center', verticalAlign: 'middle',
  padding: '6px 8px', border: '1px solid #6b7280', minWidth: 130,
}
const cellLungo: React.CSSProperties = {
  padding: '4px 8px', verticalAlign: 'middle', textAlign: 'center',
  border: '1px solid #6b7280', background: '#fff', fontSize: 12, fontWeight: 600,
}
const cellMezza: React.CSSProperties = {
  padding: '4px 8px', verticalAlign: 'middle', textAlign: 'center',
  border: '1px solid #6b7280', background: '#fff', fontSize: 12, fontWeight: 600,
  minWidth: 160,
}
const cellRicerca: React.CSSProperties = {
  padding: '4px 8px', verticalAlign: 'top',
  border: '1px solid #6b7280', background: '#f9fafb', minWidth: 130,
}
const cellReperibileStyle: React.CSSProperties = {
  fontWeight: 800, fontSize: 12, textAlign: 'center', verticalAlign: 'middle',
  padding: '6px 8px', border: '1px solid #6b7280', minWidth: 130,
}
const emptyDash: React.CSSProperties = { color: '#cbd5e1', fontSize: 11 }
const lBadgeSmall: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 14, height: 14, borderRadius: 3,
  background: '#ece5d5', border: '1px solid #4a3a1a',
  fontSize: 8, fontWeight: 900, color: '#4a3a1a',
  lineHeight: 1, marginLeft: 4,
}
