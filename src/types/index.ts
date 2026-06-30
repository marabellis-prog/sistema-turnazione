// ─── Entità database ───────────────────────────────────────────────

export interface Medico {
  id: string
  nome: string                // display combinato "COGNOME Nome" (sync dall'utente)
  numero_ordine: number       // posizione 1..N nella rotazione
  is_reperibilita: boolean    // true = il suo numero è il "REP" nello schema
  attivo: boolean
  created_at: string
  /** Cognome e nome separati (propagati dall'utente collegato via trigger). */
  cognome?: string | null
  nome_proprio?: string | null
  /** Ruolo dentro il reparto: 'turnista' (in rotazione) o 'ospite' (solo vista). */
  ruolo_reparto?: 'turnista' | 'ospite'
  /** Multi-reparto: il turnista appartiene a un reparto. */
  reparto_id?: string
  /** Link all'utente globale (utenti_autorizzati) se il turnista ha accesso. */
  utente_id?: string | null
}

// ─── Multi-reparto ──────────────────────────────────────────────────

/** Un Reparto = mondo isolato con i suoi turni e turnisti. */
export interface Reparto {
  id:         string
  nome:       string
  attivo:     boolean
  created_at: string
  /** Codice nazione per le festività nazionali (es. 'IT'). Default 'IT'. */
  nazione?:   string
}

/** Un utente (globale) responsabile di un reparto. */
export interface RepartoResponsabile {
  reparto_id: string
  utente_id:  string
  created_at: string
}

/** Tipo di turno configurabile per reparto (M, P, L, REP, o custom es. SWING). */
export interface TipoTurno {
  id:               string
  reparto_id:       string
  /** Schema a cui appartiene il tipo (ogni schema ha i suoi turni). Default 1. */
  schema_num?:      number
  sigla:            string
  nome:             string
  ora_inizio:       string | null
  ora_fine:         string | null
  peso:             number       // quanti "turni" vale (L=2, REP=0)
  copre_mattina:    boolean
  copre_pomeriggio: boolean
  is_reperibilita:  boolean
  colore_bg:        string
  colore_fg:        string
  ordine:           number
  created_at:       string
}

/** Proprieta' del turno (SUB / MED / SUP) con colore, per reparto. */
export interface ProprietaTurno {
  id:         string
  reparto_id: string
  /** Schema a cui appartiene la proprietà (ogni schema ha i suoi flag). Default 1. */
  schema_num?: number
  sigla:      string
  nome:       string
  colore_bg:  string
  ordine:     number
  /** true = mutualmente esclusiva (non coesiste con altre proprietà sullo slot). */
  esclusiva?: boolean
  created_at: string
}

/** Impostazioni GLOBALI del gestionale (singleton). Policy backup centrale. */
export interface ImpostazioniGlobali {
  id: boolean
  backup_intervallo_giorni: number   // 0 = auto-backup disattivato
  backup_da_tenere: number
  updated_at: string
}

export interface Configurazione {
  id: string
  /** Reparto a cui appartiene questa configurazione (multi-reparto). */
  reparto_id: string
  anno_inizio: number
  mese_inizio: number         // 1..12
  anno_fine: number
  mese_fine: number           // 1..12
  /** Giorno del mese_inizio = inizio esatto del calendario; la rotazione
   *  (settimana 1, sett=0) e' il primo lunedi' >= (anno_inizio, mese_inizio,
   *  giorno_inizio). I giorni tra l'inizio e quel lunedi' restano coda del
   *  ciclo precedente. Default 1 = 1° del mese (comportamento storico). */
  giorno_inizio?: number
  /** Giorno del mese_fine = fine esatta del calendario. null/undefined =
   *  ultimo giorno del mese_fine (comportamento storico). */
  giorno_fine?: number | null
  /** Cronologia degli schemi (per "Schemi aggiornati" nella sidebar admin):
   *  una generazione completa = 1 elemento, ogni Aggiorna turnazione approvato
   *  appende {schema_nuovo, cutover}. Ordine cronologico. */
  schema_storico?: SchemaEpoca[]
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
  /** Soglie "Supporto" (jolly) = celle che lavorano senza SUB/MED.
   *  Stessa convenzione di sub/med (0 = nessun controllo). */
  sup_mattina_feriale:    number
  sup_mattina_festivo:    number
  sup_pomeriggio_feriale: number
  sup_pomeriggio_festivo: number
  /** Soglie del SABATO (colonna a se' tra feriale e festivo). */
  sub_mattina_sabato:    number
  sub_pomeriggio_sabato: number
  med_mattina_sabato:    number
  med_pomeriggio_sabato: number
  sup_mattina_sabato:    number
  sup_pomeriggio_sabato: number
  /** Data (ISO) da cui valgono le soglie correnti; null = sempre. */
  impostazioni_valido_dal?: string | null
  /** Epoche passate delle soglie (per il check su periodi con composizioni
   *  diverse dopo un Aggiorna turnazione). */
  impostazioni_storico?: SogliaEpoca[]
  /** Intervallo in giorni per l'auto-backup dei turni (default 7) */
  backup_intervallo_giorni: number
  /** Quanti backup conservare prima di iniziare a rotare (default 10) */
  backup_da_tenere:         number
  /** Numero di medici attivi all'ultima generazione/approvazione turnazione.
   *  Usato dal controllo di consistenza prima di un "Aggiorna turnazione".
   *  null finche` non si fa una generazione col nuovo codice. */
  n_medici_base?: number | null
  updated_at: string
}

/** Le 12 soglie di coerenza (sub/med/sup × mattina/pomeriggio × feriale/festivo). */
export type SoglieSlot = Pick<Configurazione,
  | 'sub_mattina_feriale' | 'sub_mattina_festivo' | 'sub_pomeriggio_feriale' | 'sub_pomeriggio_festivo'
  | 'med_mattina_feriale' | 'med_mattina_festivo' | 'med_pomeriggio_feriale' | 'med_pomeriggio_festivo'
  | 'sup_mattina_feriale' | 'sup_mattina_festivo' | 'sup_pomeriggio_feriale' | 'sup_pomeriggio_festivo'
  | 'sub_mattina_sabato' | 'sub_pomeriggio_sabato' | 'med_mattina_sabato'
  | 'med_pomeriggio_sabato' | 'sup_mattina_sabato' | 'sup_pomeriggio_sabato'
>

/** Epoca passata delle soglie: valide per i giorni in [valido_dal, valido_fino). */
export interface SogliaEpoca {
  valido_dal:  string | null   // ISO o null = dall'inizio
  valido_fino: string          // ISO esclusivo
  soglie:      SoglieSlot
}

/** Una "epoca" di schema: lo schema N valido a partire dal giorno `dal`. */
export interface SchemaEpoca {
  schema: number
  dal:    string   // ISO "YYYY-MM-DD"
}

// ─── Backup turni ───────────────────────────────────────────────────

export interface TurnoBackup {
  id:          string
  created_at:  string
  descrizione: string | null
  num_turni:   number | null
  /** Snapshot JSONB: { "turni": [<riga turni>, ...] } */
  snapshot:    { turni: unknown[] }
}

// ─── Statistiche DB / Storage / Auth (free tier monitoring) ────────

export interface DbStats {
  /** Dimensione del database PostgreSQL (bytes). Free tier: 500 MB. */
  db_size_bytes: number
  /** Somma byte di tutti gli oggetti in storage. Free tier: 1 GB. */
  storage_bytes: number
  /** MAU approssimata (utenti auth.users con last_sign_in_at negli ultimi 30 giorni).
   *  Non e` esattamente la MAU di Supabase ma una sua approssimazione lato DB. */
  mau_approx:    number
  /** Utenti totali auth.users (anche mai loggati). */
  users_total:   number
  tables: Array<{ name: string; rows: number }>
}

/** Schema come UNITÀ: struttura (slot in schemi_modello) + validità propria.
 *  Le regole/fabbisogno e l'algoritmo si legheranno a questo (in costruzione). */
export interface Schema {
  id: string
  reparto_id: string
  schema_num: number
  nome: string | null
  valido_dal: string | null
  valido_al: string | null
  durata_giorni: number | null
  created_at: string
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
  is_supporto?: boolean       // true = slot di Supporto (jolly grigio, senza SUB/MED)
  reparto_id?: string
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
  /** Modello DINAMICO (nuovo schema): il turno "vero" (sigla del tipo di turno,
   *  es. 'M','L','Swing') e le proprietà attive (es. ['SUB']). Popolati dalla
   *  generazione dal nuovo schema; null/[] sui turni del vecchio motore. Le
   *  colonne vecchie (turno_clinico, slot_*) restano derivate per compat. */
  turno_sigla?: string | null
  proprieta?:   string[]
  /** Turno teorico (rotazione) della cella, settato a generazione/aggiornamento.
   *  "modificato_manualmente" ⇔ turno_clinico/ricerca != base. null = legacy
   *  (turni generati prima della feature → fallback ricalcolo). */
  turno_clinico_base?: TurnoClinico | null
  turno_ricerca_base?: TurnoRicerca | null
  /** Per le celle modificate PORTATE oltre un "Aggiorna turnazione": il base
   *  PRIMA dell'aggiornamento (il vecchio calendario sostituito). null
   *  altrimenti → marcatore del bordo/righe ROSSE in Modifica Turni. */
  turno_clinico_originario?: TurnoClinico | null
  /** Solo negli snapshot di "Anteprima turnazione": i turni della VECCHIA
   *  turnazione (schema precedente CONTINUATO) per la riga di confronto B/N.
   *  Riferimento FISSO calcolato alla creazione della bozza (non cambia con
   *  gli scambi fatti in anteprima). Bordo blu dove differisce dall'attuale. */
  turno_clinico_vecchio?: TurnoClinico | null
  turno_ricerca_vecchio?: TurnoRicerca | null
  created_at: string
  updated_at: string
}

// ─── Bozza turnazione (anteprima in attesa di approvazione) ─────────

export interface TurnazioneAnteprima {
  id:          string
  created_at:  string
  descrizione: string | null
  /** Snapshot del calendario completo proposto. */
  snapshot:    { turni: Turno[] }
  /** Metadati per la pubblicazione e l'anteprima. */
  meta: {
    cutover:        string   // ISO data del primo lunedì (stacco)
    schema_nuovo:   number
    anno_inizio:    number
    mese_inizio:    number   // mese di inizio del NUOVO schema (richiesto dall'utente)
    anno_fine:      number
    mese_fine:      number
    n_cambi:        number
    config_payload: Partial<Configurazione>
  }
}

// ─── Festività custom (oltre a quelle nazionali italiane) ───────────

export interface FestivitaCustom {
  id:          string
  data:        string         // ISO "YYYY-MM-DD"
  descrizione: string
  created_at:  string
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
  // medico ← admin
  | 'cambio_approvato'
  | 'cambio_rifiutato'
  | 'cambio_ripristinato'
  | 'ferie_approvate'
  | 'ferie_rifiutate'
  // admin ← medico (richieste / annullamenti)
  | 'ferie_richiesta'
  | 'ferie_annullata'
  | 'cambio_richiesto'
  | 'cambio_annullato'
  // admin ← admin (log condiviso fra admin di azioni eseguite)
  | 'admin_azione'

export type DestinatarioRuolo = 'medico' | 'admin'

export interface Messaggio {
  id:              string
  created_at:      string
  /** NULL se destinatario_ruolo='admin' (broadcast a tutti gli admin). */
  medico_id:       string | null
  /** 'medico' = messaggio per il medico_id; 'admin' = broadcast a tutti gli admin. */
  destinatario_ruolo: DestinatarioRuolo
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
  nome: string | null          // display combinato "COGNOME Nome"
  cognome?: string | null
  nome_proprio?: string | null
  attivo: boolean
  created_at: string
}

// ─── Tipi turno ────────────────────────────────────────────────────

/** Turno clinico:
 *  - 'M'   = Mattina
 *  - 'P'   = Pomeriggio
 *  - 'L'   = Lungo (mattina+pomeriggio)
 *  - 'REP' = Reperibilita`
 *  - 'EM'  = Esterno Mattina    (come M, ma ceduto a medico esterno)
 *  - 'EP'  = Esterno Pomeriggio (come P, ma ceduto a medico esterno)
 *  - 'EL'  = Esterno Lungo M+P  (come L, ma ceduto a medico esterno)
 *  - ''    = nessun turno (cella vuota)
 *
 *  Le varianti 'E*' rappresentano turni coperti da un medico fuori dal
 *  gruppo: contano come coperti per ferie e per la copertura
 *  giornaliera, ma NON entrano nel totale del medico (M+P+2L) perche`
 *  il medico in elenco NON li lavora. Richiedono comunque il placement
 *  SUB/MED (l'esterno fa sub-intensiva o medicina).
 */
export type TurnoClinico = 'M' | 'P' | 'L' | 'REP' | 'EM' | 'EP' | 'EL' | ''
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
