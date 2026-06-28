-- 019: Fondamenta multi-reparto (Fase 1 della "rivoluzione")
--
-- ADDITIVO: non rompe l'app esistente. I dati attuali confluiscono nel
-- reparto "11N" (id fisso). reparto_id ha DEFAULT = 11N, cosi' gli INSERT
-- esistenti (che non lo specificano) restano scoperti al reparto giusto e
-- l'app continua a funzionare mentre evolviamo il codice.
--
-- Modello: utenti GLOBALI = utenti_autorizzati (email, ruolo admin/user/
-- ospite). Turnisti PER-REPARTO = medici (+ reparto_id, + utente_id link al
-- globale). Responsabili per-reparto = reparto_responsabili.

-- ── 1. Tabella reparti + seed "11N" (id fisso) ───────────────────────
CREATE TABLE IF NOT EXISTS reparti (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome       text NOT NULL,
  attivo     boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);
INSERT INTO reparti (id, nome)
VALUES ('11111111-1111-4111-8111-111111111111', '11N')
ON CONFLICT (id) DO NOTHING;

-- ── 2. reparto_id su tutte le tabelle dati (DEFAULT 11N = backfill auto) ─
ALTER TABLE medici               ADD COLUMN IF NOT EXISTS reparto_id uuid NOT NULL DEFAULT '11111111-1111-4111-8111-111111111111' REFERENCES reparti(id);
ALTER TABLE configurazione       ADD COLUMN IF NOT EXISTS reparto_id uuid NOT NULL DEFAULT '11111111-1111-4111-8111-111111111111' REFERENCES reparti(id);
ALTER TABLE schemi_modello       ADD COLUMN IF NOT EXISTS reparto_id uuid NOT NULL DEFAULT '11111111-1111-4111-8111-111111111111' REFERENCES reparti(id);
ALTER TABLE turni                ADD COLUMN IF NOT EXISTS reparto_id uuid NOT NULL DEFAULT '11111111-1111-4111-8111-111111111111' REFERENCES reparti(id);
ALTER TABLE cambi_turno          ADD COLUMN IF NOT EXISTS reparto_id uuid NOT NULL DEFAULT '11111111-1111-4111-8111-111111111111' REFERENCES reparti(id);
ALTER TABLE ferie                ADD COLUMN IF NOT EXISTS reparto_id uuid NOT NULL DEFAULT '11111111-1111-4111-8111-111111111111' REFERENCES reparti(id);
ALTER TABLE festivita_custom     ADD COLUMN IF NOT EXISTS reparto_id uuid NOT NULL DEFAULT '11111111-1111-4111-8111-111111111111' REFERENCES reparti(id);
ALTER TABLE turnazione_anteprima ADD COLUMN IF NOT EXISTS reparto_id uuid NOT NULL DEFAULT '11111111-1111-4111-8111-111111111111' REFERENCES reparti(id);
ALTER TABLE turni_backup         ADD COLUMN IF NOT EXISTS reparto_id uuid NOT NULL DEFAULT '11111111-1111-4111-8111-111111111111' REFERENCES reparti(id);

-- ── 3. Link turnista (medico) ↔ utente globale (per Fase 2) ──────────
ALTER TABLE medici ADD COLUMN IF NOT EXISTS utente_id uuid REFERENCES utenti_autorizzati(id) ON DELETE SET NULL;

-- ── 4. Responsabili per-reparto ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS reparto_responsabili (
  reparto_id uuid NOT NULL REFERENCES reparti(id) ON DELETE CASCADE,
  utente_id  uuid NOT NULL REFERENCES utenti_autorizzati(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (reparto_id, utente_id)
);

-- ── 5. Indici per lo scoping ─────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_medici_reparto ON medici(reparto_id);
CREATE INDEX IF NOT EXISTS idx_turni_reparto  ON turni(reparto_id);
CREATE INDEX IF NOT EXISTS idx_schemi_reparto ON schemi_modello(reparto_id);
CREATE INDEX IF NOT EXISTS idx_ferie_reparto  ON ferie(reparto_id);
CREATE INDEX IF NOT EXISTS idx_cambi_reparto  ON cambi_turno(reparto_id);

-- ── 6. Helper RLS per-reparto (additivi; policy strette in Fase 2) ────
CREATE OR REPLACE FUNCTION is_super_admin() RETURNS boolean AS $$
  SELECT EXISTS (SELECT 1 FROM utenti_autorizzati
                 WHERE email = (auth.jwt() ->> 'email') AND ruolo = 'admin' AND attivo)
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION mio_utente_id() RETURNS uuid AS $$
  SELECT id FROM utenti_autorizzati WHERE email = (auth.jwt() ->> 'email')
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION puo_gestire_reparto(pid uuid) RETURNS boolean AS $$
  SELECT is_super_admin() OR EXISTS (
    SELECT 1 FROM reparto_responsabili rr
    WHERE rr.reparto_id = pid AND rr.utente_id = mio_utente_id())
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION puo_vedere_reparto(pid uuid) RETURNS boolean AS $$
  SELECT puo_gestire_reparto(pid) OR EXISTS (
    SELECT 1 FROM medici m WHERE m.reparto_id = pid AND m.utente_id = mio_utente_id())
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ── 7. RLS + grant per le tabelle nuove ──────────────────────────────
ALTER TABLE reparti              ENABLE ROW LEVEL SECURITY;
ALTER TABLE reparto_responsabili ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS reparti_select ON reparti;
DROP POLICY IF EXISTS reparti_modify ON reparti;
CREATE POLICY reparti_select ON reparti FOR SELECT USING (is_utente_attivo());
CREATE POLICY reparti_modify ON reparti FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());
DROP POLICY IF EXISTS rr_select ON reparto_responsabili;
DROP POLICY IF EXISTS rr_modify ON reparto_responsabili;
CREATE POLICY rr_select ON reparto_responsabili FOR SELECT USING (is_utente_attivo());
CREATE POLICY rr_modify ON reparto_responsabili FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON reparti              TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON reparto_responsabili TO authenticated;
GRANT EXECUTE ON FUNCTION is_super_admin()          TO authenticated, anon;
GRANT EXECUTE ON FUNCTION mio_utente_id()           TO authenticated, anon;
GRANT EXECUTE ON FUNCTION puo_gestire_reparto(uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION puo_vedere_reparto(uuid)  TO authenticated, anon;
