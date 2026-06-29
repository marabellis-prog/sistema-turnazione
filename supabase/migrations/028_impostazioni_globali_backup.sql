-- 028_impostazioni_globali_backup.sql
-- La POLICY di backup (ogni quanti giorni, quanti tenerne) diventa una
-- impostazione GLOBALE/centrale decisa dal super-admin in Centro di Controllo.
-- I backup e i ripristini restano PER-REPARTO (gestione in Backup/Ripristino).

-- Tabella singleton: una sola riga (id = true).
CREATE TABLE IF NOT EXISTS impostazioni_globali (
  id                        boolean      PRIMARY KEY DEFAULT true,
  backup_intervallo_giorni  integer      NOT NULL DEFAULT 7,   -- 0 = auto-backup off
  backup_da_tenere          integer      NOT NULL DEFAULT 10,
  updated_at                timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT impostazioni_globali_singleton CHECK (id)
);

-- Seed: preserva i valori già impostati sul reparto seed 11N (se presenti).
INSERT INTO impostazioni_globali (id, backup_intervallo_giorni, backup_da_tenere)
SELECT true,
       COALESCE((SELECT backup_intervallo_giorni FROM configurazione
                 WHERE reparto_id = '11111111-1111-4111-8111-111111111111'
                 ORDER BY updated_at DESC LIMIT 1), 7),
       COALESCE((SELECT backup_da_tenere FROM configurazione
                 WHERE reparto_id = '11111111-1111-4111-8111-111111111111'
                 ORDER BY updated_at DESC LIMIT 1), 10)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE impostazioni_globali ENABLE ROW LEVEL SECURITY;

-- Lettura: chiunque sia autenticato (serve all'auto-backup e alla UI).
DROP POLICY IF EXISTS ig_select ON impostazioni_globali;
CREATE POLICY ig_select ON impostazioni_globali
  FOR SELECT TO authenticated USING (true);

-- Modifica: solo super-admin (helper di migr. 019).
DROP POLICY IF EXISTS ig_update ON impostazioni_globali;
CREATE POLICY ig_update ON impostazioni_globali
  FOR UPDATE TO authenticated
  USING (is_super_admin()) WITH CHECK (is_super_admin());

GRANT SELECT, UPDATE ON impostazioni_globali TO authenticated;
