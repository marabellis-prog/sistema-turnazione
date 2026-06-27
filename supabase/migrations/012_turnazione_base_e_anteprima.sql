-- Migration 012 — Turno "base" memorizzato + anteprima turnazione
--
-- Contesto:
-- Feature "Aggiorna turnazione" (continuazione rotazione con nuovo schema
-- da un mese in poi, con anteprima/approvazione). Serve:
--  1) memorizzare il turno TEORICO di base di ogni cella, cosi` da poter
--     ricostruire "turno originario / attuale" anche con mesi su schemi
--     diversi (oggi il base e` solo ricalcolato dallo schema corrente);
--  2) marcare le celle "cambio" portate oltre un aggiornamento (rosso);
--  3) salvare il numero di medici dell'ultima generazione (controllo
--     consistenza prima di un aggiornamento);
--  4) una tabella per la BOZZA di turnazione in attesa di approvazione.

-- ── 1) Colonne "base" sui turni ──────────────────────────────────────
ALTER TABLE public.turni
  ADD COLUMN IF NOT EXISTS turno_clinico_base       TEXT,
  ADD COLUMN IF NOT EXISTS turno_ricerca_base       TEXT,
  ADD COLUMN IF NOT EXISTS turno_clinico_originario TEXT;
-- turno_clinico_base / turno_ricerca_base: valore teorico (rotazione) della
--   cella, settato a generazione/aggiornamento. "modificato" = corrente != base.
-- turno_clinico_originario: per le celle modificate PORTATE oltre un
--   aggiornamento, il base PRIMA dell'aggiornamento (il "vecchio calendario
--   sostituito"). NULL altrimenti → marcatore del bordo/righe ROSSE.

-- ── 2) n. medici dell'ultima generazione (su configurazione) ─────────
ALTER TABLE public.configurazione
  ADD COLUMN IF NOT EXISTS n_medici_base INTEGER;

-- ── 3) Tabella BOZZA turnazione (anteprima in attesa di approvazione) ─
-- Una sola bozza attiva alla volta (la creazione cancella la precedente).
CREATE TABLE IF NOT EXISTS public.turnazione_anteprima (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  descrizione TEXT,
  -- Snapshot del calendario COMPLETO proposto: { "turni": [<riga turno>, ...] }
  -- con i campi base/originario gia` valorizzati.
  snapshot    JSONB NOT NULL,
  -- Metadati per la pubblicazione: { cutover, schema_nuovo, anno_inizio,
  --   mese_inizio, anno_fine, mese_fine, n_cambi, config_payload }
  meta        JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_turnazione_anteprima_created
  ON public.turnazione_anteprima (created_at DESC);

-- Realtime (badge "anteprima disponibile" live)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'turnazione_anteprima'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.turnazione_anteprima';
  END IF;
END $$;

-- ── 4) RLS turnazione_anteprima ──────────────────────────────────────
-- SELECT: tutti i turnisti attivi (per vedere l'anteprima). Niente ospiti
--   a livello UI (la pagina pubblica e` protetta); a livello dati e`
--   sufficiente is_utente_attivo() come per turni/ferie.
-- INSERT/UPDATE/DELETE: solo admin.
ALTER TABLE public.turnazione_anteprima ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ta_select ON public.turnazione_anteprima;
CREATE POLICY ta_select ON public.turnazione_anteprima
  FOR SELECT TO authenticated
  USING (public.is_utente_attivo());

DROP POLICY IF EXISTS ta_modify ON public.turnazione_anteprima;
CREATE POLICY ta_modify ON public.turnazione_anteprima
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());
