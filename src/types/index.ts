// ─── Entità database ───────────────────────────────────────────────

export interface Medico {
  id: string
  nome: string
  numero_ordine: number       // posizione 1..N nella rotazione
  is_reperibilita: boolean    // true = il suo numero è il "REP" nello schema
  attivo: boolean
  created_at: string
}

export interface Configurazione {
  id: string
  anno_inizio: number
  mese_inizio: number         // 1..12
  anno_fine: number
  mese_fine: number           // 1..12
  schema_attivo: number       // numero schema (1, 2, ...)
  max_ferie_concomitanti: number   // quanti medici al massimo possono essere in ferie nello stesso giorno
  /** Flag globale: quando true, in Modifica Turni il cambio TC ricalcola
   *  automaticamente TR/SUB/MED del giorno via ricalcolaGiorno. Quando
   *  false, il cambio TC tocca solo la cella interessata e l'admin
   *  gestisce SUB/MED manualmente trascinando i pallini. Default true.
   *  Stato condiviso fra tutti gli admin tramite tabella `configurazione`. */
  autocalc_sub_med: boolean
  /** Impostazioni numero medici attesi per slot/mezza-giornata/tipo-giorno.
   *  Usate dal check "inconsistenze nei turni" in ModificaTurniPage.
   *  Convenzione: 0 = nessun controllo (slot non verificato). Default 0. */
  sub_mattina_feriale:    number
  sub_mattina_festivo:    number
  sub_pomeriggio_feriale: number
  sub_pomeriggio_festivo: number
  med_mattina_feriale:    number
  med_mattina_festivo:    number
  med_pomeriggio_feriale: number
  med_pomeriggio_festivo: number
  updated_at: string
}

export interface SchemaModello {
  id: string
  schema_num: number
  giorno_settimana: number    // 1=Lun, ..., 7=Dom
  slot: number                // 0..4
  numero_medico_mattina: number | null
  numero_medico_pomeriggio: number | null
  numero_medico_rm: number | null
  numero_medico_rp: number | null
  is_reperibilita: boolean    // true = questo slot è la reperibilità
  is_sub: boolean             // true = il turno clinico di questo slot è in sub-intensiva
  is_med: boolean             // true = il turno clinico di questo slot è in medicina
}

/** Dove fisicamente lavora il medico in una mezza giornata.
 *  null = non lavora in quella sessione (es. la mattina di un P) o
 *  non specificato. */
export type SlotPlacement = 'SUB' | 'MED' | null

export interface Turno {
  id: string
  medico_id: string
  data: string                // ISO date: "2026-05-01"
  turno_clinico: TurnoClinico
  turno_ricerca: TurnoRicerca
  note: string | null
  modificato_manualmente: boolean
  is_ferie: boolean
  // Posizione del medico nella mattina/pomeriggio. Per L può variare:
  // es. SUB mattina + MED pomeriggio. Per M solo mattina rilevante,
  // per P solo pomeriggio, per REP/'' entrambi null.
  slot_mattina:    SlotPlacement
  slot_pomeriggio: SlotPlacement
  // Mantenuti per backward-compat con altri pezzi del DB; ora sono
  // calcolati come OR sui due slot:
  //   is_sub = slot_mattina === 'SUB' || slot_pomeriggio === 'SUB'
  //   is_med = slot_mattina === 'MED' || slot_pomeriggio === 'MED'
  is_sub: boolean
  is_med: boolean
  created_at: string
  updated_at: string
}

export interface Ferie {
  id: string
  medico_id: string
  data_inizio: string
  data_fine: string
  approvate: boolean
  note: string | null
  created_at: string
}

// ─── Cambi turno ────────────────────────────────────────────────────

/** Singola modifica all'interno di una richiesta di cambio turno.
 *  Rappresenta UNA cella del calendario (medico/data) che cambia dal
 *  valore "da" al valore "a". Una richiesta puo` contenerne piu` di una
 *  (es. scambio reciproco = 2 elementi). */
export interface ModificaCambio {
  medico_id: string
  data:      string          // ISO date "YYYY-MM-DD"
  da: {
    tc: TurnoClinico
    tr: TurnoRicerca
    slot_mattina:    SlotPlacement
    slot_pomeriggio: SlotPlacement
  }
  a: {
    tc: TurnoClinico
    tr: TurnoRicerca
    slot_mattina:    SlotPlacement
    slot_pomeriggio: SlotPlacement
  }
}

export interface CambioTurno {
  id:                    string
  created_at:            string
  medico_richiedente_id: string
  /** Array JSONB di {medico_id, data, da, a}. Una richiesta puo` toccare
   *  piu` celle in una sola operazione (utile per scambi reciproci o
   *  multi-medico). */
  modifiche:             ModificaCambio[]
  motivo:                string | null
  /** 'pending' = in attesa, 'approved' = applicato al calendario,
   *  'rejected' = rifiutato, 'restored' = applicato e poi annullato
   *  dall'admin (i turni sono stati riportati ai valori originali). */
  stato:                 'pending' | 'approved' | 'rejected' | 'restored'
  resolved_at:           string | null
  resolved_by:           string | null
  rejection_reason:      string | null
}

// ─── Messaggi (casella di posta utente) ─────────────────────────────

export type TipoMessaggio =
  | 'cambio_approvato'
  | 'cambio_rifiutato'
  | 'cambio_ripristinato'
  | 'ferie_approvate'
  | 'ferie_rifiutate'

export interface Messaggio {
  id:              string
  created_at:      string
  medico_id:       string         // destinatario
  tipo:            TipoMessaggio
  titolo:          string
  corpo:           string | null
  letto:           boolean
  /** Riferimenti opzionali al record che ha generato il messaggio. */
  cambio_turno_id: string | null
  ferie_id:        string | null
}

export interface UtenteAutorizzato {
  id: string
  email: string
  /** 'admin' = accesso completo;  'user' = vista pubblica + ferie;
   *  'ospite' = SOLO vista settimanale (niente calendario completo,
   *  niente ferie, niente riepilogo). */
  ruolo: 'admin' | 'user' | 'ospite'
  nome: string | null
  attivo: boolean
  created_at: string
}

// ─── Tipi turno ────────────────────────────────────────────────────

export type TurnoClinico = 'M' | 'P' | 'L' | 'REP' | ''
export type TurnoRicerca = 'RM' | 'RP' | 'RM+RP' | ''

// ─── Tipi per l'algoritmo ──────────────────────────────────────────

export interface TurnoTeorico {
  turno_clinico: TurnoClinico
  turno_ricerca: TurnoRicerca
  slot_mattina:    SlotPlacement
  slot_pomeriggio: SlotPlacement
  is_sub: boolean   // calcolato (backward compat)
  is_med: boolean   // calcolato (backward compat)
}

export interface TurnoGenerato {
  medico_id: string
  data: string
  turno_clinico: TurnoClinico
  turno_ricerca: TurnoRicerca
  slot_mattina:    SlotPlacement
  slot_pomeriggio: SlotPlacement
  is_sub: boolean
  is_med: boolean
}

// ─── Tipi per il calendario UI ─────────────────────────────────────

export interface CellaCal {
  data: string
  turno_clinico: TurnoClinico
  turno_ricerca: TurnoRicerca
  note: string | null
  modificato_manualmente: boolean
  is_ferie: boolean
  slot_mattina:    SlotPlacement
  slot_pomeriggio: SlotPlacement
  is_sub: boolean
  is_med: boolean
}

export interface RigaCal {
  medico: Medico
  celle: Record<string, CellaCal>  // key = data ISO "YYYY-MM-DD"
}

export interface ColonnaCal {
  data: string          // "YYYY-MM-DD"
  giorno: number        // 1..31
  mese: number          // 1..12
  anno: number
  isDomenica: boolean
  isFestivo: boolean
}

// ─── Auth ──────────────────────────────────────────────────────────

export interface AuthUser {
  id: string
  email: string
  ruolo: 'admin' | 'user' | 'ospite'
  nome: string | null
}
