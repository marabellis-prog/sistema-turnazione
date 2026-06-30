-- 042_salva_schema_con_fabbisogno.sql
-- Il FABBISOGNO entra nel salvataggio dello schema (niente più autosave):
-- salva_schema_struttura ora riceve anche p_fabbisogno e sostituisce
-- schema_fabbisogno insieme al resto, in transazione.
-- Si rimpiazza la firma a 6 arg con quella a 7 (drop esplicito dell'overload).

DROP FUNCTION IF EXISTS salva_schema_struttura(uuid, integer, jsonb, jsonb, jsonb, jsonb);

CREATE OR REPLACE FUNCTION salva_schema_struttura(
  p_reparto uuid, p_num integer,
  p_giorni jsonb, p_colonne jsonb, p_checks jsonb, p_celle jsonb, p_fabbisogno jsonb
) RETURNS void AS $$
BEGIN
  IF NOT puo_gestire_reparto(p_reparto) THEN RAISE EXCEPTION 'Permesso negato'; END IF;

  DELETE FROM schema_cella          WHERE reparto_id = p_reparto AND schema_num = p_num;
  DELETE FROM schema_giorno_colonna WHERE reparto_id = p_reparto AND schema_num = p_num;
  DELETE FROM schema_colonna        WHERE reparto_id = p_reparto AND schema_num = p_num;
  DELETE FROM schema_giorno         WHERE reparto_id = p_reparto AND schema_num = p_num;
  DELETE FROM schema_fabbisogno     WHERE reparto_id = p_reparto AND schema_num = p_num;

  INSERT INTO schema_giorno (reparto_id, schema_num, giorno_settimana, ordine)
    SELECT p_reparto, p_num, (x->>'giorno_settimana')::int, COALESCE((x->>'ordine')::int, 0)
    FROM jsonb_array_elements(p_giorni) x;

  INSERT INTO schema_colonna (reparto_id, schema_num, tipo, sigla, ordine)
    SELECT p_reparto, p_num, x->>'tipo', x->>'sigla', COALESCE((x->>'ordine')::int, 0)
    FROM jsonb_array_elements(p_colonne) x;

  INSERT INTO schema_giorno_colonna (reparto_id, schema_num, giorno_settimana, colonna_sigla, attivo)
    SELECT p_reparto, p_num, (x->>'giorno_settimana')::int, x->>'colonna_sigla', true
    FROM jsonb_array_elements(p_checks) x;

  INSERT INTO schema_cella (reparto_id, schema_num, giorno_settimana, slot_idx, colonna_sigla, numero, attivo)
    SELECT p_reparto, p_num, (x->>'giorno_settimana')::int, (x->>'slot_idx')::int, x->>'colonna_sigla',
           NULLIF(x->>'numero','')::int, COALESCE((x->>'attivo')::boolean, false)
    FROM jsonb_array_elements(p_celle) x;

  INSERT INTO schema_fabbisogno (reparto_id, schema_num, ambito, turno_sigla, totale, per_proprieta)
    SELECT p_reparto, p_num, x->>'ambito', x->>'turno_sigla',
           COALESCE((x->>'totale')::int, 0), COALESCE(x->'per_proprieta', '{}'::jsonb)
    FROM jsonb_array_elements(p_fabbisogno) x;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION salva_schema_struttura(uuid, integer, jsonb, jsonb, jsonb, jsonb, jsonb) TO authenticated;
