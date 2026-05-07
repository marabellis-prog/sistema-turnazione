import { useState, useMemo, useEffect, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { RefreshCw, Info, AlertTriangle } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { generaColonne, MESI_SHORT_IT } from '../lib/algorithm'
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
// STRATEGIA DI CARICAMENTO — il DB è sempre la fonte di verità
//
//  Il calcolo locale NON è sicuro per il display: se schema o medici
//  cambiano dopo la generazione, il calcolo locale mostrarebbe turni
//  diversi da quelli effettivamente assegnati. Il DB registra ciò che
//  è stato realmente comunicato ai medici.
//
//  Per bypassare il limite di 1000 righe di Supabase si usa la
//  PAGINAZIONE con .range(): 2-3 query invece di una sola.
//  Con 11 medici × 184 giorni = 2024 righe → 3 chiamate (1000+1000+24).
//
//  Il contatore di progresso mostra quante righe sono state caricate
//  in tempo reale so l'utente vede l'avanzamento preciso.
// ════════════════════════════════════════════════════════════════════

const PAGE_SIZE = 1000

export function CalendarioPage() {
  const [rigaSel,       setRigaSel]       = useState<string | null>(null)
  const [mostraLegenda, setMostraLegenda] = useState(true)

  // Stato paginazione manuale
  const [turni,         setTurni]         = useState<Turno[]>([])
  const [loadedRows,    setLoadedRows]     = useState(0)
  const [totalRows,     setTotalRows]      = useState<number | null>(null)
  const [loadError,     setLoadError]      = useState<string | null>(null)
  const [loadDone,      setLoadDone]       = useState(false)

  // ── Query dati statici (piccoli) ─────────────────────────────────
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

  // ── Fetch paginato dei turni dal DB ──────────────────────────────
  const caricaTurni = useCallback(async (cfg: Configurazione) => {
    setTurni([])
    setLoadedRows(0)
    setTotalRows(null)
    setLoadError(null)
    setLoadDone(false)

    const di = `${cfg.anno_inizio}-${String(cfg.mese_inizio).padStart(2,'0')}-01`
    const df = new Date(cfg.anno_fine, cfg.mese_fine, 0).toISOString().split('T')[0]

    let all: Turno[] = []
    let from = 0
    let totale: number | null = null

    try {
      while (true) {
        // Prima pagina: chiedi anche il count totale
        const query = supabase
          .from('turni')
          .select(from === 0 ? '*' : '*', from === 0 ? { count: 'exact' } : undefined)
          .gte('data', di)
          .lte('data', df)
          .order('data')
          .order('medico_id')
          .range(from, from + PAGE_SIZE - 1)

        const res = from === 0
          ? await supabase
              .from('turni')
              .select('*', { count: 'exact' })
              .gte('data', di).lte('data', df)
              .order('data').order('medico_id')
              .range(0, PAGE_SIZE - 1)
          : await supabase
              .from('turni')
              .select('*')
              .gte('data', di).lte('data', df)
              .order('data').order('medico_id')
              .range(from, from + PAGE_SIZE - 1)

        if (res.error) throw res.error

        if (from === 0 && res.count !== null) {
          totale = res.count
          setTotalRows(totale)
        }

        const page = res.data ?? []
        all = [...all, ...page]
        setLoadedRows(all.length)

        // Ultima pagina?
        if (page.length < PAGE_SIZE) break
        from += PAGE_SIZE
      }

      setTurni(all)
      setLoadDone(true)

    } catch (e: unknown) {
      setLoadError((e as Error).message)
      setLoadDone(true)
    }
  }, [])

  // Avvia il caricamento quando config è disponibile
  useEffect(() => {
    if (config) caricaTurni(config)
  }, [config, caricaTurni])

  // ── Mappa display (medico_id → data → CellDisplay) ───────────────
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

  // ── Colonne (giorni) e raggruppamento mesi ───────────────────────
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

  // ── Schermata di caricamento ─────────────────────────────────────
  const isLoading = lCfg || lMed || !loadDone

  if (isLoading) {
    const pct = totalRows && totalRows > 0
      ? Math.round((loadedRows / totalRows) * 100)
      : loadedRows > 0 ? 50 : (lCfg || lMed ? 10 : 20)

    return (
      <div className="flex items-center justify-center h-[calc(100vh-48px)]"
        style={{ background: '#f4f1ea' }}>
        <div className="rounded-2xl p-8 w-84 shadow-lg space-y-5"
          style={{ background: '#faf8f3', border: '1px solid #d5ccb8', minWidth: 320 }}>

          <div className="text-center">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 mx-auto mb-3"
              style={{ borderColor: '#476540' }} />
            <h2 className="font-bold text-base" style={{ color: '#2b3c24' }}>
              Caricamento calendario
            </h2>
          </div>

          {/* Messaggio corrente */}
          <div className="text-sm text-center space-y-1" style={{ color: '#5a5a4a' }}>
            {lCfg || lMed ? (
              <p>Caricamento configurazione e medici...</p>
            ) : totalRows === null && loadedRows === 0 ? (
              <p>Connessione al database...</p>
            ) : (
              <>
                <p className="font-semibold" style={{ color: '#374f30', fontSize: 15 }}>
                  {loadedRows.toLocaleString('it-IT')}
                  {totalRows !== null && ` / ${totalRows.toLocaleString('it-IT')}`}
                  {' '}turni caricati
                </p>
                {totalRows !== null && (
                  <p style={{ color: '#9a9a8a', fontSize: 12 }}>
                    Pagina {Math.ceil(loadedRows / PAGE_SIZE) || 1} di{' '}
                    {Math.ceil(totalRows / PAGE_SIZE)}
                    {' '}· {medici.length} medici
                  </p>
                )}
              </>
            )}
          </div>

          {/* Barra progresso */}
          <div className="space-y-1">
            <div className="flex justify-between text-xs" style={{ color: '#7a7a6a' }}>
              <span>Avanzamento</span>
              <span className="font-semibold">{pct}%</span>
            </div>
            <div className="h-3 rounded-full overflow-hidden" style={{ background: '#e0e8d8' }}>
              <div className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${pct}%`,
                  background: 'linear-gradient(90deg, #476540, #6b8254)',
                }} />
            </div>
          </div>

          {loadError && (
            <div className="flex items-start gap-2 p-3 rounded-lg text-xs"
              style={{ background: '#fde8e8', color: '#7a2020', border: '1px solid #f0c0c0' }}>
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <span>Errore: {loadError}</span>
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

  // ── Tabella ───────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-[calc(100vh-48px)]">

      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-2 shrink-0 print:hidden border-b"
        style={{ background: '#faf8f3', borderColor: '#d5ccb8' }}>
        <h1 className="text-sm font-bold" style={{ color: '#2b3c24' }}>
          Calendario {config.anno_inizio}
          {config.anno_fine !== config.anno_inizio ? `–${config.anno_fine}` : ''}
        </h1>
        <span className="text-xs" style={{ color: '#9a9a8a' }}>
          {medici.length} medici · Schema {config.schema_attivo} ·{' '}
          {turni.length.toLocaleString('it-IT')} turni
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => setMostraLegenda(v => !v)}
            className="btn-secondary py-1 px-2 text-xs">
            <Info size={13} /> Legenda
          </button>
          <button onClick={() => config && caricaTurni(config)}
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
