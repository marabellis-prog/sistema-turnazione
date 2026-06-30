-- 035_schema_fabbisogno.sql
-- Fabbisogno giornaliero PER-SCHEMA (parte dello "schema = unità auto-contenuta").
-- Quanti SUB/MED/Supporto servono per fascia (mattina/pomeriggio) e tipo-giorno
-- (feriale/sabato/festivo). Una riga per (reparto, schema_num). Specchia le
-- soglie che oggi stanno su configurazione, ma legate allo SCHEMA.
CREATE TABLE IF NOT EXISTS schema_fabbisogno (
  id          uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  reparto_id  uuid    NOT NULL REFERENCES reparti(id) ON DELETE CASCADE,
  schema_num  integer NOT NULL,
  -- SUB
  sub_mattina_feriale int NOT NULL DEFAULT 0, sub_pomeriggio_feriale int NOT NULL DEFAULT 0,
  sub_mattina_sabato  int NOT NULL DEFAULT 0, sub_pomeriggio_sabato  int NOT NULL DEFAULT 0,
  sub_mattina_festivo int NOT NULL DEFAULT 0, sub_pomeriggio_festivo int NOT NULL DEFAULT 0,
  -- MED
  med_mattina_feriale int NOT NULL DEFAULT 0, med_pomeriggio_feriale int NOT NULL DEFAULT 0,
  med_mattina_sabato  int NOT NULL DEFAULT 0, med_pomeriggio_sabato  int NOT NULL DEFAULT 0,
  med_mattina_festivo int NOT NULL DEFAULT 0, med_pomeriggio_festivo int NOT NULL DEFAULT 0,
  -- Supporto (jolly)
  sup_mattina_feriale int NOT NULL DEFAULT 0, sup_pomeriggio_feriale int NOT NULL DEFAULT 0,
  sup_mattina_sabato  int NOT NULL DEFAULT 0, sup_pomeriggio_sabato  int NOT NULL DEFAULT 0,
  sup_mattina_festivo int NOT NULL DEFAULT 0, sup_pomeriggio_festivo int NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (reparto_id, schema_num)
);

ALTER TABLE schema_fabbisogno ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sf_select ON schema_fabbisogno;
CREATE POLICY sf_select ON schema_fabbisogno FOR SELECT TO authenticated
  USING (puo_vedere_reparto(reparto_id));
DROP POLICY IF EXISTS sf_all ON schema_fabbisogno;
CREATE POLICY sf_all ON schema_fabbisogno FOR ALL TO authenticated
  USING (puo_gestire_reparto(reparto_id)) WITH CHECK (puo_gestire_reparto(reparto_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON schema_fabbisogno TO authenticated;
