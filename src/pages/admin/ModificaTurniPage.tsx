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
  calcolaCalendarioCompleto, generaColonne, MESI_IT,
} from '../../lib/algorithm'
import { ConfirmModal } from '../../components/ConfirmModal'
import { usePendingActions } from '../../contexts/PendingActionsContext'
import type {
  Configurazione, Medico, SchemaModello, Turno,
  TurnoClinico, TurnoRicerca, ColonnaCal,
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

/** Etichetta del turno clinico (M / P / L / REP) */
function LabelClinico({ tc }: { tc: string }) {
  if (!tc) return null
  return (
    <span className="pointer-events-none select-none" style={{
      fontSize:      tc === 'REP' ? 11 : 13,
      fontWeight:    700,
      color:         tc === 'REP' ? '#b91c1c' : (CELL_COLORS[tc]?.fg ?? '#3a3d30'),
      letterSpacing: tc === 'REP' ? '-0.3px' : undefined,
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
  tipo:        TipoTabella   // 'clinica' = edita TC, 'ricerca' = edita TR
  tc:          TurnoClinico  // sempre passati per il bg/check; quello "non gestito" dal tipo è readonly
  tr:          TurnoRicerca
  isModified:  boolean       // valore corrente diverso dall'originale (per il tipo della tabella)
  isFerie:     boolean
  isRedDay:    boolean       // domenica/festivo
  onChangeClinico:  (tc: TurnoClinico) => void
  onChangeRicerca:  (tr: TurnoRicerca) => void
}

function EditableCell({
  tipo, tc, tr, isModified, isFerie, isRedDay,
  onChangeClinico, onChangeRicerca,
}: EditableCellProps) {
  const [editing, setEditing] = useState(false)
  const [draft,   setDraft]   = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  const startEdit = () => {
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

  // Background della cella:
  // - clinica: colore basato su TC (verde M, blu P, beige L, rosso REP)
  // - ricerca: colore basato su TR (viola RM, magenta RP, mix)
  // Ferie e festivi hanno priorità sul background neutro.
  let bg: string
  if (isFerie) {
    bg = 'repeating-linear-gradient(-45deg, #d5e5d0 0, #d5e5d0 3px, #a8c4a0 3px, #a8c4a0 6px)'
  } else if (tipo === 'clinica') {
    bg = CELL_COLORS[tc]?.bg ?? (isRedDay ? '#fde0e0' : '#fefefe')
  } else {
    // ricerca: prendi il primo TR per il colore (RM > RP arbitrariamente)
    const first = tr.split('+')[0]
    bg = CELL_COLORS[first]?.bg ?? (isRedDay ? '#fde0e0' : '#fefefe')
  }

  const modifiedShadow = isModified
    ? 'inset 0 0 0 2px #38bdf8, 0 0 4px 0 rgba(56,189,248,0.4)'
    : undefined

  // Mostro solo il valore pertinente al tipo; il complementare resta "in background"
  const displayValue = tipo === 'clinica' ? tc : tr
  const hasValue     = !!displayValue

  return (
    <td
      onClick={!editing ? startEdit : undefined}
      style={{
        width: 32, minWidth: 32, height: 28,
        background:    bg,
        boxShadow:     modifiedShadow,
        cursor:        editing ? 'text' : 'pointer',
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
          ? <LabelClinico tc={tc} />
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

  const [view,        setView]        = useState<'lineare' | 'mensile'>('mensile')
  const [navPending,  setNavPending]  = useState<string | null>(null)
  const [saving,      setSaving]      = useState(false)
  const [err,         setErr]         = useState<string | null>(null)
  const [msg,         setMsg]         = useState<string | null>(null)

  // Map<key=`${medicoId}|${data}`, {tc, tr}> = modifiche locali non salvate
  const [modifiche, setModifiche] =
    useState<Map<string, { tc: TurnoClinico; tr: TurnoRicerca }>>(() => new Map())

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

  const { data: schemi = [] } = useQuery<SchemaModello[]>({
    queryKey: ['schemi-modello-modifica'],
    queryFn: async () => {
      const { data, error } = await supabase.from('schemi_modello').select('*')
      if (error) throw error
      return data ?? []
    },
  })

  // Query turni paginata per mese — la query Supabase è limitata a 1000
  // righe di default; con ~25 medici × 180 giorni siamo a ~4500 righe e
  // l'ultimo periodo verrebbe troncato. Spezzando in batch mensili
  // (~750 righe/mese) restiamo sotto al cap per ogni richiesta.
  const { data: turni = [], refetch: refetchTurni, isLoading: lTur } =
    useQuery<Turno[]>({
      queryKey: ['turni-modifica', config?.id],
      enabled:  !!config,
      queryFn: async () => {
        if (!config) return []
        const mesi = calcolaMesi(config)
        let all: Turno[] = []
        for (const { di, df } of mesi) {
          const { data, error } = await supabase
            .from('turni')
            .select('id, medico_id, data, turno_clinico, turno_ricerca, modificato_manualmente, is_ferie, note, created_at, updated_at')
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
  const getCella = useCallback((medicoId: string, data: string): { tc: TurnoClinico; tr: TurnoRicerca } => {
    const key = `${medicoId}|${data}`
    if (modifiche.has(key)) return modifiche.get(key)!
    const t = turniByKey.get(key)
    return t ? { tc: t.turno_clinico, tr: t.turno_ricerca } : { tc: '', tr: '' }
  }, [modifiche, turniByKey])

  const getOriginale = useCallback((medicoId: string, data: string): { tc: TurnoClinico; tr: TurnoRicerca } => {
    return teoriciByKey.get(`${medicoId}|${data}`) ?? { tc: '', tr: '' }
  }, [teoriciByKey])

  const isFerieCella = useCallback((medicoId: string, data: string): boolean => {
    return turniByKey.get(`${medicoId}|${data}`)?.is_ferie ?? false
  }, [turniByKey])

  // ── Update cella (delta vs DB) ─────────────────────────────────────
  // Modifica un singolo "lato" della cella (TC o TR) preservando l'altro.
  // Se il nuovo (tc, tr) coincide col DB, rimuoviamo l'entry dal Map.
  const updateCella = useCallback((medicoId: string, data: string, tc: TurnoClinico, tr: TurnoRicerca) => {
    const key = `${medicoId}|${data}`
    const dbT = turniByKey.get(key)
    const dbCur = dbT ? { tc: dbT.turno_clinico, tr: dbT.turno_ricerca } : { tc: '' as TurnoClinico, tr: '' as TurnoRicerca }
    setModifiche(prev => {
      const next = new Map(prev)
      if (tc === dbCur.tc && tr === dbCur.tr) next.delete(key)
      else next.set(key, { tc, tr })
      return next
    })
  }, [turniByKey])

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
      const updates = Array.from(modifiche.entries()).map(([key, { tc, tr }]) => {
        const [medico_id, data] = key.split('|')
        const orig = getOriginale(medico_id, data)
        const modificato_manualmente = (tc !== orig.tc) || (tr !== orig.tr)
        const dbT = turniByKey.get(key)
        return {
          medico_id,
          data,
          turno_clinico:           tc,
          turno_ricerca:           tr,
          modificato_manualmente,
          // Preserva campi non gestiti dalla pagina (altrimenti l'upsert
          // li resetterebbe ai default: is_ferie=false, note=null)
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

  // ── Render di una singola cella ───────────────────────────────────
  // Il "tipo" determina quale parte della cella visualizzare/editare:
  //   - 'clinica'  → mostra/edita TC, lascia TR invariato
  //   - 'ricerca'  → mostra/edita TR, lascia TC invariato
  // Il bordo azzurro "modificato" è indipendente per tipo: riferito
  // solo al lato gestito da quella tabella.
  const renderCella = (medicoId: string, col: ColonnaCal, tipo: TipoTabella) => {
    const cur  = getCella(medicoId, col.data)
    const orig = getOriginale(medicoId, col.data)
    const isMod = tipo === 'clinica'
      ? cur.tc !== orig.tc
      : cur.tr !== orig.tr
    return (
      <EditableCell
        key={`${medicoId}|${col.data}|${tipo}`}
        tipo={tipo}
        tc={cur.tc} tr={cur.tr}
        isModified={isMod}
        isFerie={isFerieCella(medicoId, col.data)}
        isRedDay={col.isDomenica || col.isFestivo}
        onChangeClinico={tcNew => updateCella(medicoId, col.data, tcNew, cur.tr)}
        onChangeRicerca={trNew => updateCella(medicoId, col.data, cur.tc, trNew)}
      />
    )
  }

  // ── Tabella generica (clinica o ricerca) per un set di colonne ────
  function TabellaPeriodo({ cols, tipo }: { cols: ColonnaCal[]; tipo: TipoTabella }) {
    // Clinica: verde olive scuro · Ricerca: rosso vinaccia (burgundy)
    const headerBg     = tipo === 'clinica' ? '#374f30' : '#7a2233'
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
              return (
                <th key={c.data} style={{
                  width: 32, minWidth: 32,
                  background: isRedDay ? '#fde0e0' : '#f0ece4',
                  color: isRedDay ? '#7a2020' : '#3a3d30',
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
        </tbody>
      </table>
    )
  }

  /** Coppia di tabelle (clinica + ricerca) per uno stesso periodo */
  function CoppiaTabelle({ cols }: { cols: ColonnaCal[] }) {
    return (
      <div className="space-y-2">
        <div className="overflow-auto rounded-lg border border-stone-300 bg-white">
          <TabellaPeriodo cols={cols} tipo="clinica" />
        </div>
        <div className="overflow-auto rounded-lg border bg-white" style={{ borderColor: '#c98a96' }}>
          <TabellaPeriodo cols={cols} tipo="ricerca" />
        </div>
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
            Due tabelle: <strong>clinica</strong> (M / P / L / REP) sopra, <strong>ricerca</strong> (RM / RP) sotto.
            Clicca una cella per modificarla. Bordo azzurro = diversa dallo schema originale.
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

          {/* Bottone salva */}
          <button
            onClick={handleSave}
            disabled={!hasUnsaved || saving}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white shadow disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            style={{ background: hasUnsaved && !saving ? '#476540' : '#9ca3af' }}
            onMouseEnter={e => { if (hasUnsaved && !saving) (e.currentTarget as HTMLElement).style.background = '#374f30' }}
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
