/**
 * SettimanalePage
 *
 * Vista settimanale/mensile compatta del calendario turni: per ogni giorno
 * una riga con quattro colonne — MATTINA / POMERIGGIO / RICERCA / REPERIBILE
 * — popolate leggendo direttamente la tabella `turni` del DB. È solo
 * un'impaginazione alternativa del calendario pubblico: qualsiasi modifica
 * fatta dall'admin in ModificaTurniPage si riflette qui via Supabase
 * Realtime (con polling 15 s come safety net).
 *
 * Niente più rotazione teorica — il sorgente di verità è il DB. La
 * navigazione è limitata al periodo configurato nel calendario: fuori
 * dall'intervallo non ci sono dati, quindi i bottoni Prec./Succ. si
 * disabilitano ai bordi e il bottone "Oggi" è disabilitato se oggi cade
 * fuori dal periodo.
 *
 * Accessibile a tutti i loggati, ospiti inclusi (per loro è l'unica
 * pagina visibile).
 */

import { useState, useMemo, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { getDayOfWeek, formatDate, MESI_IT } from '../lib/algorithm'
import { useTurniRealtime } from '../hooks/useTurniRealtime'
import { useFerieRealtime } from '../hooks/useFerieRealtime'
import type { Configurazione, Medico, Turno, Ferie, SlotPlacement } from '../types'

// 1=Lun, …, 7=Dom (allineato a getDayOfWeek)
const GIORNI_IT = ['', 'LUNEDÌ', 'MARTEDÌ', 'MERCOLEDÌ', 'GIOVEDÌ', 'VENERDÌ', 'SABATO', 'DOMENICA']
const GIORNO_BG = ['#f0f4ee', '#ecf3e0', '#fef3c7', '#fee0c0', '#e8e0f5', '#f0f0f0', '#fde0e0']

/** Sfondo cerchio del placement (SUB rosa / MED azzurro / nessun grigio chiaro) */
const PLACEMENT_BG: Record<'SUB'|'MED'|'NONE', string> = {
  SUB:  '#fecaca',
  MED:  '#bae6fd',
  NONE: '#f3f4f6',
}

function startOfWeek(d: Date): Date {
  const r = new Date(d)
  r.setHours(0, 0, 0, 0)
  const dow = (r.getDay() + 6) % 7   // 0=Lun, 1=Mar, …, 6=Dom
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

/** Calcola i giorni visualizzati per (anchor, vista). */
function computeGiorni(anchor: Date, vista: Vista): Date[] {
  if (vista === 'settimana') {
    return Array.from({ length: 7 }, (_, i) => addDays(anchor, i))
  }
  // Mese che contiene anchor (riferimento: primo giorno della settimana
  // visibile). La griglia mensile va dal lunedì della settimana del 1°
  // al sabato/domenica della settimana dell'ultimo giorno.
  const primoMese  = new Date(anchor.getFullYear(), anchor.getMonth(),     1)
  const ultimoMese = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0)
  const lunStart   = startOfWeek(primoMese)
  const lunEnd     = startOfWeek(ultimoMese)
  const out: Date[] = []
  for (let d = new Date(lunStart); d <= addDays(lunEnd, 6); d = addDays(d, 1)) {
    out.push(new Date(d))
  }
  return out
}

/** Sposta l'anchor di una settimana (vista=settimana) o un mese (vista=mese). */
function shiftAnchor(anchor: Date, vista: Vista, dir: 1 | -1): Date {
  if (vista === 'settimana') return addDays(anchor, 7 * dir)
  return startOfWeek(new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1))
}

interface MedDisplay {
  medico:    Medico
  /** Lettera del turno: M, P o L (per i lunghi). Le L compaiono sia in
   *  mattina che in pomeriggio con il rispettivo placement. */
  letter:    'M' | 'P' | 'L'
  placement: SlotPlacement
  inFerie:   boolean
}

interface RicercaDisplay {
  medico:  Medico
  /** TC del medico quel giorno — se 'L', mostra il suffisso "·L" per
   *  segnalare che la ricerca si combina con un lungo. */
  tcMain:  string
  inFerie: boolean
}

interface DayDisplay {
  data:               Date
  dataISO:            string
  /** Falso se la data è fuori dal periodo del calendario. In monthly view
   *  alcune celle del bordo settimanale possono ricadere prima di
   *  config.mese_inizio o dopo config.mese_fine. */
  inPeriod:           boolean
  mattina:            MedDisplay[]
  pomeriggio:         MedDisplay[]
  ricercaMattina:     RicercaDisplay[]
  ricercaPomeriggio:  RicercaDisplay[]
  reperibile:         { medico: Medico; inFerie: boolean } | null
  /** Nel periodo ma con zero turni (caso tipico: domenica generata vuota). */
  emptyByDesign:      boolean
}

export function SettimanalePage() {
  const [anchorWeek, setAnchorWeek] = useState<Date>(() => startOfWeek(new Date()))
  const [vista, setVista] = useState<Vista>('settimana')

  // ── Realtime: invalidate automatico delle query 'turni' / 'ferie-ranges'.
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

  // Bordi del periodo del calendario — usati per limitare la navigazione
  // e per marcare visivamente le celle fuori intervallo.
  const periodo = useMemo(() => {
    if (!config) return null
    const min = new Date(config.anno_inizio, config.mese_inizio - 1, 1)
    const max = new Date(config.anno_fine,   config.mese_fine,        0)
    min.setHours( 0,  0,  0,    0)
    max.setHours(23, 59, 59,  999)
    return { min, max }
  }, [config])

  // Se l'anchor di default (settimana di "oggi") cade fuori dal periodo
  // del calendario, riposiziona alla prima/ultima settimana valida appena
  // disponibile la config. Eseguito una sola volta per ogni cambio di
  // periodo: dopo, l'utente naviga liberamente entro i bordi.
  useEffect(() => {
    if (!periodo) return
    if (anchorWeek < periodo.min) {
      setAnchorWeek(startOfWeek(periodo.min))
    } else if (anchorWeek > periodo.max) {
      setAnchorWeek(startOfWeek(periodo.max))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodo])

  const giorni = useMemo(() => computeGiorni(anchorWeek, vista), [anchorWeek, vista])

  // Range ISO del periodo visualizzato — parametro delle query turni
  const periodoView = useMemo(() => {
    if (giorni.length === 0) return null
    return { di: formatDate(giorni[0]), df: formatDate(giorni[giorni.length - 1]) }
  }, [giorni])

  // ── Turni del periodo ────────────────────────────────────────────
  // Prefisso ['turni', …] → coperto da useTurniRealtime (invalidate match
  // prefix). Polling 15 s come safety net se la WebSocket cade.
  const { data: turni = [] } = useQuery<Turno[]>({
    queryKey: ['turni', 'settimanale', periodoView?.di, periodoView?.df],
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

  // ── Ferie (range completi, solo i campi minimi) ──────────────────
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

  // ── Indici di lookup O(1) ─────────────────────────────────────────
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

  // ── Build display data per ogni giorno ─────────────────────────────
  // Per ogni giorno, raggruppa i medici per TC/TR letti dal DB:
  //   M  → mattina · P → pomeriggio · L → entrambe · REP → reperibile
  //   TR contains RM / RP → ricerca mattina / pomeriggio
  // Niente più medicoForNum: la rotazione teorica è ridondante quando
  // abbiamo già lo stato salvato in `turni`.
  const giorniDisplay = useMemo<DayDisplay[]>(() => {
    if (!periodo) return []
    return giorni.map(data => {
      const dataISO = formatDate(data)
      const inPeriod = data >= periodo.min && data <= periodo.max

      const mattina:           MedDisplay[]      = []
      const pomeriggio:        MedDisplay[]      = []
      const ricercaMattina:    RicercaDisplay[]  = []
      const ricercaPomeriggio: RicercaDisplay[]  = []
      let reperibile: DayDisplay['reperibile'] = null

      if (inPeriod) {
        // I medici sono già ordinati per numero_ordine dalla query →
        // l'output finale ha lo stesso ordine consistente in tutti i giorni.
        for (const med of medici) {
          const t = turniByKey.get(`${med.id}|${dataISO}`)
          if (!t) continue
          const tc = t.turno_clinico ?? ''
          const tr = t.turno_ricerca ?? ''
          const inFerie = !!t.is_ferie || isInFerie(med.id, dataISO)

          if (tc === 'M') {
            mattina.push({ medico: med, letter: 'M', placement: t.slot_mattina ?? null, inFerie })
          } else if (tc === 'P') {
            pomeriggio.push({ medico: med, letter: 'P', placement: t.slot_pomeriggio ?? null, inFerie })
          } else if (tc === 'L') {
            mattina.push(   { medico: med, letter: 'L', placement: t.slot_mattina    ?? null, inFerie })
            pomeriggio.push({ medico: med, letter: 'L', placement: t.slot_pomeriggio ?? null, inFerie })
          } else if (tc === 'REP') {
            reperibile = { medico: med, inFerie }
          }

          if (tr.includes('RM')) ricercaMattina.push(   { medico: med, tcMain: tc, inFerie })
          if (tr.includes('RP')) ricercaPomeriggio.push({ medico: med, tcMain: tc, inFerie })
        }
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

  // ── Navigazione: bordi del periodo ─────────────────────────────────
  // Il pulsante è abilitato se la nuova vista (post-click) si sovrappone
  // ancora al periodo del calendario.
  const canGoPrev = useMemo(() => {
    if (!periodo) return false
    const newAnchor = shiftAnchor(anchorWeek, vista, -1)
    const newGiorni = computeGiorni(newAnchor, vista)
    if (newGiorni.length === 0) return false
    const newStart = newGiorni[0]
    const newEnd   = newGiorni[newGiorni.length - 1]
    return newEnd >= periodo.min && newStart <= periodo.max
  }, [anchorWeek, vista, periodo])

  const canGoNext = useMemo(() => {
    if (!periodo) return false
    const newAnchor = shiftAnchor(anchorWeek, vista, +1)
    const newGiorni = computeGiorni(newAnchor, vista)
    if (newGiorni.length === 0) return false
    const newStart = newGiorni[0]
    const newEnd   = newGiorni[newGiorni.length - 1]
    return newEnd >= periodo.min && newStart <= periodo.max
  }, [anchorWeek, vista, periodo])

  const todayInRange = useMemo(() => {
    if (!periodo) return false
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return today >= periodo.min && today <= periodo.max
  }, [periodo])

  const goPrev = () => { if (canGoPrev) setAnchorWeek(shiftAnchor(anchorWeek, vista, -1)) }
  const goNext = () => { if (canGoNext) setAnchorWeek(shiftAnchor(anchorWeek, vista, +1)) }
  const goOggi = () => { if (todayInRange) setAnchorWeek(startOfWeek(new Date())) }

  // ── Helpers di rendering ───────────────────────────────────────────
  /** Pillola circolare colorata per il placement (SUB pink / MED cyan).
   *  La lettera dentro identifica il tipo di turno (M, P, L). */
  function Chip({ letter, placement }: { letter: string; placement: SlotPlacement }) {
    const bg = PLACEMENT_BG[placement ?? 'NONE']
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 18, height: 18, borderRadius: '50%',
        background: bg,
        border: '1px solid #6b7280',
        fontSize: 9, fontWeight: 800,
        color: '#1f2937',
        lineHeight: 1,
        flexShrink: 0,
      }}>{letter}</span>
    )
  }

  /** Riga di un medico in cella Mattina / Pomeriggio: chip + cognome
   *  (barrato se in ferie) + suffisso (F) arancione. */
  function MedRow({ medico, letter, placement, inFerie }: MedDisplay) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '1px 0' }}>
        <Chip letter={letter} placement={placement} />
        <span style={{
          fontSize: 11, fontWeight: 600,
          ...(inFerie ? { textDecoration: 'line-through', color: '#9ca3af' } : {}),
        }}>{nomeBreve(medico)}</span>
        {inFerie && (
          <span style={{ marginLeft: 2, color: '#b45309', fontWeight: 800, fontSize: 9 }}>(F)</span>
        )}
      </div>
    )
  }

  /** Riga RM o RP: badge a sinistra + lista cognomi separati da virgola.
   *  "·L" dopo il cognome se il medico è anche in turno lungo quel giorno. */
  function RicercaRow({ label, items }: { label: 'RM' | 'RP'; items: RicercaDisplay[] }) {
    if (items.length === 0) return null
    return (
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, padding: '1px 0', flexWrap: 'wrap' }}>
        <span style={{
          fontSize: 9, fontWeight: 800, color: '#3a2858',
          background: '#ddd8ea', padding: '1px 4px', borderRadius: 3, flexShrink: 0,
        }}>{label}</span>
        {items.map((r, i) => (
          <span key={r.medico.id} style={{ fontSize: 11, fontWeight: 600 }}>
            <span style={r.inFerie ? { textDecoration: 'line-through', color: '#9ca3af' } : undefined}>
              {nomeBreve(r.medico)}
            </span>
            {r.tcMain === 'L' && (
              <span style={{ color: '#7a2233', fontWeight: 700, marginLeft: 1 }}>·L</span>
            )}
            {r.inFerie && (
              <span style={{ marginLeft: 2, color: '#b45309', fontWeight: 800, fontSize: 9 }}>(F)</span>
            )}
            {i < items.length - 1 && <span style={{ color: '#9ca3af' }}>,&nbsp;</span>}
          </span>
        ))}
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
          <td colSpan={4} style={{
            padding: '8px', textAlign: 'center', color: '#9ca3af',
            fontStyle: 'italic', fontSize: 11,
            background: '#f9fafb', border: '1px solid #d1d5db',
          }}>
            (fuori periodo del calendario)
          </td>
        ) : d.emptyByDesign ? (
          <td colSpan={4} style={{
            padding: '6px', textAlign: 'center', color: '#9ca3af',
            fontStyle: 'italic', fontSize: 11,
            background: '#f9fafb', border: '1px solid #d1d5db',
          }}>
            riposo / nessun turno
          </td>
        ) : (
          <>
            {/* MATTINA — colore di sfondo bianco per leggibilità sui chip */}
            <td style={{
              padding: '4px 8px', verticalAlign: 'top',
              border: '1px solid #6b7280', background: '#fff', minWidth: 200,
            }}>
              {d.mattina.length === 0
                ? <span style={{ color: '#cbd5e1', fontSize: 11 }}>—</span>
                : d.mattina.map(m => <MedRow key={m.medico.id} {...m} />)}
            </td>
            {/* POMERIGGIO */}
            <td style={{
              padding: '4px 8px', verticalAlign: 'top',
              border: '1px solid #6b7280', background: '#fff', minWidth: 200,
            }}>
              {d.pomeriggio.length === 0
                ? <span style={{ color: '#cbd5e1', fontSize: 11 }}>—</span>
                : d.pomeriggio.map(m => <MedRow key={m.medico.id} {...m} />)}
            </td>
            {/* RICERCA */}
            <td style={{
              padding: '4px 8px', verticalAlign: 'top',
              border: '1px solid #6b7280', background: '#f9fafb', minWidth: 160,
            }}>
              <RicercaRow label="RM" items={d.ricercaMattina} />
              <RicercaRow label="RP" items={d.ricercaPomeriggio} />
              {d.ricercaMattina.length === 0 && d.ricercaPomeriggio.length === 0 && (
                <span style={{ color: '#cbd5e1', fontSize: 11 }}>—</span>
              )}
            </td>
            {/* REPERIBILE */}
            <td style={{
              background: bgGiorno,
              fontWeight: 800, fontSize: 12,
              textAlign: 'center', verticalAlign: 'middle',
              width: 140, padding: '6px 8px',
              border: '1px solid #6b7280',
              color: d.reperibile ? '#1f2937' : '#9ca3af',
            }}>
              {d.reperibile ? (
                <span style={d.reperibile.inFerie
                  ? { textDecoration: 'line-through', color: '#9ca3af' }
                  : undefined}>
                  {nomeBreve(d.reperibile.medico)}
                  {d.reperibile.inFerie && (
                    <span style={{ marginLeft: 2, color: '#b45309', fontWeight: 800, fontSize: 9 }}>(F)</span>
                  )}
                </span>
              ) : '—'}
            </td>
          </>
        )}
      </tr>
    )
  }

  // ── Toolbar: label + bottoni ───────────────────────────────────────
  const labelRange = (() => {
    if (vista === 'settimana') {
      const fine = addDays(anchorWeek, 6)
      return `${anchorWeek.getDate()} ${MESI_IT[anchorWeek.getMonth() + 1]} → ${fine.getDate()} ${MESI_IT[fine.getMonth() + 1]} ${fine.getFullYear()}`
    }
    return `${MESI_IT[anchorWeek.getMonth() + 1]} ${anchorWeek.getFullYear()}`
  })()

  return (
    <div className="flex flex-col gap-3 p-4 mx-auto" style={{ maxWidth: 1100, width: '100%' }}>
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-xl font-bold text-stone-800 flex items-center gap-2">
          <CalendarDays size={20} style={{ color: '#476540' }} />
          Vista {vista === 'settimana' ? 'settimanale' : 'mensile'}
        </h2>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Toggle vista */}
          <div className="flex rounded-lg overflow-hidden border border-stone-300">
            <button
              onClick={() => setVista('settimana')}
              className="px-3 py-1.5 text-xs font-medium transition-colors"
              style={vista === 'settimana'
                ? { background: '#476540', color: '#fff' }
                : { background: '#faf8f3', color: '#5a5a4a' }}>
              Settimana
            </button>
            <button
              onClick={() => setVista('mese')}
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
        </div>
      </div>

      {!config && (
        <p className="text-sm text-stone-500">Caricamento configurazione…</p>
      )}

      {config && medici.length === 0 && (
        <p className="text-sm text-stone-500">Nessun medico attivo trovato.</p>
      )}

      {config && medici.length > 0 && (
        <div className="overflow-auto rounded-lg border border-stone-300 bg-white">
          <table className="border-collapse text-xs" style={{ borderSpacing: 0, width: '100%', minWidth: 850 }}>
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
                  width: 200, padding: '6px 4px',
                  background: '#456b3a', color: '#fff',
                  border: '1px solid #2b3c24',
                }}>Mattina</th>
                <th style={{
                  width: 200, padding: '6px 4px',
                  background: '#456b3a', color: '#fff',
                  border: '1px solid #2b3c24',
                }}>Pomeriggio</th>
                <th style={{
                  width: 160, padding: '6px 4px',
                  background: '#7a2233', color: '#fff',
                  border: '1px solid #5a1a26',
                }}>Ricerca</th>
                <th style={{
                  width: 140, padding: '6px 4px',
                  background: '#dc2626', color: '#fff',
                  border: '1px solid #7f1d1d',
                }}>Reperibile</th>
              </tr>
            </thead>
            <tbody>
              {giorniDisplay.map((d, idx) => renderGiorno(d, idx))}
            </tbody>
          </table>
        </div>
      )}

      {/* Footer: info sul periodo coperto dal calendario */}
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
