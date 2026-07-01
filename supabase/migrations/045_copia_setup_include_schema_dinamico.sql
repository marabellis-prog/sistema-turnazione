-- 045 — "Copia da reparto": includere lo SCHEMA DINAMICO.
--
-- copia_setup_reparto (021) copiava tipi_turno, proprieta_turno, schemi_modello
-- (classico) e configurazione, ma NON le 6 tabelle dello schema dinamico
-- (schema_meta/giorno/colonna/cella/giorno_colonna/fabbisogno). Copiando il
-- setup da un reparto dinamico, il target restava SENZA disegno dello schema →
-- inutilizzabile per generare/modificare ("Copia da reparto non funziona").
--
-- Ora copia anche le 6 tabelle, in un blocco GUARDATO su "il target non ha
-- ancora uno schema" (NOT EXISTS schema_meta) → non clobbera un reparto già
-- configurato. Le schema_* hanno FK solo verso reparti → ordine libero.
-- Applicata in prod via scripts/run-sql.mjs il 01/07/2026.

CREATE OR REPLACE FUNCTION public.copia_setup_reparto(p_target uuid, p_source uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF p_target = p_source THEN RETURN; END IF;
  IF NOT (puo_gestire_reparto(p_target) AND puo_vedere_reparto(p_source)) THEN
    RAISE EXCEPTION 'Permesso negato sulla copia setup';
  END IF;

  INSERT INTO tipi_turno (reparto_id, schema_num, sigla, nome, ora_inizio, ora_fine, peso,
      copre_mattina, copre_pomeriggio, is_reperibilita, colore_bg, colore_fg, ordine)
    SELECT p_target, schema_num, sigla, nome, ora_inizio, ora_fine, peso,
      copre_mattina, copre_pomeriggio, is_reperibilita, colore_bg, colore_fg, ordine
    FROM tipi_turno WHERE reparto_id = p_source
    ON CONFLICT (reparto_id, schema_num, sigla) DO NOTHING;

  INSERT INTO proprieta_turno (reparto_id, schema_num, sigla, nome, colore_bg, ordine, esclusiva)
    SELECT p_target, schema_num, sigla, nome, colore_bg, ordine, esclusiva
    FROM proprieta_turno WHERE reparto_id = p_source
    ON CONFLICT (reparto_id, schema_num, sigla) DO NOTHING;

  INSERT INTO schemi_modello (reparto_id, schema_num, giorno_settimana, slot,
      numero_medico_mattina, numero_medico_pomeriggio, numero_medico_rm, numero_medico_rp,
      is_reperibilita, is_sub, is_med, is_supporto)
    SELECT p_target, schema_num, giorno_settimana, slot,
      numero_medico_mattina, numero_medico_pomeriggio, numero_medico_rm, numero_medico_rp,
      is_reperibilita, is_sub, is_med, is_supporto
    FROM schemi_modello WHERE reparto_id = p_source;

  -- Schema DINAMICO (la parte che mancava). Copia le 6 tabelle SOLO se il target
  -- non ha ancora uno schema, così non si sovrascrive un reparto già configurato.
  IF NOT EXISTS (SELECT 1 FROM schema_meta WHERE reparto_id = p_target) THEN
    INSERT INTO schema_meta (reparto_id, schema_num, titolo)
      SELECT p_target, schema_num, titolo
      FROM schema_meta WHERE reparto_id = p_source;

    INSERT INTO schema_giorno (reparto_id, schema_num, giorno_settimana, ordine)
      SELECT p_target, schema_num, giorno_settimana, ordine
      FROM schema_giorno WHERE reparto_id = p_source;

    INSERT INTO schema_colonna (reparto_id, schema_num, tipo, sigla, ordine)
      SELECT p_target, schema_num, tipo, sigla, ordine
      FROM schema_colonna WHERE reparto_id = p_source;

    INSERT INTO schema_cella (reparto_id, schema_num, giorno_settimana, slot_idx, colonna_sigla, numero, attivo)
      SELECT p_target, schema_num, giorno_settimana, slot_idx, colonna_sigla, numero, attivo
      FROM schema_cella WHERE reparto_id = p_source;

    INSERT INTO schema_giorno_colonna (reparto_id, schema_num, giorno_settimana, colonna_sigla, attivo)
      SELECT p_target, schema_num, giorno_settimana, colonna_sigla, attivo
      FROM schema_giorno_colonna WHERE reparto_id = p_source;

    INSERT INTO schema_fabbisogno (reparto_id, schema_num, ambito, turno_sigla, totale, per_proprieta)
      SELECT p_target, schema_num, ambito, turno_sigla, totale, per_proprieta
      FROM schema_fabbisogno WHERE reparto_id = p_source;
  END IF;

  INSERT INTO configurazione (reparto_id,
      anno_inizio, mese_inizio, anno_fine, mese_fine, giorno_inizio, giorno_fine,
      schema_attivo, max_ferie_concomitanti, autocalc_sub_med,
      sub_mattina_feriale, sub_mattina_festivo, sub_pomeriggio_feriale, sub_pomeriggio_festivo,
      med_mattina_feriale, med_mattina_festivo, med_pomeriggio_feriale, med_pomeriggio_festivo,
      sup_mattina_feriale, sup_mattina_festivo, sup_pomeriggio_feriale, sup_pomeriggio_festivo,
      sub_mattina_sabato, sub_pomeriggio_sabato, med_mattina_sabato, med_pomeriggio_sabato,
      sup_mattina_sabato, sup_pomeriggio_sabato,
      backup_intervallo_giorni, backup_da_tenere, n_medici_base,
      impostazioni_valido_dal, impostazioni_storico, schema_storico)
    SELECT p_target,
      anno_inizio, mese_inizio, anno_fine, mese_fine, giorno_inizio, giorno_fine,
      schema_attivo, max_ferie_concomitanti, autocalc_sub_med,
      sub_mattina_feriale, sub_mattina_festivo, sub_pomeriggio_feriale, sub_pomeriggio_festivo,
      med_mattina_feriale, med_mattina_festivo, med_pomeriggio_feriale, med_pomeriggio_festivo,
      sup_mattina_feriale, sup_mattina_festivo, sup_pomeriggio_feriale, sup_pomeriggio_festivo,
      sub_mattina_sabato, sub_pomeriggio_sabato, med_mattina_sabato, med_pomeriggio_sabato,
      sup_mattina_sabato, sup_pomeriggio_sabato,
      backup_intervallo_giorni, backup_da_tenere, n_medici_base,
      NULL, '[]'::jsonb, '[]'::jsonb
    FROM configurazione WHERE reparto_id = p_source
    ORDER BY updated_at DESC LIMIT 1;
END;
$function$;
