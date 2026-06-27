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
import type {
  Configurazione, Medico, SchemaModello, Turno, TurnoClinico, TurnoRicerca,
  SlotPlacement, TurnazioneAnteprima,
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
  'turno_clinico_originario'>

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

  // ── Old base (schema attuale) — fallback per "originario" ──────────
  const oldBase = calcolaCalendarioCompleto(config, schemi, mediciAttivi)
  const obMap = new Map(oldBase.map(t => [`${t.medico_id}|${t.data}`, t]))

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

      if (inFinestraNuova) {
        const nb = nbMap.get(key)
        const nbTc = (nb?.turno_clinico ?? '') as TurnoClinico
        const nbTr = (nb?.turno_ricerca ?? '') as TurnoRicerca
        if (pr && pr.modificato_manualmente) {
          // Cambio/edit preservato → resta applicato, marcato "originario"
          const originario = (pr.turno_clinico_base ?? obMap.get(key)?.turno_clinico ?? '') as TurnoClinico
          nCambi++
          snap.push({
            medico_id: m.id, data: dataISO,
            turno_clinico: pr.turno_clinico, turno_ricerca: pr.turno_ricerca,
            slot_mattina: pr.slot_mattina, slot_pomeriggio: pr.slot_pomeriggio,
            is_sub: pr.is_sub, is_med: pr.is_med,
            is_ferie: pr.is_ferie, note: pr.note ?? null,
            modificato_manualmente: true,
            turno_clinico_base: nbTc, turno_ricerca_base: nbTr,
            turno_clinico_originario: originario,
          })
        } else {
          // Nuova rotazione pulita
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
          })
        }
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
        })
      }
      // (else: nessuna riga produzione fuori finestra → niente, non dovrebbe capitare)
    }
  }

  // ── Salva la bozza (una sola attiva: cancella le precedenti) ───────
  await supabase.from('turnazione_anteprima').delete()
    .neq('id', '00000000-0000-0000-0000-000000000000')

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
export async function pubblicaBozza(anteprima: TurnazioneAnteprima, configId: string): Promise<number> {
  const turni = anteprima.snapshot?.turni ?? []

  // 1) Replace completo dei turni con lo snapshot (lo snapshot È lo stato
  //    finale: i mesi non toccati sono copiati invariati).
  const { error: delErr } = await supabase.from('turni')
    .delete().neq('id', '00000000-0000-0000-0000-000000000000')
  if (delErr) throw delErr

  const CHUNK = 500
  let inserted = 0
  for (let i = 0; i < turni.length; i += CHUNK) {
    const chunk = turni.slice(i, i + CHUNK).map(t => {
      // Rimuovi eventuali id/timestamp dallo snapshot (li rigenera il DB).
      const r = { ...(t as unknown as Record<string, unknown>) }
      delete r.id; delete r.created_at; delete r.updated_at
      return r
    })
    const { error } = await supabase.from('turni').insert(chunk)
    if (error) throw error
    inserted += chunk.length
  }

  // 2) Aggiorna configurazione (periodo/schema/n_medici_base) + updated_at.
  const { error: cfgErr } = await supabase.from('configurazione')
    .update({ ...anteprima.meta.config_payload, updated_at: new Date().toISOString() })
    .eq('id', configId)
  if (cfgErr) throw cfgErr

  // 3) Elimina la bozza.
  const { error: bkErr } = await supabase.from('turnazione_anteprima')
    .delete().eq('id', anteprima.id)
  if (bkErr) throw bkErr

  return inserted
}

/** Scarta la bozza (solo DELETE). */
export async function scartaBozza(anteprimaId: string): Promise<void> {
  const { error } = await supabase.from('turnazione_anteprima').delete().eq('id', anteprimaId)
  if (error) throw error
}
