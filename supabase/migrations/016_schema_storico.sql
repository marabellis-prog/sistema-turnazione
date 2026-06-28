-- 016: storico degli switch di schema
--
-- Serve alla sidebar admin per mostrare "Schema Attivo: N" oppure, dopo uno o
-- piu' "Aggiorna turnazione", "Schemi aggiornati" con l'elenco cronologico
-- degli schemi che si sono susseguiti e il giorno dello switch.
--
-- Formato: [{ "schema": <int>, "dal": "YYYY-MM-DD" }, ...] in ordine cronologico.
--  - una GENERAZIONE completa resetta a un solo elemento (schema, data_inizio);
--  - ogni AGGIORNA TURNAZIONE approvato appende { schema_nuovo, cutover }.

ALTER TABLE configurazione
  ADD COLUMN IF NOT EXISTS schema_storico JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN configurazione.schema_storico IS
  'Cronologia schemi [{schema, dal(ISO)}]. Generazione completa = 1 elemento; ogni Aggiorna turnazione approvato appende lo switch (schema_nuovo, cutover).';
