-- 031_schemi_unita.sql
-- Schema come UNITÀ AUTO-CONTENUTA: oltre alla struttura (schemi_modello) e
-- alle regole/fabbisogno (prossima migration), ogni schema porta la sua
-- VALIDITÀ (valido_dal/valido_al) e un nome. Additivo: non tocca la
-- generazione attuale (11N continua a usare schema_attivo + schema_storico).
CREATE TABLE IF NOT EXISTS schemi (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  reparto_id    uuid        NOT NULL REFERENCES reparti(id) ON DELETE CASCADE,
  schema_num    integer     NOT NULL,
  nome          text,
  valido_dal    date,                 -- da quando si applica (null = sempre)
  valido_al     date,                 -- fino a quando (null = aperto)
  durata_giorni integer,              -- durata indicativa del ciclo (opzionale)
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (reparto_id, schema_num)
);

-- Seed: una riga per ogni (reparto, schema_num) già presente negli slot.
INSERT INTO schemi (reparto_id, schema_num, nome)
SELECT DISTINCT reparto_id, schema_num, 'Schema ' || schema_num
FROM schemi_modello
ON CONFLICT (reparto_id, schema_num) DO NOTHING;

ALTER TABLE schemi ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS schemi_select ON schemi;
CREATE POLICY schemi_select ON schemi FOR SELECT TO authenticated
  USING (puo_vedere_reparto(reparto_id));
DROP POLICY IF EXISTS schemi_all ON schemi;
CREATE POLICY schemi_all ON schemi FOR ALL TO authenticated
  USING (puo_gestire_reparto(reparto_id)) WITH CHECK (puo_gestire_reparto(reparto_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON schemi TO authenticated;
