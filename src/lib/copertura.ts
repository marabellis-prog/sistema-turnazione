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
  ambito: string                         // 'normale' | 'sabato' | 'festivi'
  meta: 'mattina' | 'pomeriggio'         // colonna `turno_sigla` nel DB
  totale: number
  per_proprieta: Record<string, number>  // es. { SUB: 2, MED: 2 }
}

/** Turno di un medico in un giorno (solo i campi utili alla copertura). */
export interface TurnoCopertura {
  turno_clinico?: string | null
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

/** Ambito del giorno a partire dalla data ISO + flag festivo. */
export function ambitoGiorno(dataISO: string, isFestivo: boolean): AmbitoCopertura {
  const dow = new Date(dataISO + 'T00:00:00').getDay()   // 0 = domenica
  if (dow === 0 || isFestivo) return 'festivi'
  if (dow === 6) return 'sabato'
  return 'normale'
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
      for (const p of t.proprieta ?? []) presente[p] = (presente[p] ?? 0) + 1
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
