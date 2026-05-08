import { useState, useMemo, useEffect, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { RefreshCw, Info, AlertTriangle } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { generaColonne, MESI_IT } from '../lib/algorithm'
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

// ── Riga indicatore step (sempre visibile, placeholder finché non ha valore)
function StepRow({ label, value, active }: {
  label: string; value?: string; active?: boolean
}) {
  const done = !!value
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold shrink-0 transition-all"
        style={{
          background: done ? '#d5e5d0' : active ? '#e8f0e0' : '#ede8e0',
          color:      done ? '#2b4a28' : active ? '#476540' : '#6b6b5a',
        }}>
        {done ? '✓' : active ? '⟳' : '○'}
      </span>
      <span className="flex-1" style={{ color: done ? '#3a3d30' : active ? '#3a3d30' : '#6b6b5a' }}>
        {label}
      </span>
      <span className="text-xs font-semibold transition-all"
        style={{ color: done ? '#476540' : '#7a7a6a', minWidth: 60, textAlign: 'right' }}>
        {value ?? '—'}
      </span>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════

export function CalendarioPage() {
  const [rigaSel,       setRigaSel]       = useState<string | null>(null)
  const [mostraLegenda, setMostraLegenda] = useState(true)

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
  // (es. domenica non generata nel calendario ma con ferie inserite)
  const { data: ferieDB = [] } = useQuery<Pick<Ferie, 'medico_id' | 'data_inizio' | 'data_fine'>[]>({
    queryKey: ['ferie'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ferie').select('medico_id, data_inizio, data_fine')
      if (error) throw error
      return data ?? []
    },
  })

  // Map medicoId → [[start, end], ...] per lookup O(1)
  const ferieRanges = useMemo(() => {
    const m = new Map<string, [string, string][]>()
    for (const f of ferieDB) {
      if (!m.has(f.medico_id)) m.set(f.medico_id, [])
      m.get(f.medico_id)!.push([f.data_inizio, f.data_fine])
    }
    return m
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
    const pct = stima > 0 && loadedRows > 0
      ? Math.min(Math.round((loadedRows / stima) * 100), 99)
      : meseCorrente > 0 && mesi.length > 0
        ? Math.min(Math.round((meseCorrente / mesi.length) * 85), 85)
        : lCfg ? 2 : lMed ? 6 : mesi.length > 0 ? 10 : 4

    // Placeholder barre mesi: mostra 6 slot se non sappiamo ancora
    const nBarre = mesi.length > 0 ? mesi.length : 6

    return (
      <div className="flex items-center justify-center h-[calc(100vh-48px)]"
        style={{ background: '#f4f1ea' }}>
        <div className="rounded-2xl p-7 shadow-lg"
          style={{ background: '#faf8f3', border: '1px solid #d5ccb8', width: 360 }}>

          {/* Titolo fisso — sempre visibile dal frame 1 */}
          <div className="flex items-center gap-3 mb-5">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 shrink-0"
              style={{ borderColor: '#476540' }} />
            <div>
              <h2 className="font-bold text-sm leading-tight" style={{ color: '#2b3c24' }}>
                Caricamento calendario
              </h2>
              <p className="text-xs mt-0.5" style={{ color: '#6b6b5a' }}>
                Il sistema sta recuperando i dati dal server
              </p>
            </div>
          </div>

          {/* 4 step SEMPRE visibili dal primo frame — valori arrivano man mano */}
          <div className="space-y-2.5 mb-5">
            <StepRow
              label="Configurazione periodo"
              value={config
                ? `${MESI_IT[config.mese_inizio]} → ${MESI_IT[config.mese_fine]} ${config.anno_fine}`
                : undefined}
              active={lCfg}
            />
            <StepRow
              label="Medici attivi"
              value={medici.length > 0 ? `${medici.length} turnisti` : undefined}
              active={lMed}
            />
            <StepRow
              label="Piano di caricamento"
              value={mesi.length > 0
                ? `${mesi.length} mesi · ~${stima.toLocaleString('it-IT')} turni`
                : undefined}
              active={!!config && !!medici.length && mesi.length === 0}
            />
            <StepRow
              label={meseCorrente > 0
                ? `${meseName}  (${meseCorrente} di ${mesi.length})`
                : 'Scaricamento turni'}
              value={loadedRows > 0
                ? `${loadedRows.toLocaleString('it-IT')} / ~${stima > 0 ? stima.toLocaleString('it-IT') : '…'}`
                : undefined}
              active={meseCorrente > 0}
            />
          </div>

          {/* Barra progresso — sempre visibile, parte da 2% */}
          <div className="space-y-2">
            <div className="flex justify-between text-xs" style={{ color: '#7a7a6a' }}>
              <span>
                {loadedRows > 0
                  ? `${loadedRows.toLocaleString('it-IT')} turni caricati`
                  : stima > 0
                    ? `~${stima.toLocaleString('it-IT')} turni da caricare`
                    : 'Connessione al server...'}
              </span>
              <span style={{ color: '#476540', fontWeight: 700 }}>{pct}%</span>
            </div>
            <div className="h-3 rounded-full overflow-hidden" style={{ background: '#e0e8d8' }}>
              <div className="h-full rounded-full transition-all duration-400"
                style={{
                  width: `${Math.max(pct, 2)}%`,   // minimo 2% così non è vuota
                  background: 'linear-gradient(90deg, #374f30 0%, #6b8254 100%)',
                }} />
            </div>

            {/* Barre mesi — 6 placeholder da subito, poi si riempiono */}
            <div className="flex gap-1 mt-1">
              {Array.from({ length: nBarre }).map((_, i) => {
                const m = mesi[i]
                const fatto   = i < meseCorrente - 1
                const inCorso = i === meseCorrente - 1
                const label   = m ? MESI_IT[m.mese].slice(0, 3) : '···'
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                    <div className="w-full h-1.5 rounded-full transition-all duration-300"
                      style={{
                        background: fatto ? '#476540' : inCorso ? '#9ab488' : '#d5ccb8',
                      }} />
                    <span style={{
                      fontSize: 8,
                      color: fatto ? '#476540' : inCorso ? '#476540' : '#6b6b5a',
                      fontWeight: inCorso ? 700 : 400,
                    }}>
                      {label}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>

          {loadError && (
            <div className="flex items-start gap-2 p-3 rounded-lg text-xs mt-4"
              style={{ background: '#fde8e8', color: '#7a2020', border: '1px solid #f0c0c0' }}>
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <span>{loadError}</span>
            </div>
          )}
        </div>
      </div>
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
        <h1 className="text-sm font-bold" style={{ color: '#2b3c24' }}>
          Calendario {config.anno_inizio}
          {config.anno_fine !== config.anno_inizio ? `–${config.anno_fine}` : ''}
        </h1>
        <span className="text-xs" style={{ color: '#6b6b5a' }}>
          {medici.length} medici · Schema {config.schema_attivo} ·{' '}
          {turni.length.toLocaleString('it-IT')} turni · {mesi.length} mesi
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => setMostraLegenda(v => !v)}
            className="btn-secondary py-1 px-2 text-xs">
            <Info size={13} /> Legenda
          </button>
          <button onClick={() => config && mesi.length > 0 && caricaTurni(config, mesi)}
            className="btn-secondary py-1 px-2 text-xs">
            <RefreshCw size={13} /> Aggiorna
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

          {/* Ferie */}
          <span className="flex items-center gap-1">
            <span className="inline-flex items-center justify-center rounded border"
              style={{ width: 26, height: 18, background: '#d5e5d0', borderColor: '#8a9882', fontSize: 9, color: '#2e5a28', fontWeight: 700 }}>
              F
            </span>
            <span style={{ color: '#5a5a4a' }}>Ferie</span>
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
                    style={{ background: '#374f30', borderColor: '#2b3c24', letterSpacing: '0.04em' }}>
                    {MESI_IT[g.mese].toUpperCase()} {g.anno}
                  </th>
                ))}
              </tr>
              <tr>
                {colonne.map(col => {
                  const isLastOfMonth = lastDaysOfMonth.has(col.data)
                  return (
                    <th key={col.data}
                      className="cal-th text-[10px] !px-0 !py-0.5 w-8"
                      style={{
                        ...(col.isDomenica || col.isFestivo ? { background: '#fde0e0', color: '#9a2020' } : {}),
                        ...(isLastOfMonth ? { borderRight: '2px solid #7a9a6a' } : {}),
                      }}
                      title={col.data}>
                      {col.giorno}
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

                      const isFerieDay = (cell?.is_ferie ?? false)
                        || (ferieRanges.get(med.id)?.some(([s, e]) => col.data >= s && col.data <= e) ?? false)

                      // Colore base della cella (senza selezione)
                      let bgBase: string
                      if (isFerieDay) {
                        bgBase = '#d5e5d0'
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
