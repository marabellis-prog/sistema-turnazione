-- ============================================================
-- Sistema Turnazione – Migration iniziale
-- Esegui questo script nell'SQL Editor di Supabase
-- ============================================================

-- ─── Abilita estensioni ──────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── TABELLE ─────────────────────────────────────────────────

-- Utenti autorizzati (whitelist Google accounts)
CREATE TABLE IF NOT EXISTS utenti_autorizzati (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email      TEXT UNIQUE NOT NULL,
  ruolo      TEXT NOT NULL CHECK (ruolo IN ('admin', 'user')),
  nome       TEXT,
  attivo     BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Medici / turnisti
CREATE TABLE IF NOT EXISTS medici (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome            TEXT NOT NULL,
  numero_ordine   INTEGER NOT NULL UNIQUE,   -- posizione 1..N nella rotazione
  is_reperibilita BOOLEAN DEFAULT false,      -- true = numero di REP nello schema
  attivo          BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Configurazione calendario
CREATE TABLE IF NOT EXISTS configurazione (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  anno_inizio   INTEGER NOT NULL,
  mese_inizio   INTEGER NOT NULL CHECK (mese_inizio BETWEEN 1 AND 12),
  anno_fine     INTEGER NOT NULL,
  mese_fine     INTEGER NOT NULL CHECK (mese_fine BETWEEN 1 AND 12),
  schema_attivo INTEGER DEFAULT 1,
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Schema/modello di rotazione
CREATE TABLE IF NOT EXISTS schemi_modello (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schema_num                INTEGER NOT NULL,
  giorno_settimana          INTEGER NOT NULL CHECK (giorno_settimana BETWEEN 1 AND 7),
  slot                      INTEGER NOT NULL CHECK (slot BETWEEN 0 AND 9),
  numero_medico_mattina     INTEGER,
  numero_medico_pomeriggio  INTEGER,
  numero_medico_rm          INTEGER,
  numero_medico_rp          INTEGER,
  is_reperibilita           BOOLEAN DEFAULT false,  -- true = slot REP
  UNIQUE (schema_num, giorno_settimana, slot)
);

-- Turni (generati + modificati manualmente)
CREATE TABLE IF NOT EXISTS turni (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  medico_id             UUID NOT NULL REFERENCES medici(id) ON DELETE CASCADE,
  data                  DATE NOT NULL,
  turno_clinico         TEXT DEFAULT '' CHECK (turno_clinico IN ('M','P','L','REP','')),
  turno_ricerca         TEXT DEFAULT '' CHECK (turno_ricerca IN ('RM','RP','RM+RP','')),
  note                  TEXT,
  modificato_manualmente BOOLEAN DEFAULT false,
  is_ferie              BOOLEAN DEFAULT false,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (medico_id, data)
);

-- Ferie
CREATE TABLE IF NOT EXISTS ferie (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  medico_id   UUID NOT NULL REFERENCES medici(id) ON DELETE CASCADE,
  data_inizio DATE NOT NULL,
  data_fine   DATE NOT NULL,
  approvate   BOOLEAN DEFAULT false,
  note        TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  CHECK (data_fine >= data_inizio)
);

-- ─── INDICI ──────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_turni_medico_data ON turni (medico_id, data);
CREATE INDEX IF NOT EXISTS idx_turni_data        ON turni (data);
CREATE INDEX IF NOT EXISTS idx_ferie_medico      ON ferie (medico_id);
CREATE INDEX IF NOT EXISTS idx_schemi_giorno     ON schemi_modello (schema_num, giorno_settimana);

-- ─── TRIGGER updated_at ──────────────────────────────────────

CREATE OR REPLACE FUNCTION aggiorna_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_turni_updated_at
  BEFORE UPDATE ON turni
  FOR EACH ROW EXECUTE FUNCTION aggiorna_updated_at();

CREATE OR REPLACE TRIGGER trg_config_updated_at
  BEFORE UPDATE ON configurazione
  FOR EACH ROW EXECUTE FUNCTION aggiorna_updated_at();

-- ─── ROW LEVEL SECURITY ──────────────────────────────────────

ALTER TABLE utenti_autorizzati ENABLE ROW LEVEL SECURITY;
ALTER TABLE medici              ENABLE ROW LEVEL SECURITY;
ALTER TABLE configurazione      ENABLE ROW LEVEL SECURITY;
ALTER TABLE schemi_modello      ENABLE ROW LEVEL SECURITY;
ALTER TABLE turni               ENABLE ROW LEVEL SECURITY;
ALTER TABLE ferie               ENABLE ROW LEVEL SECURITY;

-- Helper: controlla se l'utente corrente è in whitelist
CREATE OR REPLACE FUNCTION is_utente_attivo()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM utenti_autorizzati
    WHERE email  = (SELECT email FROM auth.users WHERE id = auth.uid())
    AND   attivo = true
  )
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Helper: controlla se l'utente corrente è admin
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM utenti_autorizzati
    WHERE email  = (SELECT email FROM auth.users WHERE id = auth.uid())
    AND   ruolo  = 'admin'
    AND   attivo = true
  )
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ── utenti_autorizzati ──
DROP POLICY IF EXISTS "ua_select" ON utenti_autorizzati;
DROP POLICY IF EXISTS "ua_insert" ON utenti_autorizzati;
DROP POLICY IF EXISTS "ua_update" ON utenti_autorizzati;
DROP POLICY IF EXISTS "ua_delete" ON utenti_autorizzati;

CREATE POLICY "ua_select" ON utenti_autorizzati
  FOR SELECT USING (
    email = (SELECT email FROM auth.users WHERE id = auth.uid())
    OR is_admin()
  );
CREATE POLICY "ua_insert" ON utenti_autorizzati
  FOR INSERT WITH CHECK (is_admin());
CREATE POLICY "ua_update" ON utenti_autorizzati
  FOR UPDATE USING (is_admin());
CREATE POLICY "ua_delete" ON utenti_autorizzati
  FOR DELETE USING (is_admin());

-- ── medici ──
DROP POLICY IF EXISTS "medici_select" ON medici;
DROP POLICY IF EXISTS "medici_modify"  ON medici;
CREATE POLICY "medici_select" ON medici
  FOR SELECT USING (is_utente_attivo());
CREATE POLICY "medici_modify" ON medici
  FOR ALL USING (is_admin());

-- ── configurazione ──
DROP POLICY IF EXISTS "config_select"  ON configurazione;
DROP POLICY IF EXISTS "config_modify"  ON configurazione;
CREATE POLICY "config_select" ON configurazione
  FOR SELECT USING (is_utente_attivo());
CREATE POLICY "config_modify" ON configurazione
  FOR ALL USING (is_admin());

-- ── schemi_modello ──
DROP POLICY IF EXISTS "schemi_select" ON schemi_modello;
DROP POLICY IF EXISTS "schemi_modify" ON schemi_modello;
CREATE POLICY "schemi_select" ON schemi_modello
  FOR SELECT USING (is_utente_attivo());
CREATE POLICY "schemi_modify" ON schemi_modello
  FOR ALL USING (is_admin());

-- ── turni ──
DROP POLICY IF EXISTS "turni_select" ON turni;
DROP POLICY IF EXISTS "turni_modify"  ON turni;
CREATE POLICY "turni_select" ON turni
  FOR SELECT USING (is_utente_attivo());
CREATE POLICY "turni_modify" ON turni
  FOR ALL USING (is_admin());

-- ── ferie ──
DROP POLICY IF EXISTS "ferie_select" ON ferie;
DROP POLICY IF EXISTS "ferie_modify"  ON ferie;
CREATE POLICY "ferie_select" ON ferie
  FOR SELECT USING (is_utente_attivo());
CREATE POLICY "ferie_modify" ON ferie
  FOR ALL USING (is_admin());

-- ─── DATI INIZIALI ────────────────────────────────────────────
-- (Inserisci il tuo account admin manualmente dopo aver eseguito questo script)

-- Medici (dati reali dal foglio Google Sheets)
INSERT INTO medici (nome, numero_ordine, is_reperibilita, attivo) VALUES
  ('COGNATA',      1,  false, true),
  ('GALASSO',      2,  false, true),
  ('UBERTI',       3,  false, true),
  ('PALMIERI',     4,  false, true),
  ('BIADER',       5,  false, true),
  ('DI VENANZIO',  6,  false, true),
  ('SPIRIDINOV',   7,  false, true),
  ('MERINGOLO',    8,  false, true),
  ('CIAVARELLI',   9,  false, true),
  ('SCATRAGLI',    10, false, true),
  ('MARABELLI',    11, true,  true)   -- reperibilità
ON CONFLICT (numero_ordine) DO NOTHING;

-- Configurazione attiva (Maggio 2026 – Ottobre 2026, Schema 1)
INSERT INTO configurazione (anno_inizio, mese_inizio, anno_fine, mese_fine, schema_attivo)
VALUES (2026, 5, 2026, 10, 1)
ON CONFLICT DO NOTHING;

-- ─── SCHEMA 1 ────────────────────────────────────────────────
-- Struttura: slot = riga all'interno del giorno (0-based)
-- giorno_settimana: 1=Lun, 2=Mar, 3=Mer, 4=Gio, 5=Ven, 6=Sab, 7=Dom
-- is_reperibilita=true → chi ottiene questo numero è in reperibilità

INSERT INTO schemi_modello
  (schema_num, giorno_settimana, slot, numero_medico_mattina, numero_medico_pomeriggio, numero_medico_rm, numero_medico_rp, is_reperibilita)
VALUES
  -- ── LUNEDI ──
  (1, 1, 0,  1,  1,    NULL, NULL, false),   -- medico 1: L (M+P)
  (1, 1, 1,  6,  6,    NULL, NULL, false),   -- medico 6: L
  (1, 1, 2,  10, 5,    NULL, NULL, false),   -- medico 10: M, medico 5: P
  (1, 1, 3,  3,  4,    NULL, 3,    false),   -- medico 3: M+RP, medico 4: P
  (1, 1, 4,  11, NULL, NULL, NULL, true),    -- medico 11: REP

  -- ── MARTEDI ──
  (1, 2, 0,  1,  1,    NULL, NULL,  false),
  (1, 2, 1,  6,  6,    NULL, NULL,  false),
  (1, 2, 2,  10, 5,    NULL, 10,    false),  -- medico 10: M+RP, medico 5: P
  (1, 2, 3,  3,  4,    NULL, NULL,  false),  -- medico 3: M, medico 4: P
  (1, 2, 4,  11, NULL, NULL, NULL,  true),

  -- ── MERCOLEDI ──
  (1, 3, 0,  5,  5,    NULL, NULL, false),   -- medico 5: L
  (1, 3, 1,  4,  4,    NULL, NULL, false),   -- medico 4: L
  (1, 3, 2,  10, 1,    1,    NULL, false),   -- medico 10: M, medico 1: P+RM
  (1, 3, 3,  3,  6,    6,    NULL, false),   -- medico 3: M, medico 6: P+RM
  (1, 3, 4,  11, NULL, NULL, NULL, true),

  -- ── GIOVEDI ──
  (1, 4, 0,  5,  5,    NULL, NULL, false),
  (1, 4, 1,  4,  4,    NULL, NULL, false),
  (1, 4, 2,  10, 2,    2,    NULL, false),   -- medico 10: M, medico 2: P+RM
  (1, 4, 3,  3,  9,    9,    NULL, false),   -- medico 3: M, medico 9: P+RM
  (1, 4, 4,  11, NULL, NULL, NULL, true),

  -- ── VENERDI ──
  (1, 5, 0,  9,  9,    NULL, NULL, false),   -- medico 9: L
  (1, 5, 1,  2,  2,    NULL, NULL, false),   -- medico 2: L
  (1, 5, 2,  10, 8,    8,    NULL, false),   -- medico 10: M, medico 8: P+RM
  (1, 5, 3,  3,  7,    7,    NULL, false),   -- medico 3: M, medico 7: P+RM
  (1, 5, 4,  11, NULL, NULL, NULL, true),

  -- ── SABATO ──
  (1, 6, 0,  8,  8,    NULL, NULL, false),
  (1, 6, 1,  7,  7,    NULL, NULL, false),
  (1, 6, 2,  2,  2,    NULL, NULL, false),
  (1, 6, 3,  9,  9,    NULL, NULL, false),
  (1, 6, 4,  11, NULL, NULL, NULL, true),

  -- ── DOMENICA ──
  (1, 7, 0,  8,  8,    NULL, NULL, false),
  (1, 7, 1,  7,  7,    NULL, NULL, false),
  (1, 7, 2,  11, NULL, NULL, NULL, true)

ON CONFLICT (schema_num, giorno_settimana, slot) DO NOTHING;

-- ─── NOTA FINALE ─────────────────────────────────────────────
-- Dopo aver eseguito questo script, inserisci il tuo account admin:
--
--   INSERT INTO utenti_autorizzati (email, ruolo, nome)
--   VALUES ('tua-email@gmail.com', 'admin', 'Il Tuo Nome');
--
-- Poi vai su Authentication > Providers > Google per configurare OAuth.
-- ─────────────────────────────────────────────────────────────
