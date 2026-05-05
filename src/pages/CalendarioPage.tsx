import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { RefreshCw, Info, Calendar } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { generaColonne, MESI_IT, MESI_SHORT_IT } from '../lib/algorithm'
import type { Medico, Turno, Configurazione, ColonnaCal, CellaCal } from '../types'

// ─── Badge turno ───────────────────────────────────────────────────

function BadgeTurno({ tc, tr }: { tc: string; tr: string }) {
  const clinico = () => {
    if (!tc) return null
    const cls =
      tc === 'M'   ? 'badge-m'   :
      tc === 'P'   ? 'badge-p'   :
      tc === 'L'   ? 'badge-l'   :
      tc === 'REP' ? 'badge-rep' : ''
    return <span className={cls}>{tc}</span>
  }

  const ricerca = () => {
    if (!tr) return null
    const parts = tr.split('+')
    return (
      <>
        {parts.map(p => (
          <span key={p} className={p === 'RM' ? 'badge-rm' : 'badge-rp'}>
            {p}
          </span>
        ))}
      </>
    )
  }

  return (
    <div className="flex flex-col items-center gap-0.5 leading-none">
      {clinico()}
      {ricerca()}
    </div>
  )
}

// ─── Pagina principale ─────────────────────────────────────────────

export function CalendarioPage() {
  const [rigaSelezionata, setRigaSelezionata] = useState<string | null>(null)
  const [mostraLegenda, setMostraLegenda]     = useState(false)

  // ── Fetch configurazione ──
  const { data: config } = useQuery<Configurazione>({
    queryKey: ['configurazione'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('configurazione')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(1)
        .single()
      if (error) throw error
      return data
    },
  })

  // ── Fetch medici ──
  const { data: medici = [] } = useQuery<Medico[]>({
    queryKey: ['medici'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('medici')
        .select('*')
        .eq('attivo', true)
        .order('numero_ordine')
      if (error) throw error
      return data
    },
  })

  // ── Fetch turni ──
  const { data: turni = [], isFetching, refetch } = useQuery<Turno[]>({
    queryKey: ['turni', config?.id],
    enabled: !!config,
    queryFn: async () => {
      if (!config) return []
      const dataInizio = `${config.anno_inizio}-${String(config.mese_inizio).padStart(2,'0')}-01`
      // Ultimo giorno del mese fine
      const dataFine = new Date(config.anno_fine, config.mese_fine, 0)
        .toISOString().split('T')[0]

      const { data, error } = await supabase
        .from('turni')
        .select('*')
        .gte('data', dataInizio)
        .lte('data', dataFine)
        .order('data')
      if (error) throw error
      return data
    },
    staleTime: 60_000,
  })

  // ── Genera colonne (giorni) ──
  const colonne = useMemo<ColonnaCal[]>(() => {
    if (!config) return []
    return generaColonne(config)
  }, [config])

  // ── Indicizza turni per medico_id → data → cella ──
  const turniMap = useMemo(() => {
    const map = new Map<string, Map<string, CellaCal>>()
    for (const t of turni) {
      if (!map.has(t.medico_id)) map.set(t.medico_id, new Map())
      map.get(t.medico_id)!.set(t.data, {
        data:                 t.data,
        turno_clinico:        t.turno_clinico,
        turno_ricerca:        t.turno_ricerca,
        note:                 t.note,
        modificato_manualmente: t.modificato_manualmente,
        is_ferie:             t.is_ferie,
      })
    }
    return map
  }, [turni])

  // ── Raggruppa colonne per mese (per header) ──
  const gruppiMese = useMemo(() => {
    const gruppi: { mese: number; anno: number; count: number; startIdx: number }[] = []
    colonne.forEach((col, i) => {
      const last = gruppi[gruppi.length - 1]
      if (last && last.mese === col.mese && last.anno === col.anno) {
        last.count++
      } else {
        gruppi.push({ mese: col.mese, anno: col.anno, count: 1, startIdx: i })
      }
    })
    return gruppi
  }, [colonne])

  if (!config) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        <p>Nessuna configurazione trovata. Configura il sistema dalla sezione Admin.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-[calc(100vh-48px)]">
      {/* ── Toolbar ── */}
      <div className="flex items-center gap-3 px-4 py-2 bg-white border-b border-gray-200 shrink-0 print:hidden">
        <h1 className="text-base font-bold text-gray-700">
          Calendario Turni {config.anno_inizio}
          {config.anno_fine !== config.anno_inizio ? `–${config.anno_fine}` : ''}
        </h1>
        <span className="text-xs text-gray-400">
          {MESI_IT[config.mese_inizio]} → {MESI_IT[config.mese_fine]}
          {' · Schema '}{config.schema_attivo}
          {' · '}{medici.length} medici
        </span>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setMostraLegenda(v => !v)}
            className="btn-secondary py-1 px-2 text-xs"
            title="Legenda colori"
          >
            <Info size={13} />
            Legenda
          </button>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="btn-secondary py-1 px-2 text-xs"
            title="Aggiorna"
          >
            <RefreshCw size={13} className={isFetching ? 'animate-spin' : ''} />
            Aggiorna
          </button>
        </div>
      </div>

      {/* ── Legenda ── */}
      {mostraLegenda && (
        <div className="flex flex-wrap gap-3 px-4 py-2 bg-gray-50 border-b border-gray-200 text-xs shrink-0">
          <span className="flex items-center gap-1"><span className="badge-m">M</span> Mattina</span>
          <span className="flex items-center gap-1"><span className="badge-p">P</span> Pomeriggio</span>
          <span className="flex items-center gap-1"><span className="badge-l">L</span> Lungo (M+P)</span>
          <span className="flex items-center gap-1"><span className="badge-rep">REP</span> Reperibilità</span>
          <span className="flex items-center gap-1"><span className="badge-rm">RM</span> Ricerca mattina</span>
          <span className="flex items-center gap-1"><span className="badge-rp">RP</span> Ricerca pomeriggio</span>
          <span className="flex items-center gap-1 bg-amber-50 px-1 rounded border border-amber-200">🟡 Dom / Festivo</span>
          <span className="flex items-center gap-1 bg-emerald-50 px-1 rounded border border-emerald-200">🟢 Ferie</span>
          <span className="flex items-center gap-1 outline outline-2 outline-blue-400 px-1 rounded">🔵 Modificato</span>
        </div>
      )}

      {/* ── Tabella (scrollabile) ── */}
      <div className="overflow-auto flex-1">
        <table className="cal-table">
          {/* ── Head ── */}
          <thead>
            {/* Riga mesi */}
            <tr>
              <th className="cal-td-nome-header" rowSpan={2}>Medico</th>
              {gruppiMese.map(g => (
                <th
                  key={`${g.anno}-${g.mese}`}
                  colSpan={g.count}
                  className="cal-th bg-blue-700 text-white border-blue-800 text-[11px]"
                >
                  {MESI_SHORT_IT[g.mese]} {g.anno !== config.anno_inizio ? g.anno : ''}
                </th>
              ))}
            </tr>

            {/* Riga giorni */}
            <tr>
              {colonne.map(col => (
                <th
                  key={col.data}
                  className={`cal-th text-[10px] !px-0 !py-0.5 w-8
                    ${col.isDomenica || col.isFestivo ? 'bg-amber-100 text-amber-800' : ''}
                  `}
                  title={col.data}
                >
                  {col.giorno}
                </th>
              ))}
            </tr>
          </thead>

          {/* ── Body ── */}
          <tbody>
            {medici.map(med => {
              const medTurni = turniMap.get(med.id)
              const isSelected = rigaSelezionata === med.id

              return (
                <tr
                  key={med.id}
                  onClick={() => setRigaSelezionata(isSelected ? null : med.id)}
                  className={`cursor-pointer hover:bg-blue-50/50 transition-colors
                    ${isSelected ? 'cal-row-selected' : ''}
                  `}
                >
                  {/* Nome medico (sticky) */}
                  <td className={`cal-td-nome ${isSelected ? 'bg-blue-100' : ''}`}>
                    {med.nome}
                  </td>

                  {/* Celle turno */}
                  {colonne.map(col => {
                    const cella = medTurni?.get(col.data)
                    const tc = cella?.turno_clinico ?? ''
                    const tr = cella?.turno_ricerca  ?? ''
                    const isFerie   = cella?.is_ferie ?? false
                    const modif     = cella?.modificato_manualmente ?? false
                    const note      = cella?.note ?? ''

                    const cellClass = [
                      'cal-cell',
                      isFerie                            ? 'cal-cell-ferie'   :
                      col.isDomenica || col.isFestivo    ? 'cal-cell-festivo'  : '',
                      modif                              ? 'cal-cell-modificata' : '',
                      isSelected                         ? 'bg-blue-50'       : '',
                    ].filter(Boolean).join(' ')

                    return (
                      <td key={col.data} className={cellClass} title={note || undefined}>
                        {(tc || tr) ? <BadgeTurno tc={tc} tr={tr} /> : null}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>

        {/* Placeholder se nessun turno */}
        {turni.length === 0 && !isFetching && (
          <div className="flex flex-col items-center justify-center py-20 text-gray-400">
            <Calendar className="mb-3 opacity-30" size={48} />
            <p className="text-sm font-medium">Nessun turno generato</p>
            <p className="text-xs mt-1">
              Vai in <strong>Admin → Genera Calendario</strong> per generare i turni.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

