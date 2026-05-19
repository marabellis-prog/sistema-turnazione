-- Migration 003 — Sistema "Richiesta cambio turno"
--
-- Contesto:
--  Un medico turnista (user) puo` aprire una richiesta di cambio turno per
--  comunicare all'admin un accordo gia` stabilito offline con un collega.
--  La richiesta porta UN ARRAY di modifiche puntuali (per medico/data) che,
--  in caso di approvazione admin, vengono applicate automaticamente alla
--  tabella `turni`.
--
--  Esempio: A ha un L lunedi`, ma non puo` fare la mattina; B (P lunedi`)
--  si prende la mattina di A. Risultato proposto:
--    [{ medico_id: A_id, data: 'lun', da: {tc:'L'}, a: {tc:'P'} },
--     { medico_id: B_id, data: 'lun', da: {tc:'P'}, a: {tc:'M'} }]

-- ── 1) Helper function: medico_id dell'utente loggato ────────────────
-- Mappa l'auth user (via email) al medico in elenco (per nome).
-- Stesso match-by-name usato in CalendarioPage.tsx (mioMedico).
CREATE OR REPLACE FUNCTION my_medico_id()
RETURNS UUID AS $$
  SELECT m.id FROM medici m
  JOIN utenti_autorizzati ua
    ON UPPER(TRIM(ua.nome)) = UPPER(TRIM(m.nome))
  WHERE ua.email = (SELECT email FROM auth.users WHERE id = auth.uid())
    AND ua.attivo = true
    AND m.attivo = true
  LIMIT 1
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ── 2) Tabella cambi_turno ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cambi_turno (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at            TIMESTAMPTZ DEFAULT NOW(),

  -- Chi ha aperto la richiesta (medico richiedente / "portavoce")
  medico_richiedente_id UUID NOT NULL REFERENCES medici(id) ON DELETE CASCADE,

  -- Array di modifiche proposte. Schema di ogni elemento:
  --   {
  --     "medico_id": "uuid",
  --     "data":      "YYYY-MM-DD",
  --     "da": { "tc": "L", "tr": "", "slot_mattina": "SUB", "slot_pomeriggio": "MED" },
  --     "a":  { "tc": "P", "tr": "", "slot_mattina": null,  "slot_pomeriggio": "MED" }
  --   }
  -- JSONB consente query veloci, indici GIN se servisse, ed e` piu`
  -- semplice di una tabella figlia normalizzata per questo caso d'uso
  -- (lista corta di righe per richiesta, rara modifica/lookup interno).
  modifiche             JSONB NOT NULL CHECK (jsonb_typeof(modifiche) = 'array'),

  -- Note libere del richiedente (es. "B copre la mia mattina del lun 12/5")
  motivo                TEXT,

  -- Stato del workflow
  stato                 TEXT NOT NULL DEFAULT 'pending'
                        CHECK (stato IN ('pending', 'approved', 'rejected')),

  -- Audit dell'approvazione/rifiuto (admin che ha agito)
  resolved_at           TIMESTAMPTZ,
  resolved_by           UUID,
  rejection_reason      TEXT
);

-- ── 3) Indici per le query principali ───────────────────────────────
CREATE INDEX IF NOT EXISTS idx_cambi_turno_stato
  ON cambi_turno (stato);
CREATE INDEX IF NOT EXISTS idx_cambi_turno_richiedente
  ON cambi_turno (medico_richiedente_id);
CREATE INDEX IF NOT EXISTS idx_cambi_turno_created
  ON cambi_turno (created_at DESC);

-- ── 4) Realtime publication ──────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'cambi_turno'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.cambi_turno';
  END IF;
END $$;

-- ── 5) Row Level Security ────────────────────────────────────────────
ALTER TABLE cambi_turno ENABLE ROW LEVEL SECURITY;

-- SELECT: l'utente vede le proprie richieste; l'admin vede tutto
DROP POLICY IF EXISTS ct_select ON cambi_turno;
CREATE POLICY ct_select ON cambi_turno
  FOR SELECT TO authenticated
  USING (
    medico_richiedente_id = my_medico_id() OR is_admin()
  );

-- INSERT: l'utente puo` inserire UNA richiesta per il proprio medico,
-- stato obbligatoriamente pending (cosi` non puo` auto-approvarsi).
DROP POLICY IF EXISTS ct_insert ON cambi_turno;
CREATE POLICY ct_insert ON cambi_turno
  FOR INSERT TO authenticated
  WITH CHECK (
    medico_richiedente_id = my_medico_id() AND stato = 'pending'
  );

-- UPDATE: l'admin puo` aggiornare qualsiasi richiesta (approva/rifiuta).
-- L'utente puo` aggiornare SOLO la propria richiesta ancora pending
-- (utile per annullarla o modificare il motivo prima dell'approvazione).
DROP POLICY IF EXISTS ct_update ON cambi_turno;
CREATE POLICY ct_update ON cambi_turno
  FOR UPDATE TO authenticated
  USING (
    is_admin() OR
    (medico_richiedente_id = my_medico_id() AND stato = 'pending')
  );

-- DELETE: l'admin puo` cancellare qualsiasi richiesta (anche risolte,
-- per pulizia archivio). L'utente puo` cancellare solo le proprie
-- richieste pending (annullamento).
DROP POLICY IF EXISTS ct_delete ON cambi_turno;
CREATE POLICY ct_delete ON cambi_turno
  FOR DELETE TO authenticated
  USING (
    is_admin() OR
    (medico_richiedente_id = my_medico_id() AND stato = 'pending')
  );
