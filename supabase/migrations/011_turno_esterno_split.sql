-- Migration 011 — Split del turno 'E' in EM / EP / EL
--
-- Sostituisce il singolo valore 'E' (ceduto a Esterno) con tre varianti
-- analoghe a M/P/L:
--   - EM = Esterno Mattina       (come M, solo mattina rilevante)
--   - EP = Esterno Pomeriggio    (come P, solo pomeriggio rilevante)
--   - EL = Esterno Lungo (M+P)   (come L, mattina + pomeriggio)
--
-- Migrazione dati: eventuali righe con turno_clinico='E' (test fatti
-- dalla migration 010) vengono convertite in 'EL' che e` la variante
-- "piena" — coerente con il comportamento precedente di 'E' che gia`
-- copriva mattina + pomeriggio.

-- Drop vecchio CHECK
ALTER TABLE public.turni
  DROP CONSTRAINT IF EXISTS turni_turno_clinico_check;

-- Migra dati: 'E' -> 'EL'
UPDATE public.turni SET turno_clinico = 'EL' WHERE turno_clinico = 'E';

-- Nuovo CHECK con le tre varianti
ALTER TABLE public.turni
  ADD CONSTRAINT turni_turno_clinico_check
  CHECK (turno_clinico IN ('M','P','L','REP','EM','EP','EL',''));
