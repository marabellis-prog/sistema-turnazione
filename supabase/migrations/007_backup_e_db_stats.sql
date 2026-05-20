-- Migration 007 — Sistema backup + stats DB
--
-- Contesto:
-- 1) Impostazioni backup in configurazione (intervallo auto + retention)
-- 2) Tabella turni_backup per snapshot JSONB dei turni
-- 3) Funzione RPC get_db_stats() per monitoraggio free tier Supabase
--    (dimensione DB + count righe per tabella). Solo admin puo` chiamarla.

-- ── 1) Settings backup in configurazione ─────────────────────────────
ALTER TABLE public.configurazione
  ADD COLUMN IF NOT EXISTS backup_intervallo_giorni INTEGER NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS backup_da_tenere         INTEGER NOT NULL DEFAULT 10;

-- ── 2) Tabella turni_backup ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.turni_backup (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  descrizione TEXT,             -- es. "Auto-backup 2026-05-20" o "Manuale prima rigenerazione"
  num_turni   INTEGER,          -- count rapido senza dover misurare il JSONB
  snapshot    JSONB NOT NULL    -- { "turni": [<riga turno>, ...] }
);

CREATE INDEX IF NOT EXISTS idx_turni_backup_created
  ON public.turni_backup (created_at DESC);

-- Realtime
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'turni_backup'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.turni_backup';
  END IF;
END $$;

-- ── 3) RLS turni_backup: solo admin ──────────────────────────────────
ALTER TABLE public.turni_backup ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tb_select ON public.turni_backup;
CREATE POLICY tb_select ON public.turni_backup
  FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS tb_modify ON public.turni_backup;
CREATE POLICY tb_modify ON public.turni_backup
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ── 4) RPC get_db_stats — monitoraggio free tier ─────────────────────
-- Ritorna metriche dirette da Postgres + Storage + Auth:
--  - db_size_bytes:  pg_database_size del DB attivo
--  - storage_bytes:  somma di metadata->>'size' su storage.objects
--  - mau_approx:     count utenti auth.users con last_sign_in_at < 30gg
--  - users_total:    count utenti totali in auth.users
--  - tables:         count righe per tabella principale
--
-- Le altre metriche del free tier Supabase (Realtime, Egress, Edge
-- Function Invocations, ecc.) NON sono interrogabili da Postgres: vivono
-- in servizi separati e si vedono solo dalla Management API o dal
-- Dashboard. Per il monitoraggio rapido in-app, queste sono sufficienti.
--
-- SECURITY DEFINER + search_path esplicito per accedere a storage/auth
-- anche da utenti che non hanno privilegi diretti su quegli schemi.
CREATE OR REPLACE FUNCTION public.get_db_stats()
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, storage, auth, pg_catalog
AS $$
  SELECT jsonb_build_object(
    'db_size_bytes',  pg_database_size(current_database()),
    'storage_bytes',  COALESCE((SELECT SUM((metadata->>'size')::bigint) FROM storage.objects), 0),
    'mau_approx',     (SELECT count(*)::int FROM auth.users WHERE last_sign_in_at > NOW() - INTERVAL '30 days'),
    'users_total',    (SELECT count(*)::int FROM auth.users),
    'tables', jsonb_build_array(
      jsonb_build_object('name', 'turni',              'rows', (SELECT count(*) FROM public.turni)),
      jsonb_build_object('name', 'ferie',              'rows', (SELECT count(*) FROM public.ferie)),
      jsonb_build_object('name', 'cambi_turno',        'rows', (SELECT count(*) FROM public.cambi_turno)),
      jsonb_build_object('name', 'messaggi',           'rows', (SELECT count(*) FROM public.messaggi)),
      jsonb_build_object('name', 'turni_backup',       'rows', (SELECT count(*) FROM public.turni_backup)),
      jsonb_build_object('name', 'utenti_autorizzati', 'rows', (SELECT count(*) FROM public.utenti_autorizzati)),
      jsonb_build_object('name', 'medici',             'rows', (SELECT count(*) FROM public.medici)),
      jsonb_build_object('name', 'schemi_modello',     'rows', (SELECT count(*) FROM public.schemi_modello)),
      jsonb_build_object('name', 'festivita_custom',   'rows', (SELECT count(*) FROM public.festivita_custom)),
      jsonb_build_object('name', 'configurazione',     'rows', (SELECT count(*) FROM public.configurazione))
    )
  );
$$;

-- Solo admin puo` eseguire la funzione (la funzione stessa puo` fallire
-- per RLS se chiamata da non-admin, ma blocchiamo a monte con il GRANT).
REVOKE EXECUTE ON FUNCTION public.get_db_stats FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_db_stats TO authenticated;
