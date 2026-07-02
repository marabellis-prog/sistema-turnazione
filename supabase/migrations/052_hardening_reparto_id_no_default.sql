-- 052_hardening_reparto_id_no_default.sql
--
-- DIFESA STRUTTURALE contro l'intera classe di bug "scrittura senza reparto_id".
--
-- Contesto: 9 tabelle reparto-scoped avevano reparto_id NOT NULL *con DEFAULT
-- 11N*. Un qualsiasi INSERT/UPSERT che dimenticava reparto_id NON dava errore:
-- il default riempiva silenziosamente 11N (il reparto legacy/sacro), corrompendo
-- i suoi dati e creando righe cross-reparto. È esattamente il bug che ha colpito
-- l'approvazione dei cambi turno (turno di un altro reparto finito su 11N).
--
-- Fix puntuale già applicato lato codice (GestioneCambiPage passa reparto_id).
-- Questa migration chiude la classe a livello DB: TOGLIENDO IL DEFAULT, un
-- reparto_id mancante viola il NOT NULL -> errore immediato, insert annullato,
-- ZERO possibilità di contaminare 11N. "Fail loud" invece di "fail silent".
--
-- Sicurezza verificata prima di applicare:
--   * tutte e 9 le colonne sono già NOT NULL;
--   * 0 righe con reparto_id NULL in tutte le tabelle;
--   * ogni writer (client TSX + tutte le RPC copia/subentro/backup/restore)
--     passa reparto_id esplicito -> nessun percorso dipende dal default;
--   * il seed storico 001_initial.sql si appoggiava al default ma è già
--     eseguito e non verrà rieseguito.
-- Reversibile: riaggiungere `DEFAULT '111...111'` se mai servisse.

ALTER TABLE turni               ALTER COLUMN reparto_id DROP DEFAULT;
ALTER TABLE turni_backup        ALTER COLUMN reparto_id DROP DEFAULT;
ALTER TABLE ferie               ALTER COLUMN reparto_id DROP DEFAULT;
ALTER TABLE cambi_turno         ALTER COLUMN reparto_id DROP DEFAULT;
ALTER TABLE medici              ALTER COLUMN reparto_id DROP DEFAULT;
ALTER TABLE configurazione      ALTER COLUMN reparto_id DROP DEFAULT;
ALTER TABLE festivita_custom    ALTER COLUMN reparto_id DROP DEFAULT;
ALTER TABLE schemi_modello      ALTER COLUMN reparto_id DROP DEFAULT;
ALTER TABLE turnazione_anteprima ALTER COLUMN reparto_id DROP DEFAULT;
