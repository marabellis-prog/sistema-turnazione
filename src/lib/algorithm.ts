import { isFestivo } from './holidays'
import type {
  Medico,
  Configurazione,
  SchemaModello,
  TurnoTeorico,
  TurnoGenerato,
  TurnoClinico,
  TurnoRicerca,
  ColonnaCal,
} from '../types'

// ─── Utility data ──────────────────────────────────────────────────

/**
 * Numero di settimane intere trascorse tra dataRif e dataCorrente.
 * Può restituire valori NEGATIVI: i giorni prima del primo lunedì del
 * periodo hanno sett=-1 e vengono trattati come fine del ciclo precedente.
 */
export function contaLunedi(dataRif: Date, dataCorrente: Date): number {
  const lunRif = new Date(dataRif)
  lunRif.setDate(lunRif.getDate() - ((lunRif.getDay() + 6) % 7))
  lunRif.setHours(0, 0, 0, 0)

  const lunCorrente = new Date(dataCorrente)
  lunCorrente.setDate(lunCorrente.getDate() - ((lunCorrente.getDay() + 6) % 7))
  lunCorrente.setHours(0, 0, 0, 0)

  return Math.round(
    (lunCorrente.getTime() - lunRif.getTime()) / (7 * 24 * 3600 * 1000)
  )
  // NOTA: nessun clamp a 0 — valori negativi gestiti dalla matematica modulare
}

/**
 * Restituisce il primo lunedì del periodo (su o dopo dataInizio).
 * Questo è il punto di riferimento della rotazione (settimana 0).
 * I giorni prima di questo lunedì (es. Ven-Dom di inizio mese) ricevono
 * sett=-1 e vengono calcolati come fine del ciclo precedente.
 */
export function primoLunediDelPeriodo(dataInizio: Date): Date {
  const d = new Date(dataInizio)
  d.setHours(0, 0, 0, 0)
  const dow = d.getDay() // 0=Dom, 1=Lun, ..., 6=Sab
  if (dow !== 1) {
    // Avanza al lunedì successivo (domenica: +1, altri: 8-dow)
    d.setDate(d.getDate() + (dow === 0 ? 1 : 8 - dow))
  }
  return d
}

/**
 * Giorno della settimana: 1=Lun, 2=Mar, ..., 7=Dom
 */
export function getDayOfWeek(date: Date): number {
  const d = date.getDay() // JS: 0=Dom, 1=Lun, ..., 6=Sab
  return d === 0 ? 7 : d
}

// ─── Algoritmo centrale ────────────────────────────────────────────

/**
 * Calcola il turno teorico di UN medico per UN giorno specifico.
 * Porta la stessa logica di GetTurnoMedico() nel codice GAS.
 *
 * @param medicoIndex   Indice 0-based del medico nell'array ordinato per numero_ordine
 * @param data          Data da calcolare
 * @param dataInizio    Primo giorno del calendario (dataInizioGlobale)
 * @param numMedici     Numero totale di medici attivi
 * @param schemiGiorno  Tutti gli slot SchemaModello per il giorno_settimana e schema_num corretti
 */
export function calcolaTurnoTeorico(
  medicoIndex: number,
  data: Date,
  dataInizio: Date,
  numMedici: number,
  schemiGiorno: SchemaModello[]
): TurnoTeorico {
  const sett = contaLunedi(dataInizio, data)
  const dWeek = getDayOfWeek(data)

  // schemiGiorno è già filtrato per giorno_settimana dal chiamante
  const slots = schemiGiorno

  // Trova il numero-schema (calcNum) assegnato a questo medico questa settimana
  let calcNum = 0
  for (let testNum = 1; testNum <= numMedici; testNum++) {
    let calcIdx = (testNum - 1 - sett) % numMedici
    while (calcIdx < 0) calcIdx += numMedici
    if (calcIdx === medicoIndex) {
      calcNum = testNum
      break
    }
  }

  let turno_clinico: TurnoClinico = ''
  let turno_ricerca: TurnoRicerca = ''
  let is_sub = false
  let is_med = false

  for (const slot of slots) {
    const inM  = slot.numero_medico_mattina    === calcNum
    const inP  = slot.numero_medico_pomeriggio === calcNum
    const inRM = slot.numero_medico_rm         === calcNum
    const inRP = slot.numero_medico_rp         === calcNum

    // Turno clinico (primo match vince). is_sub / is_med ereditate
    // dallo slot in cui il medico è assegnato come clinico.
    if (turno_clinico === '') {
      let matched = false
      if (slot.is_reperibilita && inM) {
        turno_clinico = 'REP'; matched = true
      } else if (inM && inP) {
        turno_clinico = 'L';   matched = true
      } else if (inM) {
        turno_clinico = 'M';   matched = true
      } else if (inP) {
        turno_clinico = 'P';   matched = true
      }
      if (matched) {
        is_sub = !!slot.is_sub
        is_med = !!slot.is_med
      }
    }

    // Turno ricerca
    if (inRM && inRP) {
      turno_ricerca = 'RM+RP'
    } else if (inRM && turno_ricerca === '') {
      turno_ricerca = 'RM'
    } else if (inRP && turno_ricerca === '') {
      turno_ricerca = 'RP'
    }
  }

  return { turno_clinico, turno_ricerca, is_sub, is_med }
}

// ─── Generazione calendario completo ──────────────────────────────

/**
 * Genera l'array completo di turni teorici per tutti i medici e tutte le date.
 * Equivalente a GeneraCalendarioCompleto() nel codice GAS.
 */
export function calcolaCalendarioCompleto(
  config: Configurazione,
  schemi: SchemaModello[],
  medici: Medico[]
): TurnoGenerato[] {
  const mediciAttivi = [...medici]
    .filter(m => m.attivo)
    .sort((a, b) => a.numero_ordine - b.numero_ordine)

  const numMedici = mediciAttivi.length
  const schemaFiltrato = schemi.filter(s => s.schema_num === config.schema_attivo)

  const dataInizio = new Date(config.anno_inizio, config.mese_inizio - 1, 1)
  dataInizio.setHours(0, 0, 0, 0)

  const dataFine = new Date(config.anno_fine, config.mese_fine - 1, 1)
  dataFine.setMonth(dataFine.getMonth() + 1, 0)
  dataFine.setHours(0, 0, 0, 0)

  // ── Punto di riferimento rotazione: primo lunedì del periodo ──────
  // I giorni prima (es. Ven-Dom se il mese inizia venerdì) ricevono
  // sett=-1 e sono calcolati come fine del ciclo precedente.
  const dataRifRotazione = primoLunediDelPeriodo(dataInizio)

  const risultati: TurnoGenerato[] = []

  const corrente = new Date(dataInizio)
  while (corrente <= dataFine) {
    const dataISO = formatDate(corrente)
    const dWeek = getDayOfWeek(corrente)
    const schemiGiorno = schemaFiltrato.filter(s => s.giorno_settimana === dWeek)

    for (let n = 0; n < numMedici; n++) {
      const { turno_clinico, turno_ricerca, is_sub, is_med } = calcolaTurnoTeorico(
        n,
        corrente,
        dataRifRotazione,   // ← primo lunedì, non giorno 1
        numMedici,
        schemiGiorno
      )

      risultati.push({
        medico_id: mediciAttivi[n].id,
        data: dataISO,
        turno_clinico,
        turno_ricerca,
        is_sub,
        is_med,
      })
    }

    corrente.setDate(corrente.getDate() + 1)
  }

  return risultati
}

// ─── Ricalcolo redistributivo per UN giorno ──────────────────────────
// Quando l'admin cambia manualmente il TC di un medico in Modifica Turni,
// questa funzione ridistribuisce TR (RM/RP) e i flag SUB/MED del GIORNO
// rispettando le regole di eligibilità + tie-break "chi ne ha meno + alfa".
//
// Regole:
//   RM solo a chi ha TC=='P'   |   RP solo a chi ha TC=='M'
//   (escluso L, REP, riposo — un medico non può avere RM e RP insieme)
//
//   SUB/MED applicabili solo a TC ∈ {M, P, L} (escluso REP e riposo)
//   Logica ibrida: chi era flaggato dallo slot teorico mantiene il flag
//   se ancora eligibile; capacità mancanti redistribuite per priorità.
//
// Tie-break (RM, RP, SUB, MED): 1) meno turni di quel tipo nel periodo,
// 2) ordine alfabetico su medico.nome.

export interface RicalcContext {
  /** Capacità per il giorno (dallo schema) */
  capacita: { rm: number; rp: number; sub: number; med: number }
  /** Lista medici in scope. Verrà ordinata internamente per nome ai fini del tie-break. */
  medici:   Medico[]
  /** TC corrente del medico in questo giorno (post-modifica utente) */
  tcGiorno: Map<string, TurnoClinico>
  /** Flag SUB/MED ORIGINALI dello slot teorico per questo giorno (pre-modifica) */
  flagsOriginali: Map<string, { isSub: boolean; isMed: boolean }>
  /** Conteggi nel periodo ESCLUSO il giorno target — per tie-break */
  contaPeriodo: Map<string, { rm: number; rp: number; sub: number; med: number }>
}

export interface RicalcCell {
  tc:    TurnoClinico
  tr:    TurnoRicerca
  isSub: boolean
  isMed: boolean
}

export function ricalcolaGiorno(ctx: RicalcContext): Map<string, RicalcCell> {
  const { capacita, medici, tcGiorno, flagsOriginali, contaPeriodo } = ctx

  // Helper sort: meno (count tipo) prima, poi alfabetico nome.
  const cmpBy = (tipo: 'rm' | 'rp' | 'sub' | 'med') => (a: Medico, b: Medico) => {
    const ca = contaPeriodo.get(a.id)?.[tipo] ?? 0
    const cb = contaPeriodo.get(b.id)?.[tipo] ?? 0
    if (ca !== cb) return ca - cb
    return a.nome.localeCompare(b.nome, 'it', { sensitivity: 'base' })
  }

  // ── RM: TC=='P' → ordino per (count rm asc, nome asc), prendo primi N_RM ──
  const eligibiliRM = medici.filter(m => tcGiorno.get(m.id) === 'P').sort(cmpBy('rm'))
  const assegnatiRM = new Set(eligibiliRM.slice(0, capacita.rm).map(m => m.id))

  // ── RP: TC=='M' → idem ──────────────────────────────────────────────────
  const eligibiliRP = medici.filter(m => tcGiorno.get(m.id) === 'M').sort(cmpBy('rp'))
  const assegnatiRP = new Set(eligibiliRP.slice(0, capacita.rp).map(m => m.id))

  // ── SUB con logica ibrida ───────────────────────────────────────────────
  const isLavorante = (id: string) => {
    const t = tcGiorno.get(id) ?? ''
    return t === 'M' || t === 'P' || t === 'L'   // escluso REP e ''
  }

  const assegnatiSUB = new Set<string>()
  // a) Preserva: chi era isSub originale e lavora ancora → tiene il flag
  for (const m of medici) {
    if (flagsOriginali.get(m.id)?.isSub && isLavorante(m.id)) {
      assegnatiSUB.add(m.id)
    }
  }
  // b) Se mancano slot SUB, ridistribuisci tra eligibili non già assegnati
  if (assegnatiSUB.size < capacita.sub) {
    const candidati = medici
      .filter(m => isLavorante(m.id) && !assegnatiSUB.has(m.id))
      .sort(cmpBy('sub'))
    for (let i = 0; i < capacita.sub - assegnatiSUB.size && i < candidati.length; i++) {
      assegnatiSUB.add(candidati[i].id)
    }
  }
  // c) Se assegnatiSUB > capacita.sub, niente rimozione: lasciamo coerenti
  //    coi flag originali. Succede solo se l'utente cambia uno schema in
  //    corsa (raro). I non-eligibili sono già esclusi al passo a).

  // ── MED — identico a SUB ────────────────────────────────────────────────
  const assegnatiMED = new Set<string>()
  for (const m of medici) {
    if (flagsOriginali.get(m.id)?.isMed && isLavorante(m.id)) {
      assegnatiMED.add(m.id)
    }
  }
  if (assegnatiMED.size < capacita.med) {
    const candidati = medici
      .filter(m => isLavorante(m.id) && !assegnatiMED.has(m.id))
      .sort(cmpBy('med'))
    for (let i = 0; i < capacita.med - assegnatiMED.size && i < candidati.length; i++) {
      assegnatiMED.add(candidati[i].id)
    }
  }

  // ── Costruisci output: una riga per ogni medico in scope ─────────────────
  const out = new Map<string, RicalcCell>()
  for (const m of medici) {
    const tc = tcGiorno.get(m.id) ?? ''
    let tr: TurnoRicerca = ''
    if (assegnatiRM.has(m.id)) tr = 'RM'
    else if (assegnatiRP.has(m.id)) tr = 'RP'
    out.set(m.id, {
      tc, tr,
      isSub: assegnatiSUB.has(m.id),
      isMed: assegnatiMED.has(m.id),
    })
  }
  return out
}

// ─── Generazione colonne calendario (per la UI) ────────────────────

/**
 * Crea la lista ordinata di ColonnaCal per l'intervallo di configurazione.
 */
export function generaColonne(config: Configurazione): ColonnaCal[] {
  const colonne: ColonnaCal[] = []

  const corrente = new Date(config.anno_inizio, config.mese_inizio - 1, 1)
  const fine = new Date(config.anno_fine, config.mese_fine, 0) // ultimo giorno del mese fine

  while (corrente <= fine) {
    const festivo = isFestivo(corrente)
    const domenica = corrente.getDay() === 0

    colonne.push({
      data:       formatDate(corrente),
      giorno:     corrente.getDate(),
      mese:       corrente.getMonth() + 1,
      anno:       corrente.getFullYear(),
      isDomenica: domenica,
      isFestivo:  festivo,
    })

    corrente.setDate(corrente.getDate() + 1)
  }

  return colonne
}

// ─── Utility ───────────────────────────────────────────────────────

/**
 * Formatta una data come "YYYY-MM-DD"
 */
export function formatDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * Nomi dei mesi in italiano
 */
export const MESI_IT = [
  '', 'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre',
]

/**
 * Nomi corti dei mesi
 */
export const MESI_SHORT_IT = [
  '', 'Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu',
  'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic',
]

/**
 * Etichette brevi dei turni clinici
 */
export const LABEL_TURNO: Record<string, string> = {
  M:   'M',
  P:   'P',
  L:   'L',
  REP: 'REP',
  '':  '',
}
