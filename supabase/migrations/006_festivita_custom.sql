-- Migration 006 — Festività custom (es. patrono cittadino)
--
-- Contesto:
-- Oltre alle festività nazionali hardcoded in src/lib/holidays.ts
-- (Capodanno, Pasqua, Ferragosto, ecc.), l'admin puo` definire altre
-- date come "festive" — esempio classico: il santo patrono della citta`.
-- Da quel momento in poi quel giorno e` trattato come festivo in:
--   - generaColonne (col.isFestivo = true)
--   - check inconsistenze turni in ModificaTurni (usa attesi "festivo")
--   - calcoli statistici nel riepilogo turni
--   - visualizzazione calendario FerieModal (sfondo rosso del giorno)

CREATE TABLE IF NOT EXISTS public.festivita_custom (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  data        DATE NOT NULL UNIQUE,
  descrizione TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_festivita_custom_data ON public.festivita_custom (data);

-- ── Realtime publication ───────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'festivita_custom'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.festivita_custom';
  END IF;
END $$;

-- ── Row Level Security ────────────────────────────────────────────
ALTER TABLE public.festivita_custom ENABLE ROW LEVEL SECURITY;

-- SELECT: tutti gli utenti attivi (serve in CalendarioPage / FerieModal
-- a tutti gli account, non solo admin)
DROP POLICY IF EXISTS fc_select ON public.festivita_custom;
CREATE POLICY fc_select ON public.festivita_custom
  FOR SELECT TO authenticated
  USING (public.is_utente_attivo());

-- INSERT / UPDATE / DELETE: solo admin
DROP POLICY IF EXISTS fc_modify ON public.festivita_custom;
CREATE POLICY fc_modify ON public.festivita_custom
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());
