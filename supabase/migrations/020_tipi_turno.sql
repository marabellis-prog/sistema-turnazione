-- 020: Tipi di turno dinamici per reparto (Fase 3, modello dati)
--
-- ADDITIVO: l'algoritmo/designer attuali continuano a usare M/P/L/REP fissi
-- per il reparto 11N. Queste tabelle definiscono i tipi di turno e le
-- proprieta' (sub/med/sup) configurabili PER REPARTO, con colori/orari/peso.
-- Verranno cablate nel motore in un passo successivo.

-- ── Tipi di turno (M, P, L, REP, EM/EP/EL, o custom es. SWING) ────────
CREATE TABLE IF NOT EXISTS tipi_turno (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reparto_id       uuid NOT NULL REFERENCES reparti(id) ON DELETE CASCADE,
  sigla            text NOT NULL,                 -- 'M','P','L','REP','SWING'...
  nome             text NOT NULL DEFAULT '',
  ora_inizio       text,                          -- '08:00'
  ora_fine         text,                          -- '14:00'
  peso             int  NOT NULL DEFAULT 1,        -- quanti "turni" vale (L=2, REP=0)
  copre_mattina    boolean NOT NULL DEFAULT false,
  copre_pomeriggio boolean NOT NULL DEFAULT false,
  is_reperibilita  boolean NOT NULL DEFAULT false,
  colore_bg        text NOT NULL DEFAULT '#e5e5e5',
  colore_fg        text NOT NULL DEFAULT '#333333',
  ordine           int  NOT NULL DEFAULT 0,
  created_at       timestamptz DEFAULT now(),
  UNIQUE (reparto_id, sigla)
);

-- ── Proprieta' del turno (SUB / MED / SUP) con colore ────────────────
CREATE TABLE IF NOT EXISTS proprieta_turno (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reparto_id uuid NOT NULL REFERENCES reparti(id) ON DELETE CASCADE,
  sigla      text NOT NULL,                       -- 'SUB','MED','SUP'
  nome       text NOT NULL DEFAULT '',
  colore_bg  text NOT NULL DEFAULT '#d4d4d4',
  ordine     int  NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE (reparto_id, sigla)
);

CREATE INDEX IF NOT EXISTS idx_tipi_turno_reparto      ON tipi_turno(reparto_id);
CREATE INDEX IF NOT EXISTS idx_proprieta_turno_reparto ON proprieta_turno(reparto_id);

-- ── Seed del reparto 11N coi tipi/colori attuali ─────────────────────
INSERT INTO tipi_turno (reparto_id, sigla, nome, ora_inizio, ora_fine, peso, copre_mattina, copre_pomeriggio, is_reperibilita, colore_bg, colore_fg, ordine) VALUES
  ('11111111-1111-4111-8111-111111111111','M',  'Mattina',          '08:00','14:00',1,true, false,false,'#dde8d5','#2e4a28',1),
  ('11111111-1111-4111-8111-111111111111','P',  'Pomeriggio',       '14:00','20:00',1,false,true, false,'#d5e0e8','#253a4a',2),
  ('11111111-1111-4111-8111-111111111111','L',  'Lunga (M+P)',      '08:00','20:00',2,true, true, false,'#ece5d5','#4a3a1a',3),
  ('11111111-1111-4111-8111-111111111111','REP','Reperibilita''',   NULL,   NULL,   0,false,false,true, '#e8d5d5','#5a2a2a',4),
  ('11111111-1111-4111-8111-111111111111','EM', 'Esterno Mattina',  '08:00','14:00',1,true, false,false,'#dbe4e8','#36495a',5),
  ('11111111-1111-4111-8111-111111111111','EP', 'Esterno Pomeriggio','14:00','20:00',1,false,true,false,'#dbe4e8','#36495a',6),
  ('11111111-1111-4111-8111-111111111111','EL', 'Esterno Lunga',    '08:00','20:00',2,true, true, false,'#dbe4e8','#36495a',7)
ON CONFLICT (reparto_id, sigla) DO NOTHING;

INSERT INTO proprieta_turno (reparto_id, sigla, nome, colore_bg, ordine) VALUES
  ('11111111-1111-4111-8111-111111111111','SUB','Sub-intensiva','#fecaca',1),
  ('11111111-1111-4111-8111-111111111111','MED','Medicina',     '#bae6fd',2),
  ('11111111-1111-4111-8111-111111111111','SUP','Supporto',     '#d4d4d4',3)
ON CONFLICT (reparto_id, sigla) DO NOTHING;

-- ── RLS + grant (per-reparto: vede chi vede il reparto, gestisce chi gestisce) ──
ALTER TABLE tipi_turno      ENABLE ROW LEVEL SECURITY;
ALTER TABLE proprieta_turno ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tt_select ON tipi_turno;
DROP POLICY IF EXISTS tt_modify ON tipi_turno;
CREATE POLICY tt_select ON tipi_turno FOR SELECT USING (puo_vedere_reparto(reparto_id));
CREATE POLICY tt_modify ON tipi_turno FOR ALL USING (puo_gestire_reparto(reparto_id)) WITH CHECK (puo_gestire_reparto(reparto_id));
DROP POLICY IF EXISTS pt_select ON proprieta_turno;
DROP POLICY IF EXISTS pt_modify ON proprieta_turno;
CREATE POLICY pt_select ON proprieta_turno FOR SELECT USING (puo_vedere_reparto(reparto_id));
CREATE POLICY pt_modify ON proprieta_turno FOR ALL USING (puo_gestire_reparto(reparto_id)) WITH CHECK (puo_gestire_reparto(reparto_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON tipi_turno      TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON proprieta_turno TO authenticated;
