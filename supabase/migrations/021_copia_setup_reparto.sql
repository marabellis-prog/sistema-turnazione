-- 021: copia "setup" (schema + tipi + regole) da un reparto a un altro
--
-- Usata dall'icona "Copia da reparto" nel Centro di controllo: invece di
-- copiare automaticamente alla creazione, l'admin crea un reparto VUOTO e poi
-- copia a richiesta tipi_turno + proprieta_turno + schemi_modello + la
-- configurazione (regole/soglie), azzerando gli storici. NON copia turnisti
-- ne' turni/calendari (quelli sono propri di ogni reparto).

CREATE OR REPLACE FUNCTION copia_setup_reparto(p_target uuid, p_source uuid)
RETURNS void AS $$
BEGIN
  IF p_target = p_source THEN RETURN; END IF;
  IF NOT (puo_gestire_reparto(p_target) AND puo_vedere_reparto(p_source)) THEN
    RAISE EXCEPTION 'Permesso negato sulla copia setup';
  END IF;

  INSERT INTO tipi_turno (reparto_id, sigla, nome, ora_inizio, ora_fine, peso,
      copre_mattina, copre_pomeriggio, is_reperibilita, colore_bg, colore_fg, ordine)
    SELECT p_target, sigla, nome, ora_inizio, ora_fine, peso,
      copre_mattina, copre_pomeriggio, is_reperibilita, colore_bg, colore_fg, ordine
    FROM tipi_turno WHERE reparto_id = p_source
    ON CONFLICT (reparto_id, sigla) DO NOTHING;

  INSERT INTO proprieta_turno (reparto_id, sigla, nome, colore_bg, ordine)
    SELECT p_target, sigla, nome, colore_bg, ordine
    FROM proprieta_turno WHERE reparto_id = p_source
    ON CONFLICT (reparto_id, sigla) DO NOTHING;

  INSERT INTO schemi_modello (reparto_id, schema_num, giorno_settimana, slot,
      numero_medico_mattina, numero_medico_pomeriggio, numero_medico_rm, numero_medico_rp,
      is_reperibilita, is_sub, is_med, is_supporto)
    SELECT p_target, schema_num, giorno_settimana, slot,
      numero_medico_mattina, numero_medico_pomeriggio, numero_medico_rm, numero_medico_rp,
      is_reperibilita, is_sub, is_med, is_supporto
    FROM schemi_modello WHERE reparto_id = p_source;

  -- Regole/configurazione: la piu' recente del source, storici azzerati.
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION copia_setup_reparto(uuid, uuid) TO authenticated;
