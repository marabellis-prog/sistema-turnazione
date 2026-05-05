/**
 * Calcola la data di Pasqua per un dato anno (Algoritmo di Gauss/Meeus)
 */
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

/**
 * Restituisce true se la data è un festivo italiano.
 */
export function isFestivo(date: Date): boolean {
  const d = date.getDate()
  const m = date.getMonth() + 1
  const y = date.getFullYear()

  // Festività fisse
  if (d === 1  && m === 1)  return true  // Capodanno
  if (d === 6  && m === 1)  return true  // Epifania
  if (d === 25 && m === 4)  return true  // Liberazione
  if (d === 1  && m === 5)  return true  // Festa del Lavoro
  if (d === 2  && m === 6)  return true  // Repubblica
  if (d === 15 && m === 8)  return true  // Ferragosto
  if (d === 1  && m === 11) return true  // Ognissanti
  if (d === 8  && m === 12) return true  // Immacolata Concezione
  if (d === 25 && m === 12) return true  // Natale
  if (d === 26 && m === 12) return true  // Santo Stefano

  // Pasqua e Pasquetta (variabili)
  const pasqua = getPasqua(y)
  if (d === pasqua.getDate() && m === pasqua.getMonth() + 1) return true

  const pasquetta = new Date(pasqua)
  pasquetta.setDate(pasquetta.getDate() + 1)
  if (d === pasquetta.getDate() && m === pasquetta.getMonth() + 1) return true

  return false
}

/**
 * Restituisce true se la data è domenica O festivo.
 */
export function isDomenicaOFestivo(date: Date): boolean {
  return date.getDay() === 0 || isFestivo(date)
}
