-- Migration 013 — Soglie "Supporto" (jolly) + impostazioni con validità
--
-- Contesto:
-- 1) Il check di coerenza dei turni aggiunge una terza categoria oltre a
--    SUB/MED: il "Supporto" (jolly) = cella che lavora (M/P/L) ma senza
--    assegnazione SUB/MED (slot null). Servono le 4 soglie attese come
--    per sub/med (mattina/pomeriggio × feriale/festivo).
-- 2) Le soglie diventano "datate": dopo un Aggiorna turnazione coesistono
--    composizioni diverse, quindi le nuove soglie devono valere solo da
--    una certa data in poi (le vecchie restano per i giorni precedenti).
--    Il check sceglie le soglie giuste per ogni giorno.

ALTER TABLE public.configurazione
  -- Soglie Supporto (jolly), default 0 = nessun controllo
  ADD COLUMN IF NOT EXISTS sup_mattina_feriale    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sup_mattina_festivo    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sup_pomeriggio_feriale INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sup_pomeriggio_festivo INTEGER NOT NULL DEFAULT 0,
  -- Data da cui valgono le soglie CORRENTI (colonne sub/med/sup_*).
  -- null = valgono da sempre (comportamento storico).
  ADD COLUMN IF NOT EXISTS impostazioni_valido_dal DATE,
  -- Epoche passate delle soglie: array di
  --   { valido_dal: ISO|null, valido_fino: ISO (esclusivo), soglie: {12 numeri} }
  ADD COLUMN IF NOT EXISTS impostazioni_storico   JSONB NOT NULL DEFAULT '[]'::jsonb;
