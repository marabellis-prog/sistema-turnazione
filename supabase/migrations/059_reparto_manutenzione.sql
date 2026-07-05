-- 059_reparto_manutenzione.sql
-- Modalità "in manutenzione" per-reparto: quando attiva, le viste PUBBLICHE del
-- reparto mostrano un messaggio di manutenzione a TUTTI tranne super-admin e
-- responsabili di QUEL reparto. Toggle dal Centro di Controllo (is_super_admin).
ALTER TABLE reparti ADD COLUMN IF NOT EXISTS in_manutenzione boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN reparti.in_manutenzione IS
  'Se true, le viste pubbliche del reparto mostrano un messaggio di manutenzione a tutti tranne super-admin e responsabili del reparto.';
