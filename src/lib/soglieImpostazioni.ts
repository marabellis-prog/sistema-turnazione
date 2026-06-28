/**
 * soglieImpostazioni
 *
 * Selezione delle soglie di coerenza (sub/med/sup × mattina/pomeriggio ×
 * feriale/festivo) VALIDE per un dato giorno, tenendo conto della validità
 * temporale: dopo un "Aggiorna turnazione" le nuove soglie valgono solo da
 * una certa data; per i giorni precedenti si usano quelle storiche.
 */

import type { Configurazione, SoglieSlot } from '../types'

const SOGLIE_KEYS: (keyof SoglieSlot)[] = [
  'sub_mattina_feriale', 'sub_mattina_festivo', 'sub_pomeriggio_feriale', 'sub_pomeriggio_festivo',
  'med_mattina_feriale', 'med_mattina_festivo', 'med_pomeriggio_feriale', 'med_pomeriggio_festivo',
  'sup_mattina_feriale', 'sup_mattina_festivo', 'sup_pomeriggio_feriale', 'sup_pomeriggio_festivo',
  'sub_mattina_sabato', 'sub_pomeriggio_sabato', 'med_mattina_sabato',
  'med_pomeriggio_sabato', 'sup_mattina_sabato', 'sup_pomeriggio_sabato',
]

/** Estrae le 12 soglie correnti dalle colonne config. */
export function soglieCorrenti(config: Configurazione): SoglieSlot {
  const out = {} as SoglieSlot
  for (const k of SOGLIE_KEYS) out[k] = config[k] ?? 0
  return out
}

const ZERO: SoglieSlot = (() => {
  const out = {} as SoglieSlot
  for (const k of SOGLIE_KEYS) out[k] = 0
  return out
})()

/**
 * Ritorna le soglie valide per il giorno `dataISO`:
 *  - se `impostazioni_valido_dal` è null OPPURE dataISO >= valido_dal →
 *    soglie correnti (colonne config);
 *  - altrimenti cerca nello storico l'epoca che copre il giorno;
 *  - se nessuna copre il giorno → tutte 0 (nessun controllo).
 */
export function soglieForDay(config: Configurazione | null | undefined, dataISO: string): SoglieSlot {
  if (!config) return ZERO
  const validoDal = config.impostazioni_valido_dal ?? null
  if (!validoDal || dataISO >= validoDal) return soglieCorrenti(config)

  const storico = config.impostazioni_storico ?? []
  for (const ep of storico) {
    const dalOk  = !ep.valido_dal || ep.valido_dal <= dataISO
    const finoOk = dataISO < ep.valido_fino
    if (dalOk && finoOk) return ep.soglie
  }
  return ZERO
}
