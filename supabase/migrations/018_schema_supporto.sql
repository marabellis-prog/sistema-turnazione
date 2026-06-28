-- 018: flag "Supporto" sugli slot dello schema (Disegna Schema)
--
-- Colonna opzionale: marca uno slot come "Supporto" (jolly grigio, lavora
-- senza assegnazione SUB/MED). Mutuamente esclusiva con SUB/MED nel designer.
-- Default false = comportamento storico.

ALTER TABLE schemi_modello
  ADD COLUMN IF NOT EXISTS is_supporto BOOLEAN NOT NULL DEFAULT false;
