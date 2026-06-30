-- 040_schema_meta_azzera_elimina.sql
-- (A) schema_meta: titolo dello schema (per riconoscerlo), per (reparto, schema_num).
-- (B) azzera_schema: svuota il CONTENUTO dello schema (tiene il titolo).
-- (C) elimina_schema: cancella lo schema E rinumera (chiude il buco), titolo incluso.
-- La rinumerazione usa la negazione in 2 fasi per evitare collisioni sulle UNIQUE
-- (i vincoli non sono deferrable: uno shift diretto x->x-1 puo' violare temporaneamente).

-- ── (A) Tabella titoli ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS schema_meta (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reparto_id uuid    NOT NULL REFERENCES reparti(id) ON DELETE CASCADE,
  schema_num integer NOT NULL,
  titolo     text    NOT NULL DEFAULT '',
  UNIQUE (reparto_id, schema_num)
);

ALTER TABLE schema_meta ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS schema_meta_select ON schema_meta;
CREATE POLICY schema_meta_select ON schema_meta FOR SELECT TO authenticated USING (puo_vedere_reparto(reparto_id));
DROP POLICY IF EXISTS schema_meta_all ON schema_meta;
CREATE POLICY schema_meta_all ON schema_meta FOR ALL TO authenticated USING (puo_gestire_reparto(reparto_id)) WITH CHECK (puo_gestire_reparto(reparto_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON schema_meta TO authenticated;

-- ── (B) Azzera: svuota il contenuto, tiene il titolo ────────────────
CREATE OR REPLACE FUNCTION azzera_schema(p_reparto uuid, p_num integer)
RETURNS void AS $$
DECLARE t text;
BEGIN
  IF NOT puo_gestire_reparto(p_reparto) THEN RAISE EXCEPTION 'Permesso negato'; END IF;
  FOREACH t IN ARRAY ARRAY['schema_cella','schema_giorno_colonna','schema_colonna',
                           'schema_giorno','schema_fabbisogno','tipi_turno','proprieta_turno'] LOOP
    EXECUTE format('DELETE FROM %I WHERE reparto_id=$1 AND schema_num=$2', t) USING p_reparto, p_num;
  END LOOP;
  -- schema_meta (titolo) NON viene toccato.
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
GRANT EXECUTE ON FUNCTION azzera_schema(uuid, integer) TO authenticated;

-- ── (C) Elimina: cancella + rinumera (chiude il buco) ───────────────
CREATE OR REPLACE FUNCTION elimina_schema(p_reparto uuid, p_num integer)
RETURNS void AS $$
DECLARE t text;
BEGIN
  IF NOT puo_gestire_reparto(p_reparto) THEN RAISE EXCEPTION 'Permesso negato'; END IF;
  FOREACH t IN ARRAY ARRAY['schema_cella','schema_giorno_colonna','schema_colonna',
                           'schema_giorno','schema_fabbisogno','tipi_turno','proprieta_turno','schema_meta'] LOOP
    EXECUTE format('DELETE FROM %I WHERE reparto_id=$1 AND schema_num=$2', t) USING p_reparto, p_num;
    -- Fase 1: nega gli schemi successivi (nessuna collisione tra negativi e positivi).
    EXECUTE format('UPDATE %I SET schema_num = -schema_num WHERE reparto_id=$1 AND schema_num > $2', t) USING p_reparto, p_num;
    -- Fase 2: riporta a positivo scalato di 1 (-4 -> 3, -5 -> 4 …).
    EXECUTE format('UPDATE %I SET schema_num = (-schema_num) - 1 WHERE reparto_id=$1 AND schema_num < 0', t) USING p_reparto;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
GRANT EXECUTE ON FUNCTION elimina_schema(uuid, integer) TO authenticated;
