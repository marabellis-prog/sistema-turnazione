/**
 * ModificaTurniPage
 *
 * Pagina admin per modificare manualmente i turni generati dallo schema.
 *
 * - Due viste: "Mensile" (una tabella per mese, una sotto l'altra) e
 *   "Lineare" (una tabella unica con tutto il periodo).
 * - Ogni cella è cliccabile → input testuale → parsing flessibile della
 *   stringa scritta dall'utente (es. "m rm", "REP", "RM+RP"). Uppercase auto.
 * - Bordo azzurro sulle celle il cui valore corrente ≠ valore teorico
 *   da schema. Se l'utente rimette il valore originale (anche su una cella
 *   precedentemente salvata come "modificata"), il bordo sparisce automaticamente.
 *
 * "Valore originale" = ricalcolato in memoria via `calcolaCalendarioCompleto`
 * sullo schema corrente. NON serve una colonna SQL dedicata: il confronto
 * cur ≠ originale produce automaticamente il flag modificato_manualmente.
 *
 * Modifiche non salvate:
 * - Tracciate in un Map locale `modifiche`. Il flag `hasUnsaved` blocca
 *   la navigazione in-app via `registerNavGuard` del PendingActionsContext
 *   (modal di conferma) e attiva `beforeunload` per bloccare chiusura tab.
 * - Al salvataggio: upsert su `turni` con `modificato_manualmente` ricalcolato.
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Calendar, Save, Layers, Rows3 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import {
  calcolaCalendarioCompleto, calcolaTurnoTeorico, primoLunediDelPeriodo,
  getDayOfWeek, ricalcolaGiorno, generaColonne, MESI_IT,
  type RicalcCell,
} from '../../lib/algorithm'
import { ConfirmModal } from '../../components/ConfirmModal'
import { RiepilogoTurni } from '../../components/RiepilogoTurni'
import { LegendaCalendario, DRAG_MIME } from '../../components/LegendaCalendario'
import { calcolaColoreFerie, COLORI_FERIE, ETICHETTA_COLORE } from '../../lib/ferieColori'
import { usePendingActions } from '../../contexts/PendingActionsContext'
import { useFerieRealtime } from '../../hooks/useFerieRealtime'
import { useTurniRealtime } from '../../hooks/useTurniRealtime'
import type {
  Configurazione, Medico, SchemaModello, Turno, Ferie,
  TurnoClinico, TurnoRicerca, SlotPlacement, ColonnaCal,
} from '../../types'

// ════════════════════════════════════════════════════════════════════
// Costanti di rendering (allineate alla pagina pubblica del calendario)
// ════════════════════════════════════════════════════════════════════

const CELL_COLORS: Record<string, { bg: string; fg: string }> = {
  M:   { bg: '#dde8d5', fg: '#2e4a28' },
  P:   { bg: '#d5e0e8', fg: '#253a4a' },
  L:   { bg: '#ece5d5', fg: '#4a3a1a' },
  REP: { bg: '#e8d5d5', fg: '#5a2a2a' },
  RM:  { bg: '#ddd8ea', fg: '#3a2858' },
  RP:  { bg: '#ead8e2', fg: '#582840' },
}

const DAY_LETTERS = ['D', 'L', 'M', 'M', 'G', 'V', 'S']

function dayLetter(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return DAY_LETTERS[new Date(y, m - 1, d).getDay()]
}

// Colore pastello per ogni placement nel cerchio mezzo/mezzo
const PLACEMENT_BG: Record<'SUB'|'MED'|'NONE', string> = {
  SUB:  '#fecaca',
  MED:  '#bae6fd',
  NONE: 'transparent',
}

/** Etichetta TC (M / P / L / REP) con cerchio pastello che riflette
 *  slot_mattina (metà sx) e slot_pomeriggio (metà dx).
 *  - Se M: solo mattina conta → cerchio pieno del colore di slot_mattina
 *  - Se P: solo pomeriggio conta → cerchio pieno del colore di slot_pomeriggio
 *  - Se L: cerchio diviso (sx = mattina, dx = pomeriggio)
 *  - Senza placement: testo nudo, no cerchio */
function LabelClinico({ tc, slot_mattina, slot_pomeriggio }: {
  tc: string
  slot_mattina?:    'SUB'|'MED'|null
  slot_pomeriggio?: 'SUB'|'MED'|null
}) {
  if (!tc) return null
  const fontSize = tc === 'REP' ? 10 : 12
  const color    = tc === 'REP' ? '#b91c1c' : (CELL_COLORS[tc]?.fg ?? '#3a3d30')

  // Calcola lo sfondo del cerchio
  let bg: string | undefined
  if (tc === 'M' && slot_mattina) {
    bg = PLACEMENT_BG[slot_mattina]
  } else if (tc === 'P' && slot_pomeriggio) {
    bg = PLACEMENT_BG[slot_pomeriggio]
  } else if (tc === 'L' && (slot_mattina || slot_pomeriggio)) {
    const colSX = PLACEMENT_BG[slot_mattina    ?? 'NONE']
    const colDX = PLACEMENT_BG[slot_pomeriggio ?? 'NONE']
    if (colSX === colDX && colSX !== 'transparent') {
      bg = colSX   // entrambi uguali: cerchio pieno
    } else {
      // Cerchio diviso: sx | dx (verticale 50/50)
      bg = `linear-gradient(90deg, ${colSX} 0%, ${colSX} 50%, ${colDX} 50%, ${colDX} 100%)`
    }
  }

  const baseProps = {
    className: 'pointer-events-none select-none',
    style: {
      fontSize, fontWeight: bg ? 800 : 700, color,
      letterSpacing: tc === 'REP' ? '-0.3px' : undefined,
    } as React.CSSProperties,
  }

  if (!bg) return <span {...baseProps}>{tc}</span>
  return (
    <span {...baseProps} style={{
      ...baseProps.style,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: 22, height: 22, borderRadius: '50%',
      background: bg, lineHeight: 1,
    }}>{tc}</span>
  )
}

/** Etichetta del turno ricerca (RM / RP / RM+RP) */
function LabelRicerca({ tr }: { tr: string }) {
  if (!tr) return null
  return (
    <div className="flex flex-col items-center leading-none gap-px pointer-events-none select-none">
      {tr.split('+').map(p => (
        <span key={p} style={{
          fontSize: 9, fontWeight: 700,
          color: CELL_COLORS[p]?.fg ?? '#3a2858',
        }}>{p}</span>
      ))}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════
// Parsing input cella
// ════════════════════════════════════════════════════════════════════

type TipoTabella = 'clinica' | 'ricerca'

/**
 * Parsa la stringa scritta dall'utente, filtrando per tipo di tabella.
 * - Clinica: riconosce solo M / P / L / REP (TC)
 * - Ricerca: riconosce solo RM / RP / RM+RP (TR)
 *
 * Accetta separatori vari: spazio, virgola, "+", ";". Uppercase auto.
 */
function parseClinico(input: string): TurnoClinico {
  const tokens = input.toUpperCase().split(/[\s,+;]+/).filter(Boolean)
  for (const t of tokens) {
    if (t === 'M' || t === 'P' || t === 'L' || t === 'REP') return t
  }
  return ''
}

function parseRicerca(input: string): TurnoRicerca {
  const tokens = input.toUpperCase().split(/[\s,+;]+/).filter(Boolean)
  const set = new Set<'RM' | 'RP'>()
  for (const t of tokens) {
    if (t === 'RM') set.add('RM')
    else if (t === 'RP') set.add('RP')
  }
  if (set.has('RM') && set.has('RP')) return 'RM+RP'
  if (set.has('RM')) return 'RM'
  if (set.has('RP')) return 'RP'
  return ''
}

/**
 * Spezza il periodo in chunk mensili (di, df) per fare batch di query
 * Supabase. Senza questa partizione una singola .select() viene troncata
 * a 1000 righe (limite default PostgREST) → l'ultimo periodo del calendario
 * mancherebbe le ultime righe.
 *
 * NOTA: usa getter locali (.getDate()) per l'ultimo giorno del mese, MAI
 * toISOString() — converte in UTC e con fuso CEST/CET shift indietro di 1.
 */
function calcolaMesi(cfg: Configurazione): { di: string; df: string }[] {
  const out: { di: string; df: string }[] = []
  let anno = cfg.anno_inizio, mese = cfg.mese_inizio
  while (anno < cfg.anno_fine || (anno === cfg.anno_fine && mese <= cfg.mese_fine)) {
    const di      = `${anno}-${String(mese).padStart(2,'0')}-01`
    const lastDay = new Date(anno, mese, 0).getDate()
    const df      = `${anno}-${String(mese).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`
    out.push({ di, df })
    if (mese === 12) { anno++; mese = 1 } else mese++
  }
  return out
}

// ════════════════════════════════════════════════════════════════════
// EditableCell — singola cella editabile (TC + TR di un medico in un giorno)
// ════════════════════════════════════════════════════════════════════

interface EditableCellProps {
  tipo:             TipoTabella   // 'clinica' = edita TC, 'ricerca' = edita TR
  tc:               TurnoClinico  // sempre passati per la coerenza del modello
  tr:               TurnoRicerca
  isModified:       boolean       // valore corrente diverso dall'originale (per il tipo)
  isFerieApproved:  boolean       // ferie approvate → bg verde solido
  isFeriePending:   boolean       // ferie in attesa → bg verde a righe diagonali
  isRedDay:         boolean       // domenica/festivo
  /** Colore "magia 4-colori" per la cella clinica (calcolato per giorno) */
  ferieGiornoColore?: 'verde'|'azzurro'|'arancione'|'rosso'|null
  slot_mattina?:    'SUB'|'MED'|null   // placement mattina (per cerchio sinistro)
  slot_pomeriggio?: 'SUB'|'MED'|null   // placement pomeriggio (per cerchio destro)
  readOnly?:        boolean       // se true, niente click/editing (es. tabella ricerca)
  onChangeClinico:  (tc: TurnoClinico) => void
  onChangeRicerca:  (tr: TurnoRicerca) => void
  /**
   * Chiamato quando il paste contiene multiple righe/colonne (tab o newline)
   * — tipico paste da Excel. Il parent propaga il contenuto alle celle
   * partendo da questa come ancora (in basso e a destra).
   */
  onPasteRange?:    (text: string) => void
  /**
   * Chiamato al drop di un elemento dalla legenda.
   * Payload: 'TC:M' | 'TC:P' | 'TC:L' | 'TC:REP' | 'TR:RM' | 'TR:RP' | 'FLAG:SUB' | 'FLAG:MED'
   */
  onDropFromLegend?: (payload: string) => void
}

function EditableCell({
  tipo, tc, tr, isModified, isFerieApproved, isFeriePending, isRedDay,
  ferieGiornoColore = null,
  slot_mattina = null, slot_pomeriggio = null, readOnly = false,
  onChangeClinico, onChangeRicerca, onPasteRange, onDropFromLegend,
}: EditableCellProps) {
  const [editing, setEditing] = useState(false)
  const [draft,   setDraft]   = useState('')
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  const startEdit = () => {
    if (readOnly) return
    setDraft(tipo === 'clinica' ? tc : tr)
    setEditing(true)
  }

  const commit = () => {
    if (tipo === 'clinica') {
      const next = parseClinico(draft)
      if (next !== tc) onChangeClinico(next)
    } else {
      const next = parseRicerca(draft)
      if (next !== tr) onChangeRicerca(next)
    }
    setEditing(false)
  }

  // Background cella clinica:
  //   - Medico in ferie APPROVATE → 4-colori del giorno (verde se ferie
  //     gestite, azzurro/arancione/rosso secondo livello di criticità).
  //     Se per qualche motivo il colore non è calcolato, fallback verde.
  //   - Medico in ferie PENDING → verde a righe (info pending del singolo)
  //   - Altri medici → festivo/domenica giallo o neutro
  // Ricerca: bg basato su TR, invariato.
  let bg: string
  if (tipo === 'clinica' && isFerieApproved && ferieGiornoColore) {
    bg = COLORI_FERIE[ferieGiornoColore].bg
  } else if (tipo === 'clinica' && isFerieApproved) {
    bg = '#d5e5d0'
  } else if (tipo === 'clinica' && isFeriePending) {
    bg = 'repeating-linear-gradient(-45deg, #d5e5d0 0, #d5e5d0 3px, #a8c4a0 3px, #a8c4a0 6px)'
  } else if (tipo === 'clinica') {
    bg = isRedDay ? '#fef3c7' : '#fefefe'
  } else {
    const first = tr.split('+')[0]
    bg = CELL_COLORS[first]?.bg ?? (isRedDay ? '#fef3c7' : '#fefefe')
  }

  const modifiedShadow = isModified
    ? 'inset 0 0 0 2px #38bdf8, 0 0 4px 0 rgba(56,189,248,0.4)'
    : undefined

  // Mostro solo il valore pertinente al tipo; il complementare resta "in background"
  const displayValue = tipo === 'clinica' ? tc : tr
  const hasValue     = !!displayValue

  // Highlight visivo durante il drag-over: bordo azzurro+ombra giallo tenue
  const dragOverShadow = dragOver
    ? 'inset 0 0 0 2px #f59e0b, 0 0 6px 0 rgba(245,158,11,0.5)'
    : modifiedShadow

  return (
    <td
      onClick={!editing && !readOnly ? startEdit : undefined}
      onDragOver={e => {
        if (!onDropFromLegend) return
        const types = e.dataTransfer.types
        if (!types.includes(DRAG_MIME) && !types.includes('text/plain')) return
        e.preventDefault()                    // necessario per accettare il drop
        e.dataTransfer.dropEffect = 'copy'
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={e => {
        if (!onDropFromLegend) return
        e.preventDefault()
        setDragOver(false)
        const payload = e.dataTransfer.getData(DRAG_MIME) ||
                        e.dataTransfer.getData('text/plain')
        if (payload) onDropFromLegend(payload)
      }}
      style={{
        width: 32, minWidth: 32, height: 28,
        background:    bg,
        boxShadow:     dragOverShadow,
        cursor:        readOnly ? 'default' : (editing ? 'text' : 'pointer'),
        padding:       0,
        textAlign:     'center',
        verticalAlign: 'middle',
        position:      'relative',
        border:        '1px solid #c0b8a8',
      }}
    >
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={e => setDraft(e.target.value.toUpperCase())}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); commit() }
            else if (e.key === 'Escape') { e.preventDefault(); setEditing(false) }
          }}
          onPaste={e => {
            // Paste da Excel: stringa TSV (tab fra colonne, \n fra righe).
            // Se il testo contiene tab o newline → propaga al parent che
            // riempirà le celle a destra e in basso. Altrimenti default
            // (incolla nell'input come testo singolo).
            const text = e.clipboardData.getData('text')
            if (onPasteRange && (text.includes('\t') || text.includes('\n'))) {
              e.preventDefault()
              onPasteRange(text)
              setEditing(false)
            }
          }}
          maxLength={6}
          spellCheck={false}
          placeholder={tipo === 'clinica' ? 'M/P/L/REP' : 'RM/RP'}
          style={{
            width: '100%', height: '100%',
            border: 'none', outline: 'none',
            background: 'transparent',
            textAlign: 'center',
            fontSize: 11, fontWeight: 700,
            textTransform: 'uppercase',
            padding: 0,
          }}
        />
      ) : hasValue ? (
        tipo === 'clinica'
          ? <LabelClinico tc={tc} slot_mattina={slot_mattina} slot_pomeriggio={slot_pomeriggio} />
          : <LabelRicerca tr={tr} />
      ) : null}
    </td>
  )
}

// ════════════════════════════════════════════════════════════════════
// PAGINA
// ════════════════════════════════════════════════════════════════════

export function ModificaTurniPage() {
  const navigate = useNavigate()
  const { registerNavGuard } = usePendingActions()

  // Realtime sulle ferie: nuove richieste / approvazioni / cancellazioni
  // si riflettono istantaneamente sul pattern verde delle celle.
  useFerieRealtime()

  // Realtime sui turni: se un altro admin sta modificando in parallelo
  // (o un Genera Calendario sta rigenerando tutto), questa tab si aggiorna
  // automaticamente. Usa la queryKey ['turni-modifica'] di questa pagina.
  useTurniRealtime()

  const [view,        setView]        = useState<'lineare' | 'mensile'>('mensile')
  const [navPending,  setNavPending]  = useState<string | null>(null)
  const [saving,      setSaving]      = useState(false)
  const [err,         setErr]         = useState<string | null>(null)
  const [msg,         setMsg]         = useState<string | null>(null)

  // Flag "Autocalc SUB/MED" — quando ON (default) il cambio TC ricalcola
  // automaticamente TR/SUB/MED del giorno via ricalcolaGiorno. Quando OFF
  // il cambio TC modifica SOLO la cella interessata (preservando i
  // placement eligibili al nuovo TC), lasciando all'admin la libertà di
  // gestire manualmente SUB/MED via drag dei pallini dalla legenda.
  // Stato persistito in localStorage così non si reimposta a ogni reload.
  const [autocalcSubMed, setAutocalcSubMed] = useState<boolean>(() => {
    try { return localStorage.getItem('mt_autocalc_submed') !== 'false' }
    catch { return true }
  })
  useEffect(() => {
    try { localStorage.setItem('mt_autocalc_submed', String(autocalcSubMed)) }
    catch {}
  }, [autocalcSubMed])

  // Map<key=`${medicoId}|${data}`, RicalcCell> = modifiche locali non salvate.
  // Ogni entry contiene tc, tr, isSub, isMed insieme: il ricalcolo
  // automatico al cambio TC genera in blocco le modifiche del giorno.
  const [modifiche, setModifiche] =
    useState<Map<string, RicalcCell>>(() => new Map())

  const hasUnsaved = modifiche.size > 0

  // ── Query dati ─────────────────────────────────────────────────────
  const { data: config, isLoading: lCfg } = useQuery<Configurazione | null>({
    queryKey: ['configurazione'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('configurazione').select('*')
        .order('updated_at', { ascending: false }).limit(1).maybeSingle()
      if (error) throw error
      return data
    },
  })

  const { data: medici = [], isLoading: lMed } = useQuery<Medico[]>({
    queryKey: ['medici'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('medici').select('*').eq('attivo', true).order('numero_ordine')
      if (error) throw error
      return data ?? []
    },
  })

  // Condivide la queryKey ['schemi_modello'] con GestioneSchemaPage e
  // GeneraCalendarioPage: così quando lo schema viene salvato altrove,
  // l'invalidateQueries fatto da quella pagina raggiunge anche noi.
  const { data: schemi = [] } = useQuery<SchemaModello[]>({
    queryKey: ['schemi_modello'],
    queryFn: async () => {
      const { data, error } = await supabase.from('schemi_modello').select('*')
        .order('giorno_settimana').order('slot')
      if (error) throw error
      return data ?? []
    },
  })

  // Ferie: usiamo la stessa logica del calendario pubblico — la cella è
  // "in ferie" se la sua data cade dentro un range salvato nella tabella
  // `ferie`, distinguendo ferie approvate (verde solido) da quelle in
  // attesa (verde a righe).
  const { data: ferieDB = [] } = useQuery<Pick<Ferie, 'medico_id' | 'data_inizio' | 'data_fine' | 'approvate'>[]>({
    queryKey: ['ferie-ranges'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ferie').select('medico_id, data_inizio, data_fine, approvate')
      if (error) throw error
      return data ?? []
    },
    // Cache always fresh + polling 15s di safety net (vedi useFerieRealtime)
    staleTime:                   0,
    refetchOnMount:              'always',
    refetchInterval:             15_000,
    refetchIntervalInBackground: false,
  })

  const ferieRanges = useMemo(() => {
    const approved = new Map<string, [string, string][]>()
    const pending  = new Map<string, [string, string][]>()
    for (const f of ferieDB) {
      const map = f.approvate ? approved : pending
      if (!map.has(f.medico_id)) map.set(f.medico_id, [])
      map.get(f.medico_id)!.push([f.data_inizio, f.data_fine])
    }
    return { approved, pending }
  }, [ferieDB])

  // Query turni paginata per mese — la query Supabase è limitata a 1000
  // righe di default; con ~25 medici × 180 giorni siamo a ~4500 righe.
  // Spezziamo in batch mensili (~750 righe/mese) sotto il cap.
  //
  // ATTENZIONE: la queryKey deve dipendere da config.updated_at (NON da
  // config.id, che resta fisso). Così, dopo "Genera Calendario" che fa
  // bumping di updated_at, la key cambia → useQuery rifetcha automatico
  // → niente più sovrapposizione tra turni vecchi e nuovi.
  const { data: turni = [], refetch: refetchTurni, isLoading: lTur } =
    useQuery<Turno[]>({
      queryKey: ['turni-modifica', config?.updated_at],
      enabled:  !!config,
      queryFn: async () => {
        if (!config) return []
        const mesi = calcolaMesi(config)
        let all: Turno[] = []
        for (const { di, df } of mesi) {
          const { data, error } = await supabase
            .from('turni')
            .select('id, medico_id, data, turno_clinico, turno_ricerca, modificato_manualmente, is_ferie, is_sub, is_med, slot_mattina, slot_pomeriggio, note, created_at, updated_at')
            .gte('data', di).lte('data', df)
          if (error) throw error
          all = [...all, ...((data ?? []) as Turno[])]
        }
        return all
      },
    })

  // ── Calcola turni teorici (originali da schema) ────────────────────
  const teoriciByKey = useMemo(() => {
    const map = new Map<string, { tc: TurnoClinico; tr: TurnoRicerca }>()
    if (!config || medici.length === 0 || schemi.length === 0) return map
    const teorici = calcolaCalendarioCompleto(config, schemi, medici)
    for (const t of teorici) {
      map.set(`${t.medico_id}|${t.data}`, { tc: t.turno_clinico, tr: t.turno_ricerca })
    }
    return map
  }, [config, medici, schemi])

  // ── Map dei turni DB persistiti ────────────────────────────────────
  const turniByKey = useMemo(() => {
    const map = new Map<string, Turno>()
    for (const t of turni) map.set(`${t.medico_id}|${t.data}`, t)
    return map
  }, [turni])

  // ── Colonne (giorni) e raggruppamento per mese ─────────────────────
  const colonne = useMemo<ColonnaCal[]>(
    () => config ? generaColonne(config) : [],
    [config],
  )

  const colonnePerMese = useMemo(() => {
    const map = new Map<string, ColonnaCal[]>()
    for (const c of colonne) {
      const k = `${c.anno}-${String(c.mese).padStart(2,'0')}`
      if (!map.has(k)) map.set(k, [])
      map.get(k)!.push(c)
    }
    return Array.from(map.entries()).map(([k, cs]) => {
      const [a, m] = k.split('-').map(Number)
      return { anno: a, mese: m, colonne: cs }
    })
  }, [colonne])

  // ── Helpers per leggere lo stato della singola cella ───────────────
  const getCella = useCallback((medicoId: string, data: string): RicalcCell => {
    const key = `${medicoId}|${data}`
    if (modifiche.has(key)) return modifiche.get(key)!
    const t = turniByKey.get(key)
    return t
      ? {
          tc:              t.turno_clinico,
          tr:              t.turno_ricerca,
          slot_mattina:    t.slot_mattina    ?? null,
          slot_pomeriggio: t.slot_pomeriggio ?? null,
        }
      : { tc: '', tr: '', slot_mattina: null, slot_pomeriggio: null }
  }, [modifiche, turniByKey])

  const getOriginale = useCallback((medicoId: string, data: string): { tc: TurnoClinico; tr: TurnoRicerca } => {
    return teoriciByKey.get(`${medicoId}|${data}`) ?? { tc: '', tr: '' }
  }, [teoriciByKey])

  // "Ferie" come nel calendario pubblico:
  //   - is_ferie del singolo turno (legacy/manual) → conta come approvata
  //   - oppure data dentro un range della tabella ferie
  const ferieStatus = useCallback((medicoId: string, data: string): 'approved' | 'pending' | null => {
    const inRange = (m: Map<string, [string, string][]>) =>
      m.get(medicoId)?.some(([s, e]) => data >= s && data <= e) ?? false
    if ((turniByKey.get(`${medicoId}|${data}`)?.is_ferie ?? false) || inRange(ferieRanges.approved)) {
      return 'approved'
    }
    if (inRange(ferieRanges.pending)) return 'pending'
    return null
  }, [turniByKey, ferieRanges])

  // ── Ricalcolo automatico per un giorno ────────────────────────────
  // Riceve le modifiche TC pendenti per il giorno e produce un Map di
  // delta (key→RicalcCell) per TUTTE le celle del giorno secondo le
  // regole: RM solo a P, RP solo a M, SUB/MED ibride con tie-break
  // (meno turni di quel tipo nel periodo + alfabetico). Il chiamante
  // applica i delta al Map modifiche.
  //
  // ATTENZIONE: la funzione è "pura" lato closure. Per usarla da più
  // entry-point (cambio singola cella, paste multi-cella) accetta lo
  // stato corrente del Map come parametro.
  const ricalcoloGiorno = useCallback((
    data: string,
    tcOverrides: Map<string, TurnoClinico>,
    statoAttuale: Map<string, RicalcCell>,
  ): Map<string, RicalcCell> => {
    if (!config || schemi.length === 0 || medici.length === 0) return statoAttuale

    const mediciAttivi = [...medici].filter(m => m.attivo)
                                    .sort((a, b) => a.numero_ordine - b.numero_ordine)
    const numMedici = mediciAttivi.length

    // ── Schema del giorno_settimana di `data` ─────────────────────
    const dataObj = new Date(data + 'T00:00:00')
    const dWeek = getDayOfWeek(dataObj)   // 1..7
    const schemiGiorno = schemi.filter(s =>
      s.schema_num === config.schema_attivo && s.giorno_settimana === dWeek
    )

    // Capacità split mattina/pomeriggio: ogni slot is_sub contribuisce
    // 1 a sub_m se ha numero_medico_mattina settato e 1 a sub_p se ha
    // numero_medico_pomeriggio settato. Stesso per is_med.
    const capacita = {
      rm:    schemiGiorno.filter(s => s.numero_medico_rm  !== null).length,
      rp:    schemiGiorno.filter(s => s.numero_medico_rp  !== null).length,
      sub_m: schemiGiorno.filter(s => s.is_sub && s.numero_medico_mattina    !== null).length,
      sub_p: schemiGiorno.filter(s => s.is_sub && s.numero_medico_pomeriggio !== null).length,
      med_m: schemiGiorno.filter(s => s.is_med && s.numero_medico_mattina    !== null).length,
      med_p: schemiGiorno.filter(s => s.is_med && s.numero_medico_pomeriggio !== null).length,
    }

    // ── tcGiorno: TC corrente per ogni medico nel giorno target ───
    // Override > modifica locale > DB > vuoto
    const tcGiorno = new Map<string, TurnoClinico>()
    for (const m of mediciAttivi) {
      if (tcOverrides.has(m.id)) {
        tcGiorno.set(m.id, tcOverrides.get(m.id)!)
        continue
      }
      const key = `${m.id}|${data}`
      const cur = statoAttuale.get(key)
      if (cur) tcGiorno.set(m.id, cur.tc)
      else {
        const dbT = turniByKey.get(key)
        tcGiorno.set(m.id, (dbT?.turno_clinico ?? '') as TurnoClinico)
      }
    }

    // ── flagsOriginali: placement teorico del giorno ─────────────
    const flagsOriginali = new Map<string, { slot_mattina: SlotPlacement; slot_pomeriggio: SlotPlacement }>()
    const dataInizioPeriodo = new Date(config.anno_inizio, config.mese_inizio - 1, 1)
    dataInizioPeriodo.setHours(0, 0, 0, 0)
    const dataRifRotazione = primoLunediDelPeriodo(dataInizioPeriodo)
    for (let i = 0; i < numMedici; i++) {
      const teorico = calcolaTurnoTeorico(i, dataObj, dataRifRotazione, numMedici, schemiGiorno)
      flagsOriginali.set(mediciAttivi[i].id, {
        slot_mattina:    teorico.slot_mattina,
        slot_pomeriggio: teorico.slot_pomeriggio,
      })
    }

    // ── contaPeriodo: count rm/rp + sub/med (somma metà) per ogni
    // medico, ESCLUSO il giorno target. SUB/MED contano la SOMMA delle
    // metà giornate (un L con SUB-SUB conta 2 SUB).
    const contaPeriodo = new Map<string, { rm: number; rp: number; sub: number; med: number }>()
    for (const m of mediciAttivi) contaPeriodo.set(m.id, { rm: 0, rp: 0, sub: 0, med: 0 })
    for (const col of colonne) {
      if (col.data === data) continue
      for (const m of mediciAttivi) {
        const key = `${m.id}|${col.data}`
        const cur = statoAttuale.get(key)
        const dbT = turniByKey.get(key)
        const tr = (cur?.tr ?? dbT?.turno_ricerca ?? '') as TurnoRicerca
        const sm = cur?.slot_mattina    ?? dbT?.slot_mattina    ?? null
        const sp = cur?.slot_pomeriggio ?? dbT?.slot_pomeriggio ?? null
        const c = contaPeriodo.get(m.id)!
        if (tr === 'RM') c.rm++
        else if (tr === 'RP') c.rp++
        if (sm === 'SUB') c.sub++
        if (sp === 'SUB') c.sub++
        if (sm === 'MED') c.med++
        if (sp === 'MED') c.med++
      }
    }

    // ── Esegui il ricalcolo ────────────────────────────────────
    return ricalcolaGiorno({
      capacita,
      medici: mediciAttivi,
      tcGiorno,
      flagsOriginali,
      contaPeriodo,
    })
  }, [config, schemi, medici, turniByKey, colonne])

  // ── Update cella (TC) → triggera ricalcolo del giorno ──────────────
  // Cambia il TC di un medico in un giorno e (se autocalcSubMed è ON)
  // ridistribuisce automaticamente TR/SUB/MED del giorno. Il delta vs DB
  // viene calcolato per ogni cella del giorno: se il risultato coincide
  // col DB l'entry è rimossa dal Map (no falso modificato).
  // Quando autocalcSubMed è OFF, modifichiamo SOLO la cella interessata:
  // niente ridistribuzione, i placement vengono solo normalizzati per
  // rimuovere quelli non eligibili al nuovo TC (es. tc=M → slot_pomeriggio
  // non ha senso, lo azzero). L'admin gestisce manualmente SUB/MED via
  // drag dei pallini dalla legenda.
  const updateCella = useCallback((medicoId: string, data: string, tc: TurnoClinico, _tr: TurnoRicerca) => {
    setModifiche(prev => {
      const next = new Map(prev)

      if (autocalcSubMed) {
        // Comportamento classico: ricalcola tutto il giorno.
        const overrides = new Map<string, TurnoClinico>()
        overrides.set(medicoId, tc)
        const result = ricalcoloGiorno(data, overrides, prev)
        for (const [medId, newCell] of result) {
          const key = `${medId}|${data}`
          const dbT = turniByKey.get(key)
          const dbCur: RicalcCell = {
            tc:              (dbT?.turno_clinico ?? '') as TurnoClinico,
            tr:              (dbT?.turno_ricerca  ?? '') as TurnoRicerca,
            slot_mattina:    dbT?.slot_mattina    ?? null,
            slot_pomeriggio: dbT?.slot_pomeriggio ?? null,
          }
          if (newCell.tc === dbCur.tc && newCell.tr === dbCur.tr &&
              newCell.slot_mattina === dbCur.slot_mattina &&
              newCell.slot_pomeriggio === dbCur.slot_pomeriggio) {
            next.delete(key)
          } else {
            next.set(key, newCell)
          }
        }
      } else {
        // Modalità manuale: tocca SOLO la cella corrente, niente ridistribuzione.
        const key = `${medicoId}|${data}`
        const local = prev.get(key)
        const dbT = turniByKey.get(key)
        const cur: RicalcCell = local ?? {
          tc:              (dbT?.turno_clinico ?? '') as TurnoClinico,
          tr:              (dbT?.turno_ricerca  ?? '') as TurnoRicerca,
          slot_mattina:    dbT?.slot_mattina    ?? null,
          slot_pomeriggio: dbT?.slot_pomeriggio ?? null,
        }
        // Normalizza i placement: rimuovi quelli non eligibili al nuovo TC.
        // I valori esistenti per le metà ancora eligibili vengono preservati,
        // così se l'admin aveva trascinato un SUB/MED prima, resta dov'era.
        const newCell: RicalcCell = {
          tc,
          tr: cur.tr,  // TR invariato — gestito dalla legenda drag
          slot_mattina:    (tc === 'M' || tc === 'L') ? cur.slot_mattina    : null,
          slot_pomeriggio: (tc === 'P' || tc === 'L') ? cur.slot_pomeriggio : null,
        }
        const dbCur: RicalcCell = {
          tc:              (dbT?.turno_clinico ?? '') as TurnoClinico,
          tr:              (dbT?.turno_ricerca  ?? '') as TurnoRicerca,
          slot_mattina:    dbT?.slot_mattina    ?? null,
          slot_pomeriggio: dbT?.slot_pomeriggio ?? null,
        }
        if (newCell.tc === dbCur.tc && newCell.tr === dbCur.tr &&
            newCell.slot_mattina === dbCur.slot_mattina &&
            newCell.slot_pomeriggio === dbCur.slot_pomeriggio) {
          next.delete(key)
        } else {
          next.set(key, newCell)
        }
      }
      return next
    })
  }, [autocalcSubMed, ricalcoloGiorno, turniByKey])

  // ── Drop dalla legenda ────────────────────────────────────────────
  // Le icone della legenda sono draggabili. Drop su una cella applica:
  //   TC:M / TC:P / TC:L / TC:REP  →  setta TC, ricalcola il giorno
  //   TR:RM / TR:RP                →  toggle TR (set o svuota se uguale)
  //   FLAG:SUB / FLAG:MED          →  toggle flag, niente ricalcolo
  // Il drop di TC è equivalente a un editing manuale; gli altri sono
  // override "manuali" che il prossimo ricalcolo del giorno potrebbe
  // sovrascrivere se cambia un TC.
  const handleDropFromLegend = useCallback((medicoId: string, data: string, payload: string) => {
    if (payload.startsWith('TC:')) {
      const newTc = payload.slice(3) as TurnoClinico
      if (newTc === 'M' || newTc === 'P' || newTc === 'L' || newTc === 'REP') {
        const k = `${medicoId}|${data}`
        const local = modifiche.get(k)
        const dbT = turniByKey.get(k)
        const curTr = (local?.tr ?? dbT?.turno_ricerca ?? '') as TurnoRicerca
        updateCella(medicoId, data, newTc, curTr)
      }
      return
    }

    // TR / FLAG: aggiornamento diretto della singola cella, no ricalcolo
    setModifiche(prev => {
      const next = new Map(prev)
      const key = `${medicoId}|${data}`
      const local = next.get(key)
      const dbT = turniByKey.get(key)
      const cur: RicalcCell = local ?? {
        tc:              (dbT?.turno_clinico ?? '') as TurnoClinico,
        tr:              (dbT?.turno_ricerca  ?? '') as TurnoRicerca,
        slot_mattina:    dbT?.slot_mattina    ?? null,
        slot_pomeriggio: dbT?.slot_pomeriggio ?? null,
      }

      let updated: RicalcCell = cur

      if (payload === 'TR:RM') {
        updated = { ...cur, tr: cur.tr === 'RM' ? '' : 'RM' }
      } else if (payload === 'TR:RP') {
        updated = { ...cur, tr: cur.tr === 'RP' ? '' : 'RP' }
      } else if (payload === 'FLAG:SUB' || payload === 'FLAG:MED') {
        const X: SlotPlacement = payload === 'FLAG:SUB' ? 'SUB' : 'MED'
        // Logica drop:
        //   1) se mattina == X     → toggle off (mattina = null)
        //   2) elif pomeriggio==X  → toggle off (pomeriggio = null)
        //   3) elif mattina null   → mattina = X (riempi)
        //   4) elif pomeriggio null→ pomeriggio = X (riempi)
        //   5) else (entrambe ≠ X) → mattina = X (sostituisci, riparte ciclo)
        // Filtri di eligibilità: la mattina la posso settare solo se TC ∈ {M,L},
        // il pomeriggio solo se TC ∈ {P,L}. REP/'' non possono ricevere flag.
        const tc = cur.tc
        const canM = tc === 'M' || tc === 'L'
        const canP = tc === 'P' || tc === 'L'
        let sm = cur.slot_mattina
        let sp = cur.slot_pomeriggio
        if (canM && sm === X) sm = null
        else if (canP && sp === X) sp = null
        else if (canM && sm === null) sm = X
        else if (canP && sp === null) sp = X
        else if (canM) sm = X    // entrambe piene di altro: sostituisci mattina
        // Se !canM && !canP (REP, vuoto): nessun cambio
        updated = { ...cur, slot_mattina: sm, slot_pomeriggio: sp }
      } else {
        return prev
      }

      // Smart delta: se = DB, rimuovi l'entry
      const dbCur: RicalcCell = {
        tc:              (dbT?.turno_clinico ?? '') as TurnoClinico,
        tr:              (dbT?.turno_ricerca  ?? '') as TurnoRicerca,
        slot_mattina:    dbT?.slot_mattina    ?? null,
        slot_pomeriggio: dbT?.slot_pomeriggio ?? null,
      }
      if (updated.tc === dbCur.tc && updated.tr === dbCur.tr &&
          updated.slot_mattina === dbCur.slot_mattina &&
          updated.slot_pomeriggio === dbCur.slot_pomeriggio) {
        next.delete(key)
      } else {
        next.set(key, updated)
      }
      return next
    })
  }, [turniByKey, updateCella])

  // ── Paste multi-cella (clinica) ───────────────────────────────────
  // Riceve il testo TSV dal clipboard di Excel + ancora (medico/data della
  // cella in cui l'utente ha cliccato e fatto Ctrl+V). Itera righe×colonne
  // e applica a ciascuna cella di destinazione il TC parsato dal testo,
  // preservando il TR esistente. Le celle che escono dal range (medico
  // mancante o data oltre il periodo) vengono ignorate.
  const handlePasteRange = useCallback((medicoIdAncora: string, dataAncora: string, text: string) => {
    const startRowIdx = medici.findIndex(m => m.id === medicoIdAncora)
    const startColIdx = colonne.findIndex(c => c.data === dataAncora)
    if (startRowIdx < 0 || startColIdx < 0) return

    // Excel termina spesso il blocco con un newline finale → lo trimmo.
    // \r\n di Windows → \n.
    const rows = text.replace(/\r/g, '').replace(/\n+$/, '').split('\n')

    // Raggruppa gli override per giorno: { data → Map<medicoId, newTc> }
    // Così possiamo ricalcolare un giorno alla volta (ricalcoloGiorno è
    // l'unità di lavoro: applicare i nuovi TC in blocco e poi
    // ridistribuire RM/RP/SUB/MED).
    const overridePerGiorno = new Map<string, Map<string, TurnoClinico>>()
    let appliedCount = 0
    for (let r = 0; r < rows.length; r++) {
      const targetMedico = medici[startRowIdx + r]
      if (!targetMedico) break
      const cells = rows[r].split('\t')
      for (let c = 0; c < cells.length; c++) {
        const targetCol = colonne[startColIdx + c]
        if (!targetCol) break
        const newTc = parseClinico(cells[c])
        if (!overridePerGiorno.has(targetCol.data)) {
          overridePerGiorno.set(targetCol.data, new Map())
        }
        overridePerGiorno.get(targetCol.data)!.set(targetMedico.id, newTc)
        appliedCount++
      }
    }

    setModifiche(prev => {
      const next = new Map(prev)
      for (const [data, overrides] of overridePerGiorno) {
        const result = ricalcoloGiorno(data, overrides, next)
        for (const [medId, newCell] of result) {
          const key = `${medId}|${data}`
          const dbT = turniByKey.get(key)
          const dbCur: RicalcCell = {
            tc:              (dbT?.turno_clinico ?? '') as TurnoClinico,
            tr:              (dbT?.turno_ricerca  ?? '') as TurnoRicerca,
            slot_mattina:    dbT?.slot_mattina    ?? null,
            slot_pomeriggio: dbT?.slot_pomeriggio ?? null,
          }
          if (newCell.tc === dbCur.tc && newCell.tr === dbCur.tr &&
              newCell.slot_mattina === dbCur.slot_mattina &&
              newCell.slot_pomeriggio === dbCur.slot_pomeriggio) {
            next.delete(key)
          } else {
            next.set(key, newCell)
          }
        }
      }
      return next
    })

    setMsg(`✓ Incollati ${appliedCount} turn${appliedCount === 1 ? 'o' : 'i'} dal clipboard`)
    setTimeout(() => setMsg(null), 3000)
  }, [medici, colonne, turniByKey, ricalcoloGiorno])

  // ── Totale turni clinici coperti in un giorno ─────────────────────
  // Conteggio per la riga "TURNI TOTALI" sotto la tabella clinica:
  //   M = 1, P = 1, L = 2 (= M+P), REP = 0, vuoto = 0
  // Si aggiorna in tempo reale mentre si modificano le celle (perché
  // getCella legge prima dal Map modifiche locali, poi dal DB).
  const calcolaTotaleClinici = useCallback((data: string): number => {
    let total = 0
    for (const m of medici) {
      const { tc } = getCella(m.id, data)
      if (tc === 'M' || tc === 'P') total += 1
      else if (tc === 'L')          total += 2
      // REP e stringa vuota non contano
    }
    return total
  }, [medici, getCella])

  // ── Conteggio metà-giornate per placement (SUB / MED) ─────────────
  // Le righe "TURNI IN SUB" / "TURNI IN MED" contano le metà giornate
  // (slot_mattina + slot_pomeriggio) assegnate a quel placement. Le L
  // contribuiscono fino a 2 (una per metà), M e P fino a 1 ciascuno,
  // REP 0. Insieme sub + med == tot (riga TURNI TOTALI). In un giorno
  // bilanciato: sub == med == tot/2.
  const calcolaTotalePlacement = useCallback(
    (data: string, placement: 'SUB' | 'MED'): number => {
      let total = 0
      for (const m of medici) {
        const cur = getCella(m.id, data)
        if (cur.slot_mattina    === placement) total++
        if (cur.slot_pomeriggio === placement) total++
      }
      return total
    },
    [medici, getCella],
  )

  // ── beforeunload — blocca chiusura/refresh tab ─────────────────────
  useEffect(() => {
    if (!hasUnsaved) return
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [hasUnsaved])

  // ── navGuard — blocca cambio pagina in-app (modal di conferma) ─────
  useEffect(() => {
    if (hasUnsaved) {
      registerNavGuard((to: string) => {
        setNavPending(to)
        return false
      })
    } else {
      registerNavGuard(null)
    }
    return () => registerNavGuard(null)
  }, [hasUnsaved, registerNavGuard])

  // ── Salva tutte le modifiche pendenti ──────────────────────────────
  async function handleSave() {
    if (modifiche.size === 0) return
    setSaving(true); setErr(null); setMsg(null)
    try {
      const updates = Array.from(modifiche.entries()).map(([key, { tc, tr, slot_mattina, slot_pomeriggio }]) => {
        const [medico_id, data] = key.split('|')
        const orig = getOriginale(medico_id, data)
        const modificato_manualmente = (tc !== orig.tc) || (tr !== orig.tr)
        const dbT = turniByKey.get(key)
        // is_sub / is_med calcolati come backward-compat (OR sui placement)
        const is_sub = slot_mattina === 'SUB' || slot_pomeriggio === 'SUB'
        const is_med = slot_mattina === 'MED' || slot_pomeriggio === 'MED'
        return {
          medico_id,
          data,
          turno_clinico:           tc,
          turno_ricerca:           tr,
          modificato_manualmente,
          slot_mattina,
          slot_pomeriggio,
          is_sub,
          is_med,
          is_ferie: dbT?.is_ferie ?? false,
          note:     dbT?.note     ?? null,
        }
      })
      const { error } = await supabase.from('turni')
        .upsert(updates, { onConflict: 'medico_id,data' })
      if (error) throw error
      setMsg(`✓ ${updates.length} turn${updates.length === 1 ? 'o aggiornato' : 'i aggiornati'}`)
      setModifiche(new Map())
      await refetchTurni()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  // Magia 4 colori per giorno — ricalcolato in tempo reale al cambio
  // di TC/TR/modifiche locali. Viene applicato solo alle celle clinica
  // (cell senza ferie del medico) per dare feedback visivo immediato.
  const colorePerGiorno = useMemo(() => {
    const m = new Map<string, ReturnType<typeof calcolaColoreFerie>>()
    if (!config) return m
    const limite = config.max_ferie_concomitanti ?? 2
    for (const col of colonne) {
      m.set(col.data, calcolaColoreFerie({
        data: col.data,
        medici,
        ferieApprovate: ferieRanges.approved,
        getTurno: (mid, data) => {
          const cur = getCella(mid, data)
          return { tc: cur.tc, tr: cur.tr }
        },
        limite,
      }))
    }
    return m
  }, [config, colonne, medici, ferieRanges.approved, getCella])

  // ── Render di una singola cella ───────────────────────────────────
  // Il "tipo" determina quale parte della cella visualizzare/editare:
  //   - 'clinica'  → mostra/edita TC, lascia TR invariato
  //   - 'ricerca'  → mostra/edita TR, lascia TC invariato
  // Il bordo azzurro "modificato" si vede SOLO nella tabella clinica:
  // la ricerca è read-only (i TR sono ricalcolati automaticamente dal
  // cambio TC), evidenziarli sarebbe rumore visivo.
  const renderCella = (medicoId: string, col: ColonnaCal, tipo: TipoTabella) => {
    const cur  = getCella(medicoId, col.data)
    const orig = getOriginale(medicoId, col.data)
    const isMod = tipo === 'clinica' && cur.tc !== orig.tc
    const ferie = ferieStatus(medicoId, col.data)
    const ferieColore = colorePerGiorno.get(col.data)?.color ?? null
    return (
      <EditableCell
        key={`${medicoId}|${col.data}|${tipo}`}
        tipo={tipo}
        tc={cur.tc} tr={cur.tr}
        isModified={isMod}
        isFerieApproved={ferie === 'approved'}
        isFeriePending={ferie === 'pending'}
        isRedDay={col.isDomenica || col.isFestivo}
        ferieGiornoColore={ferieColore}
        // Placement mattina/pomeriggio dal Map modifiche (ricalcolati
        // automatic ad ogni cambio TC) o dal DB se non c'è modifica locale.
        slot_mattina={cur.slot_mattina}
        slot_pomeriggio={cur.slot_pomeriggio}
        // Tabella RICERCA: read-only — RM/RP sono ricalcolati automatic
        // dal cambio TC (regola: RM solo a P, RP solo a M).
        readOnly={tipo === 'ricerca'}
        onChangeClinico={tcNew => updateCella(medicoId, col.data, tcNew, cur.tr)}
        onChangeRicerca={trNew => updateCella(medicoId, col.data, cur.tc, trNew)}
        // Paste multi-cella SOLO per la clinica: copia da Excel di un
        // blocco medici × giorni e si propaga a partire da questa cella.
        onPasteRange={tipo === 'clinica'
          ? (text) => handlePasteRange(medicoId, col.data, text)
          : undefined}
        // Drop dalla legenda: TC e flag sub/med solo su clinica;
        // TR (RM/RP) solo su ricerca. Filtriamo nel handler stesso.
        onDropFromLegend={(payload) => {
          // Drop di TC o FLAG: solo nella clinica
          if (tipo === 'clinica' && (payload.startsWith('TC:') || payload.startsWith('FLAG:'))) {
            handleDropFromLegend(medicoId, col.data, payload)
          }
          // Drop di TR: solo nella ricerca
          else if (tipo === 'ricerca' && payload.startsWith('TR:')) {
            handleDropFromLegend(medicoId, col.data, payload)
          }
          // Altri combinazioni: ignorate (drop si annulla silenziosamente)
        }}
      />
    )
  }

  // ── Tabella generica (clinica o ricerca) per un set di colonne ────
  function TabellaPeriodo({ cols, tipo }: { cols: ColonnaCal[]; tipo: TipoTabella }) {
    // Clinica: verde olive scuro · Ricerca: rosso vinaccia (burgundy)
    const headerBg     = tipo === 'clinica' ? '#456b3a' : '#7a2233'
    const headerBorder = tipo === 'clinica' ? '#2b3c24' : '#5a1a26'
    return (
      <table className="border-collapse" style={{ tableLayout: 'fixed', borderSpacing: 0 }}>
        <thead>
          <tr>
            <th style={{
              width: 140, minWidth: 140,
              position: 'sticky', left: 0, zIndex: 2,
              background: headerBg, color: '#fff',
              fontSize: 11, fontWeight: 700, padding: '6px 8px',
              border: `1px solid ${headerBorder}`, letterSpacing: '0.04em',
              textAlign: 'left',
            }}>
              Medico — {tipo === 'clinica' ? 'Clinica' : 'Ricerca'}
            </th>
            {cols.map(c => {
              const isRedDay = c.isDomenica || c.isFestivo

              // Tooltip header con stat ferie del giorno (no colorazione qui:
              // i 4 colori vanno alle celle, non all'header)
              const limite = config?.max_ferie_concomitanti ?? 2
              const calc = colorePerGiorno.get(c.data)
              const titleText = calc?.color
                ? `${c.data} — ${ETICHETTA_COLORE[calc.color]} (${calc.totInFerieOggi} ferie, ${calc.turniScoperti} scoperti, max ${limite})`
                : c.data

              return (
                <th key={c.data} title={titleText} style={{
                  width: 32, minWidth: 32,
                  background: isRedDay ? '#fef3c7' : '#f0ece4',
                  color:      isRedDay ? '#854d0e' : '#3a3d30',
                  fontSize: 10, padding: '2px 0',
                  border: '1px solid #c0b8a8',
                  lineHeight: 1.1,
                }}>
                  <div style={{ fontWeight: 700 }}>{c.giorno}</div>
                  <div style={{ fontSize: 8, fontWeight: 400, opacity: 0.75 }}>
                    {dayLetter(c.data)}
                  </div>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {medici.map(m => (
            <tr key={m.id}>
              <td style={{
                width: 140, minWidth: 140,
                position: 'sticky', left: 0, zIndex: 1,
                background: '#fff',
                fontSize: 11, padding: '4px 8px',
                border: '1px solid #d5ccb8',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                fontWeight: 500, color: '#3a3d30',
              }}>{m.nome}</td>
              {cols.map(c => renderCella(m.id, c, tipo))}
            </tr>
          ))}

          {/* Righe totali turni — SOLO sotto la tabella Clinica:
                1) TURNI TOTALI  M=1, P=1, L=2, REP=0   azzurro
                2) TURNI IN SUB  count(slot_mattina/pom = SUB)  rosa
                3) TURNI IN MED  count(slot_mattina/pom = MED)  azzurro tenue
              Tutti si aggiornano in tempo reale (getCella legge dal Map
              modifiche prima del DB). In un giorno bilanciato vale
              sub + med == tot, e idealmente sub ≈ med. */}
          {tipo === 'clinica' && (
            <>
              <tr>
                <td style={{
                  width: 140, minWidth: 140,
                  position: 'sticky', left: 0, zIndex: 1,
                  background: '#7eb6d4', color: '#fff',
                  fontSize: 11, fontWeight: 800, padding: '4px 8px',
                  border: '1px solid #5d9bc1',
                  letterSpacing: '0.06em',
                  whiteSpace: 'nowrap',
                }}>
                  TURNI TOTALI
                </td>
                {cols.map(c => {
                  const tot = calcolaTotaleClinici(c.data)
                  return (
                    <td key={c.data} style={{
                      width: 32, minWidth: 32, height: 24,
                      background: '#7eb6d4', color: '#fff',
                      fontSize: 12, fontWeight: 700,
                      textAlign: 'center', verticalAlign: 'middle',
                      border: '1px solid #5d9bc1',
                      padding: 0,
                    }}>
                      {tot || ''}
                    </td>
                  )
                })}
              </tr>

              {/* TURNI IN SUB — colore coerente col chip SUB (rosa pastello + bordo rosso) */}
              <tr>
                <td style={{
                  width: 140, minWidth: 140,
                  position: 'sticky', left: 0, zIndex: 1,
                  background: '#fecaca', color: '#9f1239',
                  fontSize: 11, fontWeight: 800, padding: '4px 8px',
                  border: '1px solid #dc2626',
                  letterSpacing: '0.06em',
                  whiteSpace: 'nowrap',
                }}>
                  TURNI IN SUB
                </td>
                {cols.map(c => {
                  const n = calcolaTotalePlacement(c.data, 'SUB')
                  return (
                    <td key={c.data} style={{
                      width: 32, minWidth: 32, height: 24,
                      background: '#fecaca', color: '#9f1239',
                      fontSize: 12, fontWeight: 700,
                      textAlign: 'center', verticalAlign: 'middle',
                      border: '1px solid #dc2626',
                      padding: 0,
                    }}>
                      {n || ''}
                    </td>
                  )
                })}
              </tr>

              {/* TURNI IN MED — colore coerente col chip MED (azzurro pastello + bordo cyan) */}
              <tr>
                <td style={{
                  width: 140, minWidth: 140,
                  position: 'sticky', left: 0, zIndex: 1,
                  background: '#bae6fd', color: '#0c4a6e',
                  fontSize: 11, fontWeight: 800, padding: '4px 8px',
                  border: '1px solid #0284c7',
                  letterSpacing: '0.06em',
                  whiteSpace: 'nowrap',
                }}>
                  TURNI IN MED
                </td>
                {cols.map(c => {
                  const n = calcolaTotalePlacement(c.data, 'MED')
                  return (
                    <td key={c.data} style={{
                      width: 32, minWidth: 32, height: 24,
                      background: '#bae6fd', color: '#0c4a6e',
                      fontSize: 12, fontWeight: 700,
                      textAlign: 'center', verticalAlign: 'middle',
                      border: '1px solid #0284c7',
                      padding: 0,
                    }}>
                      {n || ''}
                    </td>
                  )
                })}
              </tr>
            </>
          )}
        </tbody>
      </table>
    )
  }

  /** Coppia di tabelle (clinica + ricerca) + legenda per uno stesso periodo */
  function CoppiaTabelle({ cols }: { cols: ColonnaCal[] }) {
    return (
      <div className="space-y-2">
        <div className="overflow-auto rounded-lg border border-stone-300 bg-white">
          <TabellaPeriodo cols={cols} tipo="clinica" />
        </div>
        <div className="overflow-auto rounded-lg border bg-white" style={{ borderColor: '#c98a96' }}>
          <TabellaPeriodo cols={cols} tipo="ricerca" />
        </div>
        {/* Legenda — sempre visibile sotto le tabelle del mese */}
        <LegendaCalendario variant="admin" />
      </div>
    )
  }

  // ── Loading / errori ───────────────────────────────────────────────
  const loading = lCfg || lMed || lTur
  if (!config && !loading) {
    return (
      <div className="text-stone-600 text-sm">
        Configurazione non trovata. Genera prima un calendario dalla pagina "Genera Calendario".
      </div>
    )
  }

  // ── Render principale ──────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-stone-800 flex items-center gap-2">
            <Calendar size={20} style={{ color: '#476540' }} />
            Modifica Turni
          </h2>
          <p className="text-sm text-stone-600 mt-0.5">
            <strong>Clinica</strong>: clicca per modificare TC,
            <kbd className="px-1 py-0.5 rounded text-[10px]" style={{background:'#f0ece4',border:'1px solid #d5ccb8'}}>Ctrl+V</kbd> da Excel,
            o trascina M / P / L / REP dalla legenda. Per L con sub mattina + med pomeriggio (o viceversa),
            il cerchio si divide a metà — primo drop di Ⓢ / Ⓜ = mattina, secondo = pomeriggio.
            <strong className="ml-2">Ricerca</strong>: trascina RM (a chi fa P) o RP (a chi fa M).
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Toggle vista */}
          <div className="flex rounded-lg overflow-hidden border border-stone-300">
            <button
              onClick={() => setView('mensile')}
              className="px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 transition-colors"
              style={view === 'mensile'
                ? { background: '#476540', color: '#fff' }
                : { background: '#faf8f3', color: '#5a5a4a' }}>
              <Layers size={13} /> Mensile
            </button>
            <button
              onClick={() => setView('lineare')}
              className="px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 transition-colors"
              style={view === 'lineare'
                ? { background: '#476540', color: '#fff' }
                : { background: '#faf8f3', color: '#5a5a4a' }}>
              <Rows3 size={13} /> Lineare
            </button>
          </div>

          {/* Badge modifiche non salvate */}
          {hasUnsaved && (
            <span className="px-2.5 py-1 rounded-lg text-xs font-semibold animate-pulse shrink-0"
              style={{ background: '#f59e0b', color: '#fff' }}>
              {modifiche.size} {modifiche.size === 1 ? 'modifica non salvata' : 'modifiche non salvate'}
            </span>
          )}

          {/* Flag autocalc SUB/MED — quando OFF, il cambio TC NON
              ridistribuisce automaticamente sub/med del giorno. L'admin
              gestisce manualmente i pallini via drag dalla legenda.
              Stato persistito in localStorage. */}
          <label
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium cursor-pointer select-none border transition-colors"
            style={autocalcSubMed
              ? { background: '#e0e8d8', color: '#456b3a', borderColor: '#9ab488' }
              : { background: '#fef3c7', color: '#92400e', borderColor: '#fbbf24' }}
            title={autocalcSubMed
              ? 'Autocalc SUB/MED attivo: cambiare un TC redistribuisce automaticamente i placement del giorno. Disattivalo per gestire SUB/MED a mano.'
              : 'Autocalc SUB/MED disattivato: il cambio TC tocca solo la cella interessata. Trascina i pallini Sub/Med dalla legenda per assegnarli manualmente.'}>
            <input
              type="checkbox"
              checked={autocalcSubMed}
              onChange={e => setAutocalcSubMed(e.target.checked)}
              style={{ accentColor: '#476540', cursor: 'pointer' }}
            />
            Autocalc SUB/MED
          </label>

          {/* Bottone salva */}
          <button
            onClick={handleSave}
            disabled={!hasUnsaved || saving}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white shadow disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            style={{ background: hasUnsaved && !saving ? '#476540' : '#9ca3af' }}
            onMouseEnter={e => { if (hasUnsaved && !saving) (e.currentTarget as HTMLElement).style.background = '#456b3a' }}
            onMouseLeave={e => { if (hasUnsaved && !saving) (e.currentTarget as HTMLElement).style.background = '#476540' }}>
            <Save size={13} />
            {saving ? 'Salvataggio…' : 'Salva'}
          </button>
        </div>
      </div>

      {/* Messaggi */}
      {msg && (
        <div className="px-3 py-2 rounded-lg text-xs"
          style={{ background: '#d5e5d0', color: '#2e5a28', border: '1px solid #a8c4a0' }}>
          {msg}
        </div>
      )}
      {err && (
        <div className="px-3 py-2 rounded-lg text-xs"
          style={{ background: '#fde0e0', color: '#7a2020', border: '1px solid #f0c0c0' }}>
          Errore: {err}
        </div>
      )}

      {/* Spinner di caricamento iniziale */}
      {loading && (
        <div className="flex items-center gap-2 text-stone-600 text-sm">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2"
            style={{ borderColor: '#476540' }} />
          Caricamento turni…
        </div>
      )}

      {/* Tabelle */}
      {!loading && config && view === 'lineare' && (
        <CoppiaTabelle cols={colonne} />
      )}

      {!loading && config && view === 'mensile' && (
        <div className="space-y-6">
          {colonnePerMese.map(({ anno, mese, colonne: cs }) => (
            <div key={`${anno}-${mese}`}>
              <h3 className="text-sm font-bold mb-1.5 flex items-center gap-2"
                style={{ color: '#476540' }}>
                <Calendar size={14} />
                {MESI_IT[mese]} {anno}
                <span className="text-[10px] font-normal text-stone-500">
                  ({cs.length} giorni)
                </span>
              </h3>
              <CoppiaTabelle cols={cs} />
            </div>
          ))}
        </div>
      )}

      {/* Riepilogo turni — in fondo, copre TUTTI i medici per l'intero periodo.
          Si auto-aggiorna in tempo reale con le modifiche locali (getCella legge
          prima dal Map modifiche, poi dal DB). */}
      {!loading && config && colonne.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-bold mb-1.5 flex items-center gap-2"
            style={{ color: '#456b3a' }}>
            <Calendar size={14} />
            Riepilogo turni — periodo intero
            <span className="text-[10px] font-normal text-stone-500">
              ({colonne.length} giorni · M=1, P=1, L=2, REP=0)
            </span>
          </h3>
          <div className="overflow-auto rounded-lg border border-stone-300 bg-white">
            <RiepilogoTurni
              medici={medici}
              colonne={colonne}
              getCellInfo={(mid, data) => {
                const cur = getCella(mid, data)
                return {
                  tc:              cur.tc,
                  slot_mattina:    cur.slot_mattina,
                  slot_pomeriggio: cur.slot_pomeriggio,
                }
              }}
            />
          </div>
        </div>
      )}

      {/* Modal blocco navigazione — modifiche non salvate */}
      <ConfirmModal
        open={navPending !== null}
        title="Modifiche non salvate"
        message={`Hai ${modifiche.size} ${modifiche.size === 1 ? 'modifica' : 'modifiche'} ai turni non ancora salvate. Se esci ora andranno perse.`}
        confirmLabel="Rimani e salva"
        cancelLabel="Esci senza salvare"
        danger={false}
        onConfirm={() => setNavPending(null)}
        onCancel={() => {
          const dest = navPending!
          setModifiche(new Map())
          setNavPending(null)
          navigate(dest)
        }}
      />
    </div>
  )
}
