-- 043_turni_dinamici.sql
-- Fase 1 — motore dinamico: la generazione dal NUOVO schema scrive il turno
-- "vero" del nuovo modello (turno_sigla) e le proprietà attive (proprieta),
-- OLTRE alle colonne vecchie derivate (turno_clinico, slot_mattina/pomeriggio…)
-- che restano popolate per compatibilità con 11N e le viste attuali durante la
-- transizione. Additivo: nessun impatto sui dati esistenti.
ALTER TABLE turni ADD COLUMN IF NOT EXISTS turno_sigla text;                       -- es. 'M','P','L','REP','Swing'
ALTER TABLE turni ADD COLUMN IF NOT EXISTS proprieta   jsonb NOT NULL DEFAULT '[]'::jsonb;  -- es. ["SUB"] / ["MED"]
