-- Migration 010 — Aggiunge turno 'E' (ceduto a Esterno)
--
-- Nuovo valore di `turno_clinico`: 'E' significa "Turno ceduto ad un
-- Esterno" (medico non in elenco). Lato logica e` un turno coperto:
--   - non genera buco per le ferie (la cella e` coperta da esterno)
--   - conta 1 nel riepilogo turni (come M, P, REP)
--   - mantiene comunque i placement SUB/MED (mattina + pomeriggio),
--     quindi il chip di inconsistenza "manca SUB/MED" compare
--     finche` non si setta il placement.

ALTER TABLE public.turni
  DROP CONSTRAINT IF EXISTS turni_turno_clinico_check;

ALTER TABLE public.turni
  ADD CONSTRAINT turni_turno_clinico_check
  CHECK (turno_clinico IN ('M','P','L','REP','E',''));
