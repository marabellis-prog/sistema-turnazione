/**
 * "Magia dei 4 colori" per le ferie nel calendario.
 *
 * Per ogni giorno conteggiamo:
 *   - totInFerieOggi  = medici in ferie APPROVATE in quel giorno
 *   - turniScoperti   = di quelli, quanti hanno ancora TC o TR assegnato
 *                       (= non hanno ancora ceduto/scambiato il turno)
 *
 * Confronto col `limite` (configurazione → max_ferie_concomitanti):
 *
 *   🟢 VERDE     turniScoperti === 0
 *               (tutte le ferie sono "pulite": chi è in ferie ha TC vuoto)
 *
 *   🔵 AZZURRO  turniScoperti > 0  &&  totInFerieOggi <= limite
 *               (qualcuno deve ancora cedere ma siamo entro il limite)
 *
 *   🟠 ARANCIONE  totInFerieOggi > limite  &&  turniScoperti <= limite
 *               (sovraffollamento di ferie ma turni scoperti rimangono
 *                sotto il limite di guardia → si sono organizzati)
 *
 *   🔴 ROSSO     totInFerieOggi > limite  &&  turniScoperti > limite
 *               (allarme critico: troppe ferie e troppi turni scoperti)
 *
 * I giorni senza ferie (totInFerieOggi == 0) NON ricevono nessun colore:
 * la cella header mantiene il suo aspetto normale (festivo/domenica
 * giallo o stile default). Le ferie pending non contano (solo approvate
 * impattano operativamente).
 */

import type { Medico, TurnoClinico, TurnoRicerca } from '../types'

export type ColoreFerie = 'verde' | 'azzurro' | 'arancione' | 'rosso'

export interface CalcoloColoreFerie {
  color:          ColoreFerie | null
  totInFerieOggi: number
  turniScoperti:  number
}

interface Opts {
  data:           string
  medici:         Medico[]
  /** Range di ferie APPROVATE per medico_id: Map<medicoId, [start,end][]> */
  ferieApprovate: Map<string, [string, string][]>
  /** Restituisce TC e TR del medico per quel giorno (post-modifiche locali) */
  getTurno:       (medicoId: string, data: string) => { tc: TurnoClinico; tr: TurnoRicerca } | null
  /** Limite massimo persone in ferie nello stesso giorno (da configurazione) */
  limite:         number
}

export function calcolaColoreFerie(o: Opts): CalcoloColoreFerie {
  let totInFerieOggi = 0
  let turniScoperti = 0
  for (const m of o.medici) {
    const ranges = o.ferieApprovate.get(m.id) ?? []
    const inFerie = ranges.some(([s, e]) => o.data >= s && o.data <= e)
    if (!inFerie) continue
    totInFerieOggi++
    const t = o.getTurno(m.id, o.data)
    if (t && (t.tc !== '' || t.tr !== '')) turniScoperti++
  }
  let color: ColoreFerie | null = null
  if (totInFerieOggi > 0) {
    if (turniScoperti === 0)                 color = 'verde'
    else if (totInFerieOggi <= o.limite)     color = 'azzurro'
    else if (turniScoperti <= o.limite)      color = 'arancione'
    else                                     color = 'rosso'
  }
  return { color, totInFerieOggi, turniScoperti }
}

export const COLORI_FERIE: Record<ColoreFerie, { bg: string; fg: string }> = {
  verde:     { bg: '#c6efce', fg: '#1f4a18' },
  // "azzurro" è etichetta storica del modello 4-colori; il colore reso
  // è un giallo medio pastello, intermedio fra verde (gestito) e
  // arancione (sovraffollamento), così la sequenza ha un gradiente
  // visivo coerente.
  azzurro:   { bg: '#fde68a', fg: '#713f12' },
  arancione: { bg: '#ffc896', fg: '#7c2d12' },
  rosso:     { bg: '#ff0000', fg: '#ffffff' },
}

/** Etichetta human-readable del colore (per tooltip / legenda) */
export const ETICHETTA_COLORE: Record<ColoreFerie, string> = {
  verde:     'Ferie gestite (nessun turno scoperto)',
  azzurro:   'Ferie nei limiti, qualche turno da cedere',
  arancione: 'Sovraffollamento ferie, turni scoperti sotto controllo',
  rosso:     'Allarme: troppe ferie + troppi turni scoperti',
}
