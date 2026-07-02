-- 056_salva_fabbisogno.sql
--
-- Il FABBISOGNO non tocca i turni generati: serve solo al controllo copertura
-- (avvisi atteso/presente). Quindi dev'essere modificabile ANCHE quando lo
-- schema è in uso da una turnazione attiva (a differenza della struttura, che
-- resta protetta da salva_schema_struttura + schema_in_uso).
--
-- Questa RPC salva SOLO schema_fabbisogno per (reparto, schema), senza la
-- guardia schema_in_uso. Permesso: chi gestisce il reparto.

CREATE OR REPLACE FUNCTION public.salva_fabbisogno(p_reparto uuid, p_num integer, p_fabbisogno jsonb)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  IF NOT puo_gestire_reparto(p_reparto) THEN RAISE EXCEPTION 'Permesso negato'; END IF;
  DELETE FROM schema_fabbisogno WHERE reparto_id = p_reparto AND schema_num = p_num;
  INSERT INTO schema_fabbisogno (reparto_id, schema_num, ambito, turno_sigla, totale, per_proprieta, ordine)
    SELECT p_reparto, p_num, x->>'ambito', x->>'turno_sigla',
           COALESCE((x->>'totale')::int, 0), COALESCE(x->'per_proprieta', '{}'::jsonb),
           COALESCE((x->>'ordine')::int, 0)
    FROM jsonb_array_elements(p_fabbisogno) x;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.salva_fabbisogno(uuid, integer, jsonb) TO authenticated;
