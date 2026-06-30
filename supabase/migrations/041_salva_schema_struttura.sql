-- 041_salva_schema_struttura.sql
-- Salvataggio ATOMICO dell'intero schema (struttura + celle) dal Designer:
-- il client tiene tutto in un draft locale (niente autosave) e con "Salva schema"
-- invia giorni + colonne + checkbox + celle; la RPC sostituisce il contenuto
-- dello schema (full-replace) in transazione.

CREATE OR REPLACE FUNCTION salva_schema_struttura(
  p_reparto uuid, p_num integer,
  p_giorni jsonb, p_colonne jsonb, p_checks jsonb, p_celle jsonb
) RETURNS void AS $$
BEGIN
  IF NOT puo_gestire_reparto(p_reparto) THEN RAISE EXCEPTION 'Permesso negato'; END IF;

  DELETE FROM schema_cella          WHERE reparto_id = p_reparto AND schema_num = p_num;
  DELETE FROM schema_giorno_colonna WHERE reparto_id = p_reparto AND schema_num = p_num;
  DELETE FROM schema_colonna        WHERE reparto_id = p_reparto AND schema_num = p_num;
  DELETE FROM schema_giorno         WHERE reparto_id = p_reparto AND schema_num = p_num;

  INSERT INTO schema_giorno (reparto_id, schema_num, giorno_settimana, ordine)
    SELECT p_reparto, p_num, (x->>'giorno_settimana')::int, COALESCE((x->>'ordine')::int, 0)
    FROM jsonb_array_elements(p_giorni) x;

  INSERT INTO schema_colonna (reparto_id, schema_num, tipo, sigla, ordine)
    SELECT p_reparto, p_num, x->>'tipo', x->>'sigla', COALESCE((x->>'ordine')::int, 0)
    FROM jsonb_array_elements(p_colonne) x;

  -- checks = solo le caselle SPUNTATE (attivo=true).
  INSERT INTO schema_giorno_colonna (reparto_id, schema_num, giorno_settimana, colonna_sigla, attivo)
    SELECT p_reparto, p_num, (x->>'giorno_settimana')::int, x->>'colonna_sigla', true
    FROM jsonb_array_elements(p_checks) x;

  INSERT INTO schema_cella (reparto_id, schema_num, giorno_settimana, slot_idx, colonna_sigla, numero, attivo)
    SELECT p_reparto, p_num, (x->>'giorno_settimana')::int, (x->>'slot_idx')::int, x->>'colonna_sigla',
           NULLIF(x->>'numero','')::int, COALESCE((x->>'attivo')::boolean, false)
    FROM jsonb_array_elements(p_celle) x;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION salva_schema_struttura(uuid, integer, jsonb, jsonb, jsonb, jsonb) TO authenticated;
