-- 049_copia_setup_medici_festivita.sql
--
-- "Copia da reparto" (Centro di Controllo) deve copiare anche i TURNISTI/OSPITI
-- e le FESTIVITÀ, oltre a tipi/proprietà/schema/config già copiati. NON genera
-- i turni (schema_storico resta '[]') → genera/modifica/anteprima/ferie/cambi
-- restano vuoti. Aggiunge due blocchi guardati (solo se il target è vuoto) alla
-- RPC esistente; il resto è invariato.

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

  -- Schema DINAMICO: 6 tabelle, SOLO se il target non ha ancora uno schema.
  IF NOT EXISTS (SELECT 1 FROM schema_meta WHERE reparto_id = p_target) THEN
    INSERT INTO schema_meta (reparto_id, schema_num, titolo)
      SELECT p_target, schema_num, titolo FROM schema_meta WHERE reparto_id = p_source;
    INSERT INTO schema_giorno (reparto_id, schema_num, giorno_settimana, ordine)
      SELECT p_target, schema_num, giorno_settimana, ordine FROM schema_giorno WHERE reparto_id = p_source;
    INSERT INTO schema_colonna (reparto_id, schema_num, tipo, sigla, ordine)
      SELECT p_target, schema_num, tipo, sigla, ordine FROM schema_colonna WHERE reparto_id = p_source;
    INSERT INTO schema_cella (reparto_id, schema_num, giorno_settimana, slot_idx, colonna_sigla, numero, attivo)
      SELECT p_target, schema_num, giorno_settimana, slot_idx, colonna_sigla, numero, attivo FROM schema_cella WHERE reparto_id = p_source;
    INSERT INTO schema_giorno_colonna (reparto_id, schema_num, giorno_settimana, colonna_sigla, attivo)
      SELECT p_target, schema_num, giorno_settimana, colonna_sigla, attivo FROM schema_giorno_colonna WHERE reparto_id = p_source;
    INSERT INTO schema_fabbisogno (reparto_id, schema_num, ambito, turno_sigla, totale, per_proprieta)
      SELECT p_target, schema_num, ambito, turno_sigla, totale, per_proprieta FROM schema_fabbisogno WHERE reparto_id = p_source;
  END IF;

  -- TURNISTI + OSPITI (attivi): SOLO se il target non ha ancora medici, così non
  -- si duplicano. Copia anche utente_id → lo stesso turnista resta collegato al
  -- suo account anche nel nuovo reparto (niente medici "scollegati", cfr. #40).
  -- I ritirati (attivo=false) NON vengono copiati.
  IF NOT EXISTS (SELECT 1 FROM medici WHERE reparto_id = p_target) THEN
    INSERT INTO medici (reparto_id, nome, cognome, nome_proprio, numero_ordine,
        is_reperibilita, attivo, ruolo_reparto, utente_id)
      SELECT p_target, nome, cognome, nome_proprio, numero_ordine,
        is_reperibilita, attivo, ruolo_reparto, utente_id
      FROM medici WHERE reparto_id = p_source AND attivo;
  END IF;

  -- FESTIVITÀ custom: solo se il target non ne ha.
  IF NOT EXISTS (SELECT 1 FROM festivita_custom WHERE reparto_id = p_target) THEN
    INSERT INTO festivita_custom (reparto_id, data, descrizione)
      SELECT p_target, data, descrizione FROM festivita_custom WHERE reparto_id = p_source;
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
