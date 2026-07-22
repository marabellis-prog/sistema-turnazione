/**
 * placementColors — colore del cerchietto di un piazzamento (#48).
 *
 * Con la promozione delle proprietà a piazzamenti per metà (SUB/MED/SUP/…),
 * le viste non possono più indicizzare un Record fisso SUB/MED: questa
 * helper centralizza la palette. SUB e MED tengono i pastelli storici;
 * qualunque altra sigla (SUP "Supporto" oggi, altre domani) usa il grigio
 * del Supporto — fedele al colore configurato di SUP (#adadad ~ grigio).
 * I chip del popover invece mostrano il colore REALE della proprietà
 * (lookup su proprieta_turno), qui serve solo il cerchietto della cella.
 */

export const PLACEMENT_BASE: Record<string, string> = {
  SUB: '#fecaca',
  MED: '#bae6fd',
}

/** Grigio del "Supporto"/jolly (metà che lavora senza SUB/MED). */
export const SUPPORTO_GREY = '#d4d4d4'

/** Sfondo del cerchietto per una metà piazzata; undefined se metà neutra. */
export function placementBg(s: string | null | undefined): string | undefined {
  if (!s) return undefined
  return PLACEMENT_BASE[s] ?? SUPPORTO_GREY
}
