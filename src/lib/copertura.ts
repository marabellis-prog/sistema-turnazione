/**
 * Controllo copertura DINAMICO: confronta i turni generati con il Fabbisogno
 * dello schema (`schema_fabbisogno`), per METÀ-GIORNATA (mattina / pomeriggio)
 * e per OGNI proprietà configurata.
 *
 * Regole (volute dall'utente):
 *  - si legge il VALORE del turno (turno_clinico → quali metà copre), MAI il nome;
 *  - una Lunga (L/EL) conta sia mattina sia pomeriggio; M/EM solo mattina; P/EP
 *    solo pomeriggio; REP e vuoto NON contano;
 *  - le proprietà presenti si leggono dall'array `proprieta` del turno → il
 *    sistema regge anche proprietà nuove (es. "Supporto") senza modifiche;
 *  - ambito del giorno: domenica/festivo → 'festivi', sabato → 'sabato', else
 *    'normale'.
 *
 * Helper PURO (nessuna dipendenza da React/DB) → testabile in isolamento.
 */

export type AmbitoCopertura = 'normale' | 'sabato' | 'festivi'

/** Riga di `schema_fabbisogno` (una per ambito × metà-giornata). */
export interface FabbisognoRiga {
  ambito: string                         // 'normale' | 'sabato' | 'festivi' | ...
  meta: 'mattina' | 'pomeriggio'         // colonna `turno_sigla` nel DB
  totale: number
  per_proprieta: Record<string, number>  // es. { SUB: 2, MED: 2 }
  /** Precedenza di override: a parità di giorno che combacia più ambiti, vince
   *  l'ordine più ALTO (l'ultimo nella cascata). normale = 0 (base). */
  ordine?: number
}

/** Turno di un medico in un giorno (solo i campi utili alla copertura). */
export interface TurnoCopertura {
  turno_clinico?: string | null
  /** Placement SUB/MED per metà (fonte LIVE: riflette le modifiche manuali). */
  slot_mattina?: 'SUB' | 'MED' | null
  slot_pomeriggio?: 'SUB' | 'MED' | null
  /** Flag del turno: usati per le proprietà SENZA placement (es. Supporto). */
  proprieta?: string[] | null
}

export interface RigaCopertura { sigla: string; richiesto: number; presente: number }
export interface MetaCopertura {
  totRichiesto: number
  totPresente: number
  righe: RigaCopertura[]   // una per proprietà (richiesta o presente)
}
export interface CoperturaGiorno { mattina: MetaCopertura; pomeriggio: MetaCopertura }

const COPRE_MATTINA    = new Set(['M', 'L', 'EM', 'EL'])
const COPRE_POMERIGGIO = new Set(['P', 'L', 'EP', 'EL'])

/** Ambito del giorno a partire dalla data ISO + flag festivo (precedenza fissa
 *  storica: festivi > sabato > normale). Mantenuto per compatibilità. */
export function ambitoGiorno(dataISO: string, isFestivo: boolean): AmbitoCopertura {
  const dow = new Date(dataISO + 'T00:00:00').getDay()   // 0 = domenica
  if (dow === 0 || isFestivo) return 'festivi'
  if (dow === 6) return 'sabato'
  return 'normale'
}

/** Condizione di un ambito per un dato giorno. `prefestivo` NON è ancora
 *  risolto (servirebbe il look-ahead sulle festività) → non combacia mai. */
function ambitoCombacia(ambito: string, dow: number, isFestivo: boolean): boolean {
  switch (ambito) {
    case 'normale':    return true                    // base: vale sempre
    case 'sabato':     return dow === 6
    case 'festivi':    return dow === 0 || isFestivo
    case 'prefestivo': return false
    default:           return false
  }
}

/**
 * Ambito EFFETTIVO del giorno rispettando l'ORDINE di override definito
 * nello schema: tra gli ambiti che combaciano col giorno, vince quello con
 * `ordine` più ALTO (l'ultimo nella cascata "…viene sovrascritto da…").
 * `normale` è sempre la base (fallback), anche se non presente nell'elenco.
 *
 * @param ambiti  ambiti definiti nel fabbisogno, con il loro `ordine`
 */
export function risolviAmbito(
  dataISO: string,
  isFestivo: boolean,
  ambiti: { ambito: string; ordine: number }[],
): string {
  const dow = new Date(dataISO + 'T00:00:00').getDay()
  // Specificità = tie-break a PARITÀ di `ordine`: un ambito specifico che
  // combacia deve battere `normale` (base), a prescindere dall'ORDINE con cui
  // gli ambiti arrivano dal DB (che varia tra schemi). Precedenza storica:
  // festivi > prefestivo > sabato > normale. Un `ordine` esplicito più ALTO
  // (riordino manuale nella cascata) vince comunque sulla specificità.
  const spec = (a: string) =>
    a === 'festivi' ? 3 : a === 'prefestivo' ? 2 : a === 'sabato' ? 1 : 0
  let scelto = 'normale'
  let ordScelto = -Infinity
  let specScelto = -Infinity
  for (const a of ambiti) {
    if (!ambitoCombacia(a.ambito, dow, isFestivo)) continue
    const s = spec(a.ambito)
    if (a.ordine > ordScelto || (a.ordine === ordScelto && s > specScelto)) {
      scelto = a.ambito
      ordScelto = a.ordine
      specScelto = s
    }
  }
  return scelto
}

/**
 * Copertura di un giorno: per ogni metà-giornata, presente vs richiesto.
 *
 * @param turni        i turni dei medici in quel giorno (esclusi ferie/assenti)
 * @param proprietaOrd sigle delle proprietà configurate, NELL'ORDINE di display
 * @param fabbisogno   righe di `schema_fabbisogno` GIÀ filtrate all'ambito del giorno
 */
export function calcolaCoperturaGiorno(
  turni: TurnoCopertura[],
  proprietaOrd: string[],
  fabbisogno: FabbisognoRiga[],
): CoperturaGiorno {
  const perMeta = (meta: 'mattina' | 'pomeriggio'): MetaCopertura => {
    const copre = meta === 'mattina' ? COPRE_MATTINA : COPRE_POMERIGGIO
    const fab = fabbisogno.find(f => f.meta === meta)
    const richProp = fab?.per_proprieta ?? {}

    let totPresente = 0
    const presente: Record<string, number> = {}
    for (const t of turni) {
      const tc = t.turno_clinico ?? ''
      if (!copre.has(tc)) continue
      totPresente++
      // SUB/MED dal placement (slot) → LIVE con le modifiche manuali; le altre
      // proprietà (es. Supporto) dai flag del turno solo se NON c'è placement.
      const slot = meta === 'mattina' ? (t.slot_mattina ?? null) : (t.slot_pomeriggio ?? null)
      if (slot === 'SUB' || slot === 'MED') {
        presente[slot] = (presente[slot] ?? 0) + 1
      } else {
        for (const p of t.proprieta ?? []) {
          if (p !== 'SUB' && p !== 'MED') presente[p] = (presente[p] ?? 0) + 1
        }
      }
    }

    // Righe = proprietà configurate che sono richieste nel fabbisogno OPPURE
    // presenti nei turni (così "Supporto" e nuove proprietà compaiono appena
    // usate). Ordine = quello di `proprietaOrd`; eventuali sigle extra in coda.
    const sigleViste = new Set<string>([...Object.keys(richProp), ...Object.keys(presente)])
    const ordinate = [
      ...proprietaOrd.filter(s => sigleViste.has(s)),
      ...[...sigleViste].filter(s => !proprietaOrd.includes(s)),
    ]
    const righe = ordinate.map(sigla => ({
      sigla,
      richiesto: richProp[sigla] ?? 0,
      presente:  presente[sigla] ?? 0,
    }))

    return { totRichiesto: fab?.totale ?? 0, totPresente, righe }
  }
  return { mattina: perMeta('mattina'), pomeriggio: perMeta('pomeriggio') }
}
