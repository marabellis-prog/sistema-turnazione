-- 022: fix multi-reparto
--
-- (B) numero_ordine UNIQUE per REPARTO (non globale): senza questo, aggiungere
--     un turnista a un reparto nuovo collide con i numeri di 11N.
-- (A) ON DELETE CASCADE sulle FK di SETUP/derivati (config, schemi, festivita,
--     anteprima, backup): eliminando un reparto si puliscono da soli, niente
--     errore di FK. medici/turni/cambi/ferie restano SENZA cascade: e' l'app a
--     bloccare l'eliminazione se il reparto ha contenuti (turnisti/turni).

-- (B) ─────────────────────────────────────────────────────────────────
ALTER TABLE medici DROP CONSTRAINT IF EXISTS medici_numero_ordine_key;
ALTER TABLE medici DROP CONSTRAINT IF EXISTS medici_reparto_ordine_uniq;
ALTER TABLE medici ADD  CONSTRAINT medici_reparto_ordine_uniq UNIQUE (reparto_id, numero_ordine);

-- (A) ─────────────────────────────────────────────────────────────────
ALTER TABLE configurazione       DROP CONSTRAINT IF EXISTS configurazione_reparto_id_fkey;
ALTER TABLE configurazione       ADD  CONSTRAINT configurazione_reparto_id_fkey       FOREIGN KEY (reparto_id) REFERENCES reparti(id) ON DELETE CASCADE;
ALTER TABLE schemi_modello       DROP CONSTRAINT IF EXISTS schemi_modello_reparto_id_fkey;
ALTER TABLE schemi_modello       ADD  CONSTRAINT schemi_modello_reparto_id_fkey       FOREIGN KEY (reparto_id) REFERENCES reparti(id) ON DELETE CASCADE;
ALTER TABLE festivita_custom     DROP CONSTRAINT IF EXISTS festivita_custom_reparto_id_fkey;
ALTER TABLE festivita_custom     ADD  CONSTRAINT festivita_custom_reparto_id_fkey     FOREIGN KEY (reparto_id) REFERENCES reparti(id) ON DELETE CASCADE;
ALTER TABLE turnazione_anteprima DROP CONSTRAINT IF EXISTS turnazione_anteprima_reparto_id_fkey;
ALTER TABLE turnazione_anteprima ADD  CONSTRAINT turnazione_anteprima_reparto_id_fkey FOREIGN KEY (reparto_id) REFERENCES reparti(id) ON DELETE CASCADE;
ALTER TABLE turni_backup         DROP CONSTRAINT IF EXISTS turni_backup_reparto_id_fkey;
ALTER TABLE turni_backup         ADD  CONSTRAINT turni_backup_reparto_id_fkey         FOREIGN KEY (reparto_id) REFERENCES reparti(id) ON DELETE CASCADE;
