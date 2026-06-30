-- 036_schema_matrice.sql
-- Schema = MATRICE giorni (righe) × colonne (turni+flag, globali e draggabili),
-- con una CHECKBOX per ogni cella (il giorno "ha" quel turno/flag se spuntata).
-- Rivede schema_colonna (da per-giorno a globale) + aggiunge schema_giorno
-- (le righe) e schema_giorno_colonna (le checkbox). schema_cella/fabbisogno
-- restano per le tappe successive (slot/numeri + fabbisogno).

DROP TABLE IF EXISTS schema_colonna;

-- Righe = giorni dello schema, in ordine di inserimento.
CREATE TABLE IF NOT EXISTS schema_giorno (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reparto_id       uuid    NOT NULL REFERENCES reparti(id) ON DELETE CASCADE,
  schema_num       integer NOT NULL,
  giorno_settimana integer NOT NULL,         -- 1=Lun … 7=Dom
  ordine           integer NOT NULL DEFAULT 0,
  UNIQUE (reparto_id, schema_num, giorno_settimana)
);

-- Colonne GLOBALI dello schema (turni + flag), ordine = draggabile.
CREATE TABLE IF NOT EXISTS schema_colonna (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reparto_id  uuid    NOT NULL REFERENCES reparti(id) ON DELETE CASCADE,
  schema_num  integer NOT NULL,
  tipo        text    NOT NULL CHECK (tipo IN ('turno','flag')),
  sigla       text    NOT NULL,
  ordine      integer NOT NULL DEFAULT 0,
  UNIQUE (reparto_id, schema_num, sigla)
);

-- Checkbox per (giorno, colonna): il giorno usa quel turno/flag?
CREATE TABLE IF NOT EXISTS schema_giorno_colonna (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reparto_id       uuid    NOT NULL REFERENCES reparti(id) ON DELETE CASCADE,
  schema_num       integer NOT NULL,
  giorno_settimana integer NOT NULL,
  colonna_sigla    text    NOT NULL,
  attivo           boolean NOT NULL DEFAULT false,
  UNIQUE (reparto_id, schema_num, giorno_settimana, colonna_sigla)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['schema_giorno','schema_colonna','schema_giorno_colonna'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_select ON %I', t, t);
    EXECUTE format('CREATE POLICY %I_select ON %I FOR SELECT TO authenticated USING (puo_vedere_reparto(reparto_id))', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_all ON %I', t, t);
    EXECUTE format('CREATE POLICY %I_all ON %I FOR ALL TO authenticated USING (puo_gestire_reparto(reparto_id)) WITH CHECK (puo_gestire_reparto(reparto_id))', t, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO authenticated', t);
  END LOOP;
END $$;
