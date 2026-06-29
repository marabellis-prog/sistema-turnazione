/**
 * Festività nazionali (per-nazione) + helper festivo.
 *
 * Multi-reparto: ogni reparto sceglie la sua NAZIONE (due reparti possono
 * stare in nazioni diverse). Le festività nazionali derivano dalla nazione;
 * le festività custom (santo patrono, chiusure locali) sono per-reparto.
 *
 * `isFestivo(date, festivoSet)` ora usa SOLO il set passato: il set deve già
 * contenere le festività nazionali (della nazione del reparto) UNITE alle
 * custom. Lo costruisce `useFestivitaCustom` con `buildFestivoSet`.
 */

const pad = (n: number) => String(n).padStart(2, '0')
const isoYMD = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`
const localIso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** Data di Pasqua per un dato anno (Algoritmo di Gauss/Meeus). */
export function getPasqua(year: number): Date {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(year, month - 1, day)
}

// ── Festività nazionali per nazione ────────────────────────────────────
// Estensibile: per aggiungere una nazione, aggiungi una voce a NAZIONI con
// la sua funzione holidays(year). Pasqua/Pasquetta via getPasqua se serve.

interface DefNazione {
  nome: string
  /** Festività dell'anno (data ISO + nome leggibile), escluse le custom. */
  holidays: (year: number) => Array<{ data: string; nome: string }>
}

function holidaysIT(year: number): Array<{ data: string; nome: string }> {
  const fixed = [
    { data: isoYMD(year, 1,  1),  nome: 'Capodanno' },
    { data: isoYMD(year, 1,  6),  nome: 'Epifania' },
    { data: isoYMD(year, 4, 25),  nome: 'Liberazione' },
    { data: isoYMD(year, 5,  1),  nome: 'Festa del Lavoro' },
    { data: isoYMD(year, 6,  2),  nome: 'Festa della Repubblica' },
    { data: isoYMD(year, 8, 15),  nome: 'Ferragosto' },
    { data: isoYMD(year, 11, 1),  nome: 'Ognissanti' },
    { data: isoYMD(year, 12, 8),  nome: 'Immacolata Concezione' },
    { data: isoYMD(year, 12, 25), nome: 'Natale' },
    { data: isoYMD(year, 12, 26), nome: 'Santo Stefano' },
  ]
  const pasqua = getPasqua(year)
  const pasquetta = new Date(pasqua); pasquetta.setDate(pasquetta.getDate() + 1)
  return [
    ...fixed,
    { data: localIso(pasqua),    nome: 'Pasqua' },
    { data: localIso(pasquetta), nome: 'Lunedì dell\'Angelo' },
  ].sort((a, b) => a.data.localeCompare(b.data))
}

/** Nazioni supportate. 'NONE' = nessuna festività nazionale (solo domeniche
 *  + eventuali festività custom). Aggiungere nuove nazioni qui. */
export const NAZIONI: Record<string, DefNazione> = {
  IT:   { nome: 'Italia',                       holidays: holidaysIT },
  NONE: { nome: 'Nessuna (solo domeniche)',     holidays: () => [] },
}

/** Codice nazione valido (fallback IT se sconosciuto/non impostato). */
export function nazioneValida(codice: string | null | undefined): string {
  return codice && NAZIONI[codice] ? codice : 'IT'
}

/** Festività nazionali della nazione per l'anno (lista con nomi, ordinata). */
export function holidaysForNation(codice: string | null | undefined, year: number) {
  return NAZIONI[nazioneValida(codice)].holidays(year)
}

/** Alias storico (Italia). */
export function getItalianHolidaysWithNames(year: number) {
  return holidaysIT(year)
}

/** Costruisce il Set di date ISO festive = nazionali (della nazione) su un
 *  range di anni UNITE alle festività custom. È il set da passare a isFestivo
 *  / generaColonne. */
export function buildFestivoSet(
  nazione: string | null | undefined,
  customDates: Iterable<string>,
  years: number[],
): Set<string> {
  const s = new Set<string>(customDates)
  for (const y of years) {
    for (const h of holidaysForNation(nazione, y)) s.add(h.data)
  }
  return s
}

/**
 * true se la data è festiva. Usa SOLO il set passato (nazionali + custom),
 * costruito a monte con buildFestivoSet. Senza set → false (nessun festivo).
 */
export function isFestivo(date: Date, festivoSet?: Set<string>): boolean {
  if (!festivoSet || festivoSet.size === 0) return false
  return festivoSet.has(localIso(date))
}

/** true se la data è domenica O festivo. */
export function isDomenicaOFestivo(date: Date, festivoSet?: Set<string>): boolean {
  return date.getDay() === 0 || isFestivo(date, festivoSet)
}
