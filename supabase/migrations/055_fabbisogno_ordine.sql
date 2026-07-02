-- 055_fabbisogno_ordine.sql
--
-- Fabbisogno ordinabile: aggiunge `ordine` a schema_fabbisogno. L'ordine
-- definisce la PRECEDENZA di override tra ambiti quando un giorno ne combacia
-- più d'uno (es. un festivo che cade di sabato): vince l'ambito con ordine più
-- ALTO (l'ultimo nella cascata "…viene sovrascritto da…"). Riguarda SOLO il
-- controllo copertura (la generazione usa la griglia dello schema, non il
-- fabbisogno). Il default riproduce il comportamento storico:
--   normale(0) < prefestivo(1) < sabato(2) < festivi(3).

ALTER TABLE schema_fabbisogno ADD COLUMN IF NOT EXISTS ordine int NOT NULL DEFAULT 0;

-- Backfill coerente col vecchio ambitoGiorno (festivi vinceva su sabato).
UPDATE schema_fabbisogno SET ordine = CASE ambito
  WHEN 'normale'    THEN 0
  WHEN 'prefestivo' THEN 1
  WHEN 'sabato'     THEN 2
  WHEN 'festivi'    THEN 3
  ELSE 4 END
WHERE ordine = 0;

-- RPC di salvataggio schema: persiste anche `ordine` del fabbisogno.
CREATE OR REPLACE FUNCTION public.salva_schema_struttura(p_reparto uuid, p_num integer, p_giorni jsonb, p_colonne jsonb, p_checks jsonb, p_celle jsonb, p_fabbisogno jsonb)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  IF NOT puo_gestire_reparto(p_reparto) THEN RAISE EXCEPTION 'Permesso negato'; END IF;
  IF schema_in_uso(p_reparto, p_num) THEN
    RAISE EXCEPTION 'Schema % in uso nella turnazione attiva: duplicalo per modificarlo', p_num;
  END IF;

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

  INSERT INTO schema_fabbisogno (reparto_id, schema_num, ambito, turno_sigla, totale, per_proprieta, ordine)
    SELECT p_reparto, p_num, x->>'ambito', x->>'turno_sigla',
           COALESCE((x->>'totale')::int, 0), COALESCE(x->'per_proprieta', '{}'::jsonb),
           COALESCE((x->>'ordine')::int, 0)
    FROM jsonb_array_elements(p_fabbisogno) x;
END;
$function$;
