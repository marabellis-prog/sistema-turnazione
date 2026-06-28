/**
 * anteprimaEditing
 *
 * Applica un payload della legenda (drag&drop) a una cella turno dello
 * snapshot di "Anteprima turnazione", restituendo la cella modificata.
 *
 * E' la versione "diretta" della logica di Modifica Turni: in anteprima i
 * cambi sono manuali e preliminari, quindi NON si fa il ricalcolo automatico
 * del giorno (niente redistribuzione di SUB/MED/RM/RP) — l'admin compone gli
 * scambi a mano e poi salva. I campi *_vecchio (riga di confronto) e
 * turno_clinico_base (basale per l'arancione) NON vengono toccati.
 *
 * Payload (vedi LegendaCalendario):
 *   TC:M | TC:P | TC:L | TC:REP | TC:EM | TC:EP | TC:EL | TC:  (vuoto)
 *   TR:RM | TR:RP
 *   FLAG:SUB | FLAG:MED | FLAG:L_SUB_MED | FLAG:L_MED_SUB
 */

import type { Turno, TurnoClinico, TurnoRicerca, SlotPlacement } from '../types'

const TC_VALIDI = ['', 'M', 'P', 'L', 'REP', 'EM', 'EP', 'EL']

export function applicaDropCella(cell: Turno, payload: string): Turno {
  // ── TC: imposta il turno clinico ────────────────────────────────────
  if (payload.startsWith('TC:')) {
    const newTc = payload.slice(3) as TurnoClinico
    if (!TC_VALIDI.includes(newTc)) return cell
    if (newTc === '') {
      // Chip "Vuoto": azzera TC + TR + slot.
      return { ...cell, turno_clinico: '' as TurnoClinico, turno_ricerca: '' as TurnoRicerca,
        slot_mattina: null, slot_pomeriggio: null }
    }
    // Cambio TC: mantieni TR, azzera gli slot non piu' validi per il nuovo TC.
    const canM = newTc === 'M' || newTc === 'L' || newTc === 'EM' || newTc === 'EL'
    const canP = newTc === 'P' || newTc === 'L' || newTc === 'EP' || newTc === 'EL'
    return { ...cell, turno_clinico: newTc,
      slot_mattina:    canM ? (cell.slot_mattina    ?? null) : null,
      slot_pomeriggio: canP ? (cell.slot_pomeriggio ?? null) : null }
  }

  // ── TR: toggle ricerca mattina/pomeriggio ───────────────────────────
  if (payload === 'TR:RM') return { ...cell, turno_ricerca: (cell.turno_ricerca === 'RM' ? '' : 'RM') as TurnoRicerca }
  if (payload === 'TR:RP') return { ...cell, turno_ricerca: (cell.turno_ricerca === 'RP' ? '' : 'RP') as TurnoRicerca }

  // ── FLAG SUB/MED: toggle placement con eligibilita' per TC ──────────
  if (payload === 'FLAG:SUB' || payload === 'FLAG:MED') {
    const X: SlotPlacement = payload === 'FLAG:SUB' ? 'SUB' : 'MED'
    const tc = cell.turno_clinico
    const canM = tc === 'M' || tc === 'L' || tc === 'EM' || tc === 'EL'
    const canP = tc === 'P' || tc === 'L' || tc === 'EP' || tc === 'EL'
    let sm = cell.slot_mattina    ?? null
    let sp = cell.slot_pomeriggio ?? null
    if (canM && canP) {
      if (sm === X && sp === X) { sm = null; sp = null } else { sm = X; sp = X }
    } else if (canM) {
      sm = (sm === X) ? null : X; sp = null
    } else if (canP) {
      sp = (sp === X) ? null : X; sm = null
    }
    return { ...cell, slot_mattina: sm, slot_pomeriggio: sp }
  }

  // ── L misto: SUB-mattina + MED-pomeriggio (o viceversa) ─────────────
  if (payload === 'FLAG:L_SUB_MED' || payload === 'FLAG:L_MED_SUB') {
    if (cell.turno_clinico !== 'L') return cell
    const sm: SlotPlacement = payload === 'FLAG:L_SUB_MED' ? 'SUB' : 'MED'
    const sp: SlotPlacement = payload === 'FLAG:L_SUB_MED' ? 'MED' : 'SUB'
    return { ...cell, slot_mattina: sm, slot_pomeriggio: sp }
  }

  return cell
}
