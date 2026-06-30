-- 039_copia_schema.sql
-- (A) Aggiorna copia_setup_reparto: tipi_turno/proprieta_turno ora hanno
--     schema_num → la copia reparto→reparto deve preservarlo.
-- (B) Nuova RPC copia_schema(reparto, from, to): copia DENTRO lo stesso reparto
--     un intero schema (tipi + proprietà + giorni + colonne + checkbox + celle)
--     da uno schema_num a un altro. Usata dal pulsante "Copia da schema" nel
--     nuovo Disegna Schema. Atomica: ripulisce prima il target.

-- ── (A) copia_setup_reparto con schema_num ──────────────────────────
CREATE OR REPLACE FUNCTION copia_setup_reparto(p_target uuid, p_source uuid)
RETURNS void AS $$
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

-- ── (B) copia_schema: schema → schema, stesso reparto ───────────────
CREATE OR REPLACE FUNCTION copia_schema(p_reparto uuid, p_from integer, p_to integer)
RETURNS void AS $$
BEGIN
  IF p_from = p_to THEN RETURN; END IF;
  IF NOT puo_gestire_reparto(p_reparto) THEN
    RAISE EXCEPTION 'Permesso negato sulla copia schema';
  END IF;

  -- Pulisci il target (in ordine: prima i dipendenti).
  DELETE FROM schema_cella          WHERE reparto_id = p_reparto AND schema_num = p_to;
  DELETE FROM schema_giorno_colonna WHERE reparto_id = p_reparto AND schema_num = p_to;
  DELETE FROM schema_colonna        WHERE reparto_id = p_reparto AND schema_num = p_to;
  DELETE FROM schema_giorno         WHERE reparto_id = p_reparto AND schema_num = p_to;
  DELETE FROM schema_fabbisogno     WHERE reparto_id = p_reparto AND schema_num = p_to;
  DELETE FROM tipi_turno            WHERE reparto_id = p_reparto AND schema_num = p_to;
  DELETE FROM proprieta_turno       WHERE reparto_id = p_reparto AND schema_num = p_to;

  -- Tipi e proprietà.
  INSERT INTO tipi_turno (reparto_id, schema_num, sigla, nome, ora_inizio, ora_fine, peso,
      copre_mattina, copre_pomeriggio, is_reperibilita, colore_bg, colore_fg, ordine)
    SELECT p_reparto, p_to, sigla, nome, ora_inizio, ora_fine, peso,
      copre_mattina, copre_pomeriggio, is_reperibilita, colore_bg, colore_fg, ordine
    FROM tipi_turno WHERE reparto_id = p_reparto AND schema_num = p_from;

  INSERT INTO proprieta_turno (reparto_id, schema_num, sigla, nome, colore_bg, ordine, esclusiva)
    SELECT p_reparto, p_to, sigla, nome, colore_bg, ordine, esclusiva
    FROM proprieta_turno WHERE reparto_id = p_reparto AND schema_num = p_from;

  -- Struttura schema.
  INSERT INTO schema_giorno (reparto_id, schema_num, giorno_settimana, ordine)
    SELECT p_reparto, p_to, giorno_settimana, ordine
    FROM schema_giorno WHERE reparto_id = p_reparto AND schema_num = p_from;

  INSERT INTO schema_colonna (reparto_id, schema_num, tipo, sigla, ordine)
    SELECT p_reparto, p_to, tipo, sigla, ordine
    FROM schema_colonna WHERE reparto_id = p_reparto AND schema_num = p_from;

  INSERT INTO schema_giorno_colonna (reparto_id, schema_num, giorno_settimana, colonna_sigla, attivo)
    SELECT p_reparto, p_to, giorno_settimana, colonna_sigla, attivo
    FROM schema_giorno_colonna WHERE reparto_id = p_reparto AND schema_num = p_from;

  INSERT INTO schema_cella (reparto_id, schema_num, giorno_settimana, slot_idx, colonna_sigla, numero, attivo)
    SELECT p_reparto, p_to, giorno_settimana, slot_idx, colonna_sigla, numero, attivo
    FROM schema_cella WHERE reparto_id = p_reparto AND schema_num = p_from;

  -- Fabbisogno.
  INSERT INTO schema_fabbisogno (reparto_id, schema_num, ambito, turno_sigla, totale, per_proprieta)
    SELECT p_reparto, p_to, ambito, turno_sigla, totale, per_proprieta
    FROM schema_fabbisogno WHERE reparto_id = p_reparto AND schema_num = p_from;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION copia_schema(uuid, integer, integer) TO authenticated;
