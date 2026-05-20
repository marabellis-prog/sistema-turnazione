import { useState, useMemo, useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Zap, AlertTriangle, CheckCircle, Info } from 'lucide-react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { calcolaCalendarioCompleto, primoLunediDelPeriodo, MESI_IT } from '../../lib/algorithm'
import { useConfirm } from '../../hooks/useConfirm'
import { ConfirmModal } from '../../components/ConfirmModal'
import { usePendingActions } from '../../contexts/PendingActionsContext'
import type { Configurazione, Medico, SchemaModello } from '../../types'

// Colori pastello coerenti con la pagina Schema
const PASTEL: { bg: string; fg: string }[] = [
  { bg: '#fecdd3', fg: '#9f1239' }, { bg: '#fed7aa', fg: '#9a3412' },
  { bg: '#fef9c3', fg: '#713f12' }, { bg: '#bbf7d0', fg: '#14532d' },
  { bg: '#a5f3fc', fg: '#164e63' }, { bg: '#bfdbfe', fg: '#1e3a8a' },
  { bg: '#ddd6fe', fg: '#4c1d95' }, { bg: '#f5d0fe', fg: '#701a75' },
  { bg: '#fbcfe8', fg: '#831843' }, { bg: '#d1fae5', fg: '#064e3b' },
  { bg: '#ccfbf1', fg: '#134e4a' }, { bg: '#e0e7ff', fg: '#3730a3' },
]
const GIORNI_S = ['','Lun','Mar','Mer','Gio','Ven','Sab','Dom']
const ANNI     = [2025, 2026, 2027, 2028]

// ── Anteprima schema: una mini-tabella per ogni giorno, layout multi-column.
// Quando l'altezza supera, i giorni successivi vanno automaticamente nella
// colonna a destra (CSS columns + break-inside: avoid sui blocchi).
function AntepremaSchema({
  schemi, medici, schemaNum,
}: {
  schemi:    SchemaModello[]
  medici:    Medico[]
  schemaNum: number
}) {
  const colorMap = useMemo(() => {
    const m: Record<number, { bg: string; fg: string }> = {}
    medici.forEach((med, i) => { m[med.numero_ordine] = PASTEL[i % PASTEL.length] })
    return m
  }, [medici])

  const filtered = useMemo(() =>
    schemi.filter(s => s.schema_num === schemaNum)
      .sort((a, b) => a.giorno_settimana - b.giorno_settimana || a.slot - b.slot),
  [schemi, schemaNum])

  const perGiorno = useMemo(() => {
    const pg: Record<number, SchemaModello[]> = {}
    for (let g = 1; g <= 7; g++) pg[g] = []
    filtered.forEach(r => pg[r.giorno_settimana].push(r))
    return pg
  }, [filtered])

  const COLS: Array<keyof Pick<SchemaModello,
    'numero_medico_mattina'|'numero_medico_pomeriggio'|'numero_medico_rm'|'numero_medico_rp'>> =
    ['numero_medico_mattina','numero_medico_pomeriggio','numero_medico_rm','numero_medico_rp']
  const LABELS = ['M','P','RM','RP']

  if (filtered.length === 0) return (
    <div className="flex items-center justify-center h-full text-xs" style={{ color: '#6b6b5a' }}>
      Schema {schemaNum} vuoto
    </div>
  )

  // Dimensioni fisse e leggibili — niente più adattamento proporzionale.
  // Mini-tabella width: 26 (gg) + 4*36 (M/P/RM/RP) + 3*22 (REP/SUB/MED) = 236 px
  const dayW = 26, cellW = 36, boolW = 22, cellH = 24, fontSize = 11

  // Stile dell'header per le colonne booleane (REP/SUB/MED): colore label
  // diverso per leggibilità, sfondo verde olive come gli altri header.
  const boolHeaderBase: React.CSSProperties = {
    background:    '#456b3a',
    border:        '1px solid #2b3c24',
    width:         boolW, height: cellH,
    fontSize:      9, fontWeight: 800,
    textAlign:     'center', verticalAlign: 'middle', padding: 0,
    letterSpacing: '-0.3px',
  }
  // Stile della cella booleana — sfondo eredita rowBg, mostra ✓ colorato
  const boolCellBase: React.CSSProperties = {
    width: boolW, height: cellH,
    textAlign: 'center', verticalAlign: 'middle',
    border: '1px solid #d5ccb8',
    padding: 0,
  }

  return (
    <div style={{
      height:      '100%',
      columnWidth: 250,        // ~236px mini-tabella + margini → 2 colonne in 560
      columnGap:   8,
      columnFill:  'auto',     // riempi la prima colonna prima di passare alla seconda
      overflow:    'auto',
    }}>
      {[1,2,3,4,5,6,7].map(g => {
        const slots = perGiorno[g]
        if (slots.length === 0) return null
        return (
          <div key={g} style={{
            breakInside:    'avoid',
            pageBreakInside:'avoid',
            display:        'inline-block',
            width:          '100%',
            marginBottom:   6,
          }}>
            <table style={{ borderCollapse: 'collapse', tableLayout: 'fixed' }}>
              <thead>
                <tr>
                  <th style={{
                    background: '#456b3a', color: '#e0e8d8',
                    border: '1px solid #2b3c24', width: dayW, height: cellH,
                    fontSize: 9, fontWeight: 700,
                    textAlign: 'center', verticalAlign: 'middle', padding: 0,
                  }}>GG</th>
                  {LABELS.map(l => (
                    <th key={l} style={{
                      background: '#456b3a', color: '#e0e8d8',
                      border: '1px solid #2b3c24', width: cellW, height: cellH,
                      fontSize: 10, fontWeight: 700,
                      textAlign: 'center', verticalAlign: 'middle', padding: 0,
                    }}>{l}</th>
                  ))}
                  <th style={{ ...boolHeaderBase, color: '#fca5a5' }}>REP</th>
                  <th style={{ ...boolHeaderBase, color: '#fca5a5' }} title="Sub-intensiva">SUB</th>
                  <th style={{ ...boolHeaderBase, color: '#7ec3e8' }} title="Medicina">MED</th>
                </tr>
              </thead>
              <tbody>
                {slots.map((s, idx) => {
                  const isRep = s.is_reperibilita
                  const rowBg = isRep ? '#fee2e2' : idx % 2 === 0 ? '#faf8f3' : '#f0ece4'
                  return (
                    <tr key={idx} style={{ height: cellH, background: rowBg }}>
                      {idx === 0 && (
                        <td rowSpan={slots.length} style={{
                          background: '#476540', color: '#fff', fontWeight: 700, fontSize: 10,
                          border: '1px solid #456b3a', textAlign: 'center', verticalAlign: 'middle',
                          padding: 0, width: dayW,
                        }}>
                          {GIORNI_S[g]}
                        </td>
                      )}
                      {COLS.map((col, ci) => {
                        const num = s[col] as number | null
                        const color = num ? colorMap[num] : null
                        return (
                          <td key={ci} style={{
                            width: cellW, height: cellH,
                            textAlign: 'center', verticalAlign: 'middle',
                            border: '1px solid #d5ccb8',
                            background: isRep ? '#fee2e2' : (num && color ? color.bg : rowBg),
                            padding: 0,
                          }}>
                            {num ? (
                              <span style={{ fontSize, fontWeight: 700, color: color?.fg ?? '#555' }}>
                                {num}
                              </span>
                            ) : (
                              <span style={{ color: '#8a8070', fontSize: 9 }}>—</span>
                            )}
                          </td>
                        )
                      })}
                      {/* REP / SUB / MED — ✓ colorato se attivo, vuoto altrimenti */}
                      <td style={{ ...boolCellBase, background: isRep ? '#fee2e2' : rowBg }}>
                        {s.is_reperibilita && (
                          <span style={{ color: '#b91c1c', fontWeight: 900, fontSize: 12 }}>✓</span>
                        )}
                      </td>
                      <td style={{ ...boolCellBase, background: isRep ? '#fee2e2' : rowBg }}>
                        {s.is_sub && (
                          <span style={{ color: '#dc2626', fontWeight: 900, fontSize: 12 }}>✓</span>
                        )}
                      </td>
                      <td style={{ ...boolCellBase, background: isRep ? '#fee2e2' : rowBg }}>
                        {s.is_med && (
                          <span style={{ color: '#0284c7', fontWeight: 900, fontSize: 12 }}>✓</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )
      })}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
export function GeneraCalendarioPage() {
  const qc = useQueryClient()
  const { confirm, confirmState } = useConfirm()
  const { clearAll } = usePendingActions()
  const tableRef = useRef<HTMLDivElement>(null)

  // Parametri locali (inizializzati da configurazione DB)
  const [schemaNum,   setSchemaNum]   = useState(1)
  const [meseInizio,  setMeseInizio]  = useState(5)
  const [annoInizio,  setAnnoInizio]  = useState(2026)
  const [meseFine,    setMeseFine]    = useState(10)
  const [annoFine,    setAnnoFine]    = useState(2026)
  const [conferma,    setConferma]    = useState(false)
  const [stato,       setStato]       = useState<'idle'|'loading'|'ok'|'error'>('idle')
  const [messaggio,   setMessaggio]   = useState('')

  // ── Queries ──────────────────────────────────────────────────
  const { data: config } = useQuery<Configurazione | null>({
    queryKey: ['configurazione'],
    queryFn: async () => {
      const { data, error } = await supabase.from('configurazione')
        .select('*').order('updated_at', { ascending: false }).limit(1).maybeSingle()
      if (error) throw error
      return data
    },
  })

  const { data: medici = [] } = useQuery<Medico[]>({
    queryKey: ['medici'],
    queryFn: async () => {
      const { data, error } = await supabase.from('medici')
        .select('*').eq('attivo', true).order('numero_ordine')
      if (error) throw error
      return data
    },
  })

  const { data: schemi = [] } = useQuery<SchemaModello[]>({
    queryKey: ['schemi_modello'],
    queryFn: async () => {
      const { data, error } = await supabase.from('schemi_modello').select('*')
      if (error) throw error
      return data
    },
  })

  // Inizializza i parametri dalla configurazione DB
  useEffect(() => {
    if (!config) return
    setSchemaNum(config.schema_attivo)
    setMeseInizio(config.mese_inizio)
    setAnnoInizio(config.anno_inizio)
    setMeseFine(config.mese_fine)
    setAnnoFine(config.anno_fine)
  }, [config])

  // ── Riepilogo dinamico ───────────────────────────────────────
  const slotSchema = useMemo(
    () => schemi.filter(s => s.schema_num === schemaNum).length,
    [schemi, schemaNum]
  )

  const stimaTurni = useMemo(() => {
    const start = new Date(annoInizio, meseInizio - 1, 1)
    const end   = new Date(annoFine, meseFine, 0)
    const giorni = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1
    return giorni * medici.length
  }, [annoInizio, meseInizio, annoFine, meseFine, medici.length])

  const periodoLabel = `${MESI_IT[meseInizio]} ${annoInizio} → ${MESI_IT[meseFine]} ${annoFine}`

  // ── Genera ──────────────────────────────────────────────────
  async function genera() {
    // Conferma rafforzata
    const ok = await confirm({
      title:        '⚠️ Conferma generazione',
      message:      `Stai per generare il calendario con Schema ${schemaNum} per il periodo ${periodoLabel}.\n\nTutte le modifiche manuali ai turni esistenti in questo periodo andranno DEFINITIVAMENTE perse e non potranno essere recuperate.\n\nProcedere?`,
      confirmLabel: 'Sì, genera',
      danger:       true,
    })
    if (!ok) return

    setStato('loading'); setConferma(false)

    try {
      // Salva la configurazione scelta
      setMessaggio('Aggiornamento configurazione...')
      const configPayload = {
        anno_inizio: annoInizio, mese_inizio: meseInizio,
        anno_fine:   annoFine,   mese_fine:   meseFine,
        schema_attivo: schemaNum,
        updated_at: new Date().toISOString(),
      }
      if (config?.id) {
        await supabase.from('configurazione').update(configPayload).eq('id', config.id)
      } else {
        await supabase.from('configurazione').insert(configPayload)
      }
      qc.invalidateQueries({ queryKey: ['configurazione'] })

      // Calcola turni
      setMessaggio('Calcolo turni in corso...')
      const cfgObj = {
        id: config?.id ?? '',
        anno_inizio: annoInizio, mese_inizio: meseInizio,
        anno_fine:   annoFine,   mese_fine:   meseFine,
        schema_attivo: schemaNum,
        max_ferie_concomitanti: config?.max_ferie_concomitanti ?? 2,
        autocalc_sub_med: config?.autocalc_sub_med ?? true,
        // Impostazioni check inconsistenze (non usate da calcolaCalendarioCompleto
        // ma richieste dal tipo Configurazione). Default 0 = nessun controllo.
        sub_mattina_feriale:    config?.sub_mattina_feriale    ?? 0,
        sub_mattina_festivo:    config?.sub_mattina_festivo    ?? 0,
        sub_pomeriggio_feriale: config?.sub_pomeriggio_feriale ?? 0,
        sub_pomeriggio_festivo: config?.sub_pomeriggio_festivo ?? 0,
        med_mattina_feriale:    config?.med_mattina_feriale    ?? 0,
        med_mattina_festivo:    config?.med_mattina_festivo    ?? 0,
        med_pomeriggio_feriale: config?.med_pomeriggio_feriale ?? 0,
        med_pomeriggio_festivo: config?.med_pomeriggio_festivo ?? 0,
        updated_at: new Date().toISOString(),
      }
      const turniGenerati = calcolaCalendarioCompleto(cfgObj, schemi, medici)

      // Cancella turni esistenti per il periodo
      setMessaggio('Cancellazione turni precedenti...')
      const medicoIds  = medici.map(m => m.id)
      const dataInizio = `${annoInizio}-${String(meseInizio).padStart(2,'0')}-01`
      // ⚠️ NON usare toISOString(): converte in UTC e con fuso CEST/CET
      // mezzanotte locale diventa il giorno prima → la cancellazione
      // salterebbe l'ultimo giorno del mese di fine.
      const lastDay  = new Date(annoFine, meseFine, 0).getDate()
      const dataFine = `${annoFine}-${String(meseFine).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`

      const { error: delErr } = await supabase.from('turni')
        .delete()
        .in('medico_id', medicoIds)
        .gte('data', dataInizio)
        .lte('data', dataFine)
      if (delErr) throw new Error(`Cancellazione fallita: ${delErr.message}`)

      // Inserisce in batch
      const BATCH = 400
      for (let i = 0; i < turniGenerati.length; i += BATCH) {
        const chunk = turniGenerati.slice(i, i + BATCH)
        setMessaggio(`Salvataggio ${Math.min(i + BATCH, turniGenerati.length)} / ${turniGenerati.length} turni...`)
        const { error: insErr } = await supabase.from('turni')
          .upsert(chunk, { onConflict: 'medico_id,data' })
        if (insErr) throw new Error(`Inserimento fallito: ${insErr.message}`)
      }

      setStato('ok')
      setMessaggio(`✓ Generati ${turniGenerati.length} turni · Schema ${schemaNum} · ${periodoLabel}`)
      // Invalida tutte le cache che ora sono stale dopo la rigenerazione:
      // - 'turni'         → CalendarioPage fetch manuale (key invalidata
      //                     come segnale, in pratica la pagina pubblica
      //                     ricarica al cambio tab/refresh)
      // - 'turni-modifica' → ModificaTurniPage useQuery (anche la
      //                     dipendenza da config.updated_at lo coprirebbe,
      //                     questo è cintura+bretelle)
      // - 'configurazione' (già fatto sopra)
      // - 'ferie-ranges'  → eventuali ferie/turni linkate
      qc.invalidateQueries({ queryKey: ['turni'] })
      qc.invalidateQueries({ queryKey: ['turni-modifica'] })
      qc.invalidateQueries({ queryKey: ['ferie-ranges'] })
      clearAll()  // ✓ Azzera avvisi pendenti: calendario appena rigenerato

    } catch (e: unknown) {
      setStato('error')
      setMessaggio((e as Error).message)
    }
  }

  // ─────────────────────────────────────────────────────────────
  return (
    <div className="flex gap-6 max-w-6xl">
      <ConfirmModal {...confirmState.opts} open={confirmState.open}
        onConfirm={confirmState.onConfirm} onCancel={confirmState.onCancel} />

      {/* ═══ COLONNA SINISTRA ═══════════════════════════════════ */}
      <div className="flex-1 space-y-5">
        <div>
          <h2 className="text-xl font-bold text-stone-800 mb-0.5 flex items-center gap-2">
            <Zap size={20} style={{ color: '#476540' }} />
            Genera Calendario
          </h2>
          <p className="text-sm text-stone-600">
            Scegli schema e periodo, poi genera tutti i turni teorici.
          </p>
        </div>

        {/* ── Selettore schema ── */}
        <div className="card p-4 space-y-3">
          <h3 className="text-sm font-semibold text-stone-700">Schema di rotazione</h3>
          <div className="flex gap-2">
            {[1,2,3].map(n => (
              <button
                key={n}
                onClick={() => setSchemaNum(n)}
                className={`flex-1 py-2 rounded-lg border text-sm font-semibold transition-colors
                  ${schemaNum === n
                    ? 'text-white shadow'
                    : 'text-stone-600 border-stone-300 hover:bg-cream-200'}`}
                style={schemaNum === n ? { background: '#476540', borderColor: '#456b3a' } : { background: '#faf8f3' }}
              >
                Schema {n}
                <span className="block text-[10px] font-normal opacity-70 mt-0.5">
                  {schemi.filter(s => s.schema_num === n).length} slot
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* ── Selettore periodo ── */}
        <div className="card p-4 space-y-3">
          <h3 className="text-sm font-semibold text-stone-700">Periodo</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label text-xs">Mese inizio</label>
              <select value={meseInizio} onChange={e => setMeseInizio(+e.target.value)} className="input text-sm">
                {MESI_IT.slice(1).map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="label text-xs">Anno inizio</label>
              <select value={annoInizio} onChange={e => setAnnoInizio(+e.target.value)} className="input text-sm">
                {ANNI.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div>
              <label className="label text-xs">Mese fine</label>
              <select value={meseFine} onChange={e => setMeseFine(+e.target.value)} className="input text-sm">
                {MESI_IT.slice(1).map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="label text-xs">Anno fine</label>
              <select value={annoFine} onChange={e => setAnnoFine(+e.target.value)} className="input text-sm">
                {ANNI.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* ── Riepilogo dinamico ── */}
        <div className="card p-4">
          <h3 className="text-sm font-semibold text-stone-700 mb-3 flex items-center gap-1.5">
            <Info size={14} className="text-olive-600" />
            Riepilogo
          </h3>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <span className="text-stone-600">Schema attivo:</span>
            <span className="font-semibold text-stone-800">Schema {schemaNum}</span>

            <span className="text-stone-600">Periodo:</span>
            <span className="font-semibold text-stone-800">{periodoLabel}</span>

            <span className="text-stone-600">Medici attivi:</span>
            <span className={`font-semibold ${medici.length === 0 ? 'text-red-600' : 'text-stone-800'}`}>
              {medici.length}
              {medici.length === 0 && ' ⚠️'}
            </span>

            <span className="text-stone-600">Slot schema:</span>
            <span className={`font-semibold ${slotSchema === 0 ? 'text-red-600' : 'text-stone-800'}`}>
              {slotSchema} righe
              {slotSchema === 0 && ' ⚠️ schema vuoto'}
            </span>

            <span className="text-stone-600">Turni stimati:</span>
            <span className="font-semibold text-stone-800">
              ~{stimaTurni.toLocaleString('it-IT')}
            </span>
          </div>
        </div>

        {/* ── Warning ── */}
        <div className="flex gap-3 p-3.5 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold mb-0.5">Attenzione</p>
            <p className="text-xs leading-relaxed">
              La generazione <strong>cancella e riscrive</strong> tutti i turni del periodo selezionato.
              Le eventuali <strong>modifiche manuali</strong> ai turni esistenti andranno perse.
              Salva l'attuale configurazione prima di procedere se necessario.
            </p>
          </div>
        </div>

        {/* ── Checkbox + bottone ── */}
        {stato === 'idle' && (
          <>
            <label className="flex items-start gap-2 text-sm text-stone-700 cursor-pointer select-none">
              <input type="checkbox" checked={conferma}
                onChange={e => setConferma(e.target.checked)}
                className="rounded mt-0.5 shrink-0" />
              <span>
                Ho letto l'avviso e voglio generare il calendario{' '}
                <strong>{periodoLabel}</strong> con <strong>Schema {schemaNum}</strong>
              </span>
            </label>

            <button
              onClick={genera}
              disabled={!conferma || medici.length === 0 || slotSchema === 0}
              className="btn-primary w-full justify-center py-2.5"
            >
              <Zap size={16} />
              Genera Calendario
            </button>
          </>
        )}

        {/* ── Loading ── */}
        {stato === 'loading' && (
          <div className="flex items-center gap-3 p-4 rounded-xl"
            style={{ background: '#e8f0e0', border: '1px solid #b0c8a0', color: '#2b4a28' }}>
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 shrink-0"
              style={{ borderColor: '#476540' }} />
            <span className="text-sm">{messaggio}</span>
          </div>
        )}

        {/* ── Esito ── */}
        {(stato === 'ok' || stato === 'error') && (
          <div className={`flex items-start gap-3 p-4 rounded-xl text-sm
            ${stato === 'ok'
              ? 'bg-green-50 border border-green-200 text-green-800'
              : 'bg-red-50 border border-red-200 text-red-800'}`}>
            {stato === 'ok'
              ? <CheckCircle size={18} className="shrink-0 mt-0.5" />
              : <AlertTriangle size={18} className="shrink-0 mt-0.5" />}
            <div>
              <p className="font-medium">{messaggio}</p>
              <button onClick={() => { setStato('idle'); setMessaggio('') }}
                className="mt-2 text-xs underline opacity-70 hover:opacity-100">
                Genera di nuovo
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ═══ COLONNA DESTRA — anteprima schema ══════════════════ */}
      {/* Colonna destra — altezza fissa = viewport - navbar - padding admin.
          Larghezza w-[560px] per ospitare anche le colonne REP/SUB/MED
          oltre M/P/RM/RP, con possibilità di multi-column quando serve. */}
      <div className="w-[560px] shrink-0 min-w-0"
        style={{ height: 'calc(100vh - 96px)', position: 'sticky', top: 0 }}>
        <div className="card flex flex-col" style={{ height: '100%' }}>

          {/* Header fisso */}
          <div className="px-4 pt-4 pb-2 shrink-0">
            <h3 className="text-sm font-bold mb-1" style={{ color: '#2b3c24' }}>
              Anteprima Schema {schemaNum}
            </h3>
            <div className="text-[10px] flex gap-3 flex-wrap" style={{ color: '#7a7a6a' }}>
              <span className="flex items-center gap-1">
                <span className="w-3 h-3 rounded inline-block"
                  style={{ background: '#fee2e2', border: '1px solid #f0c0c0' }} />
                REP
              </span>
              <span>Num. = posizione rotazione</span>
              <span><strong style={{ color: '#dc2626' }}>S</strong> = sub-intensiva</span>
              <span><strong style={{ color: '#0284c7' }}>M</strong> = medicina</span>
            </div>
          </div>

          {/* Area mini-tabelle: multi-colonna automatico se serve */}
          <div ref={tableRef} className="flex-1 px-3 pb-3" style={{ minHeight: 0 }}>
            <AntepremaSchema
              schemi={schemi}
              medici={medici}
              schemaNum={schemaNum}
            />
          </div>

          {/* Footer cliccabile → pagina Disegna Schema */}
          <Link to="/admin/schema"
            className="block px-4 py-2 border-t text-center shrink-0 transition-colors"
            style={{ borderColor: '#e0e8d8', color: '#6b6b5a', textDecoration: 'none' }}
            onMouseEnter={e => (e.currentTarget.style.background = '#f0ece4')}
            onMouseLeave={e => (e.currentTarget.style.background = '')}>
            <span className="text-[10px]">
              Modifica in <strong style={{ color: '#476540' }}>Disegna Schema</strong>
            </span>
          </Link>
        </div>
      </div>
    </div>
  )
}
