-- 035_schema_design_dinamico.sql
-- Nuovo modello "schema = unità auto-contenuta" con COLONNE DINAMICHE PER-GIORNO.
-- Lo schema (schemi.schema_num) si compone di:
--   1) colonne scelte giorno per giorno (turni + flag, dai Tipi di turno)
--   2) celle = valori degli slot (numero medico nelle colonne-turno, flag attivi)
--   3) fabbisogno = conteggio dichiarato per (giorno|speciale, turno) + ripartizione
-- Additivo: NON tocca schemi_modello (il modello vecchio resta per 11N).

-- 1) Colonne scelte per ogni giorno dello schema (turni e flag).
CREATE TABLE IF NOT EXISTS schema_colonna (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reparto_id       uuid    NOT NULL REFERENCES reparti(id) ON DELETE CASCADE,
  schema_num       integer NOT NULL,
  giorno_settimana integer NOT NULL,                 -- 1=Lun … 7=Dom
  tipo             text    NOT NULL CHECK (tipo IN ('turno','flag')),
  sigla            text    NOT NULL,                  -- es. M, P, L, REP, SUB, MED, SUP
  ordine           integer NOT NULL DEFAULT 0,
  UNIQUE (reparto_id, schema_num, giorno_settimana, sigla)
);

-- 2) Celle: per (giorno, slot, colonna) → numero medico (colonne-turno) o flag attivo.
CREATE TABLE IF NOT EXISTS schema_cella (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reparto_id       uuid    NOT NULL REFERENCES reparti(id) ON DELETE CASCADE,
  schema_num       integer NOT NULL,
  giorno_settimana integer NOT NULL,
  slot_idx         integer NOT NULL,                  -- riga
  colonna_sigla    text    NOT NULL,
  numero           integer,                           -- numero medico (colonna-turno)
  attivo           boolean NOT NULL DEFAULT false,    -- flag spuntato (colonna-flag)
  UNIQUE (reparto_id, schema_num, giorno_settimana, slot_idx, colonna_sigla)
);

-- 3) Fabbisogno dichiarato (conteggio visivo) per ambito × turno.
--    ambito = 'giorno:1'…'giorno:7' (Fabbisogno Normale) oppure
--             'prefestivo' | 'sabato' | 'festivi' (override).
--    per_proprieta = {"SUB":1,"MED":1,"SUP":0} (ripartizione del totale).
CREATE TABLE IF NOT EXISTS schema_fabbisogno (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reparto_id    uuid    NOT NULL REFERENCES reparti(id) ON DELETE CASCADE,
  schema_num    integer NOT NULL,
  ambito        text    NOT NULL,
  turno_sigla   text    NOT NULL,
  totale        integer NOT NULL DEFAULT 0,
  per_proprieta jsonb   NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (reparto_id, schema_num, ambito, turno_sigla)
);

-- RLS per-reparto su tutte e tre.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['schema_colonna','schema_cella','schema_fabbisogno'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_select ON %I', t, t);
    EXECUTE format('CREATE POLICY %I_select ON %I FOR SELECT TO authenticated USING (puo_vedere_reparto(reparto_id))', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_all ON %I', t, t);
    EXECUTE format('CREATE POLICY %I_all ON %I FOR ALL TO authenticated USING (puo_gestire_reparto(reparto_id)) WITH CHECK (puo_gestire_reparto(reparto_id))', t, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO authenticated', t);
  END LOOP;
END $$;
