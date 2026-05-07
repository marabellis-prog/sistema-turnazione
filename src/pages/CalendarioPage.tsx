import { useState, useMemo, useEffect, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { RefreshCw, Info, AlertTriangle } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { generaColonne, MESI_IT, MESI_SHORT_IT } from '../lib/algorithm'
import type {
  Medico, Turno, Configurazione, ColonnaCal,
  TurnoClinico, TurnoRicerca,
} from '../types'

interface CellDisplay {
  turno_clinico:          TurnoClinico
  turno_ricerca:          TurnoRicerca
  note:                   string | null
  modificato_manualmente: boolean
  is_ferie:               boolean
}

function LabelTurno({ tc, tr }: { tc: string; tr: string }) {
  return (
    <div className="flex flex-col items-center leading-none gap-px">
      {tc === 'M'   && <span style={{ fontSize: 13, fontWeight: 600, color: '#2e4a28' }}>M</span>}
      {tc === 'P'   && <span style={{ fontSize: 13, fontWeight: 600, color: '#253a4a' }}>P</span>}
      {tc === 'L'   && <span style={{ fontSize: 13, fontWeight: 700, color: '#4a3a1a' }}>L</span>}
      {tc === 'REP' && <span style={{ fontSize: 11, fontWeight: 700, color: '#b91c1c' }}>REP</span>}
      {tr && tr.split('+').map(p => (
        <span key={p} style={{ fontSize: 9, fontWeight: 500, color: '#3a2858' }}>{p}</span>
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

// ── Riga indicatore step ─────────────────────────────────────────
function StepRow({ icon, label, value, active }: {
  icon: string; label: string; value?: string; active?: boolean
}) {
  return (
    <div className="flex items-center gap-2 text-sm"
      style={{ color: active ? '#374f30' : value ? '#5a5a4a' : '#b0a898' }}>
      <span className="w-5 h-5 rounded-full flex items-center justify-center text-xs shrink-0"
        style={{
          background: value ? '#d5e5d0' : active ? '#e8f0e0' : '#f0ece4',
          color: value ? '#2b4a28' : '#9a9a8a',
        }}>
        {value ? '✓' : active ? '⟳' : '○'}
      </span>
      <span className="flex-1">{label}</span>
      {value && <span className="font-semibold text-xs" style={{ color: '#476540' }}>{value}</span>}
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

  // ── Loading screen ───────────────────────────────────────────────
  if (!loadDone) {
    // Progresso preciso: sappiamo stima e mesi PRIMA di iniziare il fetch
    const pct = stima > 0 && loadedRows > 0
      ? Math.min(Math.round((loadedRows / stima) * 100), 99)
      : meseCorrente > 0 && mesi.length > 0
        ? Math.min(Math.round((meseCorrente / mesi.length) * 80), 80)
        : lCfg ? 3 : lMed ? 8 : mesi.length > 0 ? 12 : 5

    return (
      <div className="flex items-center justify-center h-[calc(100vh-48px)]"
        style={{ background: '#f4f1ea' }}>
        <div className="rounded-2xl p-7 shadow-lg"
          style={{ background: '#faf8f3', border: '1px solid #d5ccb8', width: 360 }}>

          {/* Titolo + spinner */}
          <div className="flex items-center gap-3 mb-5">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 shrink-0"
              style={{ borderColor: '#476540' }} />
            <h2 className="font-bold text-base" style={{ color: '#2b3c24' }}>
              Caricamento calendario
            </h2>
          </div>

          {/* Step list — sempre visibili, si aggiornano mano a mano */}
          <div className="space-y-2 mb-5">
            <StepRow
              icon="cfg"
              label="Configurazione periodo"
              value={config ? `${MESI_IT[config.mese_inizio]} → ${MESI_IT[config.mese_fine]} ${config.anno_fine}` : undefined}
              active={lCfg}
            />
            <StepRow
              icon="med"
              label="Medici attivi"
              value={medici.length > 0 ? `${medici.length} turnisti` : undefined}
              active={lMed}
            />
            <StepRow
              icon="plan"
              label="Piano di caricamento"
              value={mesi.length > 0 ? `${mesi.length} mesi · ~${stima.toLocaleString('it-IT')} turni` : undefined}
              active={!lCfg && !lMed && mesi.length === 0}
            />
            <StepRow
              icon="fetch"
              label={meseCorrente > 0
                ? `${meseName} (${meseCorrente} di ${mesi.length})`
                : 'Scaricamento turni dal DB'}
              value={loadedRows > 0
                ? `${loadedRows.toLocaleString('it-IT')} / ~${stima.toLocaleString('it-IT')}`
                : undefined}
              active={meseCorrente > 0 && !loadDone}
            />
          </div>

          {/* Barra progresso */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs font-medium"
              style={{ color: '#7a7a6a' }}>
              <span>
                {loadedRows > 0
                  ? `${loadedRows.toLocaleString('it-IT')} turni caricati`
                  : 'In attesa...'}
              </span>
              <span style={{ color: '#476540', fontWeight: 700 }}>{pct}%</span>
            </div>
            <div className="h-3 rounded-full overflow-hidden" style={{ background: '#e0e8d8' }}>
              <div className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${pct}%`,
                  background: 'linear-gradient(90deg, #374f30 0%, #6b8254 100%)',
                }} />
            </div>
            {/* Indicatori mesi */}
            {mesi.length > 0 && (
              <div className="flex gap-1 mt-1.5">
                {mesi.map((m, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                    <div className="w-full h-1.5 rounded-full transition-all"
                      style={{
                        background: i < meseCorrente - 1
                          ? '#476540'
                          : i === meseCorrente - 1
                            ? '#9ab488'
                            : '#d5ccb8',
                      }} />
                    <span style={{
                      fontSize: 8,
                      color: i < meseCorrente ? '#476540' : '#b0a898',
                      fontWeight: i === meseCorrente - 1 ? 700 : 400,
                    }}>
                      {MESI_IT[m.mese].slice(0,3)}
                    </span>
                  </div>
                ))}
              </div>
            )}
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
      <div className="flex items-center justify-center h-64 text-stone-400 text-sm">
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
        <span className="text-xs" style={{ color: '#9a9a8a' }}>
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
        <div className="flex flex-wrap gap-3 px-4 py-2 border-b text-xs shrink-0"
          style={{ background: '#f0ece4', borderColor: '#d5ccb8' }}>
          <span className="flex items-center gap-1.5"><LabelTurno tc="M"   tr="" /> Mattina</span>
          <span className="flex items-center gap-1.5"><LabelTurno tc="P"   tr="" /> Pomeriggio</span>
          <span className="flex items-center gap-1.5"><LabelTurno tc="L"   tr="" /> Lungo (M+P)</span>
          <span className="flex items-center gap-1.5"><LabelTurno tc="REP" tr="" /> Reperibilità</span>
          <span className="flex items-center gap-1.5"><LabelTurno tc=""   tr="RM" /> Ric. mat.</span>
          <span className="flex items-center gap-1.5"><LabelTurno tc=""   tr="RP" /> Ric. pom.</span>
          <span className="flex items-center gap-1 px-1 rounded"
            style={{ background: '#f0ead8', border: '1px solid #d5ccb8' }}>🟡 Dom/Festivo</span>
          <span className="flex items-center gap-1 px-1 rounded"
            style={{ background: '#d5e5d0', border: '1px solid #b0c8a8' }}>🌿 Ferie</span>
          <span className="flex items-center gap-1 px-1 rounded"
            style={{ outline: '2px solid #9ab488' }}>✎ Modificato</span>
        </div>
      )}

      <div className="overflow-auto flex-1">
        {turni.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-stone-400">
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
                    style={{ background: '#374f30', borderColor: '#2b3c24' }}>
                    {MESI_SHORT_IT[g.mese]}{g.anno !== config.anno_inizio ? ` ${g.anno}` : ''}
                  </th>
                ))}
              </tr>
              <tr>
                {colonne.map(col => (
                  <th key={col.data}
                    className="cal-th text-[10px] !px-0 !py-0.5 w-8"
                    style={col.isDomenica || col.isFestivo
                      ? { background: '#f0ead8', color: '#6b5030' } : {}}
                    title={col.data}>
                    {col.giorno}
                  </th>
                ))}
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
                    style={{ background: isSel ? '#dde8d5' : '' }}
                    onMouseEnter={e => { if (!isSel) e.currentTarget.style.background = '#eae8e0' }}
                    onMouseLeave={e => { if (!isSel) e.currentTarget.style.background = '' }}>
                    <td className="cal-td-nome"
                      style={{ background: isSel ? '#c5d8bc' : undefined }}>
                      {med.nome}
                    </td>
                    {colonne.map(col => {
                      const cell  = medMap?.get(col.data)
                      const tc    = cell?.turno_clinico ?? ''
                      const tr    = cell?.turno_ricerca  ?? ''
                      const ferie = cell?.is_ferie ?? false
                      const modif = cell?.modificato_manualmente ?? false
                      let bg = isSel ? '#e8f0e0' : '#faf8f3'
                      if (ferie) bg = '#d5e5d0'
                      else if (col.isDomenica || col.isFestivo) bg = '#f0ead8'
                      return (
                        <td key={col.data}
                          className={`cal-cell ${modif ? 'cal-cell-modificata' : ''}`}
                          style={{ background: bg }}
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
