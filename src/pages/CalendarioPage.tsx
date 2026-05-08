import { useState, useMemo, useEffect, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, Info, RotateCw, Plane, BarChart3, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { generaColonne, MESI_IT } from '../lib/algorithm'
import { CalendarLoadingScreen } from '../components/CalendarLoadingScreen'
import { FerieModal, expandRange, toRanges, type DayChange } from '../components/FerieModal'
import { RiepilogoTurni } from '../components/RiepilogoTurni'
import { useAuth } from '../hooks/useAuth'
import { useFerieRealtime } from '../hooks/useFerieRealtime'
import { useTurniRealtime } from '../hooks/useTurniRealtime'
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
  is_sub:                 boolean
  is_med:                 boolean
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

/** Etichetta del turno clinico (M / P / L / REP) — più grande perché unico nella sua tabella.
 *  Mostra anche eventuali tag (sub) rosso o (med) azzurro sotto il TC. */
function LabelClinico({ tc, isSub, isMed }: { tc: string; isSub?: boolean; isMed?: boolean }) {
  if (!tc && !isSub && !isMed) return null
  return (
    <div className="flex flex-col items-center leading-none gap-px">
      {tc && (
        <span style={{
          fontSize:      tc === 'REP' ? 11 : 13,
          fontWeight:    700,
          color:         tc === 'REP' ? '#b91c1c'
                       : tc === 'M'   ? '#2e4a28'
                       : tc === 'P'   ? '#253a4a'
                       : tc === 'L'   ? '#4a3a1a'
                       : '#3a3d30',
          letterSpacing: tc === 'REP' ? '-0.3px' : undefined,
        }}>{tc}</span>
      )}
      {isSub && (
        <span style={{ fontSize: 8, fontWeight: 800, color: '#dc2626', letterSpacing: '-0.2px' }}>
          (sub)
        </span>
      )}
      {isMed && (
        <span style={{ fontSize: 8, fontWeight: 800, color: '#0284c7', letterSpacing: '-0.2px' }}>
          (med)
        </span>
      )}
    </div>
  )
}

/** Etichetta del turno ricerca (RM / RP / RM+RP) */
function LabelRicerca({ tr }: { tr: string }) {
  if (!tr) return null
  return (
    <div className="flex flex-col items-center leading-none gap-px">
      {tr.split('+').map(p => (
        <span key={p} style={{
          fontSize: 10, fontWeight: 700,
          color: CELL_COLORS[p]?.fg ?? '#3a2858',
        }}>{p}</span>
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
    // ⚠️ NON usare toISOString(): converte in UTC e con fuso CEST/CET
    // mezzanotte locale diventa 22:00/23:00 del giorno PRIMA → l'ultimo
    // giorno del mese viene troncato e i turni del 30/31 spariscono.
    // new Date(anno, mese, 0).getDate() = numero giorni del mese corrente.
    const lastDay = new Date(anno, mese, 0).getDate()
    const df = `${anno}-${String(mese).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`
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

  // Utente loggato + stato modal "Richiedi Ferie" e "Riepilogo turni"
  const { user } = useAuth()
  const qc = useQueryClient()
  const [showRichiediFerie, setShowRichiediFerie] = useState(false)
  const [showRiepilogo,     setShowRiepilogo]     = useState(false)

  // Realtime sulle ferie: quando l'admin approva/respinge una richiesta
  // (o un altro medico aggiunge le sue), il calendario pubblico aggiorna
  // istantaneamente i pattern verde solido / verde a righe.
  useFerieRealtime()

  // Realtime sui turni: quando l'admin modifica un turno o rigenera tutto,
  // il calendario pubblico si rifresca da solo. NON usiamo useQuery per i
  // turni qui (carichiamo per mese con state manuale), quindi passiamo
  // un onChange che richiama caricaTurni. Il debounce 500ms del hook
  // assicura che N upsert consecutivi facciano un solo refetch.

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

  // Match utente loggato ↔ medico in elenco — per nome (uppercase + trim).
  // Stesso pattern usato in GestioneUtentiPage. Se l'utente non corrisponde
  // ad alcun medico (es. account "supervisore" senza assegnazione), il
  // pulsante "Richiedi Ferie" non viene mostrato.
  const mioMedico = useMemo(() => {
    const myName = (user?.nome ?? '').toUpperCase().trim()
    if (!myName) return undefined
    return medici.find(m => m.nome.toUpperCase().trim() === myName)
  }, [user?.nome, medici])

  // Sub-set delle ferie del medico associato all'utente (per il modal "self")
  // ⚠️ DEVE stare qui sopra — prima di qualsiasi early-return (loadDone, config)
  // — altrimenti React lancia "rendered fewer hooks than expected" → schermo bianco.

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
    // Sempre fresh: ogni mount/focus rifetcha + polling 15s per la safety
    // net se Supabase Realtime non è configurato. Stessa logica delle altre
    // pagine che mostrano ferie (vedi GestioneFeriePage).
    staleTime:                   0,
    refetchOnMount:              'always',
    refetchInterval:             15_000,
    refetchIntervalInBackground: false,
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

  // Sub-set delle ferie del medico associato all'utente (per modal "Richiedi Ferie")
  const ferieDelMioMedico = useMemo(
    () => ferieDB.filter(f => f.medico_id === mioMedico?.id),
    [ferieDB, mioMedico?.id],
  )

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

  // Realtime turni: l'admin modifica un turno → tutti i client (medici
  // collegati al calendario, altri admin) ricevono l'evento e ricaricano.
  // useRef interno al hook → onChange è "stabile" anche se cambiano
  // config/mesi tra un render e l'altro: viene presa la versione più
  // recente al firing. Debounce 500ms evita N fetch su upsert massivo.
  useTurniRealtime({
    onChange: () => {
      if (config && mesi.length > 0) caricaTurni(config, mesi)
    },
  })

  // ── Mappa display ────────────────────────────────────────────────
  const turniMap = useMemo(() => {
    const map = new Map<string, Map<string, CellDisplay>>()
    for (const t of turni) {
      if (!map.has(t.medico_id)) map.set(t.medico_id, new Map())
      map.get(t.medico_id)!.set(t.data, {
        turno_clinico: t.turno_clinico, turno_ricerca: t.turno_ricerca,
        note: t.note, modificato_manualmente: t.modificato_manualmente,
        is_ferie: t.is_ferie,
        is_sub: t.is_sub ?? false,
        is_med: t.is_med ?? false,
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

  // ── Render di una tabella (clinica o ricerca) ─────────────────────
  // Stessa struttura: header mesi + giorni, riga per medico, una cella
  // per giorno. Differenza:
  //   - 'clinica' → rende il TC (M/P/L/REP)
  //   - 'ricerca' → rende il TR (RM/RP/RM+RP)
  // Lo scroll orizzontale è condiviso (stesso container .overflow-auto),
  // gli sticky header funzionano naturalmente: la clinica è sticky finché
  // sei nella sua area; quando scrolli sotto, la ricerca prende il top.
  const renderTabella = (tipo: 'clinica' | 'ricerca') => {
    // Clinica: verde olive scuro · Ricerca: rosso vinaccia (burgundy)
    const headerBg     = tipo === 'clinica' ? '#456b3a' : '#7a2233'
    const headerBorder = tipo === 'clinica' ? '#2b3c24' : '#5a1a26'
    const headerLabel  = tipo === 'clinica' ? 'Clinica' : 'Ricerca'
    return (
      <table className="cal-table">
        <thead>
          <tr>
            <th className="cal-td-nome-header" rowSpan={2}
              style={{ background: headerBg, borderColor: headerBorder, color: '#fff' }}>
              Medico — {headerLabel}
            </th>
            {gruppiMese.map(g => (
              <th key={`${g.anno}-${g.mese}`} colSpan={g.count}
                className="cal-th text-[11px] text-white"
                style={{
                  background: headerBg, borderColor: headerBorder, letterSpacing: '0.04em',
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
              const isRedDay = letter === 'D' || col.isFestivo
              return (
                <th key={col.data}
                  className="cal-th !px-0 !py-0.5 w-8"
                  style={{
                    position: 'sticky', top: 22, zIndex: 20,
                    ...(isRedDay ? { background: '#fde0e0' } : {}),
                    ...(isLastOfMonth ? { borderRight: '2px solid #1a1a1a' } : {}),
                  }}
                  title={col.data}>
                  <div style={{ lineHeight: 1, padding: '1px 0' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: isRedDay ? '#9a2020' : undefined }}>
                      {col.giorno}
                    </div>
                    <div style={{ fontSize: 8, fontWeight: 600, marginTop: 1, color: isRedDay ? '#9a2020' : '#9ca3af' }}>
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

                  // Ferie: stato per medico+giorno (vale per entrambe le tabelle)
                  const inRange = (m: Map<string, [string, string][]>) =>
                    m.get(med.id)?.some(([s, e]) => col.data >= s && col.data <= e) ?? false
                  const isFerieApproved = (cell?.is_ferie ?? false) || inRange(ferieRanges.approved)
                  const isFeriePending  = !isFerieApproved && inRange(ferieRanges.pending)

                  // Colore base: se c'è un valore PER QUESTA TABELLA usa il bg del tipo,
                  // altrimenti neutro/festivo
                  // Solo la RICERCA conserva il bg color basato sul TR
                  // (viola RM, magenta RP). La CLINICA mostra il turno solo
                  // nella label, sfondo sempre neutro.
                  const valKey = tipo === 'ricerca' ? tr.split('+')[0] : ''

                  // Le ferie compaiono SOLO nella tabella Clinica (per non
                  // duplicare l'informazione: il medico non lavora del tutto
                  // quel giorno, evidenziarlo una sola volta basta).
                  let bgBase: string
                  if (tipo === 'clinica' && isFerieApproved) {
                    bgBase = '#d5e5d0'
                  } else if (tipo === 'clinica' && isFeriePending) {
                    bgBase = 'repeating-linear-gradient(-45deg, #d5e5d0 0, #d5e5d0 3px, #a8c4a0 3px, #a8c4a0 6px)'
                  } else if (col.isDomenica || col.isFestivo) {
                    bgBase = '#fde0e0'
                  } else if (tipo === 'ricerca' && valKey && CELL_COLORS[valKey]) {
                    bgBase = CELL_COLORS[valKey].bg
                  } else {
                    bgBase = '#faf8f3'  // neutro (anche per clinica con M/P/L/REP)
                  }

                  const YELLOW_OVL = 'linear-gradient(rgba(253,224,71,0.8),rgba(253,224,71,0.8))'
                  const bg = isSel ? `${YELLOW_OVL}, ${bgBase}` : bgBase

                  return (
                    <td key={col.data}
                      className={`cal-cell ${modif ? 'cal-cell-modificata' : ''}`}
                      style={{
                        background:  bg,
                        borderColor: '#8a9882',
                        ...(lastDaysOfMonth.has(col.data) ? { borderRight: '2px solid #1a1a1a' } : {}),
                      }}
                      title={cell?.note || undefined}>
                      {tipo === 'clinica'
                        ? (tc || cell?.is_sub || cell?.is_med
                            ? <LabelClinico tc={tc} isSub={cell?.is_sub} isMed={cell?.is_med} />
                            : null)
                        : (tr ? <LabelRicerca tr={tr} /> : null)}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    )
  }

  // ── Salva modifiche dal FerieModal in modalità "self" ─────────────
  // L'utente può: (a) aggiungere giorni → diventano richieste pending,
  // (b) cancellare giorni delle SUE richieste pending. Le ferie già
  // approvate sono read-only nel modal stesso (mode='self'), quindi
  // l'utente non può accidentalmente generare changes con 'remove' su
  // un giorno approvato — ma facciamo comunque il filtro di sicurezza.
  // ⚠️ ferieDelMioMedico è definito SOPRA con gli altri hook, prima degli
  // early-return (regola degli hooks: stesso ordine ad ogni render).

  async function handleSaveSelfFerie(changes: Map<string, DayChange>) {
    if (!mioMedico) return
    const toRemoveSet = new Set(
      [...changes.entries()].filter(([, v]) => v === 'remove').map(([k]) => k)
    )
    const toAdd = [...changes.entries()].filter(([, v]) => v === 'add').map(([k]) => k)

    // Carica i record completi delle ferie del medico (incluso 'note')
    // per poter splittare i range pending toccati dalle rimozioni.
    const { data: myFerie, error: loadErr } = await supabase
      .from('ferie').select('*').eq('medico_id', mioMedico.id)
    if (loadErr) throw loadErr

    // ── Rimozioni: solo su record PENDING (approvate = false) ────────
    const affected = (myFerie ?? []).filter((f: Ferie) =>
      !f.approvate &&
      expandRange(f.data_inizio, f.data_fine).some(d => toRemoveSet.has(d))
    )
    for (const record of affected as Ferie[]) {
      const allDays  = expandRange(record.data_inizio, record.data_fine)
      const remaining = allDays.filter(d => !toRemoveSet.has(d))
      const { error } = await supabase.from('ferie').delete().eq('id', record.id)
      if (error) throw error
      // Ricrea i giorni rimanenti (sempre come pending, perché lo erano)
      for (const { start, end } of toRanges(remaining)) {
        await supabase.from('ferie').insert({
          medico_id: mioMedico.id, data_inizio: start, data_fine: end,
          note: record.note, approvate: false,
        })
      }
    }

    // ── Aggiunte: tutte come pending ─────────────────────────────────
    for (const { start, end } of toRanges(toAdd)) {
      const { error } = await supabase.from('ferie').insert({
        medico_id: mioMedico.id, data_inizio: start, data_fine: end,
        note: null, approvate: false,
      })
      if (error) throw error
    }

    qc.invalidateQueries({ queryKey: ['ferie'] })
    qc.invalidateQueries({ queryKey: ['ferie-ranges'] })
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
              style={{ background: '#e0e8d8', color: '#456b3a' }}
              title="Ruota il dispositivo in orizzontale per una visione migliore">
              <RotateCw size={12} /> Orizzontale
            </span>
          )}
          <button onClick={() => setMostraLegenda(v => !v)}
            className="btn-secondary py-1 px-2 text-xs"
            style={mostraLegenda ? { background: '#e0e8d8', borderColor: '#9ab488' } : {}}>
            <Info size={13} /> Legenda
          </button>
          {/* Riepilogo turni — visibile SOLO ai medici turnisti loggati.
              Apre un modal con il conteggio M/P/L/S/D/Totale del medico. */}
          {mioMedico && (
            <button onClick={() => setShowRiepilogo(true)}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-white shadow-sm transition-colors"
              style={{ background: '#7eb6d4' }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#5d9bc1'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = '#7eb6d4'}
              title={`Riepilogo turni di ${mioMedico.nome}`}>
              <BarChart3 size={13} />
              <span className="hidden sm:inline">Riepilogo turni</span>
            </button>
          )}
          {/* Richiedi Ferie — visibile SOLO se l'utente loggato corrisponde
              ad un medico in elenco (match per nome). Account "supervisore"
              senza assegnazione ad un medico non vede questo pulsante. */}
          {mioMedico && (
            <button onClick={() => setShowRichiediFerie(true)}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-white shadow-sm transition-colors"
              style={{ background: '#476540' }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#456b3a'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = '#476540'}
              title={`Richiedi ferie per ${mioMedico.nome}`}>
              <Plane size={13} />
              <span className="hidden sm:inline">Richiedi ferie</span>
            </button>
          )}
          <button onClick={() => {
              // Aggiorna esplicitamente TUTTO: turni (fetch manuale) + ferie + medici.
              // Senza l'invalidate sui ferie-ranges, una richiesta cambiata di stato
              // (es. respinta o approvata dall'admin) non si rifletterebbe nei colori.
              if (config && mesi.length > 0) caricaTurni(config, mesi)
              qc.invalidateQueries({ queryKey: ['ferie-ranges'] })
              qc.invalidateQueries({ queryKey: ['medici'] })
              qc.invalidateQueries({ queryKey: ['configurazione'] })
            }}
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
          <>
            {/* ─── TABELLA CLINICA (M/P/L/REP) ─── */}
            {renderTabella('clinica')}
            {/* ─── TABELLA RICERCA (RM/RP) ─── */}
            <div style={{ height: 8 }} />
            {renderTabella('ricerca')}
          </>
        )}
      </div>

      {/* ── Modal Richiedi Ferie (stesso modal di Gestione Ferie, mode='self') ── */}
      {showRichiediFerie && mioMedico && (
        <FerieModal
          medico={mioMedico}
          ferie={ferieDelMioMedico}
          mode="self"
          title={`Richiedi ferie — ${mioMedico.nome}`}
          subtitle="Clicca i giorni per richiederli · le ferie già approvate sono bloccate · le richieste in attesa puoi annullarle ricliccandole"
          onSave={handleSaveSelfFerie}
          onClose={() => setShowRichiediFerie(false)}
        />
      )}

      {/* ── Modal Riepilogo turni — completo (tutti i medici) ── */}
      {showRiepilogo && mioMedico && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(2px)' }}
          onClick={() => setShowRiepilogo(false)}>
          <div
            className="relative bg-white rounded-2xl shadow-2xl flex flex-col"
            style={{ maxWidth: 'min(96vw, 820px)', maxHeight: '92vh' }}
            onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-6 pt-4 pb-3 border-b border-stone-200 shrink-0">
              <div className="flex items-center gap-2">
                <BarChart3 size={20} style={{ color: '#5d9bc1' }} />
                <div>
                  <h3 className="font-bold text-stone-800 text-base">
                    Riepilogo turni
                  </h3>
                  <p className="text-xs text-stone-500 mt-0.5">
                    Conteggio nel periodo {MESI_IT[config.mese_inizio]} {config.anno_inizio}
                    {' → '} {MESI_IT[config.mese_fine]} {config.anno_fine} ·
                    Totale = (M + P) + 2L
                  </p>
                </div>
              </div>
              <button onClick={() => setShowRiepilogo(false)}
                className="text-stone-400 hover:text-stone-600 transition-colors">
                <X size={18} />
              </button>
            </div>
            {/* Tabella — tutti i medici */}
            <div className="overflow-auto p-4">
              <RiepilogoTurni
                medici={medici}
                colonne={colonne}
                getTC={(mid, data) =>
                  turniMap.get(mid)?.get(data)?.turno_clinico ?? ''
                }
              />
            </div>
            {/* Legenda */}
            <div className="px-6 py-2.5 border-t border-stone-200 text-xs text-stone-500"
              style={{ background: '#faf8f3' }}>
              <strong>S</strong> = sabati ·
              <strong className="ml-2">D</strong> = domeniche ·
              <strong className="ml-2">F</strong> = festivi italiani (escluse domeniche) ·
              REP è incluso in S/D/F ma non concorre al Totale
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
