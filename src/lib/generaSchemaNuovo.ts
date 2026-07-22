/**
 * generaSchemaNuovo — motore di generazione dal NUOVO schema dinamico.
 *
 * Stessa ROTAZIONE del motore vecchio (algorithm.ts): ancora = primo lunedì del
 * periodo; il turnista in posizione `mi` la settimana `sett` riceve il numero
 * schema `((mi + sett) % N) + 1`. Cambia SOLO la risoluzione del turno: invece
 * di leggere schemi_modello (M/P/L/REP fissi) legge le `schema_cella` + i FLAG
 * dei tipi_turno (copre_mattina/copre_pomeriggio/is_reperibilita) → turni
 * arbitrari. Le proprietà attive sullo slot diventano `proprieta`.
 *
 * Produce UNA riga per (medico, giorno) come calcolaCalendarioCompleto, con in
 * più `turno_sigla` (il turno vero) e `proprieta` (i flag). Le colonne vecchie
 * (turno_clinico, slot_mattina/pomeriggio, is_sub/is_med) sono DERIVATE dai flag
 * per compatibilità con 11N e le viste attuali durante la transizione.
 *
 * Self-contained: importa solo i tipi (le helper di rotazione sono inline,
 * identiche ad algorithm.ts) → testabile in isolamento.
 */

import type { Medico, TipoTurno } from '../types'

export interface SchemaCellaLite  { giorno_settimana: number; slot_idx: number; colonna_sigla: string; numero: number | null; attivo: boolean }
export interface SchemaColonnaLite { tipo: 'turno' | 'flag'; sigla: string }
export interface SchemaCheckLite   { giorno_settimana: number; colonna_sigla: string }

export interface TurnoGenDin {
  medico_id: string
  data: string
  turno_clinico: string
  turno_ricerca: string
  /** #48 — piazzamento per metà: qualunque proprietà (SUB/MED/SUP/…). */
  slot_mattina: string | null
  slot_pomeriggio: string | null
  is_sub: boolean
  is_med: boolean
  turno_sigla: string | null
  proprieta: string[]
}

// ── Helper rotazione (identiche ad algorithm.ts, inline per auto-contenimento) ──
function contaLunedi(dataRif: Date, dataCorrente: Date): number {
  const a = new Date(dataRif);      a.setDate(a.getDate() - ((a.getDay() + 6) % 7)); a.setHours(0, 0, 0, 0)
  const b = new Date(dataCorrente); b.setDate(b.getDate() - ((b.getDay() + 6) % 7)); b.setHours(0, 0, 0, 0)
  return Math.round((b.getTime() - a.getTime()) / (7 * 24 * 3600 * 1000))
}
function primoLunediDelPeriodo(dataInizio: Date): Date {
  const d = new Date(dataInizio); d.setHours(0, 0, 0, 0)
  const dow = d.getDay()
  if (dow !== 1) d.setDate(d.getDate() + (dow === 0 ? 1 : 8 - dow))
  return d
}
function getDayOfWeek(date: Date): number { const d = date.getDay(); return d === 0 ? 7 : d }
function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export interface GeneraSchemaParams {
  anno_inizio: number; mese_inizio: number; giorno_inizio?: number | null
  anno_fine: number;   mese_fine: number;   giorno_fine?: number | null
  medici: Medico[]
  celle:     SchemaCellaLite[]
  colonne:   SchemaColonnaLite[]
  checks:    SchemaCheckLite[]   // solo le caselle SPUNTATE
  tipiTurno: TipoTurno[]
  /** Continuità rotazione (Aggiorna turnazione): ancora alternativo. */
  anchorOverride?: Date
}

export function generaSchemaNuovo(p: GeneraSchemaParams): TurnoGenDin[] {
  const mediciAttivi = [...p.medici]
    .filter(m => m.attivo && m.numero_ordine != null)
    .sort((a, b) => (a.numero_ordine ?? 0) - (b.numero_ordine ?? 0))
  const N = mediciAttivi.length

  const dataInizio = new Date(p.anno_inizio, p.mese_inizio - 1, p.giorno_inizio ?? 1)
  dataInizio.setHours(0, 0, 0, 0)
  const dataFine = new Date(p.anno_fine, p.mese_fine - 1, 1)
  if (p.giorno_fine != null) dataFine.setDate(p.giorno_fine)
  else dataFine.setMonth(dataFine.getMonth() + 1, 0)
  dataFine.setHours(0, 0, 0, 0)

  const anchor = p.anchorOverride ?? primoLunediDelPeriodo(dataInizio)

  const turnoSigle = new Set(p.colonne.filter(c => c.tipo === 'turno').map(c => c.sigla))
  const flagSigle  = new Set(p.colonne.filter(c => c.tipo === 'flag').map(c => c.sigla))
  const isChecked  = (g: number, sigla: string) => p.checks.some(c => c.giorno_settimana === g && c.colonna_sigla === sigla)
  const tipo       = (sigla: string) => p.tipiTurno.find(t => t.sigla === sigla)

  const out: TurnoGenDin[] = []
  if (N === 0) return out

  const corrente = new Date(dataInizio)
  while (corrente <= dataFine) {
    const dataISO = formatDate(corrente)
    const dWeek   = getDayOfWeek(corrente)
    const sett    = contaLunedi(anchor, corrente)

    for (let mi = 0; mi < N; mi++) {
      const calcNum = ((((mi + sett) % N) + N) % N) + 1

      // Prima cella-turno (in uno slot spuntato del giorno) col numero di questo turnista.
      const cel = p.celle.find(c =>
        c.giorno_settimana === dWeek && c.numero === calcNum &&
        turnoSigle.has(c.colonna_sigla) && isChecked(dWeek, c.colonna_sigla))

      let turno_sigla: string | null = null
      let turno_clinico = ''
      let slot_mattina: string | null = null
      let slot_pomeriggio: string | null = null
      let proprieta: string[] = []

      if (cel) {
        turno_sigla = cel.colonna_sigla
        const t = tipo(turno_sigla)
        const m = !!t?.copre_mattina, pm = !!t?.copre_pomeriggio, rep = !!t?.is_reperibilita
        turno_clinico = rep ? 'REP' : (m && pm ? 'L' : m ? 'M' : pm ? 'P' : '')

        // Proprietà (flag) attive su QUELLO slot del giorno.
        proprieta = p.celle.filter(c =>
          c.giorno_settimana === dWeek && c.slot_idx === cel.slot_idx && c.attivo &&
          flagSigle.has(c.colonna_sigla) && isChecked(dWeek, c.colonna_sigla))
          .map(c => c.colonna_sigla)

        // Piazzamento nelle metà coperte dal turno (#48: qualunque proprietà).
        // Precedenza storica SUB → MED, poi la prima altra flag attiva (es. SUP).
        const placement: string | null =
          proprieta.includes('SUB') ? 'SUB'
          : proprieta.includes('MED') ? 'MED'
          : (proprieta[0] ?? null)
        slot_mattina    = m  ? placement : null
        slot_pomeriggio = pm ? placement : null
      }

      out.push({
        medico_id: mediciAttivi[mi].id, data: dataISO,
        turno_clinico, turno_ricerca: '',
        slot_mattina, slot_pomeriggio,
        is_sub: slot_mattina === 'SUB' || slot_pomeriggio === 'SUB',
        is_med: slot_mattina === 'MED' || slot_pomeriggio === 'MED',
        turno_sigla, proprieta,
      })
    }
    corrente.setDate(corrente.getDate() + 1)
  }
  return out
}
