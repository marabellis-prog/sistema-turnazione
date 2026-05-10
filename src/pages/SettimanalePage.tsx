/**
 * SettimanalePage
 *
 * Vista settimanale compatta del calendario turni: una sezione per ogni
 * giorno della settimana, con le righe degli slot dello schema attivo.
 * Per ogni slot mostra mattina + pomeriggio + l'eventuale colonna extra
 * (ricerca) + colonna reperibilità.
 *
 * La struttura (chi sta in quale slot) è derivata dalla rotazione teorica
 * dello schema attivo. Le informazioni che invece dipendono dai turni reali
 * salvati nel DB — flag SUB/MED su mattina/pomeriggio e stato ferie —
 * vengono lette in tempo reale: appena l'admin modifica un turno o approva
 * delle ferie, la vista si aggiorna automaticamente (Supabase Realtime
 * + polling 15s come fallback).
 *
 * Accessibile a tutti gli utenti loggati (admin, user, ospite). Per gli
 * ospiti è l'unica pagina visibile.
 */

import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react'
import { supabase } from '../lib/supabase'
import {
  contaLunedi, primoLunediDelPeriodo, getDayOfWeek, formatDate, MESI_IT,
} from '../lib/algorithm'
import { useTurniRealtime } from '../hooks/useTurniRealtime'
import { useFerieRealtime } from '../hooks/useFerieRealtime'
import type { Configurazione, Medico, SchemaModello, Turno, Ferie, SlotPlacement } from '../types'

// Giorni della settimana in italiano (1=Lun, ..., 7=Dom)
const GIORNI_IT = ['', 'LUNEDÌ', 'MARTEDÌ', 'MERCOLEDÌ', 'GIOVEDÌ', 'VENERDÌ', 'SABATO', 'DOMENICA']

// Colore di sfondo del giorno (cosmetic — alternato per leggibilità)
const GIORNO_BG = ['#f0f4ee', '#ecf3e0', '#fef3c7', '#fee0c0', '#e8e0f5', '#f0f0f0', '#fde0e0']

/** Trova il primo lunedì <= della data (start della settimana ISO) */
function startOfWeek(d: Date): Date {
  const r = new Date(d)
  r.setHours(0, 0, 0, 0)
  const dow = (r.getDay() + 6) % 7   // 0=Lun, 1=Mar, ..., 6=Dom
  r.setDate(r.getDate() - dow)
  return r
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

function fmtDataBreve(d: Date): string {
  return `${d.getDate()}-${MESI_IT[d.getMonth() + 1].slice(0, 3).toLowerCase()}`
}

/** Per un dato testNum (numero schema 1..N), restituisce il medicoIndex
 *  della rotazione settimana corrente. Inversa di calcolaTurnoTeorico. */
function medicoIdxForNum(testNum: number, sett: number, numMedici: number): number {
  let idx = (testNum - 1 - sett) % numMedici
  while (idx < 0) idx += numMedici
  return idx
}

type Vista = 'settimana' | 'mese'

export function SettimanalePage() {
  // Settimana corrente (lunedì) come default
  const [anchorWeek, setAnchorWeek] = useState<Date>(() => startOfWeek(new Date()))
  const [vista, setVista] = useState<Vista>('settimana')

  // ── Realtime: invalida le query non appena cambia qualcosa lato DB ─
  // useTurniRealtime / useFerieRealtime di default fanno invalidate sulle
  // query con i prefissi giusti — perfetto qui visto che usiamo useQuery
  // anche per turni e ferie. Debounce 500ms interno al hook.
  useTurniRealtime()
  useFerieRealtime()

  // ── Query dati ───────────────────────────────────────────────────
  const { data: config } = useQuery<Configurazione | null>({
    queryKey: ['configurazione'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('configurazione').select('*')
        .order('updated_at', { ascending: false }).limit(1).maybeSingle()
      if (error) throw error
      return data
    },
  })

  const { data: medici = [] } = useQuery<Medico[]>({
    queryKey: ['medici'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('medici').select('*').eq('attivo', true).order('numero_ordine')
      if (error) throw error
      return data ?? []
    },
  })

  const { data: schemi = [] } = useQuery<SchemaModello[]>({
    queryKey: ['schemi_modello'],
    queryFn: async () => {
      const { data, error } = await supabase.from('schemi_modello').select('*')
      if (error) throw error
      return data ?? []
    },
  })

  // ── Giorni visualizzati ────────────────────────────────────────────
  // Vista 'settimana': 7 giorni Lun → Dom dall'anchor.
  // Vista 'mese':       Lun della settimana del 1° del mese di anchor →
  //                     Dom della settimana dell'ultimo del mese.
  const giorni = useMemo(() => {
    if (vista === 'settimana') {
      return Array.from({ length: 7 }, (_, i) => addDays(anchorWeek, i))
    }
    // Mese che contiene anchorWeek (riferimento: primo giorno della settimana)
    const ref = anchorWeek
    const primoMese = new Date(ref.getFullYear(), ref.getMonth(), 1)
    const ultimoMese = new Date(ref.getFullYear(), ref.getMonth() + 1, 0)
    const lunStart = startOfWeek(primoMese)
    const lunEnd   = startOfWeek(ultimoMese)
    const out: Date[] = []
    for (let d = new Date(lunStart); d <= addDays(lunEnd, 6); d = addDays(d, 1)) {
      out.push(new Date(d))
    }
    return out
  }, [anchorWeek, vista])

  // Range ISO del periodo visualizzato — usato come parametro delle query
  // turni/ferie. La queryKey include di/df, così cambiare settimana/mese
  // forza un nuovo fetch del solo periodo richiesto.
  const periodo = useMemo(() => {
    if (giorni.length === 0) return null
    return { di: formatDate(giorni[0]), df: formatDate(giorni[giorni.length - 1]) }
  }, [giorni])

  // ── Turni del periodo ────────────────────────────────────────────
  // Servono per leggere lo stato REALE di slot_mattina/pomeriggio (SUB/MED)
  // e il flag is_ferie aggiornati alle ultime modifiche dell'admin. Senza
  // questa query la vista mostrerebbe solo lo schema teorico statico.
  // staleTime: 0 + refetchOnMount: 'always' + refetchInterval 15s → safety
  // net se la connessione Realtime cade. L'invalidate via useTurniRealtime
  // copre il caso normale (refresh istantaneo).
  const { data: turni = [] } = useQuery<Turno[]>({
    // Prefisso ['turni', ...] → coperto dall'invalidate di useTurniRealtime
    // che fa invalidateQueries({ queryKey: ['turni'] }) con match parziale.
    queryKey: ['turni', 'settimanale', periodo?.di, periodo?.df],
    queryFn: async () => {
      if (!periodo) return []
      const { data, error } = await supabase
        .from('turni').select('*')
        .gte('data', periodo.di).lte('data', periodo.df)
      if (error) throw error
      return data ?? []
    },
    enabled: !!periodo,
    staleTime:                   0,
    refetchOnMount:              'always',
    refetchInterval:             15_000,
    refetchIntervalInBackground: false,
  })

  // ── Ferie (range completi, solo i campi minimi) ──────────────────
  // Query analoga a quella usata in CalendarioPage: tutti i range,
  // mai filtrati per medico. Saranno filtrati lato client. Servono
  // per barrare i medici in ferie nella vista settimanale.
  const { data: ferieDB = [] } = useQuery<Pick<Ferie, 'medico_id' | 'data_inizio' | 'data_fine' | 'approvate'>[]>({
    queryKey: ['ferie-ranges'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ferie').select('medico_id, data_inizio, data_fine, approvate')
      if (error) throw error
      return data ?? []
    },
    staleTime:                   0,
    refetchOnMount:              'always',
    refetchInterval:             15_000,
    refetchIntervalInBackground: false,
  })

  // ── Helper per calcolare il medico per un numero in una data ───────
  const mediciAttivi = useMemo(() =>
    [...medici].filter(m => m.attivo).sort((a, b) => a.numero_ordine - b.numero_ordine),
    [medici])

  // Lookup turni: chiave "medico_id|data" → Turno. Costruito con un solo
  // pass sui turni del periodo, così ogni cella legge in O(1).
  const turniByKey = useMemo(() => {
    const m = new Map<string, Turno>()
    for (const t of turni) m.set(`${t.medico_id}|${t.data}`, t)
    return m
  }, [turni])

  // Range ferie APPROVATE per medico — la vista pubblica mostra solo le
  // approvate (le richieste in attesa non condizionano la vista del team).
  const ferieRanges = useMemo(() => {
    const m = new Map<string, [string, string][]>()
    for (const f of ferieDB) {
      if (!f.approvate) continue
      if (!m.has(f.medico_id)) m.set(f.medico_id, [])
      m.get(f.medico_id)!.push([f.data_inizio, f.data_fine])
    }
    return m
  }, [ferieDB])

  function isInFerie(medicoId: string | null | undefined, dataISO: string): boolean {
    if (!medicoId) return false
    const ranges = ferieRanges.get(medicoId)
    if (!ranges) return false
    return ranges.some(([di, df]) => dataISO >= di && dataISO <= df)
  }

  function medicoForNum(numero: number | null, data: Date): Medico | null {
    if (numero == null || mediciAttivi.length === 0 || !config) return null
    const dataInizio = new Date(config.anno_inizio, config.mese_inizio - 1, 1)
    dataInizio.setHours(0, 0, 0, 0)
    const dataRif = primoLunediDelPeriodo(dataInizio)
    const sett = contaLunedi(dataRif, data)
    const idx = medicoIdxForNum(numero, sett, mediciAttivi.length)
    return mediciAttivi[idx] ?? null
  }

  function nomeBreve(m: Medico | null): string {
    if (!m) return ''
    // Ultima parola del nome (cognome) in maiuscolo
    return m.nome.split(' ').slice(-1)[0].toUpperCase()
  }

  /** Visualizza un nome medico con eventuale tag SUB/MED e overlay "(F)"
   *  se il medico è in ferie quel giorno. Il nome viene barrato per
   *  segnalare visivamente la ferie senza far sparire l'informazione di
   *  chi sarebbe stato in turno secondo la rotazione. */
  const NomeMedico = ({ medico, placement, inFerie }: {
    medico: Medico | null
    placement: SlotPlacement
    inFerie: boolean
  }) => {
    if (!medico) return null
    const tag = placement === 'SUB' ? '(SUB)'
              : placement === 'MED' ? '(MED)' : ''
    const tagColor = placement === 'SUB' ? '#9f1239'
                   : placement === 'MED' ? '#0c4a6e' : undefined
    return (
      <>
        <span style={inFerie
          ? { textDecoration: 'line-through', color: '#9ca3af' }
          : undefined}>
          {nomeBreve(medico)}
        </span>
        {tag && !inFerie && (
          <span style={{ marginLeft: 4, color: tagColor, fontWeight: 800, fontSize: 10 }}>
            {tag}
          </span>
        )}
        {inFerie && (
          <span style={{
            marginLeft: 4, color: '#b45309', fontWeight: 800, fontSize: 10,
          }}>(F)</span>
        )}
      </>
    )
  }

  // ── Render del singolo giorno ────────────────────────────────────
  function renderGiorno(data: Date, idx: number) {
    const dWeek = getDayOfWeek(data)
    const dataISO = formatDate(data)
    const slotsGiorno = schemi
      .filter(s => s.schema_num === (config?.schema_attivo ?? 1) && s.giorno_settimana === dWeek)
      .sort((a, b) => a.slot - b.slot)

    const bgGiorno = GIORNO_BG[idx % GIORNO_BG.length]

    // Reperibile = medico nello slot con is_reperibilita
    const repSlot = slotsGiorno.find(s => s.is_reperibilita)
    const medicoRep = repSlot ? medicoForNum(repSlot.numero_medico_mattina, data) : null
    const repInFerie = !!medicoRep && (
      !!turniByKey.get(`${medicoRep.id}|${dataISO}`)?.is_ferie ||
      isInFerie(medicoRep.id, dataISO)
    )

    // Slot non-reperibilità ordinati
    const slotsNormali = slotsGiorno.filter(s => !s.is_reperibilita)

    return (
      <tbody key={dataISO}>
        {/* Riga header del giorno con colonne MATTINA/POMERIGGIO/extra/REPERIBILE */}
        <tr style={{ background: '#dbeafe', borderTop: '2px solid #1e3a8a' }}>
          <td rowSpan={Math.max(1, slotsNormali.length) + 1}
              style={{
                background: bgGiorno,
                fontWeight: 700, fontSize: 12,
                textAlign: 'center', verticalAlign: 'middle',
                width: 60, padding: '6px 4px',
                border: '1px solid #6b7280',
              }}>
            {fmtDataBreve(data)}
          </td>
          <td rowSpan={Math.max(1, slotsNormali.length) + 1}
              style={{
                background: bgGiorno,
                fontWeight: 800, fontSize: 11,
                textAlign: 'center', verticalAlign: 'middle',
                width: 90, padding: '6px 4px',
                border: '1px solid #6b7280',
              }}>
            {GIORNI_IT[dWeek]}
          </td>
          <td style={{
            fontWeight: 700, fontSize: 11, textAlign: 'center',
            background: '#dbeafe', padding: '4px 6px',
            border: '1px solid #6b7280', width: 200,
          }}>MATTINA</td>
          <td style={{
            fontWeight: 700, fontSize: 11, textAlign: 'center',
            background: '#dbeafe', padding: '4px 6px',
            border: '1px solid #6b7280', width: 200,
          }}>POMERIGGIO</td>
          <td style={{
            fontWeight: 700, fontSize: 11, textAlign: 'center',
            background: '#e5e7eb', padding: '4px 6px',
            border: '1px solid #6b7280', width: 160,
          }}>&nbsp;</td>
          <td rowSpan={Math.max(1, slotsNormali.length) + 1}
              style={{
                background: bgGiorno,
                fontWeight: 800, fontSize: 12,
                textAlign: 'center', verticalAlign: 'middle',
                width: 140, padding: '6px 8px',
                border: '1px solid #6b7280',
                color: medicoRep ? '#1f2937' : '#9ca3af',
              }}>
            {medicoRep
              ? <NomeMedico medico={medicoRep} placement={null} inFerie={repInFerie} />
              : '—'}
          </td>
        </tr>

        {/* Righe slot del giorno */}
        {slotsNormali.length === 0 && (
          <tr>
            <td colSpan={3} style={{
              padding: '8px', textAlign: 'center', color: '#9ca3af',
              fontStyle: 'italic', fontSize: 11,
              background: '#f9fafb', border: '1px solid #d1d5db',
            }}>
              Nessuno slot configurato per {GIORNI_IT[dWeek].toLowerCase()}.
            </td>
          </tr>
        )}
        {slotsNormali.map((slot, slotIdx) => {
          const medM  = medicoForNum(slot.numero_medico_mattina,    data)
          const medP  = medicoForNum(slot.numero_medico_pomeriggio, data)
          const medRM = medicoForNum(slot.numero_medico_rm,         data)
          const medRP = medicoForNum(slot.numero_medico_rp,         data)

          // Lookup turno reale per ogni medico — quando esiste, lo schema
          // teorico cede il passo allo stato salvato nel DB (SUB/MED per
          // mattina/pomeriggio + flag ferie).
          const turnoM  = medM  ? turniByKey.get(`${medM.id}|${dataISO}`)  : undefined
          const turnoP  = medP  ? turniByKey.get(`${medP.id}|${dataISO}`)  : undefined
          const turnoRM = medRM ? turniByKey.get(`${medRM.id}|${dataISO}`) : undefined
          const turnoRP = medRP ? turniByKey.get(`${medRP.id}|${dataISO}`) : undefined

          // Fallback dello schema: in assenza del turno (es. data fuori
          // dal calendario generato) prendiamo il flag dello schema teorico.
          const fallbackPlacement: SlotPlacement = slot.is_sub
            ? 'SUB' : slot.is_med ? 'MED' : null

          // Placement effettivo — DB ha la precedenza, schema il fallback.
          const placM: SlotPlacement = turnoM?.slot_mattina    ?? fallbackPlacement
          const placP: SlotPlacement = turnoP?.slot_pomeriggio ?? fallbackPlacement

          // Stato ferie — combina flag is_ferie del turno con le date
          // inserite in tabella ferie (entrambi i casi sono validi).
          const ferieM  = !!turnoM?.is_ferie  || isInFerie(medM?.id,  dataISO)
          const ferieP  = !!turnoP?.is_ferie  || isInFerie(medP?.id,  dataISO)
          const ferieRM = !!turnoRM?.is_ferie || isInFerie(medRM?.id, dataISO)
          const ferieRP = !!turnoRP?.is_ferie || isInFerie(medRP?.id, dataISO)

          // Cella "extra" — mostra il nome di chi fa ricerca quel giorno
          // (RM o RP). Se ha entrambi, RM prevale (ricerca mattutina).
          const extraMedico = medRM ?? medRP ?? null
          const extraInFerie = medRM ? ferieRM : ferieRP

          const rowBg = slotIdx % 2 === 0 ? '#dbeafe' : '#bfdbfe'

          return (
            <tr key={`${dataISO}-${slot.id ?? slotIdx}`} style={{ background: rowBg }}>
              {/* Mattina */}
              <td style={{
                padding: '4px 8px', fontSize: 11, fontWeight: 600,
                border: '1px solid #6b7280',
              }}>
                <NomeMedico medico={medM} placement={placM} inFerie={ferieM} />
              </td>
              {/* Pomeriggio */}
              <td style={{
                padding: '4px 8px', fontSize: 11, fontWeight: 600,
                border: '1px solid #6b7280',
              }}>
                <NomeMedico medico={medP} placement={placP} inFerie={ferieP} />
              </td>
              {/* Extra (ricerca) */}
              <td style={{
                padding: '4px 8px', fontSize: 11, fontWeight: 500,
                background: '#f3f4f6',
                color: '#374151',
                border: '1px solid #6b7280',
              }}>
                <NomeMedico medico={extraMedico} placement={null} inFerie={extraInFerie} />
              </td>
            </tr>
          )
        })}
      </tbody>
    )
  }

  // ── Toolbar navigazione + label range ───────────────────────────
  const labelRange = (() => {
    if (vista === 'settimana') {
      const fine = addDays(anchorWeek, 6)
      return `${anchorWeek.getDate()} ${MESI_IT[anchorWeek.getMonth() + 1]} → ${fine.getDate()} ${MESI_IT[fine.getMonth() + 1]} ${fine.getFullYear()}`
    }
    return `${MESI_IT[anchorWeek.getMonth() + 1]} ${anchorWeek.getFullYear()}`
  })()

  // Step di navigazione (settimana/mese): in mese si avanza/arretra di un mese
  const passo = vista === 'settimana' ? 7 : 0
  const goPrev = () => {
    if (vista === 'settimana') setAnchorWeek(addDays(anchorWeek, -7))
    else {
      const prev = new Date(anchorWeek.getFullYear(), anchorWeek.getMonth() - 1, 1)
      setAnchorWeek(startOfWeek(prev))
    }
  }
  const goNext = () => {
    if (vista === 'settimana') setAnchorWeek(addDays(anchorWeek, passo))
    else {
      const next = new Date(anchorWeek.getFullYear(), anchorWeek.getMonth() + 1, 1)
      setAnchorWeek(startOfWeek(next))
    }
  }

  return (
    <div className="flex flex-col gap-3 p-4 mx-auto" style={{ maxWidth: 1100, width: '100%' }}>
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-xl font-bold text-stone-800 flex items-center gap-2">
          <CalendarDays size={20} style={{ color: '#476540' }} />
          Vista {vista === 'settimana' ? 'settimanale' : 'mensile'}
        </h2>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Toggle vista settimana / mese */}
          <div className="flex rounded-lg overflow-hidden border border-stone-300">
            <button
              onClick={() => setVista('settimana')}
              className="px-3 py-1.5 text-xs font-medium transition-colors"
              style={vista === 'settimana'
                ? { background: '#476540', color: '#fff' }
                : { background: '#faf8f3', color: '#5a5a4a' }}>
              Settimana
            </button>
            <button
              onClick={() => setVista('mese')}
              className="px-3 py-1.5 text-xs font-medium transition-colors"
              style={vista === 'mese'
                ? { background: '#476540', color: '#fff' }
                : { background: '#faf8f3', color: '#5a5a4a' }}>
              Mese
            </button>
          </div>
          <button
            onClick={goPrev}
            className="btn-secondary py-1 px-2 text-xs flex items-center gap-1"
            title={vista === 'settimana' ? 'Settimana precedente' : 'Mese precedente'}>
            <ChevronLeft size={14} /> Prec.
          </button>
          <span className="text-sm font-semibold text-stone-700 min-w-[220px] text-center">
            {labelRange}
          </span>
          <button
            onClick={goNext}
            className="btn-secondary py-1 px-2 text-xs flex items-center gap-1"
            title={vista === 'settimana' ? 'Settimana successiva' : 'Mese successivo'}>
            Succ. <ChevronRight size={14} />
          </button>
          <button
            onClick={() => setAnchorWeek(startOfWeek(new Date()))}
            className="btn-secondary py-1 px-2 text-xs"
            title="Vai a oggi">
            Oggi
          </button>
        </div>
      </div>

      {/* Nessun dato */}
      {!config && (
        <p className="text-sm text-stone-500">Caricamento configurazione...</p>
      )}

      {/* Tabella settimanale */}
      {config && mediciAttivi.length > 0 && (
        <div className="overflow-auto rounded-lg border border-stone-300 bg-white">
          <table className="border-collapse text-xs" style={{ borderSpacing: 0, width: '100%', minWidth: 850 }}>
            <thead>
              <tr>
                <th style={{
                  width: 60, padding: '6px 4px',
                  background: '#374151', color: '#fff',
                  border: '1px solid #1f2937',
                }}>Data</th>
                <th style={{
                  width: 90, padding: '6px 4px',
                  background: '#374151', color: '#fff',
                  border: '1px solid #1f2937',
                }}>Giorno</th>
                <th colSpan={3} style={{
                  background: '#374151', color: '#fff',
                  fontSize: 11, padding: '6px 4px',
                  border: '1px solid #1f2937',
                }}>Slot turni</th>
                <th style={{
                  width: 140, padding: '6px 4px',
                  background: '#dc2626', color: '#fff',
                  border: '1px solid #7f1d1d',
                }}>REPERIBILE</th>
              </tr>
            </thead>
            {giorni.map((d, idx) => renderGiorno(d, idx))}
          </table>
        </div>
      )}

      {config && mediciAttivi.length === 0 && (
        <p className="text-sm text-stone-500">Nessun medico attivo trovato.</p>
      )}
    </div>
  )
}
