import { useState, useMemo, useEffect, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { RefreshCw, Info, RotateCw } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { generaColonne, MESI_IT } from '../lib/algorithm'
import { CalendarLoadingScreen } from '../components/CalendarLoadingScreen'
import type {
  Medico, Turno, Ferie, Configurazione, ColonnaCal,
  TurnoClinico, TurnoRicerca,
} from '../types'

interface CellDisplay {
  turno_clinico:          TurnoClinico
  turno_ricerca:          TurnoRicerca
  note:                   string | null
  modificato_manualmente: boolean
  is_ferie:               boolean
}

// Stessi colori del "Prova Schema" in GestioneSchemaPage
const CELL_COLORS: Record<string, { bg: string; fg: string }> = {
  M:   { bg: '#dde8d5', fg: '#2e4a28' },
  P:   { bg: '#d5e0e8', fg: '#253a4a' },
  L:   { bg: '#ece5d5', fg: '#4a3a1a' },
  REP: { bg: '#e8d5d5', fg: '#5a2a2a' },
  RM:  { bg: '#ddd8ea', fg: '#3a2858' },
  RP:  { bg: '#ead8e2', fg: '#582840' },
}

function LabelTurno({ tc, tr }: { tc: string; tr: string }) {
  return (
    <div className="flex flex-col items-center leading-none gap-px">
      {tc && (
        <span style={{
          fontSize:      tc === 'REP' ? 9 : 11,
          fontWeight:    700,
          // REP: rosso brillante — altri: colori muted dal tema
          color:         tc === 'REP' ? '#b91c1c'
                       : tc === 'M'   ? '#2e4a28'
                       : tc === 'P'   ? '#253a4a'
                       : tc === 'L'   ? '#4a3a1a'
                       : '#3a3d30',
          letterSpacing: tc === 'REP' ? '-0.3px' : undefined,
        }}>
          {tc}
        </span>
      )}
      {tr && tr.split('+').map(p => (
        <span key={p} style={{ fontSize: 8, fontWeight: 600, color: CELL_COLORS[p]?.fg ?? '#3a2858' }}>
          {p}
        </span>
      ))}
    </div>
  )
}

interface ChunkMese { anno: number; mese: number; di: string; df: string }

// Lettere giorni settimana — indice = .getDay() (0=Dom, 1=Lun, ..., 6=Sab)
const DAY_LETTERS = ['D', 'L', 'M', 'M', 'G', 'V', 'S']

/** Lettera del giorno della settimana da una data ISO (YYYY-MM-DD), in fuso locale */
function dayLetter(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return DAY_LETTERS[new Date(y, m - 1, d).getDay()]
}

function calcolaMesi(cfg: Configurazione): ChunkMese[] {
  const mesi: ChunkMese[] = []
  let anno = cfg.anno_inizio, mese = cfg.mese_inizio
  while (anno < cfg.anno_fine || (anno === cfg.anno_fine && mese <= cfg.mese_fine)) {
    const di = `${anno}-${String(mese).padStart(2,'0')}-01`
    const df = new Date(anno, mese, 0).toISOString().split('T')[0]
    mesi.push({ anno, mese, di, df })
    if (mese === 12) { anno++; mese = 1 } else mese++
  }
  return mesi
}

function stimaRighe(cfg: Configurazione, nMedici: number): number {
  const start = new Date(cfg.anno_inizio, cfg.mese_inizio - 1, 1)
  const end   = new Date(cfg.anno_fine, cfg.mese_fine, 0)
  return (Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1) * nMedici
}

// ════════════════════════════════════════════════════════════════════

export function CalendarioPage() {
  const [rigaSel,       setRigaSel]       = useState<string | null>(null)
  // Legenda: aperta di default su desktop (≥ 640px), chiusa su mobile
  const [mostraLegenda, setMostraLegenda] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 640px)').matches
  )

  // Rilevamento orientamento per il suggerimento landscape su mobile
  const [isPortrait, setIsPortrait] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(orientation: portrait)').matches
  )
  const isTouch = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches

  useEffect(() => {
    const mq = window.matchMedia('(orientation: portrait)')
    const handler = (e: MediaQueryListEvent) => setIsPortrait(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  // Stato fetch per mese
  const [turni,        setTurni]        = useState<Turno[]>([])
  const [loadedRows,   setLoadedRows]   = useState(0)
  const [meseCorrente, setMeseCorrente] = useState(0)
  const [meseName,     setMeseName]     = useState('')
  const [loadError,    setLoadError]    = useState<string | null>(null)
  const [loadDone,     setLoadDone]     = useState(false)

  // ── Query dati statici ───────────────────────────────────────────
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
      return data
    },
  })

  // Ferie: necessarie per colorare le celle anche quando il turno non esiste
  // (es. domenica non generata nel calendario ma con ferie inserite).
  // Includiamo `approvate` per distinguere visivamente le richieste in attesa.
  const { data: ferieDB = [] } = useQuery<Pick<Ferie, 'medico_id' | 'data_inizio' | 'data_fine' | 'approvate'>[]>({
    queryKey: ['ferie-ranges'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ferie').select('medico_id, data_inizio, data_fine, approvate')
      if (error) throw error
      return data ?? []
    },
  })

  // Due mappe separate: approvate (verde pieno) vs in attesa (verde a righe)
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

  // ── Calcoli upfront (disponibili appena arrivano i dati) ─────────
  // Questi useMemo si aggiornano non appena config/medici sono pronti,
  // PRIMA che il fetch per mese inizi → il contatore è preciso da subito

  const mesi = useMemo<ChunkMese[]>(
    () => config ? calcolaMesi(config) : [],
    [config]
  )

  const stima = useMemo(
    () => (config && medici.length > 0) ? stimaRighe(config, medici.length) : 0,
    [config, medici.length]
  )

  // ── Fetch per mese ───────────────────────────────────────────────
  const caricaTurni = useCallback(async (cfg: Configurazione, chunks: ChunkMese[]) => {
    setTurni([])
    setLoadedRows(0)
    setMeseCorrente(0)
    setMeseName('')
    setLoadError(null)
    setLoadDone(false)

    let all: Turno[] = []
    try {
      for (let i = 0; i < chunks.length; i++) {
        const { anno, mese, di, df } = chunks[i]
        setMeseCorrente(i + 1)
        setMeseName(`${MESI_IT[mese]} ${anno}`)

        const { data, error } = await supabase
          .from('turni').select('*')
          .gte('data', di).lte('data', df)
          .order('data').order('medico_id')

        if (error) throw error
        all = [...all, ...(data ?? [])]
        setLoadedRows(all.length)
      }
      setTurni(all)
      setLoadDone(true)
    } catch (e: unknown) {
      setLoadError((e as Error).message)
      setLoadDone(true)
    }
  }, [])

  // Avvia quando config + medici + mesi sono pronti
  useEffect(() => {
    if (config && medici.length > 0 && mesi.length > 0) {
      caricaTurni(config, mesi)
    }
  }, [config, medici.length, mesi, caricaTurni])

  // ── Mappa display ────────────────────────────────────────────────
  const turniMap = useMemo(() => {
    const map = new Map<string, Map<string, CellDisplay>>()
    for (const t of turni) {
      if (!map.has(t.medico_id)) map.set(t.medico_id, new Map())
      map.get(t.medico_id)!.set(t.data, {
        turno_clinico: t.turno_clinico, turno_ricerca: t.turno_ricerca,
        note: t.note, modificato_manualmente: t.modificato_manualmente,
        is_ferie: t.is_ferie,
      })
    }
    return map
  }, [turni])

  const colonne = useMemo<ColonnaCal[]>(() => config ? generaColonne(config) : [], [config])
  const gruppiMese = useMemo(() => {
    const g: { mese: number; anno: number; count: number }[] = []
    colonne.forEach(col => {
      const last = g[g.length - 1]
      if (last && last.mese === col.mese && last.anno === col.anno) last.count++
      else g.push({ mese: col.mese, anno: col.anno, count: 1 })
    })
    return g
  }, [colonne])

  // Set delle date che sono l'ultimo giorno del loro mese (per il bordo separatore)
  const lastDaysOfMonth = useMemo(() => {
    const s = new Set<string>()
    colonne.forEach((col, i) => {
      const next = colonne[i + 1]
      if (!next || next.mese !== col.mese || next.anno !== col.anno) s.add(col.data)
    })
    return s
  }, [colonne])

  // ── Loading screen ───────────────────────────────────────────────
  // Renderizzata da subito (frame 1), struttura COMPLETA con placeholder.
  // I valori si riempiono mano a mano che arrivano i dati — mai blank.
  if (!loadDone) {
    return (
      <CalendarLoadingScreen
        config={config}
        medici={medici}
        mesi={mesi}
        stima={stima}
        meseCorrente={meseCorrente}
        meseName={meseName}
        loadedRows={loadedRows}
        loadError={loadError}
        lCfg={lCfg}
        lMed={lMed}
      />
    )
  }

  if (!config) {
    return (
      <div className="flex items-center justify-center h-64 text-stone-500 text-sm">
        Nessuna configurazione. Vai in Admin → Genera Calendario.
      </div>
    )
  }

  // ── Tabella calendario ────────────────────────────────────────────
  return (
    <div className="flex flex-col h-[calc(100vh-48px)]">
      <div className="flex items-center gap-3 px-4 py-2 shrink-0 border-b"
        style={{ background: '#faf8f3', borderColor: '#d5ccb8' }}>
        <h1 className="text-sm font-bold shrink-0" style={{ color: '#2b3c24' }}>
          Calendario {config.anno_inizio}
          {config.anno_fine !== config.anno_inizio ? `–${config.anno_fine}` : ''}
        </h1>
        {/* Info turni — nascosta su schermi piccoli */}
        <span className="text-xs hidden sm:inline" style={{ color: '#6b6b5a' }}>
          {medici.length} medici · Schema {config.schema_attivo} ·{' '}
          {turni.length.toLocaleString('it-IT')} turni
        </span>
        <div className="ml-auto flex items-center gap-2">
          {/* Suggerimento landscape — visibile solo su touch portrait */}
          {isTouch && isPortrait && (
            <span className="flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full animate-pulse"
              style={{ background: '#e0e8d8', color: '#374f30' }}
              title="Ruota il dispositivo in orizzontale per una visione migliore">
              <RotateCw size={12} /> Orizzontale
            </span>
          )}
          <button onClick={() => setMostraLegenda(v => !v)}
            className="btn-secondary py-1 px-2 text-xs"
            style={mostraLegenda ? { background: '#e0e8d8', borderColor: '#9ab488' } : {}}>
            <Info size={13} /> Legenda
          </button>
          <button onClick={() => config && mesi.length > 0 && caricaTurni(config, mesi)}
            className="btn-secondary py-1 px-2 text-xs">
            <RefreshCw size={13} />
            <span className="hidden sm:inline ml-1">Aggiorna</span>
          </button>
        </div>
      </div>

      {mostraLegenda && (
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 px-4 py-2 border-b text-xs shrink-0 items-center"
          style={{ background: '#f0ece4', borderColor: '#d5ccb8' }}>

          {/* Tipi di turno — sfondo crema #e8e3d8, testo colorato per tipo */}
          {([ ['M','Mattina'], ['P','Pomeriggio'], ['L','Lungo (M+P)'], ['REP','Reperibilità'],
               ['RM','Ric. mat.'], ['RP','Ric. pom.'] ] as [string,string][]).map(([t, label]) => {
            const isRep = t === 'REP'
            return (
              <span key={t} className="flex items-center gap-1">
                <span className="inline-flex items-center justify-center rounded border"
                  style={{
                    width: 26, height: 18,
                    background: '#e8e3d8',
                    borderColor: '#8a9882',
                    color:      isRep ? '#b91c1c' : (CELL_COLORS[t]?.fg ?? '#3a3d30'),
                    fontSize:   isRep ? 8 : (t.length > 1 ? 8 : 10),
                    fontWeight: isRep ? 800 : 700,
                    letterSpacing: isRep ? '-0.3px' : undefined,
                  }}>
                  {t}
                </span>
                <span style={{ color: '#5a5a4a' }}>{label}</span>
              </span>
            )
          })}

          {/* Separatore */}
          <span style={{ width: 1, height: 14, background: '#c0b8a8', display: 'inline-block', margin: '0 2px' }} />

          {/* Dom/Festivo */}
          <span className="flex items-center gap-1">
            <span className="inline-flex items-center justify-center rounded border"
              style={{ width: 26, height: 18, background: '#fde0e0', borderColor: '#8a9882' }} />
            <span style={{ color: '#5a5a4a' }}>Dom / Festivo</span>
          </span>

          {/* Ferie approvate */}
          <span className="flex items-center gap-1">
            <span className="inline-flex items-center justify-center rounded border"
              style={{ width: 26, height: 18, background: '#d5e5d0', borderColor: '#8a9882', fontSize: 9, color: '#2e5a28', fontWeight: 700 }}>
              F
            </span>
            <span style={{ color: '#5a5a4a' }}>Ferie approvate</span>
          </span>

          {/* Ferie in approvazione */}
          <span className="flex items-center gap-1">
            <span className="inline-flex items-center justify-center rounded border"
              style={{
                width: 26, height: 18,
                background: 'repeating-linear-gradient(-45deg, #d5e5d0 0, #d5e5d0 3px, #a8c4a0 3px, #a8c4a0 6px)',
                borderColor: '#8a9882',
              }} />
            <span style={{ color: '#5a5a4a' }}>In approvazione</span>
          </span>

          {/* Riga selezionata */}
          <span className="flex items-center gap-1">
            <span className="inline-flex items-center justify-center rounded border"
              style={{ width: 26, height: 18, background: '#fef9c3', borderColor: '#8a9882', fontSize: 9, color: '#78630a', fontWeight: 700 }}>
              ★
            </span>
            <span style={{ color: '#5a5a4a' }}>Riga selezionata</span>
          </span>

          {/* Modificato manualmente */}
          <span className="flex items-center gap-1">
            <span className="inline-flex items-center justify-center rounded"
              style={{ width: 26, height: 18, background: '#e8e3d8', boxShadow: 'inset 0 0 0 2px #38bdf8, 0 0 6px 1px rgba(56,189,248,0.45)' }} />
            <span style={{ color: '#5a5a4a' }}>Modificato</span>
          </span>
        </div>
      )}

      <div className="overflow-auto flex-1">
        {turni.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-stone-500">
            <p className="text-sm font-medium">Nessun turno nel calendario</p>
            <p className="text-xs mt-1">Vai in <strong>Admin → Genera Calendario</strong>.</p>
          </div>
        ) : (
          <table className="cal-table">
            <thead>
              <tr>
                <th className="cal-td-nome-header" rowSpan={2}>Medico</th>
                {gruppiMese.map(g => (
                  <th key={`${g.anno}-${g.mese}`} colSpan={g.count}
                    className="cal-th text-[11px] text-white"
                    style={{
                      background: '#374f30', borderColor: '#2b3c24', letterSpacing: '0.04em',
                      position: 'sticky', top: 0, zIndex: 30,
                    }}>
                    {MESI_IT[g.mese].toUpperCase()} {g.anno}
                  </th>
                ))}
              </tr>
              <tr>
                {colonne.map(col => {
                  const isLastOfMonth = lastDaysOfMonth.has(col.data)
                  const letter = dayLetter(col.data)
                  // 'D' (domenica) sempre rosso; festivi anche
                  const isRedDay = letter === 'D' || col.isFestivo
                  return (
                    <th key={col.data}
                      className="cal-th !px-0 !py-0.5 w-8"
                      style={{
                        position: 'sticky', top: 22, zIndex: 20,
                        ...(isRedDay ? { background: '#fde0e0' } : {}),
                        ...(isLastOfMonth ? { borderRight: '2px solid #7a9a6a' } : {}),
                      }}
                      title={col.data}>
                      <div style={{ lineHeight: 1, padding: '1px 0' }}>
                        <div style={{
                          fontSize:   10,
                          fontWeight: 700,
                          color:      isRedDay ? '#9a2020' : undefined,
                        }}>
                          {col.giorno}
                        </div>
                        <div style={{
                          fontSize:   8,
                          fontWeight: 600,
                          marginTop:  1,
                          color:      isRedDay ? '#9a2020' : '#9ca3af',
                        }}>
                          {letter}
                        </div>
                      </div>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {medici.map(med => {
                const medMap = turniMap.get(med.id)
                const isSel  = rigaSel === med.id
                return (
                  <tr key={med.id}
                    onClick={() => setRigaSel(isSel ? null : med.id)}
                    className="cursor-pointer transition-colors"
                    style={{ background: isSel ? 'rgba(253,224,71,0.8)' : '' }}
                    onMouseEnter={e => { if (!isSel) e.currentTarget.style.background = '#eae8e0' }}
                    onMouseLeave={e => { if (!isSel) e.currentTarget.style.background = '' }}>
                    <td className="cal-td-nome"
                      style={{ background: isSel ? 'rgba(253,224,71,0.85)' : undefined }}>
                      {med.nome}
                    </td>
                    {colonne.map(col => {
                      const cell  = medMap?.get(col.data)
                      const tc    = cell?.turno_clinico ?? ''
                      const tr    = cell?.turno_ricerca  ?? ''
                      const modif = cell?.modificato_manualmente ?? false

                      // Verifica se il giorno è in un range di ferie approvate o in attesa
                      const inRange = (m: Map<string, [string, string][]>) =>
                        m.get(med.id)?.some(([s, e]) => col.data >= s && col.data <= e) ?? false
                      const isFerieApproved = (cell?.is_ferie ?? false) || inRange(ferieRanges.approved)
                      const isFeriePending  = !isFerieApproved && inRange(ferieRanges.pending)

                      // Colore base della cella (senza selezione)
                      let bgBase: string
                      if (isFerieApproved) {
                        bgBase = '#d5e5d0'   // verde pieno: ferie approvate
                      } else if (isFeriePending) {
                        // Verde a righe diagonali: ferie in attesa di approvazione
                        bgBase = 'repeating-linear-gradient(-45deg, #d5e5d0 0, #d5e5d0 3px, #a8c4a0 3px, #a8c4a0 6px)'
                      } else if (col.isDomenica || col.isFestivo) {
                        bgBase = '#fde0e0'   // rosa-rosso
                      } else if (tc || tr) {
                        bgBase = '#e8e3d8'
                      } else {
                        bgBase = '#faf8f3'
                      }

                      // Se selezionata: overlay giallo 80% sopra il colore base.
                      // Si usa linear-gradient() perché rgba() da sola non è
                      // un background-image valido in un multi-layer background.
                      const YELLOW_OVL = 'linear-gradient(rgba(253,224,71,0.8),rgba(253,224,71,0.8))'
                      const bg = isSel
                        ? `${YELLOW_OVL}, ${bgBase}`
                        : bgBase

                      return (
                        <td key={col.data}
                          className={`cal-cell ${modif ? 'cal-cell-modificata' : ''}`}
                          style={{
                            background: bg,
                            borderColor: '#8a9882',
                            ...(lastDaysOfMonth.has(col.data) ? { borderRight: '2px solid #7a9a6a' } : {}),
                          }}
                          title={cell?.note || undefined}>
                          {(tc || tr) ? <LabelTurno tc={tc} tr={tr} /> : null}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
