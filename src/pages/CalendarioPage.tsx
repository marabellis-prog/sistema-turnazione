import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { RefreshCw, Info } from 'lucide-react'
import { supabase } from '../lib/supabase'
import {
  calcolaCalendarioCompleto,
  generaColonne,
  MESI_SHORT_IT,
} from '../lib/algorithm'
import type {
  Medico, Turno, Configurazione, SchemaModello, ColonnaCal,
  TurnoClinico, TurnoRicerca,
} from '../types'

// ─── Struttura cella display ──────────────────────────────────────
interface CellDisplay {
  turno_clinico:          TurnoClinico
  turno_ricerca:          TurnoRicerca
  note:                   string | null
  modificato_manualmente: boolean
  is_ferie:               boolean
}

// ─── Etichette turno — testo semplice, niente alone/sfondo ───────
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

// ─── Step di caricamento ──────────────────────────────────────────
function LoadingStep({ label, done, active }: { label: string; done: boolean; active: boolean }) {
  return (
    <div className={`flex items-center gap-2 text-sm ${done ? '' : active ? '' : 'opacity-40'}`}>
      <span className="w-5 h-5 flex items-center justify-center rounded-full text-xs font-bold shrink-0"
        style={{
          background: done ? '#d5e5d0' : '#f0ece4',
          color:      done ? '#2b4a28' : '#9a9a8a',
        }}>
        {done ? '✓' : active ? '⟳' : '○'}
      </span>
      <span style={{ color: done ? '#374f30' : active ? '#3a3d30' : '#9a9a8a' }}>
        {label}
      </span>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════
// ARCHITETTURA: calcolo locale + fetch solo eccezioni
//
//  1. DB fetch: configurazione, medici, schemi (piccoli, veloci)
//  2. Calcolo LOCALE di tutti i turni teorici (nessuna query, ~10ms)
//  3. DB fetch: SOLO turni con modificato_manualmente=true o is_ferie=true
//     (tipicamente 0-50 righe, indipendente dal numero totale di turni)
//  4. Merge: le eccezioni sovrascrivono il teorico
//
// Questo elimina il problema del limite Supabase (1000 righe default)
// e scala senza problemi a qualsiasi numero di medici/mesi.
// ════════════════════════════════════════════════════════════════════

export function CalendarioPage() {
  const [rigaSel,       setRigaSel]       = useState<string | null>(null)
  const [mostraLegenda, setMostraLegenda] = useState(true)

  // ── Step 1: Configurazione ───────────────────────────────────────
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

  // ── Step 2: Medici ───────────────────────────────────────────────
  const { data: medici = [], isLoading: lMed } = useQuery<Medico[]>({
    queryKey: ['medici'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('medici').select('*').eq('attivo', true).order('numero_ordine')
      if (error) throw error
      return data
    },
  })

  // ── Step 3: Schemi ───────────────────────────────────────────────
  const { data: schemi = [], isLoading: lSch } = useQuery<SchemaModello[]>({
    queryKey: ['schemi_modello'],
    queryFn: async () => {
      const { data, error } = await supabase.from('schemi_modello').select('*')
      if (error) throw error
      return data
    },
  })

  // ── Step 4: Calcolo locale (sincrono, ~10ms) ─────────────────────
  const turniTeorici = useMemo(() => {
    if (!config || medici.length === 0 || schemi.length === 0) return []
    return calcolaCalendarioCompleto(config, schemi, medici)
  }, [config, medici, schemi])

  // Stima totale (per il contatore nel loading)
  const stimaTotale = useMemo(() => {
    if (!config || medici.length === 0) return 0
    const start = new Date(config.anno_inizio, config.mese_inizio - 1, 1)
    const end   = new Date(config.anno_fine, config.mese_fine, 0)
    return (Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1) * medici.length
  }, [config, medici])

  // ── Step 5: Solo eccezioni dal DB ───────────────────────────────
  const {
    data: eccezioni = [], isLoading: lEcc,
    isFetching, refetch,
  } = useQuery<Turno[]>({
    queryKey: ['turni-eccezioni', config?.id],
    enabled:  turniTeorici.length > 0,
    queryFn: async () => {
      if (!config) return []
      const di = `${config.anno_inizio}-${String(config.mese_inizio).padStart(2,'0')}-01`
      const df = new Date(config.anno_fine, config.mese_fine, 0).toISOString().split('T')[0]
      const { data, error } = await supabase
        .from('turni').select('*')
        .gte('data', di).lte('data', df)
        .or('modificato_manualmente.eq.true,is_ferie.eq.true')
        .limit(5000)
      if (error) throw error
      return data ?? []
    },
    staleTime: 60_000,
  })

  // ── Costruisce mappa display (teorico + eccezioni) ───────────────
  const turniMap = useMemo(() => {
    const map = new Map<string, Map<string, CellDisplay>>()
    for (const t of turniTeorici) {
      if (!map.has(t.medico_id)) map.set(t.medico_id, new Map())
      map.get(t.medico_id)!.set(t.data, {
        turno_clinico: t.turno_clinico, turno_ricerca: t.turno_ricerca,
        note: null, modificato_manualmente: false, is_ferie: false,
      })
    }
    for (const e of eccezioni) {
      if (!map.has(e.medico_id)) map.set(e.medico_id, new Map())
      map.get(e.medico_id)!.set(e.data, {
        turno_clinico: e.turno_clinico, turno_ricerca: e.turno_ricerca,
        note: e.note, modificato_manualmente: e.modificato_manualmente,
        is_ferie: e.is_ferie,
      })
    }
    return map
  }, [turniTeorici, eccezioni])

  // ── Colonne (giorni) e raggruppamento per mese ───────────────────
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

  // ── Stato avanzamento loading ────────────────────────────────────
  const sCfg  = !lCfg  && !!config
  const sMed  = !lMed  && medici.length > 0
  const sSch  = !lSch  && schemi.length > 0
  const sCalc = turniTeorici.length > 0
  const sEcc  = !lEcc
  const done  = sCfg && sMed && sSch && sCalc && sEcc

  const pct = (sCfg ? 20 : 0) + (sMed && sSch ? 20 : 0) + (sCalc ? 30 : 0) + (sEcc ? 30 : 0)

  // ── Schermata di caricamento ─────────────────────────────────────
  if (!done) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-48px)]"
        style={{ background: '#f4f1ea' }}>
        <div className="rounded-2xl p-8 w-80 shadow-lg space-y-5"
          style={{ background: '#faf8f3', border: '1px solid #d5ccb8' }}>

          <div className="text-center">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 mx-auto mb-3"
              style={{ borderColor: '#476540' }} />
            <h2 className="font-bold text-base" style={{ color: '#2b3c24' }}>
              Caricamento calendario
            </h2>
          </div>

          <div className="space-y-2.5">
            <LoadingStep label="Configurazione" done={sCfg} active={lCfg} />
            <LoadingStep
              label={sMed && sSch
                ? `Medici (${medici.length}) · Schema (${schemi.filter(s=>s.schema_num===config?.schema_attivo).length} slot)`
                : 'Medici e schema di rotazione'}
              done={sMed && sSch}
              active={lMed || lSch}
            />
            <LoadingStep
              label={sCalc
                ? `Calcolati ${turniTeorici.length.toLocaleString('it-IT')} turni in locale ✓`
                : stimaTotale > 0
                  ? `Calcolo ~${stimaTotale.toLocaleString('it-IT')} turni in locale...`
                  : 'Calcolo turni in locale'}
              done={sCalc}
              active={(sMed && sSch) && !sCalc}
            />
            <LoadingStep
              label={sEcc
                ? `Verificate modifiche manuali (${eccezioni.length})`
                : 'Verifica modifiche manuali...'}
              done={sEcc}
              active={sCalc && lEcc}
            />
          </div>

          {/* Barra progresso */}
          <div className="space-y-1">
            <div className="flex justify-between text-xs" style={{ color: '#7a7a6a' }}>
              <span>Avanzamento</span>
              <span className="font-semibold">{pct}%</span>
            </div>
            <div className="h-2.5 rounded-full overflow-hidden" style={{ background: '#e0e8d8' }}>
              <div className="h-full rounded-full transition-all duration-500"
                style={{ width: `${pct}%`, background: '#476540' }} />
            </div>
            {stimaTotale > 0 && (
              <p className="text-xs text-center pt-0.5" style={{ color: '#9a9a8a' }}>
                {sCalc
                  ? `${turniTeorici.length.toLocaleString('it-IT')} turni · 0 query pesanti`
                  : `~${stimaTotale.toLocaleString('it-IT')} turni da calcolare`
                }
              </p>
            )}
          </div>
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
      <div className="flex items-center gap-3 px-4 py-2 shrink-0 print:hidden border-b"
        style={{ background: '#faf8f3', borderColor: '#d5ccb8' }}>
        <h1 className="text-sm font-bold" style={{ color: '#2b3c24' }}>
          Calendario {config.anno_inizio}
          {config.anno_fine !== config.anno_inizio ? `–${config.anno_fine}` : ''}
        </h1>
        <span className="text-xs" style={{ color: '#9a9a8a' }}>
          {medici.length} medici · Schema {config.schema_attivo} ·{' '}
          {turniTeorici.length.toLocaleString('it-IT')} turni
          {eccezioni.length > 0 && ` · ${eccezioni.length} modifiche`}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => setMostraLegenda(v => !v)}
            className="btn-secondary py-1 px-2 text-xs">
            <Info size={13} /> Legenda
          </button>
          <button onClick={() => refetch()} disabled={isFetching}
            className="btn-secondary py-1 px-2 text-xs">
            <RefreshCw size={13} className={isFetching ? 'animate-spin' : ''} />
            Aggiorna
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
                    ? { background: '#f0ead8', color: '#6b5030' }
                    : {}}
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
                  onMouseLeave={e => { if (!isSel) e.currentTarget.style.background = '' }}
                >
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
      </div>
    </div>
  )
}
