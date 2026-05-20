-- Migration 004 — Sistema messaggi + ripristino cambio turno
--
-- Contesto:
-- 1) Tabella `messaggi` per la casella di posta personale di ogni medico
--    turnista. Ogni evento "admin-side" (approva/rifiuta/ripristina cambio,
--    approva/rifiuta ferie) genera uno o piu` messaggi destinati ai medici
--    coinvolti. L'utente li legge dalla sua pagina pubblica via icona busta.
-- 2) Nuovo stato `restored` per `cambi_turno`: dopo l'approvazione, l'admin
--    puo` "ripristinare" il cambio (annullarlo) — il record resta in archivio
--    con stato 'restored' e i turni sono riportati al valore precedente.
-- 3) Backfill: per i record esistenti di ferie approvate e di cambi turno
--    gia` in archivio, genera messaggi retroattivi (gia` marcati come letti
--    per non gonfiare il badge "non letti").

-- ── 1) Aggiunge stato 'restored' al CHECK di cambi_turno ────────────
ALTER TABLE public.cambi_turno
  DROP CONSTRAINT IF EXISTS cambi_turno_stato_check;
ALTER TABLE public.cambi_turno
  ADD CONSTRAINT cambi_turno_stato_check
  CHECK (stato IN ('pending', 'approved', 'rejected', 'restored'));

-- ── 2) Tabella messaggi ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.messaggi (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  medico_id       UUID NOT NULL REFERENCES public.medici(id) ON DELETE CASCADE,
  tipo            TEXT NOT NULL CHECK (tipo IN (
                    'cambio_approvato', 'cambio_rifiutato', 'cambio_ripristinato',
                    'ferie_approvate',  'ferie_rifiutate'
                  )),
  titolo          TEXT NOT NULL,
  corpo           TEXT,
  letto           BOOLEAN DEFAULT FALSE,
  -- Riferimenti opzionali per audit / link nel modal
  cambio_turno_id UUID REFERENCES public.cambi_turno(id) ON DELETE SET NULL,
  ferie_id        UUID REFERENCES public.ferie(id)        ON DELETE SET NULL
);

-- ── 3) Indici per query principali ──────────────────────────────────
-- Lookup "messaggi del medico X non letti" + paginazione per data DESC
CREATE INDEX IF NOT EXISTS idx_messaggi_medico_unread
  ON public.messaggi (medico_id, letto);
CREATE INDEX IF NOT EXISTS idx_messaggi_created
  ON public.messaggi (created_at DESC);

-- ── 4) Realtime publication ─────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'messaggi'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.messaggi';
  END IF;
END $$;

-- ── 5) Row Level Security ───────────────────────────────────────────
ALTER TABLE public.messaggi ENABLE ROW LEVEL SECURITY;

-- SELECT: utente vede SOLO i propri messaggi, admin vede tutti
DROP POLICY IF EXISTS m_select ON public.messaggi;
CREATE POLICY m_select ON public.messaggi
  FOR SELECT TO authenticated
  USING (medico_id = public.my_medico_id() OR public.is_admin());

-- INSERT: solo admin puo` creare messaggi (li genera al click approva/rifiuta)
DROP POLICY IF EXISTS m_insert ON public.messaggi;
CREATE POLICY m_insert ON public.messaggi
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

-- UPDATE: utente puo` marcare i propri come letti, admin puo` tutto
DROP POLICY IF EXISTS m_update ON public.messaggi;
CREATE POLICY m_update ON public.messaggi
  FOR UPDATE TO authenticated
  USING (medico_id = public.my_medico_id() OR public.is_admin());

-- DELETE: solo admin (l'utente non deve cancellare i messaggi)
DROP POLICY IF EXISTS m_delete ON public.messaggi;
CREATE POLICY m_delete ON public.messaggi
  FOR DELETE TO authenticated
  USING (public.is_admin());

-- ── 6) BACKFILL — Ferie approvate esistenti ─────────────────────────
-- Per ogni ferie con approvate=true, genera un messaggio retroattivo.
-- Letto = TRUE (non gonfia il badge "nuovi messaggi"); created_at fissato
-- alla data originale della ferie cosi` nella lista appare in ordine corretto.
INSERT INTO public.messaggi (medico_id, tipo, titolo, corpo, letto, ferie_id, created_at)
SELECT
  f.medico_id,
  'ferie_approvate',
  'Richiesta ferie approvata',
  format('Le tue ferie dal %s al %s sono state approvate.',
    to_char(f.data_inizio, 'DD/MM/YYYY'),
    to_char(f.data_fine,   'DD/MM/YYYY')),
  TRUE,
  f.id,
  f.created_at
FROM public.ferie f
WHERE f.approvate = true
  AND NOT EXISTS (
    SELECT 1 FROM public.messaggi m
    WHERE m.ferie_id = f.id AND m.tipo = 'ferie_approvate'
  );

-- ── 7) BACKFILL — Cambi turno gia` in archivio ──────────────────────
-- Per ogni cambio in stato 'approved' o 'rejected', genera messaggi per
-- TUTTI i medici coinvolti: il richiedente + tutti i medici_id presenti
-- nelle modifiche JSONB (dedupe via UNION).
WITH medici_per_cambio AS (
  -- Richiedente
  SELECT
    c.id           AS cambio_id,
    c.stato        AS stato,
    c.rejection_reason,
    c.resolved_at,
    c.created_at,
    c.medico_richiedente_id AS medico_id
  FROM public.cambi_turno c
  WHERE c.stato IN ('approved', 'rejected')
  UNION
  -- Tutti i medici coinvolti nelle modifiche (dedupe automatico via UNION)
  SELECT
    c.id           AS cambio_id,
    c.stato        AS stato,
    c.rejection_reason,
    c.resolved_at,
    c.created_at,
    (e->>'medico_id')::uuid AS medico_id
  FROM public.cambi_turno c, jsonb_array_elements(c.modifiche) e
  WHERE c.stato IN ('approved', 'rejected')
    AND e->>'medico_id' IS NOT NULL
)
INSERT INTO public.messaggi (medico_id, tipo, titolo, corpo, letto, cambio_turno_id, created_at)
SELECT
  mc.medico_id,
  CASE WHEN mc.stato = 'approved' THEN 'cambio_approvato'
       ELSE                            'cambio_rifiutato' END,
  CASE WHEN mc.stato = 'approved' THEN 'Cambio turno approvato'
       ELSE                            'Cambio turno rifiutato' END,
  CASE
    WHEN mc.stato = 'approved'
      THEN 'Una richiesta di cambio turno che ti coinvolge e` stata approvata dall''admin. Il calendario e` stato aggiornato.'
    ELSE
      COALESCE(
        'Una richiesta di cambio turno che ti coinvolge e` stata rifiutata: ' || mc.rejection_reason,
        'Una richiesta di cambio turno che ti coinvolge e` stata rifiutata dall''admin.'
      )
  END,
  TRUE,
  mc.cambio_id,
  COALESCE(mc.resolved_at, mc.created_at)
FROM medici_per_cambio mc
WHERE NOT EXISTS (
  SELECT 1 FROM public.messaggi m
  WHERE m.cambio_turno_id = mc.cambio_id
    AND m.medico_id = mc.medico_id
);
