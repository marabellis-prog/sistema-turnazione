-- Migration 005 — Impostazioni numero medici per slot/giorno-tipo
--
-- Contesto:
-- Per il check "inconsistenze nei turni" in ModificaTurniPage serve un
-- valore di riferimento di QUANTI medici devono essere presenti in
-- ciascun placement (SUB / MED) × meta` giornata (mattina / pomeriggio)
-- × tipo di giorno (feriale / festivo+domenica).
--
-- Esempio: feriale, mattina, SUB = 2 medici (potrebbero essere uno con
-- M e uno con L, entrambi contribuiscono al count della mattina).
--
-- Le 8 colonne sono INTEGER NOT NULL DEFAULT 0. Convenzione: valore
-- 0 = "nessun controllo per questo slot" (niente warning generato).
-- Solo valori > 0 attivano la verifica.

ALTER TABLE public.configurazione
  ADD COLUMN IF NOT EXISTS sub_mattina_feriale    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sub_mattina_festivo    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sub_pomeriggio_feriale INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sub_pomeriggio_festivo INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS med_mattina_feriale    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS med_mattina_festivo    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS med_pomeriggio_feriale INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS med_pomeriggio_festivo INTEGER NOT NULL DEFAULT 0;
