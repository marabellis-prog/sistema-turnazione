import type { Configurazione } from '../types'

// ════════════════════════════════════════════════════════════════════
// #36 — Quali schemi sono "IN USO" dalla turnazione attiva.
//
// Uno schema è IN USO se è lo schema EFFETTIVO per ALMENO UN GIORNO della
// turnazione attiva (range del config), calcolato da `schema_storico`
// (cronologia [{schema, dal}]): per ogni giorno lo schema effettivo è l'epoca
// con `dal` massimo ≤ giorno. Uno schema che è stato SOVRASCRITTO prima di
// coprire anche un solo giorno (intervallo vuoto) NON è in uso → è libero.
//
// Serve a Disegna Schema per BLOCCARE elimina/azzera/salva sugli schemi in uso
// (si duplica per modificarli). Fuori dal range o senza turnazione → set vuoto.
// ════════════════════════════════════════════════════════════════════

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`

function fineTurnazione(c: Configurazione): string {
  // giorno_fine esplicito, oppure ultimo giorno del mese_fine (getter LOCALE)
  const lastDay = c.giorno_fine ?? new Date(c.anno_fine, c.mese_fine, 0).getDate()
  return ymd(c.anno_fine, c.mese_fine, lastDay)
}

export function schemiInUso(config: Configurazione | null | undefined, hasTurni: boolean = true): Set<number> {
  const out = new Set<number>()
  if (!config) return out
  // Senza turni generati non c'è turnazione attiva → nessuno schema è "in uso"
  // (evita il falso lock su reparti COPIATI / freschi / dopo chiusura totale,
  // dove config.schema_attivo è valorizzato ma non esiste alcun turno).
  if (!hasTurni) return out

  const epoche = (config.schema_storico ?? [])
    .filter(e => e && e.dal)
    .map((e, i) => ({ schema: e.schema, dal: e.dal, i }))
    // ordina per data; a pari `dal` vince l'ultimo inserito (ordine originale)
    .sort((a, b) => (a.dal < b.dal ? -1 : a.dal > b.dal ? 1 : a.i - b.i))

  // Nessuna cronologia → l'intera turnazione usa schema_attivo.
  if (epoche.length === 0) {
    if (config.schema_attivo != null) out.add(config.schema_attivo)
    return out
  }

  const inizio = ymd(config.anno_inizio, config.mese_inizio, config.giorno_inizio ?? 1)
  const fine = fineTurnazione(config)
  const cur = new Date(inizio + 'T00:00:00')
  const last = new Date(fine + 'T00:00:00')

  while (cur <= last) {
    const d = `${cur.getFullYear()}-${pad(cur.getMonth() + 1)}-${pad(cur.getDate())}`
    let eff = epoche[0].schema   // giorni prima della prima `dal` → prima epoca
    for (const e of epoche) { if (e.dal <= d) eff = e.schema; else break }
    out.add(eff)
    cur.setDate(cur.getDate() + 1)
  }
  return out
}

// ════════════════════════════════════════════════════════════════════
// Schema EFFETTIVO per un singolo giorno (da schema_storico). Stessa logica
// per-giorno di schemiInUso ma ritorna lo schema di QUEL giorno. Serve al
// controllo di copertura: dopo un Aggiorna turnazione periodi diversi usano
// schemi diversi → ogni giorno va controllato col fabbisogno del suo schema.
// ════════════════════════════════════════════════════════════════════
export function schemaEffettivoPerGiorno(
  config: Configurazione | null | undefined,
  dataISO: string,
): number | null {
  if (!config) return null
  const epoche = (config.schema_storico ?? [])
    .filter(e => e && e.dal)
    .map((e, i) => ({ schema: e.schema, dal: e.dal, i }))
    .sort((a, b) => (a.dal < b.dal ? -1 : a.dal > b.dal ? 1 : a.i - b.i))
  if (epoche.length === 0) return config.schema_attivo ?? null
  let eff = epoche[0].schema   // giorni prima della prima `dal` → prima epoca
  for (const e of epoche) { if (e.dal <= dataISO) eff = e.schema; else break }
  return eff
}
