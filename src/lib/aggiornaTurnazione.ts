/**
 * aggiornaTurnazione
 *
 * Logica della feature "Aggiorna turnazione": continua la rotazione attuale
 * applicando un NUOVO schema dal primo lunedì del mese di inizio scelto fino
 * al mese di fine, preservando:
 *   - la FASE di rotazione (le posizioni dei turnisti proseguono, non si
 *     resettano) — via `anchorOverride` = primo lunedì del periodo ATTUALE;
 *   - i CAMBI TURNO / modifiche manuali già fatti (restano applicati);
 *   - le FERIE (is_ferie preservato).
 *
 * NON tocca la produzione: produce uno snapshot del calendario completo
 * proposto e lo salva in `turnazione_anteprima` (bozza in attesa di
 * approvazione). La pubblicazione avviene altrove (pagina anteprima admin).
 *
 * Stacco = primo lunedì del mese di inizio: i giorni dal 1° del mese fino al
 * primo lunedì (escluso) restano sulla vecchia turnazione.
 */

import { supabase } from './supabase'
import { calcolaCalendarioCompleto, primoLunediDelPeriodo } from './algorithm'
import { generaSchemaNuovo, type SchemaCellaLite, type SchemaColonnaLite, type SchemaCheckLite } from './generaSchemaNuovo'
import type {
  Configurazione, Medico, SchemaModello, Turno, TurnoClinico, TurnoRicerca,
  SlotPlacement, TurnazioneAnteprima, SchemaEpoca, TipoTurno,
} from '../types'

// ── Helper date ──────────────────────────────────────────────────────
const firstOfMonth = (anno: number, mese: number) => new Date(anno, mese - 1, 1)
const lastOfMonth  = (anno: number, mese: number) => new Date(anno, mese, 0)
const monthIdx     = (anno: number, mese: number) => anno * 12 + (mese - 1)
function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ── Parametri del nuovo periodo (dallo stato di GeneraCalendarioPage) ─
export interface ParametriAggiorna {
  schemaNuovo: number
  annoInizio:  number
  meseInizio:  number
  annoFine:    number
  meseFine:    number
}

// ════════════════════════════════════════════════════════════════════
// Validazione (pura): buco di continuità + numero turnisti
// ════════════════════════════════════════════════════════════════════

/** `nMediciBase` = numero medici dell'ultima generazione (config.n_medici_base
 *  o, in fallback, il distinct nei turni). `nMediciAttuali` = medici attivi ora. */
export function validateAggiorna(
  config: Configurazione,
  p: ParametriAggiorna,
  nMediciBase: number | null,
  nMediciAttuali: number,
): { ok: true } | { ok: false; error: string } {
  const inizioAttuale = monthIdx(config.anno_inizio, config.mese_inizio)
  const fineAttuale   = monthIdx(config.anno_fine,   config.mese_fine)
  const inizioNuovo   = monthIdx(p.annoInizio, p.meseInizio)
  const fineNuovo     = monthIdx(p.annoFine,   p.meseFine)

  if (fineNuovo < inizioNuovo) {
    return { ok: false, error: 'Il mese di fine è precedente al mese di inizio.' }
  }
  // Niente buco: il nuovo inizio deve stare dentro l'attuale o attaccarsi
  // subito dopo (al massimo attuale_fine + 1 mese).
  if (inizioNuovo < inizioAttuale) {
    return { ok: false, error: 'Il nuovo periodo inizia prima della turnazione attuale: non c\'è continuità.' }
  }
  if (inizioNuovo > fineAttuale + 1) {
    return {
      ok: false,
      error: `C'è un buco di continuità: la turnazione attuale finisce nel mese ${config.mese_fine}/${config.anno_fine}, il nuovo periodo può iniziare al massimo il mese successivo.`,
    }
  }
  // Numero turnisti invariato (la rotazione dipende dal modulo N).
  if (nMediciBase != null && nMediciBase !== nMediciAttuali) {
    return {
      ok: false,
      error: `Il numero di turnisti è cambiato (${nMediciBase} → ${nMediciAttuali}): la rotazione non è più continua. Usa "Genera Calendario" per un calendario nuovo.`,
    }
  }
  return { ok: true }
}

// ════════════════════════════════════════════════════════════════════
// Lettura turni produzione (paginata, evita il limite 1000)
// ════════════════════════════════════════════════════════════════════
async function fetchTurniRange(diISO: string, dfISO: string): Promise<Turno[]> {
  const all: Turno[] = []
  let offset = 0
  const PAGE = 1000
  for (;;) {
    const { data, error } = await supabase.from('turni')
      .select('*').gte('data', diISO).lte('data', dfISO)
      .order('data').range(offset, offset + PAGE - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    all.push(...(data as Turno[]))
    if (data.length < PAGE) break
    offset += PAGE
  }
  return all
}

// ════════════════════════════════════════════════════════════════════
// Riga snapshot (colonne turni inseribili, senza id/timestamps)
// ════════════════════════════════════════════════════════════════════
type SnapRow = Pick<Turno,
  'medico_id' | 'data' | 'turno_clinico' | 'turno_ricerca' | 'note' |
  'modificato_manualmente' | 'is_ferie' | 'slot_mattina' | 'slot_pomeriggio' |
  'is_sub' | 'is_med' | 'turno_clinico_base' | 'turno_ricerca_base' |
  'turno_clinico_originario' | 'turno_clinico_vecchio' | 'turno_ricerca_vecchio'>

// ════════════════════════════════════════════════════════════════════
// Crea la bozza (snapshot completo) e la salva in turnazione_anteprima
// ════════════════════════════════════════════════════════════════════
export async function creaBozzaAggiornamento(
  config: Configurazione,
  schemi: SchemaModello[],
  medici: Medico[],
  p: ParametriAggiorna,
): Promise<TurnazioneAnteprima> {
  const mediciAttivi = [...medici].filter(m => m.attivo).sort((a, b) => a.numero_ordine - b.numero_ordine)

  // ── Anchor (continuità) e stacco ──────────────────────────────────
  const A_old   = primoLunediDelPeriodo(firstOfMonth(config.anno_inizio, config.mese_inizio))
  const cutover = primoLunediDelPeriodo(firstOfMonth(p.annoInizio, p.meseInizio))
  const cutoverISO = iso(cutover)
  const nuovoFineISO = iso(lastOfMonth(p.annoFine, p.meseFine))

  // ── Estensione finale del calendario = max(fine attuale, fine nuovo) ─
  const fineIdx   = Math.max(monthIdx(config.anno_fine, config.mese_fine), monthIdx(p.annoFine, p.meseFine))
  const fineAnno  = Math.floor(fineIdx / 12)
  const fineMese  = (fineIdx % 12) + 1
  const origStartISO = iso(firstOfMonth(config.anno_inizio, config.mese_inizio))
  const finalEndISO  = iso(lastOfMonth(fineAnno, fineMese))

  // ── Nuovo base (nuovo schema, anchor = A_old per continuità) ───────
  const cfgNuovo: Configurazione = {
    ...config,
    schema_attivo: p.schemaNuovo,
    anno_inizio: p.annoInizio, mese_inizio: p.meseInizio,
    anno_fine:   p.annoFine,   mese_fine:   p.meseFine,
  }
  const nuovoBase = calcolaCalendarioCompleto(cfgNuovo, schemi, mediciAttivi, A_old)
  const nbMap = new Map(nuovoBase.map(t => [`${t.medico_id}|${t.data}`, t]))

  // ── Vecchia turnazione CONTINUATA (schema attuale) su TUTTO il range,
  //    per la riga di confronto B/N in anteprima. Riferimento FISSO: schema
  //    precedente come se non ci fosse mai stato lo stacco (anchor naturale =
  //    A_old). Prima del cutover si usa la produzione (cambi inclusi), dopo
  //    questa rotazione counterfattuale. ──────────────────────────────────
  const cfgVecchiaEstesa: Configurazione = {
    ...config, anno_fine: fineAnno, mese_fine: fineMese, giorno_fine: null,
  }
  const vecchiaEstesa = calcolaCalendarioCompleto(cfgVecchiaEstesa, schemi, mediciAttivi)
  const veMap = new Map(vecchiaEstesa.map(t => [`${t.medico_id}|${t.data}`, t]))

  // ── Turni di produzione nel range completo ────────────────────────
  const prod = await fetchTurniRange(origStartISO, finalEndISO)
  const prodMap = new Map(prod.map(t => [`${t.medico_id}|${t.data}`, t]))

  // ── Costruzione snapshot completo ─────────────────────────────────
  const snap: SnapRow[] = []
  let nCambi = 0
  const startD = firstOfMonth(config.anno_inizio, config.mese_inizio)
  const endD   = lastOfMonth(fineAnno, fineMese)

  for (const cur = new Date(startD); cur <= endD; cur.setDate(cur.getDate() + 1)) {
    const dataISO = iso(cur)
    const inFinestraNuova = dataISO >= cutoverISO && dataISO <= nuovoFineISO

    for (const m of mediciAttivi) {
      const key = `${m.id}|${dataISO}`
      const pr  = prodMap.get(key)

      // Riga B/N "vecchia turnazione": prima del cutover = produzione (cambi
      // inclusi), dal cutover = rotazione vecchia continuata (counterfattuale).
      const ve = veMap.get(key)
      const vecchioTc = (dataISO >= cutoverISO
        ? (ve?.turno_clinico ?? '') : (pr?.turno_clinico ?? '')) as TurnoClinico
      const vecchioTr = (dataISO >= cutoverISO
        ? (ve?.turno_ricerca ?? '') : (pr?.turno_ricerca ?? '')) as TurnoRicerca

      if (inFinestraNuova) {
        const nb = nbMap.get(key)
        const nbTc = (nb?.turno_clinico ?? '') as TurnoClinico
        const nbTr = (nb?.turno_ricerca ?? '') as TurnoRicerca
        // Dal cutover in poi: SEMPRE rotazione nuova pulita. I cambi turno e le
        // modifiche manuali NON vengono più ricalcolati né portati avanti (vedi
        // versione dinamica): il calendario nuovo riscrive quei giorni e i cambi
        // vanno ricreati a mano dopo. Restano solo le FERIE approvate.
        snap.push({
          medico_id: m.id, data: dataISO,
          turno_clinico: nbTc, turno_ricerca: nbTr,
          slot_mattina: (nb?.slot_mattina ?? null) as SlotPlacement,
          slot_pomeriggio: (nb?.slot_pomeriggio ?? null) as SlotPlacement,
          is_sub: nb?.is_sub ?? false, is_med: nb?.is_med ?? false,
          is_ferie: pr?.is_ferie ?? false, note: pr?.note ?? null,
          modificato_manualmente: false,
          turno_clinico_base: nbTc, turno_ricerca_base: nbTr,
          turno_clinico_originario: null,
          turno_clinico_vecchio: vecchioTc, turno_ricerca_vecchio: vecchioTr,
        })
      } else if (pr) {
        // Fuori finestra → produzione invariata
        snap.push({
          medico_id: m.id, data: dataISO,
          turno_clinico: pr.turno_clinico, turno_ricerca: pr.turno_ricerca,
          slot_mattina: pr.slot_mattina, slot_pomeriggio: pr.slot_pomeriggio,
          is_sub: pr.is_sub, is_med: pr.is_med,
          is_ferie: pr.is_ferie, note: pr.note ?? null,
          modificato_manualmente: pr.modificato_manualmente,
          turno_clinico_base: pr.turno_clinico_base ?? null,
          turno_ricerca_base: pr.turno_ricerca_base ?? null,
          turno_clinico_originario: pr.turno_clinico_originario ?? null,
          turno_clinico_vecchio: vecchioTc, turno_ricerca_vecchio: vecchioTr,
        })
      }
      // (else: nessuna riga produzione fuori finestra → niente, non dovrebbe capitare)
    }
  }

  // ── Salva la bozza (una sola attiva PER REPARTO: cancella le precedenti
  //    SOLO di questo reparto) ─────────────────────────────────────────
  await supabase.from('turnazione_anteprima').delete()
    .eq('reparto_id', config.reparto_id)

  const meta: TurnazioneAnteprima['meta'] = {
    cutover: cutoverISO,
    schema_nuovo: p.schemaNuovo,
    anno_inizio: p.annoInizio, mese_inizio: p.meseInizio,
    anno_fine: p.annoFine, mese_fine: p.meseFine,
    n_cambi: nCambi,
    config_payload: {
      anno_inizio: config.anno_inizio, mese_inizio: config.mese_inizio,
      anno_fine: fineAnno, mese_fine: fineMese,
      schema_attivo: p.schemaNuovo,
      n_medici_base: mediciAttivi.length,
    },
  }

  const { data: inserted, error } = await supabase.from('turnazione_anteprima')
    .insert({
      reparto_id: config.reparto_id,
      descrizione: `Aggiornamento schema ${p.schemaNuovo} dal ${cutoverISO}`,
      snapshot: { turni: snap },
      meta,
    })
    .select().single()
  if (error) throw error
  return inserted as TurnazioneAnteprima
}

// ════════════════════════════════════════════════════════════════════
// Versione DINAMICA (reparti non-11N): stessa continuità di rotazione, ma
// usa il motore `generaSchemaNuovo` (schema_cella + tipi_turno) e porta nello
// snapshot anche `turno_sigla` + `proprieta`. La bozza si pubblica con la
// stessa `pubblicaBozza` (fa `{...t}` → scrive tutti i campi). La riga di
// confronto B/N "vecchia" usa la produzione attuale (semplificazione rispetto
// al counterfactual classico: sufficiente per l'anteprima dinamica).
// ════════════════════════════════════════════════════════════════════

/** Dati dello schema dinamico NUOVO (già disponibili in GeneraCalendarioPage). */
export interface SchemaDinamicoData {
  celle:     SchemaCellaLite[]
  colonne:   SchemaColonnaLite[]
  checks:    SchemaCheckLite[]
  tipiTurno: TipoTurno[]
}

/** Fetch turni di UN reparto in un range (paginata, scoped per isolamento). */
async function fetchTurniRangeReparto(repartoId: string, diISO: string, dfISO: string): Promise<Turno[]> {
  const all: Turno[] = []
  let offset = 0
  const PAGE = 1000
  for (;;) {
    const { data, error } = await supabase.from('turni')
      .select('*').eq('reparto_id', repartoId).gte('data', diISO).lte('data', dfISO)
      .order('data').range(offset, offset + PAGE - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    all.push(...(data as Turno[]))
    if (data.length < PAGE) break
    offset += PAGE
  }
  return all
}

/** Carica i dati di UNO schema dinamico (per generare la rotazione vecchia). */
async function fetchSchemaDinamico(repartoId: string, schemaNum: number): Promise<SchemaDinamicoData> {
  const [colR, chkR, celR, tipR] = await Promise.all([
    supabase.from('schema_colonna').select('tipo, sigla').eq('reparto_id', repartoId).eq('schema_num', schemaNum),
    supabase.from('schema_giorno_colonna').select('giorno_settimana, colonna_sigla').eq('reparto_id', repartoId).eq('schema_num', schemaNum).eq('attivo', true),
    supabase.from('schema_cella').select('giorno_settimana, slot_idx, colonna_sigla, numero, attivo').eq('reparto_id', repartoId).eq('schema_num', schemaNum),
    supabase.from('tipi_turno').select('*').eq('reparto_id', repartoId).eq('schema_num', schemaNum),
  ])
  for (const r of [colR, chkR, celR, tipR]) if (r.error) throw r.error
  return {
    colonne:   (colR.data ?? []) as SchemaColonnaLite[],
    checks:    (chkR.data ?? []) as SchemaCheckLite[],
    celle:     (celR.data ?? []) as SchemaCellaLite[],
    tipiTurno: (tipR.data ?? []) as TipoTurno[],
  }
}

export async function creaBozzaAggiornamentoDinamico(
  config: Configurazione,
  medici: Medico[],
  p: ParametriAggiorna,
  schema: SchemaDinamicoData,
): Promise<TurnazioneAnteprima> {
  const mediciAttivi = [...medici]
    .filter(m => m.attivo && m.numero_ordine != null)
    .sort((a, b) => (a.numero_ordine ?? 0) - (b.numero_ordine ?? 0))

  const A_old        = primoLunediDelPeriodo(firstOfMonth(config.anno_inizio, config.mese_inizio))
  const cutover      = primoLunediDelPeriodo(firstOfMonth(p.annoInizio, p.meseInizio))
  const cutoverISO   = iso(cutover)
  const nuovoFineISO = iso(lastOfMonth(p.annoFine, p.meseFine))

  const fineIdx  = Math.max(monthIdx(config.anno_fine, config.mese_fine), monthIdx(p.annoFine, p.meseFine))
  const fineAnno = Math.floor(fineIdx / 12)
  const fineMese = (fineIdx % 12) + 1
  const origStartISO = iso(firstOfMonth(config.anno_inizio, config.mese_inizio))
  const finalEndISO  = iso(lastOfMonth(fineAnno, fineMese))

  // Nuova rotazione DINAMICA con anchor = A_old (la fase prosegue, non riparte).
  const nuovoBase = generaSchemaNuovo({
    anno_inizio: p.annoInizio, mese_inizio: p.meseInizio,
    anno_fine:   p.annoFine,   mese_fine:   p.meseFine,
    medici: mediciAttivi,
    celle: schema.celle, colonne: schema.colonne, checks: schema.checks, tipiTurno: schema.tipiTurno,
    anchorOverride: A_old,
  })
  const nbMap = new Map(nuovoBase.map(t => [`${t.medico_id}|${t.data}`, t]))

  // Produzione di QUESTO reparto (scoped → isolamento).
  const prod = await fetchTurniRangeReparto(config.reparto_id, origStartISO, finalEndISO)
  const prodMap = new Map(prod.map(t => [`${t.medico_id}|${t.data}`, t]))

  // Schema VECCHIO (attivo prima dell'aggiornamento): rotazione precedente
  // CONTINUATA (stessa ancora A_old) su tutto il range → riempie i giorni-buco
  // tra la fine della produzione e il cutover. Se coincide col nuovo, lo riusa.
  const schemaVecchioNum = config.schema_attivo ?? p.schemaNuovo
  const schemaVecchio = schemaVecchioNum === p.schemaNuovo
    ? schema
    : await fetchSchemaDinamico(config.reparto_id, schemaVecchioNum)
  const vecchiaBase = generaSchemaNuovo({
    anno_inizio: config.anno_inizio, mese_inizio: config.mese_inizio,
    anno_fine: fineAnno, mese_fine: fineMese,
    medici: mediciAttivi,
    celle: schemaVecchio.celle, colonne: schemaVecchio.colonne,
    checks: schemaVecchio.checks, tipiTurno: schemaVecchio.tipiTurno,
    anchorOverride: A_old,
  })
  const veMap = new Map(vecchiaBase.map(t => [`${t.medico_id}|${t.data}`, t]))

  const snap: Array<Record<string, unknown>> = []
  let nCambi = 0
  const startD = firstOfMonth(config.anno_inizio, config.mese_inizio)
  const endD   = lastOfMonth(fineAnno, fineMese)

  for (const cur = new Date(startD); cur <= endD; cur.setDate(cur.getDate() + 1)) {
    const dataISO = iso(cur)
    const inFinestraNuova = dataISO >= cutoverISO && dataISO <= nuovoFineISO

    for (const m of mediciAttivi) {
      const key = `${m.id}|${dataISO}`
      const pr  = prodMap.get(key)
      const ve  = veMap.get(key)
      // Riferimento "vecchio": prima del cutover = produzione (coi cambi), dal
      // cutover = rotazione vecchia continuata (counterfactual).
      const vecchioTc = (dataISO >= cutoverISO ? (ve?.turno_clinico ?? '') : (pr?.turno_clinico ?? '')) as TurnoClinico
      const vecchioTr = (dataISO >= cutoverISO ? (ve?.turno_ricerca ?? '') : (pr?.turno_ricerca ?? '')) as TurnoRicerca

      if (inFinestraNuova) {
        const nb   = nbMap.get(key)
        const nbTc = (nb?.turno_clinico ?? '') as TurnoClinico
        const nbTr = (nb?.turno_ricerca ?? '') as TurnoRicerca
        // Dal cutover in poi: SEMPRE rotazione nuova pulita. I cambi turno e le
        // modifiche manuali NON vengono più ricalcolati né portati avanti
        // (richiesta esplicita: il calendario nuovo riscrive quei giorni; i
        // vecchi cambi non vengono nemmeno mostrati in anteprima e vanno
        // ricreati a mano dopo l'approvazione). Restano solo le FERIE approvate,
        // che non sono cambi turno.
        snap.push({
          medico_id: m.id, data: dataISO,
          turno_clinico: nbTc, turno_ricerca: nbTr,
          turno_sigla: nb?.turno_sigla ?? null, proprieta: nb?.proprieta ?? [],
          slot_mattina: (nb?.slot_mattina ?? null) as SlotPlacement,
          slot_pomeriggio: (nb?.slot_pomeriggio ?? null) as SlotPlacement,
          is_sub: nb?.is_sub ?? false, is_med: nb?.is_med ?? false,
          is_ferie: pr?.is_ferie ?? false, note: pr?.note ?? null,
          modificato_manualmente: false,
          turno_clinico_base: nbTc, turno_ricerca_base: nbTr,
          turno_clinico_originario: null,
          turno_clinico_vecchio: vecchioTc, turno_ricerca_vecchio: vecchioTr,
        })
      } else if (pr) {
        // Fuori finestra → produzione invariata (con turno_sigla/proprieta).
        snap.push({
          medico_id: m.id, data: dataISO,
          turno_clinico: pr.turno_clinico, turno_ricerca: pr.turno_ricerca,
          turno_sigla: pr.turno_sigla ?? null, proprieta: pr.proprieta ?? [],
          slot_mattina: pr.slot_mattina, slot_pomeriggio: pr.slot_pomeriggio,
          is_sub: pr.is_sub, is_med: pr.is_med,
          is_ferie: pr.is_ferie, note: pr.note ?? null,
          modificato_manualmente: pr.modificato_manualmente,
          turno_clinico_base: pr.turno_clinico_base ?? null,
          turno_ricerca_base: pr.turno_ricerca_base ?? null,
          turno_clinico_originario: pr.turno_clinico_originario ?? null,
          turno_clinico_vecchio: vecchioTc, turno_ricerca_vecchio: vecchioTr,
        })
      } else if (ve) {
        // Giorno-BUCO (prima del cutover, senza produzione): rotazione VECCHIA
        // continuata → riempie il vuoto tra fine turnazione vecchia e cutover.
        snap.push({
          medico_id: m.id, data: dataISO,
          turno_clinico: ve.turno_clinico, turno_ricerca: ve.turno_ricerca,
          turno_sigla: ve.turno_sigla ?? null, proprieta: ve.proprieta ?? [],
          slot_mattina: ve.slot_mattina, slot_pomeriggio: ve.slot_pomeriggio,
          is_sub: ve.is_sub, is_med: ve.is_med,
          is_ferie: false, note: null,
          modificato_manualmente: false,
          turno_clinico_base: ve.turno_clinico, turno_ricerca_base: ve.turno_ricerca,
          turno_clinico_originario: null,
          turno_clinico_vecchio: vecchioTc, turno_ricerca_vecchio: vecchioTr,
        })
      }
    }
  }

  // Una sola bozza attiva per reparto.
  await supabase.from('turnazione_anteprima').delete().eq('reparto_id', config.reparto_id)

  const meta: TurnazioneAnteprima['meta'] = {
    cutover: cutoverISO,
    schema_nuovo: p.schemaNuovo,
    anno_inizio: p.annoInizio, mese_inizio: p.meseInizio,
    anno_fine: p.annoFine, mese_fine: p.meseFine,
    n_cambi: nCambi,
    config_payload: {
      anno_inizio: config.anno_inizio, mese_inizio: config.mese_inizio,
      anno_fine: fineAnno, mese_fine: fineMese,
      schema_attivo: p.schemaNuovo,
      n_medici_base: mediciAttivi.length,
    },
  }

  const { data: inserted, error } = await supabase.from('turnazione_anteprima')
    .insert({
      reparto_id: config.reparto_id,
      descrizione: `Aggiornamento schema ${p.schemaNuovo} dal ${cutoverISO}`,
      snapshot: { turni: snap },
      meta,
    })
    .select().single()
  if (error) throw error
  return inserted as TurnazioneAnteprima
}

// ════════════════════════════════════════════════════════════════════
// Pubblica la bozza (→ produzione) / Scarta la bozza
// ════════════════════════════════════════════════════════════════════

/** Applica lo snapshot a `turni` (replace completo), aggiorna `configurazione`
 *  dai meta, elimina la bozza. Ritorna il numero di turni inseriti. */
export async function pubblicaBozza(anteprima: TurnazioneAnteprima, configId: string, repartoId: string): Promise<number> {
  const turni = anteprima.snapshot?.turni ?? []

  // 1) Replace completo dei turni DI QUESTO REPARTO con lo snapshot (lo
  //    snapshot È lo stato finale: i mesi non toccati sono copiati invariati).
  //    Scoped a reparto_id: NON tocca i turni degli altri reparti.
  const { error: delErr } = await supabase.from('turni')
    .delete().eq('reparto_id', repartoId)
  if (delErr) throw delErr

  const CHUNK = 500
  let inserted = 0
  for (let i = 0; i < turni.length; i += CHUNK) {
    const chunk = turni.slice(i, i + CHUNK).map(t => {
      // Rimuovi id/timestamp (li rigenera il DB) e i campi SOLO-snapshot usati
      // per il confronto B/N in anteprima (turno_clinico_vecchio /
      // turno_ricerca_vecchio): NON sono colonne di `turni`, altrimenti l'insert
      // fallisce ("Could not find the column ... in the schema cache").
      const r = { ...(t as unknown as Record<string, unknown>) }
      delete r.id; delete r.created_at; delete r.updated_at
      delete r.turno_clinico_vecchio; delete r.turno_ricerca_vecchio
      r.reparto_id = repartoId   // forza il reparto corretto sui turni inseriti
      return r
    })
    const { error } = await supabase.from('turni').insert(chunk)
    if (error) throw error
    inserted += chunk.length
  }

  // 2) Aggiorna configurazione (periodo/schema/n_medici_base) + updated_at.
  //    Appende lo switch alla cronologia schemi (sidebar "Schemi aggiornati"):
  //    legge lo storico corrente e aggiunge {schema_nuovo, cutover}.
  const { data: cfgRow } = await supabase.from('configurazione')
    .select('schema_storico').eq('id', configId).maybeSingle()
  const storicoPrec = (Array.isArray(cfgRow?.schema_storico)
    ? cfgRow!.schema_storico : []) as SchemaEpoca[]
  const schema_storico: SchemaEpoca[] = [
    ...storicoPrec,
    { schema: anteprima.meta.schema_nuovo, dal: anteprima.meta.cutover },
  ]
  const { error: cfgErr } = await supabase.from('configurazione')
    .update({ ...anteprima.meta.config_payload, schema_storico, updated_at: new Date().toISOString() })
    .eq('id', configId)
  if (cfgErr) throw cfgErr

  // 3) Elimina la bozza.
  const { error: bkErr } = await supabase.from('turnazione_anteprima')
    .delete().eq('id', anteprima.id)
  if (bkErr) throw bkErr

  return inserted
}

/** Salva nello snapshot della bozza i cambi preliminari fatti in anteprima
 *  (senza pubblicare). Riscrive `snapshot.turni` e aggiorna `meta.n_cambi`
 *  = celle scambiate rispetto al basale (turno_clinico != turno_clinico_base).
 *  La riga di confronto "vecchia" (turno_clinico_vecchio) resta invariata. */
export async function salvaModificheBozza(
  anteprimaId: string,
  turni: Turno[],
  meta: TurnazioneAnteprima['meta'],
): Promise<void> {
  const nCambi = turni.filter(t =>
    (t.turno_clinico ?? '') !== (t.turno_clinico_base ?? '')).length
  const { error } = await supabase.from('turnazione_anteprima')
    .update({ snapshot: { turni }, meta: { ...meta, n_cambi: nCambi } })
    .eq('id', anteprimaId)
  if (error) throw error
}

/** Scarta la bozza (solo DELETE). */
export async function scartaBozza(anteprimaId: string): Promise<void> {
  const { error } = await supabase.from('turnazione_anteprima').delete().eq('id', anteprimaId)
  if (error) throw error
}
