-- 029_reparto_nazione.sql
-- Nazione per-reparto: guida le festività NAZIONALI (due reparti possono
-- stare in nazioni diverse). Default 'IT'. Le festività custom restano
-- per-reparto (festivita_custom).
ALTER TABLE reparti ADD COLUMN IF NOT EXISTS nazione text NOT NULL DEFAULT 'IT';
