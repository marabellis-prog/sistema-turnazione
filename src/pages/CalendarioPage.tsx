import { useState, useMemo, useEffect, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { RefreshCw, Info, AlertTriangle } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { generaColonne, MESI_IT, MESI_SHORT_IT } from '../lib/algorithm'
import type {
  Medico, Turno, Configurazione, ColonnaCal,
  TurnoClinico, TurnoRicerca,
} from '../types'

// ─── CellDisplay ──────────────────────────────────────────────────
interface CellDisplay {
  turno_clinico:          TurnoClinico
  turno_ricerca:          TurnoRicerca
  note:                   string | null
  modificato_manualmente: boolean
  is_ferie:               boolean
}

// ─── Etichette turno — testo semplice, niente alone ───────────────
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

// ════════════════════════════════════════════════════════════════════
// STRATEGIA DI CARICAMENTO — fetch per mese (chunk semantici)
//
//  1. Calcolo upfront: lista mesi + stima righe totali
//     Noto PRIMA di qualsiasi fetch → contatore preciso dall'inizio
//
//  2. Fetch sequenziale per MESE: ogni chunk = 1 mese = max ~341 righe
//     (31 gg × 11 medici), sempre sotto la soglia Supabase (1000)
//     → zero paginazione interna, zero rischio di troncamento
//
//  3. Contatore: "Maggio 2026 (mese 1 di 6) · 341 / ~2.024 turni"
//     L'utente vede esattamente quanti mesi mancano.
//
//  Il DB è sempre la fonte di verità — mai calcolo locale per il display.
// ════════════════════════════════════════════════════════════════════

interface ChunkMese { anno: number; mese: number; di: string; df: string }

/** Lista dei mesi nel periodo configurato */
function calcolaMesi(cfg: Configurazione): ChunkMese[] {
  const mesi: ChunkMese[] = []
  let anno = cfg.anno_inizio
  let mese = cfg.mese_inizio
  while (anno < cfg.anno_fine || (anno === cfg.anno_fine && mese <= cfg.mese_fine)) {
    const di = `${anno}-${String(mese).padStart(2,'0')}-01`
    const df = new Date(anno, mese, 0).toISOString().split('T')[0]
    mesi.push({ anno, mese, di, df })
    if (mese === 12) { anno++; mese = 1 } else mese++
  }
  return mesi
}

/** Stima totale righe (upfront, senza query) */
function stimaRighe(cfg: Configurazione, nMedici: number): number {
  const start = new Date(cfg.anno_inizio, cfg.mese_inizio - 1, 1)
  const end   = new Date(cfg.anno_fine, cfg.mese_fine, 0)
  return (Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1) * nMedici
}

// ═════════════════════════════════════════════════════════════════════

export function CalendarioPage() {
  const [rigaSel,       setRigaSel]       = useState<string | null>(null)
  const [mostraLegenda, setMostraLegenda] = useState(true)

  // Stato caricamento per mese
  const [turni,        setTurni]        = useState<Turno[]>([])
  const [loadedRows,   setLoadedRows]   = useState(0)
  const [stimaTotale,  setStimaTotale]  = useState(0)
  const [meseCorrente, setMeseCorrente] = useState(0)   // indice chunk corrente
  const [mesiTotali,   setMesiTotali]   = useState(0)
  const [meseName,     setMeseName]     = useState('')  // "Maggio 2026"
  const [loadError,    setLoadError]    = useState<string | null>(null)
  const [loadDone,     setLoadDone]     = useState(false)

  // ── Query dati statici ────────────────────────────────────────────
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

  // ── Fetch chunk per chunk (1 mese alla volta) ─────────────────────
  const caricaTurni = useCallback(async (cfg: Configurazione, nMedici: number) => {
    setTurni([])
    setLoadedRows(0)
    setLoadError(null)
    setLoadDone(false)

    // Calcolo upfront: mesi e stima totale PRIMA di iniziare
    const mesi  = calcolaMesi(cfg)
    const stima = stimaRighe(cfg, nMedici)
    setMesiTotali(mesi.length)
    setStimaTotale(stima)

    let all: Turno[] = []
    try {
      for (let i = 0; i < mesi.length; i++) {
        const { anno, mese, di, df } = mesi[i]
        setMeseCorrente(i + 1)
        setMeseName(`${MESI_IT[mese]} ${anno}`)

        const { data, error } = await supabase
          .from('turni')
          .select('*')
          .gte('data', di)
          .lte('data', df)
          .order('data')
          .order('medico_id')

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

  useEffect(() => {
    if (config && medici.length > 0) caricaTurni(config, medici.length)
  }, [config, medici.length, caricaTurni])

  // ── Mappa display ─────────────────────────────────────────────────
  const turniMap = useMemo(() => {
    const map = new Map<string, Map<string, CellDisplay>>()
    for (const t of turni) {
      if (!map.has(t.medico_id)) map.set(t.medico_id, new Map())
      map.get(t.medico_id)!.set(t.data, {
        turno_clinico:          t.turno_clinico,
        turno_ricerca:          t.turno_ricerca,
        note:                   t.note,
        modificato_manualmente: t.modificato_manualmente,
        is_ferie:               t.is_ferie,
      })
    }
    return map
  }, [turni])

  // ── Colonne e mesi header ─────────────────────────────────────────
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

  // ── Loading screen ────────────────────────────────────────────────
  const isLoading = lCfg || lMed || !loadDone

  if (isLoading) {
    // Progresso preciso solo quando stima è nota
    const pct = stimaTotale > 0
      ? Math.min(Math.round((loadedRows / stimaTotale) * 100), 99)
      : (lCfg || lMed ? 5 : meseCorrente > 0 ? Math.round((meseCorrente / mesiTotali) * 80) : 10)

    return (
      <div className="flex items-center justify-center h-[calc(100vh-48px)]"
        style={{ background: '#f4f1ea' }}>
        <div className="rounded-2xl p-8 shadow-lg space-y-5"
          style={{ background: '#faf8f3', border: '1px solid #d5ccb8', width: 340 }}>

          {/* Spinner + titolo */}
          <div className="text-center">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 mx-auto mb-3"
              style={{ borderColor: '#476540' }} />
            <h2 className="font-bold text-base" style={{ color: '#2b3c24' }}>
              Caricamento calendario
            </h2>
          </div>

          {/* Dettaglio */}
          <div className="text-center space-y-1">
            {lCfg || lMed ? (
              <p className="text-sm" style={{ color: '#5a5a4a' }}>
                Configurazione e medici...
              </p>
            ) : meseCorrente > 0 ? (
              <>
                <p className="font-semibold" style={{ color: '#374f30', fontSize: 15 }}>
                  {meseName}
                </p>
                <p className="text-xs" style={{ color: '#7a7a6a' }}>
                  Mese {meseCorrente} di {mesiTotali}
                </p>
                <p className="text-sm font-medium mt-1" style={{ color: '#3a3d30' }}>
                  {loadedRows.toLocaleString('it-IT')}
                  {stimaTotale > 0 && (
                    <span style={{ color: '#9a9a8a' }}>
                      {' '}/ ~{stimaTotale.toLocaleString('it-IT')}
                    </span>
                  )}
                  {' '}turni caricati
                </p>
              </>
            ) : (
              <p className="text-sm" style={{ color: '#5a5a4a' }}>
                Calcolo periodo in corso...
              </p>
            )}
          </div>

          {/* Barra progresso */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs font-medium"
              style={{ color: '#7a7a6a' }}>
              <span>Avanzamento</span>
              <span>{pct}%</span>
            </div>
            <div className="h-3 rounded-full overflow-hidden" style={{ background: '#e0e8d8' }}>
              <div className="h-full rounded-full transition-all duration-400"
                style={{
                  width: `${pct}%`,
                  background: 'linear-gradient(90deg, #476540 0%, #6b8254 100%)',
                }} />
            </div>
            {/* Mini indicatori mesi */}
            {mesiTotali > 0 && (
              <div className="flex gap-0.5 mt-1">
                {Array.from({ length: mesiTotali }).map((_, i) => (
                  <div key={i} className="flex-1 h-1 rounded-full transition-all"
                    style={{
                      background: i < meseCorrente - 1
                        ? '#476540'
                        : i === meseCorrente - 1
                          ? '#9ab488'
                          : '#e0e8d8',
                    }} />
                ))}
              </div>
            )}
          </div>

          {loadError && (
            <div className="flex items-start gap-2 p-3 rounded-lg text-xs"
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

      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-2 shrink-0 border-b"
        style={{ background: '#faf8f3', borderColor: '#d5ccb8' }}>
        <h1 className="text-sm font-bold" style={{ color: '#2b3c24' }}>
          Calendario {config.anno_inizio}
          {config.anno_fine !== config.anno_inizio ? `–${config.anno_fine}` : ''}
        </h1>
        <span className="text-xs" style={{ color: '#9a9a8a' }}>
          {medici.length} medici · Schema {config.schema_attivo} ·{' '}
          {turni.length.toLocaleString('it-IT')} turni · {mesiTotali} mesi
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => setMostraLegenda(v => !v)}
            className="btn-secondary py-1 px-2 text-xs">
            <Info size={13} /> Legenda
          </button>
          <button onClick={() => config && caricaTurni(config, medici.length)}
            className="btn-secondary py-1 px-2 text-xs">
            <RefreshCw size={13} /> Aggiorna
          </button>
        </div>
      </div>

      {/* Legenda */}
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

      {/* Tabella */}
      <div className="overflow-auto flex-1">
        {turni.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-stone-400">
            <p className="text-sm font-medium">Nessun turno nel calendario</p>
            <p className="text-xs mt-1">
              Vai in <strong>Admin → Genera Calendario</strong> per generarli.
            </p>
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
