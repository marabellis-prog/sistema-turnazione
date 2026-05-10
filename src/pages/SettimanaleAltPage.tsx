/**
 * SettimanaleAltPage — vista settimanale/mensile alternativa
 *
 * Variante della SettimanalePage con colonne organizzate per ORARIO
 * (Mattina, Pomeriggio, RM Mattina, RP Pomeriggio, Reperibile) invece
 * che per settore (Sub Intensiva / Medicina). I medici dello stesso
 * orario sono raggruppati con i lunghi PRIMA dei turni brevi; il
 * settore (SUB / MED) appare fra parentesi accanto al cognome.
 *
 * Stessa logica realtime/clamping della SettimanalePage:
 *   - source of truth = tabella `turni` del DB
 *   - useTurniRealtime + useFerieRealtime + polling 15 s
 *   - navigazione bloccata al periodo configurato del calendario
 *   - accessibile a tutti i loggati, ospiti inclusi
 */

import { useState, useMemo, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, CalendarDays, Info } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { getDayOfWeek, formatDate, MESI_IT } from '../lib/algorithm'
import { useTurniRealtime } from '../hooks/useTurniRealtime'
import { useFerieRealtime } from '../hooks/useFerieRealtime'
import type { Configurazione, Medico, Turno, Ferie, SlotPlacement } from '../types'

const GIORNI_IT = ['', 'LUNEDÌ', 'MARTEDÌ', 'MERCOLEDÌ', 'GIOVEDÌ', 'VENERDÌ', 'SABATO', 'DOMENICA']
const GIORNO_BG = ['#f0f4ee', '#ecf3e0', '#fef3c7', '#fee0c0', '#e8e0f5', '#f0f0f0', '#fde0e0']

const FERIE_STRIPE = 'repeating-linear-gradient(45deg, #ffffff 0, #ffffff 7px, #fed7aa 7px, #fed7aa 14px)'
const FERIE_TOOLTIP = 'Turno non ancora coperto per turnista in ferie'

function startOfWeek(d: Date): Date {
  const r = new Date(d)
  r.setHours(0, 0, 0, 0)
  const dow = (r.getDay() + 6) % 7
  r.setDate(r.getDate() - dow)
  return r
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

function fmtDataBreve(d: Date): string {
  return `${d.getDate()}-${MESI_IT[d.getMonth() + 1].slice(0, 3).toLowerCase()}`
}

type Vista = 'settimana' | 'mese'

function firstOfMonth(d: Date): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), 1)
  r.setHours(0, 0, 0, 0)
  return r
}

function normalizeAnchor(d: Date, vista: Vista): Date {
  return vista === 'settimana' ? startOfWeek(d) : firstOfMonth(d)
}

function computeGiorni(anchor: Date, vista: Vista): Date[] {
  if (vista === 'settimana') {
    return Array.from({ length: 7 }, (_, i) => addDays(anchor, i))
  }
  const year    = anchor.getFullYear()
  const month   = anchor.getMonth()
  const lastDay = new Date(year, month + 1, 0).getDate()
  return Array.from({ length: lastDay }, (_, i) => {
    const r = new Date(year, month, i + 1)
    r.setHours(0, 0, 0, 0)
    return r
  })
}

function shiftAnchor(anchor: Date, vista: Vista, dir: 1 | -1): Date {
  if (vista === 'settimana') return addDays(anchor, 7 * dir)
  return firstOfMonth(new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1))
}

/** Voce nella colonna Mattina / Pomeriggio. */
interface SlotEntry {
  medico:    Medico
  /** Lettera turno: L lungo · M solo mattina · P solo pomeriggio. */
  letter:    'L' | 'M' | 'P'
  /** Settore (SUB/MED) della metà giornata pertinente alla colonna. */
  placement: SlotPlacement
  inFerie:   boolean
  /** Ordine: 0 lunghi, 1 turni brevi (M nella colonna Mattina, P nella
   *  colonna Pomeriggio). */
  sortKey:   number
}

/** Voce nelle colonne RM / RP — il placement riportato è quello della
 *  metà di giornata corrispondente (RM → slot_mattina, RP → slot_pomeriggio). */
interface RicercaEntry {
  medico:    Medico
  /** TC del medico — se 'L' segnaliamo che fa anche un lungo. */
  tcMain:    string
  placement: SlotPlacement
  inFerie:   boolean
  /** L=0, altri=1: i lunghi appaiono prima anche qui. */
  sortKey:   number
}

interface DayDisplay {
  data:    Date
  dataISO: string
  inPeriod: boolean
  /** Mattina = TC ∈ {M, L}, lunghi prima. */
  mattina:           SlotEntry[]
  /** Pomeriggio = TC ∈ {P, L}, lunghi prima. */
  pomeriggio:        SlotEntry[]
  /** TR contiene RM. */
  ricercaMattina:    RicercaEntry[]
  /** TR contiene RP. */
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

  // ── Query dati ────────────────────────────────────────────────────
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
    min.setHours( 0,  0,  0,    0)
    max.setHours(23, 59, 59,  999)
    return { min, max }
  }, [config])

  useEffect(() => {
    if (!periodo) return
    if (anchorWeek < periodo.min) {
      setAnchorWeek(normalizeAnchor(periodo.min, vista))
    } else if (anchorWeek > periodo.max) {
      setAnchorWeek(normalizeAnchor(periodo.max, vista))
    }
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
    staleTime:                   0,
    refetchOnMount:              'always',
    refetchInterval:             15_000,
    refetchIntervalInBackground: false,
  })

  const { data: ferieDB = [] } = useQuery<Pick<Ferie, 'medico_id' | 'data_inizio' | 'data_fine' | 'approvate'>[]>({
    queryKey: ['ferie-ranges'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ferie').select('medico_id, data_inizio, data_fine, approvate')
      if (error) throw error
      return data ?? []
    },
    staleTime:                   0,
    refetchOnMount:              'always',
    refetchInterval:             15_000,
    refetchIntervalInBackground: false,
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

  // ── Build display ─────────────────────────────────────────────────
  const giorniDisplay = useMemo<DayDisplay[]>(() => {
    if (!periodo) return []
    return giorni.map(data => {
      const dataISO = formatDate(data)
      const inPeriod = data >= periodo.min && data <= periodo.max

      const mattina:           SlotEntry[]    = []
      const pomeriggio:        SlotEntry[]    = []
      const ricercaMattina:    RicercaEntry[] = []
      const ricercaPomeriggio: RicercaEntry[] = []
      let reperibile: DayDisplay['reperibile'] = null

      if (inPeriod) {
        for (const medico of medici) {
          const t = turniByKey.get(`${medico.id}|${dataISO}`)
          if (!t) continue
          const tc = t.turno_clinico ?? ''
          const tr = t.turno_ricerca ?? ''
          const sm = t.slot_mattina    ?? null
          const sp = t.slot_pomeriggio ?? null
          const inFerie = !!t.is_ferie || isInFerie(medico.id, dataISO)

          // Mattina = M + L (lunghi prima), Pomeriggio = P + L
          if (tc === 'L') {
            mattina.push(   { medico, letter: 'L', placement: sm, inFerie, sortKey: 0 })
            pomeriggio.push({ medico, letter: 'L', placement: sp, inFerie, sortKey: 0 })
          } else if (tc === 'M') {
            mattina.push(   { medico, letter: 'M', placement: sm, inFerie, sortKey: 1 })
          } else if (tc === 'P') {
            pomeriggio.push({ medico, letter: 'P', placement: sp, inFerie, sortKey: 1 })
          } else if (tc === 'REP') {
            reperibile = { medico, inFerie }
          }

          // Ricerca: il placement riportato è quello della metà rilevante
          if (tr.includes('RM')) {
            ricercaMattina.push({
              medico, tcMain: tc, placement: sm, inFerie,
              sortKey: tc === 'L' ? 0 : 1,
            })
          }
          if (tr.includes('RP')) {
            ricercaPomeriggio.push({
              medico, tcMain: tc, placement: sp, inFerie,
              sortKey: tc === 'L' ? 0 : 1,
            })
          }
        }

        mattina.sort(          (a, b) => a.sortKey - b.sortKey)
        pomeriggio.sort(       (a, b) => a.sortKey - b.sortKey)
        ricercaMattina.sort(   (a, b) => a.sortKey - b.sortKey)
        ricercaPomeriggio.sort((a, b) => a.sortKey - b.sortKey)
      }

      const emptyByDesign = inPeriod &&
        mattina.length === 0 && pomeriggio.length === 0 &&
        ricercaMattina.length === 0 && ricercaPomeriggio.length === 0 &&
        !reperibile

      return {
        data, dataISO, inPeriod,
        mattina, pomeriggio, ricercaMattina, ricercaPomeriggio, reperibile,
        emptyByDesign,
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [giorni, medici, turniByKey, ferieRanges, periodo])

  // ── Navigation ────────────────────────────────────────────────────
  const canGoPrev = useMemo(() => {
    if (!periodo) return false
    const newAnchor = shiftAnchor(anchorWeek, vista, -1)
    const newGiorni = computeGiorni(newAnchor, vista)
    if (newGiorni.length === 0) return false
    return newGiorni[newGiorni.length - 1] >= periodo.min && newGiorni[0] <= periodo.max
  }, [anchorWeek, vista, periodo])

  const canGoNext = useMemo(() => {
    if (!periodo) return false
    const newAnchor = shiftAnchor(anchorWeek, vista, +1)
    const newGiorni = computeGiorni(newAnchor, vista)
    if (newGiorni.length === 0) return false
    return newGiorni[newGiorni.length - 1] >= periodo.min && newGiorni[0] <= periodo.max
  }, [anchorWeek, vista, periodo])

  const todayInRange = useMemo(() => {
    if (!periodo) return false
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return today >= periodo.min && today <= periodo.max
  }, [periodo])

  const goPrev = () => { if (canGoPrev) setAnchorWeek(shiftAnchor(anchorWeek, vista, -1)) }
  const goNext = () => { if (canGoNext) setAnchorWeek(shiftAnchor(anchorWeek, vista, +1)) }
  const goOggi = () => {
    if (todayInRange) setAnchorWeek(normalizeAnchor(new Date(), vista))
  }

  // ── Helpers di rendering ─────────────────────────────────────────
  /** Etichetta del settore in parentesi, colore coerente col chip
   *  (rosso SUB / azzurro MED). */
  function PlacementTag({ placement }: { placement: SlotPlacement }) {
    if (!placement) return null
    const color = placement === 'SUB' ? '#9f1239' : '#0c4a6e'
    return (
      <span style={{
        marginLeft: 3, fontSize: 9, fontWeight: 800, color,
      }}>({placement})</span>
    )
  }

  /** Riga di un medico in colonna Mattina / Pomeriggio: badge L per i
   *  lunghi, cognome, settore in parentesi, eventuale (F) e stripe ferie. */
  function MedRow({ entry }: { entry: SlotEntry }) {
    const { medico, letter, placement, inFerie } = entry
    return (
      <div
        title={inFerie ? FERIE_TOOLTIP : undefined}
        style={{
          display: 'flex', alignItems: 'center', gap: 4,
          padding: inFerie ? '2px 4px' : '1px 0',
          margin: inFerie ? '1px 0' : 0,
          borderRadius: inFerie ? 4 : 0,
          background: inFerie ? FERIE_STRIPE : undefined,
        }}>
        {letter === 'L' && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 16, height: 16, borderRadius: 3,
            background: '#ece5d5', border: '1px solid #4a3a1a',
            fontSize: 9, fontWeight: 900, color: '#4a3a1a',
            lineHeight: 1, flexShrink: 0,
          }}>L</span>
        )}
        <span style={{
          fontSize: 11, fontWeight: 600,
          ...(inFerie ? { textDecoration: 'line-through', color: '#9ca3af' } : {}),
        }}>{nomeBreve(medico)}</span>
        <PlacementTag placement={placement} />
        {inFerie && (
          <span style={{ marginLeft: 2, color: '#b45309', fontWeight: 800, fontSize: 9 }}>(F)</span>
        )}
      </div>
    )
  }

  /** Riga di una ricerca (RM o RP). */
  function RicRow({ entry }: { entry: RicercaEntry }) {
    const { medico, tcMain, placement, inFerie } = entry
    return (
      <div
        title={inFerie ? FERIE_TOOLTIP : undefined}
        style={{
          display: 'flex', alignItems: 'center', gap: 4,
          padding: inFerie ? '2px 4px' : '1px 0',
          margin: inFerie ? '1px 0' : 0,
          borderRadius: inFerie ? 4 : 0,
          background: inFerie ? FERIE_STRIPE : undefined,
        }}>
        {tcMain === 'L' && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 16, height: 16, borderRadius: 3,
            background: '#ece5d5', border: '1px solid #4a3a1a',
            fontSize: 9, fontWeight: 900, color: '#4a3a1a',
            lineHeight: 1, flexShrink: 0,
          }}>L</span>
        )}
        <span style={{
          fontSize: 11, fontWeight: 600,
          ...(inFerie ? { textDecoration: 'line-through', color: '#9ca3af' } : {}),
        }}>{nomeBreve(medico)}</span>
        <PlacementTag placement={placement} />
        {inFerie && (
          <span style={{ marginLeft: 2, color: '#b45309', fontWeight: 800, fontSize: 9 }}>(F)</span>
        )}
      </div>
    )
  }

  // ── Render del singolo giorno ─────────────────────────────────────
  function renderGiorno(d: DayDisplay, idx: number) {
    const dWeek = getDayOfWeek(d.data)
    const bgGiorno = GIORNO_BG[idx % GIORNO_BG.length]

    return (
      <tr key={d.dataISO} style={{ borderTop: '2px solid #1e3a8a' }}>
        <td style={{
          background: bgGiorno,
          fontWeight: 700, fontSize: 12,
          textAlign: 'center', verticalAlign: 'middle',
          width: 60, padding: '6px 4px',
          border: '1px solid #6b7280',
        }}>{fmtDataBreve(d.data)}</td>

        <td style={{
          background: bgGiorno,
          fontWeight: 800, fontSize: 11,
          textAlign: 'center', verticalAlign: 'middle',
          width: 90, padding: '6px 4px',
          border: '1px solid #6b7280',
        }}>{GIORNI_IT[dWeek]}</td>

        {!d.inPeriod ? (
          <td colSpan={5} style={{
            padding: '8px', textAlign: 'center', color: '#9ca3af',
            fontStyle: 'italic', fontSize: 11,
            background: '#f9fafb', border: '1px solid #d1d5db',
          }}>
            (fuori periodo del calendario)
          </td>
        ) : d.emptyByDesign ? (
          <td colSpan={5} style={{
            padding: '6px', textAlign: 'center', color: '#9ca3af',
            fontStyle: 'italic', fontSize: 11,
            background: '#f9fafb', border: '1px solid #d1d5db',
          }}>
            riposo / nessun turno
          </td>
        ) : (
          <>
            {/* MATTINA */}
            <td style={{
              padding: '4px 8px', verticalAlign: 'top',
              border: '1px solid #6b7280', background: '#fff', minWidth: 180,
            }}>
              {d.mattina.length === 0
                ? <span style={{ color: '#cbd5e1', fontSize: 11 }}>—</span>
                : d.mattina.map((m, i) => <MedRow key={`${m.medico.id}-${i}`} entry={m} />)}
            </td>
            {/* POMERIGGIO */}
            <td style={{
              padding: '4px 8px', verticalAlign: 'top',
              border: '1px solid #6b7280', background: '#fff', minWidth: 180,
            }}>
              {d.pomeriggio.length === 0
                ? <span style={{ color: '#cbd5e1', fontSize: 11 }}>—</span>
                : d.pomeriggio.map((m, i) => <MedRow key={`${m.medico.id}-${i}`} entry={m} />)}
            </td>
            {/* RM MATTINA */}
            <td style={{
              padding: '4px 8px', verticalAlign: 'top',
              border: '1px solid #6b7280', background: '#f9fafb', minWidth: 130,
            }}>
              {d.ricercaMattina.length === 0
                ? <span style={{ color: '#cbd5e1', fontSize: 11 }}>—</span>
                : d.ricercaMattina.map((r, i) => <RicRow key={`${r.medico.id}-${i}`} entry={r} />)}
            </td>
            {/* RP POMERIGGIO */}
            <td style={{
              padding: '4px 8px', verticalAlign: 'top',
              border: '1px solid #6b7280', background: '#f9fafb', minWidth: 130,
            }}>
              {d.ricercaPomeriggio.length === 0
                ? <span style={{ color: '#cbd5e1', fontSize: 11 }}>—</span>
                : d.ricercaPomeriggio.map((r, i) => <RicRow key={`${r.medico.id}-${i}`} entry={r} />)}
            </td>
            {/* REPERIBILE */}
            <td style={{
              background: bgGiorno,
              fontWeight: 800, fontSize: 12,
              textAlign: 'center', verticalAlign: 'middle',
              width: 130, padding: '6px 8px',
              border: '1px solid #6b7280',
              color: d.reperibile ? '#1f2937' : '#9ca3af',
            }}>
              {d.reperibile ? (
                <span
                  title={d.reperibile.inFerie ? FERIE_TOOLTIP : undefined}
                  style={d.reperibile.inFerie
                    ? { display: 'inline-flex', alignItems: 'center', gap: 3,
                        padding: '2px 6px', borderRadius: 4, background: FERIE_STRIPE }
                    : undefined}>
                  <span style={d.reperibile.inFerie
                    ? { textDecoration: 'line-through', color: '#9ca3af' }
                    : undefined}>
                    {nomeBreve(d.reperibile.medico)}
                  </span>
                  {d.reperibile.inFerie && (
                    <span style={{ color: '#b45309', fontWeight: 800, fontSize: 9 }}>(F)</span>
                  )}
                </span>
              ) : '—'}
            </td>
          </>
        )}
      </tr>
    )
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
          Vista {vista === 'settimana' ? 'settimanale' : 'mensile'} (alt)
        </h2>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex rounded-lg overflow-hidden border border-stone-300">
            <button
              onClick={() => changeVista('settimana')}
              className="px-3 py-1.5 text-xs font-medium transition-colors"
              style={vista === 'settimana'
                ? { background: '#476540', color: '#fff' }
                : { background: '#faf8f3', color: '#5a5a4a' }}>
              Settimana
            </button>
            <button
              onClick={() => changeVista('mese')}
              className="px-3 py-1.5 text-xs font-medium transition-colors"
              style={vista === 'mese'
                ? { background: '#476540', color: '#fff' }
                : { background: '#faf8f3', color: '#5a5a4a' }}>
              Mese
            </button>
          </div>
          <button
            onClick={goPrev}
            disabled={!canGoPrev}
            className="btn-secondary py-1 px-2 text-xs flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
            title={canGoPrev
              ? (vista === 'settimana' ? 'Settimana precedente' : 'Mese precedente')
              : 'Sei all\'inizio del periodo del calendario'}>
            <ChevronLeft size={14} /> Prec.
          </button>
          <span className="text-sm font-semibold text-stone-700 min-w-[220px] text-center">
            {labelRange}
          </span>
          <button
            onClick={goNext}
            disabled={!canGoNext}
            className="btn-secondary py-1 px-2 text-xs flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
            title={canGoNext
              ? (vista === 'settimana' ? 'Settimana successiva' : 'Mese successivo')
              : 'Sei alla fine del periodo del calendario'}>
            Succ. <ChevronRight size={14} />
          </button>
          <button
            onClick={goOggi}
            disabled={!todayInRange}
            className="btn-secondary py-1 px-2 text-xs disabled:opacity-40 disabled:cursor-not-allowed"
            title={todayInRange ? 'Vai a oggi' : 'Oggi è fuori dal periodo del calendario'}>
            Oggi
          </button>
          <button
            onClick={() => setMostraLegenda(v => !v)}
            className="btn-secondary py-1 px-2 text-xs flex items-center gap-1"
            style={mostraLegenda
              ? { background: '#e0e8d8', borderColor: '#9ab488' }
              : undefined}
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
            <span className="flex items-center gap-1.5">
              <span style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 16, height: 16, borderRadius: 3,
                background: '#ece5d5', border: '1px solid #4a3a1a',
                fontSize: 9, fontWeight: 900, color: '#4a3a1a', lineHeight: 1,
              }}>L</span>
              <span>Turno lungo (M+P) — i lunghi appaiono prima nelle colonne</span>
            </span>
            <span style={{ width: 1, height: 14, background: '#c0b8a8', display: 'inline-block' }} />
            <span className="flex items-center gap-1">
              <span style={{ color: '#9f1239', fontWeight: 800, fontSize: 11 }}>(SUB)</span>
              <span>Sub-intensiva</span>
            </span>
            <span className="flex items-center gap-1">
              <span style={{ color: '#0c4a6e', fontWeight: 800, fontSize: 11 }}>(MED)</span>
              <span>Medicina</span>
            </span>
            <span style={{ width: 1, height: 14, background: '#c0b8a8', display: 'inline-block' }} />
            <span className="flex items-center gap-1.5"
              title={FERIE_TOOLTIP}>
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 3,
                padding: '2px 6px', borderRadius: 4,
                background: FERIE_STRIPE,
                border: '1px solid #fed7aa',
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

      {!config && (
        <p className="text-sm text-stone-500">Caricamento configurazione…</p>
      )}

      {config && medici.length === 0 && (
        <p className="text-sm text-stone-500">Nessun medico attivo trovato.</p>
      )}

      {config && medici.length > 0 && (
        <div className="overflow-auto rounded-lg border border-stone-300 bg-white">
          <table className="border-collapse text-xs" style={{ borderSpacing: 0, width: '100%', minWidth: 980 }}>
            <thead>
              <tr>
                <th style={{
                  width: 60, padding: '6px 4px',
                  background: '#374151', color: '#fff',
                  border: '1px solid #1f2937',
                }}>Data</th>
                <th style={{
                  width: 90, padding: '6px 4px',
                  background: '#374151', color: '#fff',
                  border: '1px solid #1f2937',
                }}>Giorno</th>
                <th style={{
                  width: 180, padding: '6px 4px',
                  background: '#456b3a', color: '#fff',
                  border: '1px solid #2b3c24', letterSpacing: '0.02em',
                }}>Mattina</th>
                <th style={{
                  width: 180, padding: '6px 4px',
                  background: '#456b3a', color: '#fff',
                  border: '1px solid #2b3c24', letterSpacing: '0.02em',
                }}>Pomeriggio</th>
                <th style={{
                  width: 130, padding: '6px 4px',
                  background: '#7a2233', color: '#fff',
                  border: '1px solid #5a1a26', letterSpacing: '0.02em',
                }}>RM Mattina</th>
                <th style={{
                  width: 130, padding: '6px 4px',
                  background: '#7a2233', color: '#fff',
                  border: '1px solid #5a1a26', letterSpacing: '0.02em',
                }}>RP Pomeriggio</th>
                <th style={{
                  width: 130, padding: '6px 4px',
                  background: '#16a34a', color: '#fff',
                  border: '1px solid #14532d', letterSpacing: '0.02em',
                }}>Reperibile</th>
              </tr>
            </thead>
            <tbody>
              {giorniDisplay.map((d, idx) => renderGiorno(d, idx))}
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
