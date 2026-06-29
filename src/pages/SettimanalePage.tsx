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
import { ChevronLeft, ChevronRight, CalendarDays, Info } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { nomeBreve as nomeBreveLib } from '../lib/nomeTurnista'
import { getDayOfWeek, formatDate, MESI_IT } from '../lib/algorithm'
import { useTurniRealtime } from '../hooks/useTurniRealtime'
import { useFerieRealtime } from '../hooks/useFerieRealtime'
import { ForceLandscapeOverlay } from '../components/ForceLandscapeOverlay'
import type { Configurazione, Medico, Turno, Ferie, SlotPlacement } from '../types'

// 1=Lun, …, 7=Dom (allineato a getDayOfWeek)
const GIORNI_IT = ['', 'LUNEDÌ', 'MARTEDÌ', 'MERCOLEDÌ', 'GIOVEDÌ', 'VENERDÌ', 'SABATO', 'DOMENICA']
const GIORNO_BG = ['#f0f4ee', '#ecf3e0', '#fef3c7', '#fee0c0', '#e8e0f5', '#f0f0f0', '#fde0e0']

/** Sfondo cerchio del placement (SUB rosa / MED azzurro / Supporto grigio).
 *  NONE = lavora senza SUB/MED = Supporto/jolly → grigio. */
const PLACEMENT_BG: Record<'SUB'|'MED'|'NONE', string> = {
  SUB:  '#fecaca',
  MED:  '#bae6fd',
  NONE: '#d4d4d4',
}

/** Stripe bianco + arancio chiaro per evidenziare il "buco":
 *  un turno operativo (M/P/L/REP) che cade su un giorno di ferie approvate
 *  significa che NESSUNO copre quel turno (l'algoritmo non ha rigenerato
 *  dopo l'approvazione delle ferie). */
const FERIE_STRIPE = 'repeating-linear-gradient(45deg, #ffffff 0, #ffffff 7px, #fed7aa 7px, #fed7aa 14px)'
const FERIE_TOOLTIP = 'Turno non ancora coperto per turnista in ferie'

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

/** 1° del mese contenente la data. */
function firstOfMonth(d: Date): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), 1)
  r.setHours(0, 0, 0, 0)
  return r
}

/** Riporta una data al "formato anchor" della vista corrente:
 *  - settimana → lunedì della settimana
 *  - mese      → 1° del mese
 *  Usata sia all'inizializzazione che al cambio vista. */
function normalizeAnchor(d: Date, vista: Vista): Date {
  return vista === 'settimana' ? startOfWeek(d) : firstOfMonth(d)
}

/** Calcola i giorni visualizzati per (anchor, vista).
 *  - settimana → 7 giorni a partire dal lunedì
 *  - mese      → tutti e SOLO i giorni del mese (no padding di righe
 *    settimanali sul mese precedente/successivo) */
function computeGiorni(anchor: Date, vista: Vista): Date[] {
  if (vista === 'settimana') {
    return Array.from({ length: 7 }, (_, i) => addDays(anchor, i))
  }
  const year     = anchor.getFullYear()
  const month    = anchor.getMonth()
  const lastDay  = new Date(year, month + 1, 0).getDate()
  return Array.from({ length: lastDay }, (_, i) => {
    const r = new Date(year, month, i + 1)
    r.setHours(0, 0, 0, 0)
    return r
  })
}

/** Sposta l'anchor di una settimana o di un mese (dir = +1/-1).
 *  ⚠️ L'anchor ha semantiche diverse a seconda della vista, vedi
 *  normalizeAnchor — qui sfruttiamo che in vista mese l'anchor è
 *  GIÀ il 1° del mese, quindi `getMonth() + dir` punta esattamente
 *  al mese vicino senza ambiguità. */
function shiftAnchor(anchor: Date, vista: Vista, dir: 1 | -1): Date {
  if (vista === 'settimana') return addDays(anchor, 7 * dir)
  return firstOfMonth(new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1))
}

interface MedDisplay {
  medico: Medico
  /** Lettera del turno: L (lungo), M (mattina), P (pomeriggio). */
  letter: 'L' | 'M' | 'P'
  /** Per i lunghi MISTI (slot_mattina ≠ slot_pomeriggio) indica quale
   *  metà della giornata cade in questa colonna ("matt." o "pom.").
   *  Per L puri (stessa placement entrambe le metà) e per M/P è null. */
  half:   'matt' | 'pom' | null
  inFerie: boolean
  /** Ordine di visualizzazione: L=0, M=1, P=2. */
  sortKey: number
}

interface RicercaDisplay {
  medico:  Medico
  /** TC del medico quel giorno — se 'L', mostra il suffisso "·L" per
   *  segnalare che la ricerca si combina con un lungo. */
  tcMain:  string
  inFerie: boolean
}

interface DayDisplay {
  data:    Date
  dataISO: string
  /** Falso se la data è fuori dal periodo del calendario. */
  inPeriod: boolean
  /** Medici che lavorano in SUB-INTENSIVA quel giorno (M/P/L con
   *  placement SUB nella metà di giornata pertinente). Ordinati L→M→P. */
  sub: MedDisplay[]
  /** Medici che lavorano in MEDICINA quel giorno (M/P/L con placement
   *  MED). Ordinati L→M→P. */
  med: MedDisplay[]
  ricercaMattina:    RicercaDisplay[]
  ricercaPomeriggio: RicercaDisplay[]
  reperibile:        { medico: Medico; inFerie: boolean } | null
  /** Nel periodo ma con zero turni. */
  emptyByDesign:     boolean
}

export function SettimanalePage() {
  // Vista di default: settimana → anchor = lunedì della settimana di oggi.
  // Se l'utente passa a 'mese', changeVista trasformerà l'anchor in 1° del
  // mese corrispondente (vedi normalizeAnchor).
  const [vista, setVista] = useState<Vista>('settimana')
  const [anchorWeek, setAnchorWeek] = useState<Date>(() => startOfWeek(new Date()))
  // Legenda: aperta di default su desktop (≥640px), chiusa su mobile.
  // Toggle dal bottone "Legenda" nella toolbar.
  const [mostraLegenda, setMostraLegenda] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 640px)').matches,
  )

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
  // disponibile la config. Usa normalizeAnchor così rispetta la vista
  // corrente (lunedì in weekly · 1° del mese in monthly).
  useEffect(() => {
    if (!periodo) return
    if (anchorWeek < periodo.min) {
      setAnchorWeek(normalizeAnchor(periodo.min, vista))
    } else if (anchorWeek > periodo.max) {
      setAnchorWeek(normalizeAnchor(periodo.max, vista))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodo])

  /** Cambia vista e renormalizza l'anchor (con clamp ai bordi del periodo).
   *  Necessario perché il "formato" dell'anchor differisce tra le due viste:
   *  passare da weekly a monthly senza renormalizzare lascerebbe l'anchor
   *  su un lunedì che potrebbe ricadere nel mese precedente, causando
   *  bug di navigazione (Succ. che non avanza) e display sbagliato. */
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
    return nomeBreveLib(m.cognome, m.nome_proprio, m.nome)
  }

  // ── Build display data per ogni giorno ─────────────────────────────
  // Le colonne SUB / MED non sono più "mattina/pomeriggio" ma "settore":
  // ogni medico finisce nella colonna corrispondente al suo placement
  // (slot_mattina / slot_pomeriggio = SUB | MED | null), separato dalla
  // ricerca e dalla reperibilità. Ordinamento interno: L → M → P.
  //
  // Casi particolari per TC = L (lungo M+P):
  //  - L "puro" — slot_mattina === slot_pomeriggio (entrambi SUB o MED):
  //    una sola voce nella colonna corrispondente, senza suffisso.
  //  - L "misto" — placement diverso fra mattina e pomeriggio:
  //    DUE voci, una per colonna, ciascuna con suffisso "matt." / "pom."
  //    a indicare quale metà della giornata appartiene a quella colonna.
  const giorniDisplay = useMemo<DayDisplay[]>(() => {
    if (!periodo) return []
    return giorni.map(data => {
      const dataISO = formatDate(data)
      const inPeriod = data >= periodo.min && data <= periodo.max

      const sub:               MedDisplay[]     = []
      const med:               MedDisplay[]     = []
      const ricercaMattina:    RicercaDisplay[] = []
      const ricercaPomeriggio: RicercaDisplay[] = []
      let reperibile: DayDisplay['reperibile'] = null

      if (inPeriod) {
        // I medici sono già ordinati per numero_ordine dalla query →
        // l'output finale ha ordine consistente fra giorni diversi.
        for (const medico of medici) {
          const t = turniByKey.get(`${medico.id}|${dataISO}`)
          if (!t) continue
          const tc = t.turno_clinico ?? ''
          const tr = t.turno_ricerca ?? ''
          const sm = t.slot_mattina    ?? null
          const sp = t.slot_pomeriggio ?? null
          const inFerie = !!t.is_ferie || isInFerie(medico.id, dataISO)

          // Helper: aggiunge una voce alla colonna giusta (sub o med)
          // mettendola in ordine per sortKey (L=0, M=1, P=2).
          const push = (
            colPlacement: 'SUB' | 'MED',
            letter: 'L' | 'M' | 'P',
            half: 'matt' | 'pom' | null,
          ) => {
            const sortKey = letter === 'L' ? 0 : letter === 'M' ? 1 : 2
            const arr = colPlacement === 'SUB' ? sub : med
            arr.push({ medico, letter, half, inFerie, sortKey })
          }

          if (tc === 'M') {
            // Mattina-only: la colonna è determinata da slot_mattina.
            if (sm === 'SUB') push('SUB', 'M', null)
            else if (sm === 'MED') push('MED', 'M', null)
          } else if (tc === 'P') {
            // Pomeriggio-only: colonna da slot_pomeriggio.
            if (sp === 'SUB') push('SUB', 'P', null)
            else if (sp === 'MED') push('MED', 'P', null)
          } else if (tc === 'L') {
            // Lungo: se le due metà hanno lo stesso placement → una voce
            // sola; altrimenti split fra le due colonne.
            if (sm === sp) {
              if (sm === 'SUB') push('SUB', 'L', null)
              else if (sm === 'MED') push('MED', 'L', null)
            } else {
              if (sm === 'SUB') push('SUB', 'L', 'matt')
              else if (sm === 'MED') push('MED', 'L', 'matt')
              if (sp === 'SUB') push('SUB', 'L', 'pom')
              else if (sp === 'MED') push('MED', 'L', 'pom')
            }
          } else if (tc === 'REP') {
            reperibile = { medico, inFerie }
          }

          if (tr.includes('RM')) ricercaMattina.push(   { medico, tcMain: tc, inFerie })
          if (tr.includes('RP')) ricercaPomeriggio.push({ medico, tcMain: tc, inFerie })
        }

        // Ordina ogni colonna L → M → P (numero_ordine come tiebreaker
        // implicito dato l'ordine del loop).
        sub.sort((a, b) => a.sortKey - b.sortKey)
        med.sort((a, b) => a.sortKey - b.sortKey)
      }

      const emptyByDesign = inPeriod &&
        sub.length === 0 && med.length === 0 &&
        ricercaMattina.length === 0 && ricercaPomeriggio.length === 0 &&
        !reperibile

      return {
        data, dataISO, inPeriod,
        sub, med, ricercaMattina, ricercaPomeriggio, reperibile,
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
  const goOggi = () => {
    // Vai a "oggi" rispettando la vista corrente: lunedì della settimana
    // in weekly, 1° del mese corrente in monthly.
    if (todayInRange) setAnchorWeek(normalizeAnchor(new Date(), vista))
  }

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

  /** Riga di un medico in colonna SUB / MED: chip colorato (col placement
   *  della colonna) + cognome + eventuale suffisso "matt./pom." per i
   *  lunghi misti + (F) se in ferie. Quando in ferie il wrap ha stripe
   *  bianco/arancio + tooltip "turno non coperto". */
  function MedRow({
    item, columnPlacement,
  }: { item: MedDisplay; columnPlacement: 'SUB' | 'MED' }) {
    const { medico, letter, half, inFerie } = item
    const halfLabel = half === 'matt' ? 'matt.' : half === 'pom' ? 'pom.' : null
    return (
      <div
        title={inFerie ? FERIE_TOOLTIP : undefined}
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          padding: inFerie ? '2px 4px' : '1px 0',
          margin: inFerie ? '1px 0' : 0,
          borderRadius: inFerie ? 4 : 0,
          background: inFerie ? FERIE_STRIPE : undefined,
        }}>
        <Chip letter={letter} placement={columnPlacement} />
        <span style={{
          fontSize: 11, fontWeight: 600,
          ...(inFerie ? { textDecoration: 'line-through', color: '#9ca3af' } : {}),
        }}>{nomeBreve(medico)}</span>
        {halfLabel && (
          <span style={{
            fontSize: 9, fontWeight: 700, color: '#6b7280', fontStyle: 'italic',
          }}>· {halfLabel}</span>
        )}
        {inFerie && (
          <span style={{ marginLeft: 2, color: '#b45309', fontWeight: 800, fontSize: 9 }}>(F)</span>
        )}
      </div>
    )
  }

  /** Riga RM o RP: badge a sinistra + lista cognomi separati da virgola.
   *  "·L" dopo il cognome se il medico è anche in turno lungo quel giorno.
   *  I singoli medici in ferie sono avvolti in un wrap con sfondo a strisce
   *  bianco/arancio + tooltip — stesso linguaggio visivo delle celle M/P. */
  function RicercaRow({ label, items }: { label: 'RM' | 'RP'; items: RicercaDisplay[] }) {
    if (items.length === 0) return null
    return (
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, padding: '1px 0', flexWrap: 'wrap' }}>
        <span style={{
          fontSize: 9, fontWeight: 800, color: '#3a2858',
          background: '#ddd8ea', padding: '1px 4px', borderRadius: 3, flexShrink: 0,
        }}>{label}</span>
        {items.map((r, i) => (
          <span key={r.medico.id}
            title={r.inFerie ? FERIE_TOOLTIP : undefined}
            style={{
              fontSize: 11, fontWeight: 600,
              ...(r.inFerie
                ? { background: FERIE_STRIPE, padding: '0 4px', borderRadius: 3 }
                : {}),
            }}>
            <span style={r.inFerie ? { textDecoration: 'line-through', color: '#9ca3af' } : undefined}>
              {nomeBreve(r.medico)}
            </span>
            {r.tcMain === 'L' && (
              <span style={{ color: '#7a2233', fontWeight: 700, marginLeft: 1 }}>·L</span>
            )}
            {r.inFerie && (
              <span style={{ marginLeft: 2, color: '#b45309', fontWeight: 800, fontSize: 9 }}>(F)</span>
            )}
            {i < items.length - 1 && !r.inFerie && <span style={{ color: '#9ca3af' }}>,&nbsp;</span>}
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
            {/* SUB INTENSIVA — sfondo rosa molto tenue per richiamare il
                colore dei chip SUB senza sovrapporsi alla loro leggibilità */}
            <td style={{
              padding: '4px 8px', verticalAlign: 'top',
              border: '1px solid #6b7280', background: '#fff5f5', minWidth: 200,
            }}>
              {d.sub.length === 0
                ? <span style={{ color: '#cbd5e1', fontSize: 11 }}>—</span>
                : d.sub.map((m, i) => (
                    <MedRow key={`${m.medico.id}-${m.half ?? i}`} item={m} columnPlacement="SUB" />
                  ))}
            </td>
            {/* MEDICINA — sfondo azzurro molto tenue */}
            <td style={{
              padding: '4px 8px', verticalAlign: 'top',
              border: '1px solid #6b7280', background: '#f0f9ff', minWidth: 200,
            }}>
              {d.med.length === 0
                ? <span style={{ color: '#cbd5e1', fontSize: 11 }}>—</span>
                : d.med.map((m, i) => (
                    <MedRow key={`${m.medico.id}-${m.half ?? i}`} item={m} columnPlacement="MED" />
                  ))}
            </td>
            {/* RICERCA */}
            <td style={{
              padding: '4px 8px', verticalAlign: 'top',
              border: '1px solid #6b7280', background: '#fdf4f5', minWidth: 160,
            }}>
              <RicercaRow label="RM" items={d.ricercaMattina} />
              <RicercaRow label="RP" items={d.ricercaPomeriggio} />
              {d.ricercaMattina.length === 0 && d.ricercaPomeriggio.length === 0 && (
                <span style={{ color: '#cbd5e1', fontSize: 11 }}>—</span>
              )}
            </td>
            {/* REPERIBILE — stesso linguaggio visivo degli altri:
                stripe + tooltip se il reperibile è in ferie. */}
            <td style={{
              background: bgGiorno,
              fontWeight: 800, fontSize: 12,
              textAlign: 'center', verticalAlign: 'middle',
              width: 140, padding: '6px 8px',
              border: '1px solid #6b7280',
              color: d.reperibile ? '#1f2937' : '#9ca3af',
            }}>
              {d.reperibile ? (
                <span
                  title={d.reperibile.inFerie ? FERIE_TOOLTIP : undefined}
                  style={d.reperibile.inFerie
                    ? { display: 'inline-flex', alignItems: 'center', gap: 3,
                        padding: '2px 6px', borderRadius: 4,
                        background: FERIE_STRIPE }
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
      {/* Overlay rotate-to-landscape su dispositivi mobile in portrait. */}
      <ForceLandscapeOverlay />
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-xl font-bold text-stone-800 flex items-center gap-2">
          <CalendarDays size={20} style={{ color: '#476540' }} />
          Vista Settimanale
        </h2>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Toggle vista — usa changeVista per renormalizzare l'anchor */}
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

      {/* ── Legenda nascondibile sopra il calendario ────────────── */}
      {mostraLegenda && (
        <div className="rounded-lg border px-3 py-2"
          style={{ background: '#f0ece4', borderColor: '#d5ccb8' }}>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 items-center text-xs"
            style={{ color: '#5a5a4a' }}>

            {/* Lettere turno: L → M → P (stesso ordine usato nelle colonne) */}
            <span className="flex items-center gap-1.5">
              <Chip letter="L" placement="SUB" />
              <span>Lungo (M+P)</span>
            </span>
            <span className="flex items-center gap-1.5">
              <Chip letter="M" placement="SUB" />
              <span>Mattina</span>
            </span>
            <span className="flex items-center gap-1.5">
              <Chip letter="P" placement="SUB" />
              <span>Pomeriggio</span>
            </span>

            {/* Separatore */}
            <span style={{ width: 1, height: 14, background: '#c0b8a8', display: 'inline-block' }} />

            {/* Colore chip = colore della colonna (rosa SUB / azzurro MED) */}
            <span className="flex items-center gap-1.5">
              <span style={{
                display: 'inline-block', width: 14, height: 14, borderRadius: '50%',
                background: '#fecaca', border: '1px solid #dc2626',
              }} />
              <span>Sub-intensiva</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span style={{
                display: 'inline-block', width: 14, height: 14, borderRadius: '50%',
                background: '#bae6fd', border: '1px solid #0284c7',
              }} />
              <span>Medicina</span>
            </span>

            {/* Suffisso "matt./pom." per i lunghi misti */}
            <span className="flex items-center gap-1">
              <span style={{ color: '#6b7280', fontStyle: 'italic', fontWeight: 700 }}>· matt. / pom.</span>
              <span>= L con metà giornata in altra colonna</span>
            </span>

            {/* Separatore */}
            <span style={{ width: 1, height: 14, background: '#c0b8a8', display: 'inline-block' }} />

            {/* RM / RP / ·L */}
            <span className="flex items-center gap-1.5">
              <span style={{
                fontSize: 9, fontWeight: 800, color: '#3a2858',
                background: '#ddd8ea', padding: '1px 4px', borderRadius: 3,
              }}>RM</span>
              <span>Ricerca mattina</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span style={{
                fontSize: 9, fontWeight: 800, color: '#3a2858',
                background: '#ddd8ea', padding: '1px 4px', borderRadius: 3,
              }}>RP</span>
              <span>Ricerca pomeriggio</span>
            </span>
            <span className="flex items-center gap-1">
              <span style={{ color: '#7a2233', fontWeight: 700 }}>·L</span>
              <span>= anche in turno lungo</span>
            </span>

            {/* Separatore */}
            <span style={{ width: 1, height: 14, background: '#c0b8a8', display: 'inline-block' }} />

            {/* Stripe (F) — turno scoperto */}
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
          <table className="border-collapse text-xs settimanale-table" style={{ borderSpacing: 0, width: '100%', minWidth: 900 }}>
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
                {/* SUB INTENSIVA — rosso (stesso colore del bordo del pallino SUB) */}
                <th style={{
                  width: 200, padding: '6px 4px',
                  background: '#dc2626', color: '#fff',
                  border: '1px solid #991b1b', letterSpacing: '0.02em',
                }}>Sub Intensiva</th>
                {/* MEDICINA — azzurro (stesso colore del bordo del pallino MED) */}
                <th style={{
                  width: 200, padding: '6px 4px',
                  background: '#0284c7', color: '#fff',
                  border: '1px solid #075985', letterSpacing: '0.02em',
                }}>Medicina</th>
                {/* RICERCA — bordeaux */}
                <th style={{
                  width: 160, padding: '6px 4px',
                  background: '#7a2233', color: '#fff',
                  border: '1px solid #5a1a26', letterSpacing: '0.02em',
                }}>Ricerca</th>
                {/* REPERIBILE — verde */}
                <th style={{
                  width: 140, padding: '6px 4px',
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
