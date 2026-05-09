/**
 * SettimanalePage
 *
 * Vista settimanale compatta del calendario turni: una sezione per ogni
 * giorno della settimana, con le righe degli slot dello schema attivo.
 * Per ogni slot mostra mattina + pomeriggio + l'eventuale colonna extra
 * (ricerca) + colonna reperibilità.
 *
 * Il sistema mostra la STRUTTURA TEORICA dello schema (rotazione applicata
 * settimana per settimana), non i turni con modifiche manuali. Per quelle
 * c'è la pagina Modifica Turni (admin) o la pagina Calendario completa.
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
import type { Configurazione, Medico, SchemaModello } from '../types'

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

export function SettimanalePage() {
  // Settimana corrente (lunedì) come default
  const [anchorWeek, setAnchorWeek] = useState<Date>(() => startOfWeek(new Date()))

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

  // ── Settimana visualizzata: 7 date contigue (Lun → Dom) ────────────
  const giorni = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => addDays(anchorWeek, i))
  }, [anchorWeek])

  // ── Helper per calcolare il medico per un numero in una data ───────
  const mediciAttivi = useMemo(() =>
    [...medici].filter(m => m.attivo).sort((a, b) => a.numero_ordine - b.numero_ordine),
    [medici])

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
            {medicoRep ? nomeBreve(medicoRep) : '—'}
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

          // Etichetta SUB/MED da slot.is_sub / is_med
          const tag = slot.is_sub ? '(SUB)' : slot.is_med ? '(MED)' : ''
          const tagColor = slot.is_sub ? '#9f1239' : slot.is_med ? '#0c4a6e' : undefined

          // Cella "extra" — mostra il nome di chi fa ricerca quel giorno
          // (RM o RP). Se ha entrambi, RM prevale (ricerca mattutina).
          const extraMedico = medRM ?? medRP ?? null

          const rowBg = slotIdx % 2 === 0 ? '#dbeafe' : '#bfdbfe'

          return (
            <tr key={`${dataISO}-${slot.id ?? slotIdx}`} style={{ background: rowBg }}>
              {/* Mattina */}
              <td style={{
                padding: '4px 8px', fontSize: 11, fontWeight: 600,
                border: '1px solid #6b7280',
              }}>
                {medM ? (
                  <>
                    {nomeBreve(medM)}
                    {tag && (
                      <span style={{ marginLeft: 4, color: tagColor, fontWeight: 800, fontSize: 10 }}>
                        {tag}
                      </span>
                    )}
                  </>
                ) : ''}
              </td>
              {/* Pomeriggio */}
              <td style={{
                padding: '4px 8px', fontSize: 11, fontWeight: 600,
                border: '1px solid #6b7280',
              }}>
                {medP ? (
                  <>
                    {nomeBreve(medP)}
                    {tag && (
                      <span style={{ marginLeft: 4, color: tagColor, fontWeight: 800, fontSize: 10 }}>
                        {tag}
                      </span>
                    )}
                  </>
                ) : ''}
              </td>
              {/* Extra (ricerca) */}
              <td style={{
                padding: '4px 8px', fontSize: 11, fontWeight: 500,
                background: '#f3f4f6',
                color: '#374151',
                border: '1px solid #6b7280',
              }}>
                {extraMedico ? nomeBreve(extraMedico) : ''}
              </td>
            </tr>
          )
        })}
      </tbody>
    )
  }

  // ── Toolbar navigazione ───────────────────────────────────────────
  const fineSettimana = addDays(anchorWeek, 6)
  const labelSettimana = `${anchorWeek.getDate()} ${MESI_IT[anchorWeek.getMonth() + 1]} → ${fineSettimana.getDate()} ${MESI_IT[fineSettimana.getMonth() + 1]} ${fineSettimana.getFullYear()}`

  return (
    <div className="flex flex-col gap-3 p-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-xl font-bold text-stone-800 flex items-center gap-2">
          <CalendarDays size={20} style={{ color: '#476540' }} />
          Vista settimanale
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAnchorWeek(addDays(anchorWeek, -7))}
            className="btn-secondary py-1 px-2 text-xs flex items-center gap-1"
            title="Settimana precedente">
            <ChevronLeft size={14} /> Prec.
          </button>
          <span className="text-sm font-semibold text-stone-700 min-w-[260px] text-center">
            {labelSettimana}
          </span>
          <button
            onClick={() => setAnchorWeek(addDays(anchorWeek, 7))}
            className="btn-secondary py-1 px-2 text-xs flex items-center gap-1"
            title="Settimana successiva">
            Succ. <ChevronRight size={14} />
          </button>
          <button
            onClick={() => setAnchorWeek(startOfWeek(new Date()))}
            className="btn-secondary py-1 px-2 text-xs"
            title="Vai alla settimana corrente">
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
