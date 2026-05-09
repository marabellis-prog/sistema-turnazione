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

export interface Turno {
  id: string
  medico_id: string
  data: string                // ISO date: "2026-05-01"
  turno_clinico: TurnoClinico
  turno_ricerca: TurnoRicerca
  note: string | null
  modificato_manualmente: boolean
  is_ferie: boolean
  is_sub: boolean             // turno clinico in sub-intensiva (etichetta rossa)
  is_med: boolean             // turno clinico in medicina      (etichetta azzurra)
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

export interface UtenteAutorizzato {
  id: string
  email: string
  ruolo: 'admin' | 'user'
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
  is_sub: boolean
  is_med: boolean
}

export interface TurnoGenerato {
  medico_id: string
  data: string
  turno_clinico: TurnoClinico
  turno_ricerca: TurnoRicerca
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
  ruolo: 'admin' | 'user'
  nome: string | null
}
