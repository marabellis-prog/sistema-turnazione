import { isFestivo } from './holidays'
import type {
  Medico,
  Configurazione,
  SchemaModello,
  TurnoTeorico,
  TurnoGenerato,
  TurnoClinico,
  TurnoRicerca,
  SlotPlacement,
  ColonnaCal,
  Turno,
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
  let slot_mattina:    SlotPlacement = null
  let slot_pomeriggio: SlotPlacement = null

  for (const slot of slots) {
    const inM  = slot.numero_medico_mattina    === calcNum
    const inP  = slot.numero_medico_pomeriggio === calcNum
    const inRM = slot.numero_medico_rm         === calcNum
    const inRP = slot.numero_medico_rp         === calcNum

    // Turno clinico (primo match vince).
    if (turno_clinico === '') {
      if (slot.is_reperibilita && inM) {
        turno_clinico = 'REP'
      } else if (inM && inP) {
        turno_clinico = 'L'
      } else if (inM) {
        turno_clinico = 'M'
      } else if (inP) {
        turno_clinico = 'P'
      }
    }

    // Slot placement: ogni slot ha al massimo uno fra is_sub e is_med.
    // Per ogni medico assegnato (mattina o pomeriggio dello slot),
    // ereditiamo il placement nella metà corrispondente. Slot diversi
    // possono dare placement diversi sulle 2 metà di un L.
    const placement: SlotPlacement = slot.is_sub ? 'SUB'
                                   : slot.is_med ? 'MED'
                                   : null
    if (inM && slot_mattina    === null && placement) slot_mattina    = placement
    if (inP && slot_pomeriggio === null && placement) slot_pomeriggio = placement

    // Turno ricerca
    if (inRM && inRP) {
      turno_ricerca = 'RM+RP'
    } else if (inRM && turno_ricerca === '') {
      turno_ricerca = 'RM'
    } else if (inRP && turno_ricerca === '') {
      turno_ricerca = 'RP'
    }
  }

  // REP non lavora attivamente in sub/med → azzera placements
  if (turno_clinico === 'REP') {
    slot_mattina = null
    slot_pomeriggio = null
  }

  // Backward-compat: is_sub/is_med calcolati dai placement
  const is_sub = slot_mattina === 'SUB' || slot_pomeriggio === 'SUB'
  const is_med = slot_mattina === 'MED' || slot_pomeriggio === 'MED'

  return { turno_clinico, turno_ricerca, slot_mattina, slot_pomeriggio, is_sub, is_med }
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
      const teo = calcolaTurnoTeorico(
        n,
        corrente,
        dataRifRotazione,
        numMedici,
        schemiGiorno
      )

      risultati.push({
        medico_id: mediciAttivi[n].id,
        data: dataISO,
        turno_clinico:   teo.turno_clinico,
        turno_ricerca:   teo.turno_ricerca,
        slot_mattina:    teo.slot_mattina,
        slot_pomeriggio: teo.slot_pomeriggio,
        is_sub:          teo.is_sub,
        is_med:          teo.is_med,
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
//   SUB/MED applicabili solo a TC ∈ {M, P, L} (escluso REP e riposo).
//
// Capacità SUB/MED — DINAMICA, non statica dallo schema:
//   total_halves = (#L × 2) + #M + #P  (somma delle metà giornate occupate)
//   total_sub    = ⌊total_halves / 2⌋  (target globale: 50% SUB / 50% MED)
//   total_med    = total_halves - total_sub
//   target_sub_m = ⌊n_mattina / 2⌋     (mattina ≈ metà SUB metà MED)
//   target_sub_p = total_sub - target_sub_m  (compensa il pomeriggio per
//                                              tenere il bilanciamento globale)
//   target_med_m = n_mattina   - target_sub_m
//   target_med_p = n_pomerigg. - target_sub_p
//
// Esempio "standard" 2L+2M+2P → n_m=4, n_p=4, total=8, target_sub=4 →
//   target_sub_m=2, target_sub_p=2, target_med_m=2, target_med_p=2
// Esempio "L extra" 3L+1M+1P → n_m=4, n_p=4, total=8, target_sub=4 →
//   stesso 2/2/2/2: i 3 lunghi devono dividersi SUB e MED tra mattine
//   e pomeriggi (uno dei lunghi farà SUB-matt + MED-pom o viceversa).
// Esempio "transitorio" 3L+2M+1P (durante un editing in corso) →
//   n_m=5, n_p=4, total=9, target_sub=4 → target_sub_m=2, target_sub_p=2,
//   target_med_m=3, target_med_p=2. Tutti i 5 in mattina ricevono un
//   placement (cosa che il vecchio algoritmo statico NON garantiva).
//
// Init: chi era flaggato dallo slot teorico mantiene il flag se ancora
// eligibile (preserva la preferenza schema). Fill greedy con tie-break.
// Una "Fase 5" di safety net copre eventuali avanzi (medici lavoranti
// senza placement, es. quando le preferenze schema non bastano a coprire
// il fabbisogno) preferendo coerenza interna del L (stessa metà → stessa
// classe, se l'altra è settata).
//
// Tie-break (RM, RP, SUB, MED): 1) meno turni di quel tipo nel periodo,
// 2) ordine alfabetico su medico.nome.

export interface RicalcContext {
  /** Capacità separate mattina/pomeriggio (dallo schema). RM/RP sono per slot; SUB/MED suddivisi nei 2 turni. */
  capacita: {
    rm: number; rp: number;
    sub_m: number; sub_p: number;
    med_m: number; med_p: number;
  }
  /** Lista medici in scope. */
  medici:   Medico[]
  /** TC corrente del medico in questo giorno (post-modifica utente) */
  tcGiorno: Map<string, TurnoClinico>
  /** Placement ORIGINALI dello slot teorico per questo giorno (pre-modifica) */
  flagsOriginali: Map<string, { slot_mattina: SlotPlacement; slot_pomeriggio: SlotPlacement }>
  /** Conteggi nel periodo ESCLUSO il giorno target — per tie-break.
   *  sub e med contano la SOMMA delle metà giornate. */
  contaPeriodo: Map<string, { rm: number; rp: number; sub: number; med: number }>
}

export interface RicalcCell {
  tc:              TurnoClinico
  tr:              TurnoRicerca
  slot_mattina:    SlotPlacement
  slot_pomeriggio: SlotPlacement
}

export function ricalcolaGiorno(ctx: RicalcContext): Map<string, RicalcCell> {
  const { capacita, medici, tcGiorno, flagsOriginali, contaPeriodo } = ctx

  const cmpBy = (tipo: 'rm' | 'rp' | 'sub' | 'med') => (a: Medico, b: Medico) => {
    const ca = contaPeriodo.get(a.id)?.[tipo] ?? 0
    const cb = contaPeriodo.get(b.id)?.[tipo] ?? 0
    if (ca !== cb) return ca - cb
    return a.nome.localeCompare(b.nome, 'it', { sensitivity: 'base' })
  }

  // ── RM: TC=='P' → ordino per (count rm asc, nome asc) ─────────────
  const eligibiliRM = medici.filter(m => tcGiorno.get(m.id) === 'P').sort(cmpBy('rm'))
  const assegnatiRM = new Set(eligibiliRM.slice(0, capacita.rm).map(m => m.id))
  // ── RP: TC=='M' ────────────────────────────────────────────────────
  const eligibiliRP = medici.filter(m => tcGiorno.get(m.id) === 'M').sort(cmpBy('rp'))
  const assegnatiRP = new Set(eligibiliRP.slice(0, capacita.rp).map(m => m.id))

  // ── Helper eligibilità per metà giornata ──────────────────────────
  const lavoraMattina    = (id: string) => {
    const t = tcGiorno.get(id) ?? ''
    return t === 'M' || t === 'L'
  }
  const lavoraPomeriggio = (id: string) => {
    const t = tcGiorno.get(id) ?? ''
    return t === 'P' || t === 'L'
  }

  // ── Capacità SUB/MED dinamica ────────────────────────────────────
  // Calcoliamo i target a partire dal numero EFFETTIVO di medici eligibili
  // per metà giornata (vedi commento sopra alla firma per i dettagli).
  // Il vecchio algoritmo usava direttamente `capacita.sub_m` ecc. dallo
  // schema, fallendo quando i medici eligibili eccedevano la capacità
  // statica (alcuni rimanevano senza placement → chip diviso bianco/colore).
  const n_m = medici.filter(m => lavoraMattina(m.id)).length
  const n_p = medici.filter(m => lavoraPomeriggio(m.id)).length
  const totSubGlobale = Math.floor((n_m + n_p) / 2)
  // Distribuiamo SUB tra le due metà bilanciando il globale: la mattina
  // prende ⌊n_m/2⌋, il pomeriggio compensa per centrare totSubGlobale.
  // I clamp [0, n_X] proteggono da edge case (es. n_p = 0).
  const target_sub_m = Math.min(n_m, Math.max(0, Math.floor(n_m / 2)))
  const target_sub_p = Math.min(n_p, Math.max(0, totSubGlobale - target_sub_m))
  const target_med_m = n_m - target_sub_m
  const target_med_p = n_p - target_sub_p

  // ── Inizializza i placement (preservando l'originale dove eligibile)
  const slotM = new Map<string, SlotPlacement>()
  const slotP = new Map<string, SlotPlacement>()
  for (const m of medici) {
    const orig = flagsOriginali.get(m.id)
    if (orig?.slot_mattina    && lavoraMattina(m.id))    slotM.set(m.id, orig.slot_mattina)
    if (orig?.slot_pomeriggio && lavoraPomeriggio(m.id)) slotP.set(m.id, orig.slot_pomeriggio)
  }

  // Helper conta metà attualmente assegnate a un certo placement
  const countSlot = (m: Map<string, SlotPlacement>, p: 'SUB' | 'MED'): number => {
    let n = 0
    for (const v of m.values()) if (v === p) n++
    return n
  }

  // ── SUB-mattina ────────────────────────────────────────────────────
  if (countSlot(slotM, 'SUB') < target_sub_m) {
    const cand = medici
      .filter(m => lavoraMattina(m.id) && slotM.get(m.id) !== 'SUB' && !slotM.has(m.id))
      .sort(cmpBy('sub'))
    for (let i = 0; i < target_sub_m - countSlot(slotM, 'SUB') && i < cand.length; i++) {
      slotM.set(cand[i].id, 'SUB')
    }
  }

  // ── MED-mattina ────────────────────────────────────────────────────
  if (countSlot(slotM, 'MED') < target_med_m) {
    const cand = medici
      .filter(m => lavoraMattina(m.id) && slotM.get(m.id) !== 'MED' && !slotM.has(m.id))
      .sort(cmpBy('med'))
    for (let i = 0; i < target_med_m - countSlot(slotM, 'MED') && i < cand.length; i++) {
      slotM.set(cand[i].id, 'MED')
    }
  }

  // ── SUB-pomeriggio ─────────────────────────────────────────────────
  if (countSlot(slotP, 'SUB') < target_sub_p) {
    const cand = medici
      .filter(m => lavoraPomeriggio(m.id) && slotP.get(m.id) !== 'SUB' && !slotP.has(m.id))
      .sort(cmpBy('sub'))
    for (let i = 0; i < target_sub_p - countSlot(slotP, 'SUB') && i < cand.length; i++) {
      slotP.set(cand[i].id, 'SUB')
    }
  }

  // ── MED-pomeriggio ─────────────────────────────────────────────────
  if (countSlot(slotP, 'MED') < target_med_p) {
    const cand = medici
      .filter(m => lavoraPomeriggio(m.id) && slotP.get(m.id) !== 'MED' && !slotP.has(m.id))
      .sort(cmpBy('med'))
    for (let i = 0; i < target_med_p - countSlot(slotP, 'MED') && i < cand.length; i++) {
      slotP.set(cand[i].id, 'MED')
    }
  }

  // ── Fase 5 — Fallback per gli avanzi ──────────────────────────────
  // Safety net: in casi limite (orig pre-fill che esaurisce la capacità
  // mentre lascia altri medici scoperti, target dispari + preserve sbila-
  // nciato, ecc.) il fill greedy può lasciare medici eligibili senza
  // placement. Garantiamo che ognuno ne abbia uno applicando queste regole
  // in ordine:
  //   1) per i lunghi (lavora entrambe le metà) con UN solo lato già
  //      settato, copia il placement noto sull'altro lato → coerenza
  //      interna del L.
  //   2) altrimenti scegli SUB se serve raggiungere il target (count <
  //      target_sub_X), MED se serve raggiungere quello, alternativamente
  //      il placement con count attuale minore (per equilibrio).
  for (const m of medici) {
    if (lavoraMattina(m.id) && !slotM.has(m.id)) {
      const fromOther = slotP.get(m.id)
      if (fromOther) {
        slotM.set(m.id, fromOther)
      } else {
        const needSub = countSlot(slotM, 'SUB') < target_sub_m
        const needMed = countSlot(slotM, 'MED') < target_med_m
        slotM.set(m.id,
          needSub ? 'SUB'
          : needMed ? 'MED'
          : (countSlot(slotM, 'SUB') <= countSlot(slotM, 'MED') ? 'SUB' : 'MED'),
        )
      }
    }
    if (lavoraPomeriggio(m.id) && !slotP.has(m.id)) {
      const fromOther = slotM.get(m.id)
      if (fromOther) {
        slotP.set(m.id, fromOther)
      } else {
        const needSub = countSlot(slotP, 'SUB') < target_sub_p
        const needMed = countSlot(slotP, 'MED') < target_med_p
        slotP.set(m.id,
          needSub ? 'SUB'
          : needMed ? 'MED'
          : (countSlot(slotP, 'SUB') <= countSlot(slotP, 'MED') ? 'SUB' : 'MED'),
        )
      }
    }
  }

  // ── Output ──────────────────────────────────────────────────────────
  const out = new Map<string, RicalcCell>()
  for (const m of medici) {
    const tc = tcGiorno.get(m.id) ?? ''
    let tr: TurnoRicerca = ''
    if (assegnatiRM.has(m.id)) tr = 'RM'
    else if (assegnatiRP.has(m.id)) tr = 'RP'
    out.set(m.id, {
      tc, tr,
      slot_mattina:    lavoraMattina(m.id)    ? (slotM.get(m.id) ?? null) : null,
      slot_pomeriggio: lavoraPomeriggio(m.id) ? (slotP.get(m.id) ?? null) : null,
    })
  }
  return out
}

// ─── Wrapper di alto livello per ricalcolaGiorno ───────────────────

/**
 * Wrapper "tutto compreso" attorno a ricalcolaGiorno. Prende i dati grezzi
 * (config, schemi, medici, turniByKey, colonne) + override TC e calcola
 * lo stato finale (TC, TR, slot SUB/MED) di TUTTI i medici per il giorno
 * `data`, applicando le regole di schema (RM↔P, RP↔M) e tie-break.
 *
 * Usato in:
 * - ModificaTurniPage (al click "Salva" o "Ricalcola RM/RP")
 * - GestioneCambiPage (dopo l'approvazione di un cambio turno, per
 *   riallineare RM/RP)
 *
 * `statoAttuale` e` opzionale: se passato, viene letto come "modifiche
 * locali" sovrapposte al DB. Se non passato, si legge solo dal DB.
 */
export function eseguiRicalcoloGiorno(params: {
  config:       Configurazione
  schemi:       SchemaModello[]
  medici:       Medico[]                 // verra` filtrato per attivo+ordinato
  colonne:      ColonnaCal[]
  turniByKey:   Map<string, Turno>
  data:         string                   // YYYY-MM-DD
  tcOverrides:  Map<string, TurnoClinico>
  statoAttuale?: Map<string, RicalcCell>
}): Map<string, RicalcCell> {
  const { config, schemi, medici, colonne, turniByKey, data, tcOverrides } = params
  const statoAttuale = params.statoAttuale ?? new Map<string, RicalcCell>()

  if (schemi.length === 0 || medici.length === 0) return statoAttuale

  const mediciAttivi = [...medici].filter(m => m.attivo)
                                  .sort((a, b) => a.numero_ordine - b.numero_ordine)
  const numMedici = mediciAttivi.length

  // Schema del giorno_settimana di `data`
  const dataObj = new Date(data + 'T00:00:00')
  const dWeek = getDayOfWeek(dataObj)
  const schemiGiorno = schemi.filter(s =>
    s.schema_num === config.schema_attivo && s.giorno_settimana === dWeek
  )

  const capacita = {
    rm:    schemiGiorno.filter(s => s.numero_medico_rm  !== null).length,
    rp:    schemiGiorno.filter(s => s.numero_medico_rp  !== null).length,
    sub_m: schemiGiorno.filter(s => s.is_sub && s.numero_medico_mattina    !== null).length,
    sub_p: schemiGiorno.filter(s => s.is_sub && s.numero_medico_pomeriggio !== null).length,
    med_m: schemiGiorno.filter(s => s.is_med && s.numero_medico_mattina    !== null).length,
    med_p: schemiGiorno.filter(s => s.is_med && s.numero_medico_pomeriggio !== null).length,
  }

  // tcGiorno: TC corrente per ogni medico. Override > stato locale > DB > vuoto
  const tcGiorno = new Map<string, TurnoClinico>()
  for (const m of mediciAttivi) {
    if (tcOverrides.has(m.id)) { tcGiorno.set(m.id, tcOverrides.get(m.id)!); continue }
    const key = `${m.id}|${data}`
    const cur = statoAttuale.get(key)
    if (cur) tcGiorno.set(m.id, cur.tc)
    else {
      const dbT = turniByKey.get(key)
      tcGiorno.set(m.id, (dbT?.turno_clinico ?? '') as TurnoClinico)
    }
  }

  // flagsOriginali: placement teorico del giorno (dallo schema)
  const flagsOriginali = new Map<string, { slot_mattina: SlotPlacement; slot_pomeriggio: SlotPlacement }>()
  const dataInizioPeriodo = new Date(config.anno_inizio, config.mese_inizio - 1, 1)
  dataInizioPeriodo.setHours(0, 0, 0, 0)
  const dataRifRotazione = primoLunediDelPeriodo(dataInizioPeriodo)
  for (let i = 0; i < numMedici; i++) {
    const teorico = calcolaTurnoTeorico(i, dataObj, dataRifRotazione, numMedici, schemiGiorno)
    flagsOriginali.set(mediciAttivi[i].id, {
      slot_mattina:    teorico.slot_mattina,
      slot_pomeriggio: teorico.slot_pomeriggio,
    })
  }

  // contaPeriodo: count rm/rp + sub/med per ogni medico, ESCLUSO il
  // giorno target. SUB/MED contano la somma delle meta` giornate
  // (un L con SUB-SUB conta 2 SUB).
  const contaPeriodo = new Map<string, { rm: number; rp: number; sub: number; med: number }>()
  for (const m of mediciAttivi) contaPeriodo.set(m.id, { rm: 0, rp: 0, sub: 0, med: 0 })
  for (const col of colonne) {
    if (col.data === data) continue
    for (const m of mediciAttivi) {
      const key = `${m.id}|${col.data}`
      const cur = statoAttuale.get(key)
      const dbT = turniByKey.get(key)
      const tr = (cur?.tr ?? dbT?.turno_ricerca ?? '') as TurnoRicerca
      const sm = cur?.slot_mattina    ?? dbT?.slot_mattina    ?? null
      const sp = cur?.slot_pomeriggio ?? dbT?.slot_pomeriggio ?? null
      const c = contaPeriodo.get(m.id)!
      if (tr === 'RM') c.rm++
      else if (tr === 'RP') c.rp++
      if (sm === 'SUB') c.sub++
      if (sp === 'SUB') c.sub++
      if (sm === 'MED') c.med++
      if (sp === 'MED') c.med++
    }
  }

  return ricalcolaGiorno({
    capacita,
    medici: mediciAttivi,
    tcGiorno,
    flagsOriginali,
    contaPeriodo,
  })
}

// ─── Generazione colonne calendario (per la UI) ────────────────────

/**
 * Crea la lista ordinata di ColonnaCal per l'intervallo di configurazione.
 *
 * @param festivitaCustomSet  Set opzionale di date ISO "YYYY-MM-DD" che
 *   sono considerate festive in aggiunta a quelle italiane standard
 *   (es. santo patrono, eventi locali — gestiti in /admin/config).
 */
export function generaColonne(
  config: Configurazione,
  festivitaCustomSet?: Set<string>,
): ColonnaCal[] {
  const colonne: ColonnaCal[] = []

  const corrente = new Date(config.anno_inizio, config.mese_inizio - 1, 1)
  const fine = new Date(config.anno_fine, config.mese_fine, 0) // ultimo giorno del mese fine

  while (corrente <= fine) {
    const festivo = isFestivo(corrente, festivitaCustomSet)
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
  EM:  'EM',    // Esterno Mattina
  EP:  'EP',    // Esterno Pomeriggio
  EL:  'EL',    // Esterno Lungo
  '':  '',
}
