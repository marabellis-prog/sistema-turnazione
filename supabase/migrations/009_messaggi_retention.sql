-- Migration 009 — Retention automatica messaggi
--
-- Pone un limite massimo di messaggi per destinatario, applicato via
-- trigger DB AFTER INSERT cosi` la pulizia e` garantita lato DB senza
-- race condition lato app (la chiamata app-side che fa INSERT non si
-- preoccupa di nulla, il trigger fa cleanup in automatico).
--
-- Limiti:
--   - medico turnista: 80 messaggi (per medico)
--   - admin (broadcast): 500 messaggi totali
--
-- Quando si supera il limite, vengono eliminati i messaggi piu` VECCHI
-- (created_at minore) cosi` la casella resta sempre coi messaggi piu`
-- recenti, che sono quelli rilevanti.

-- ── 1) Funzione trigger ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.messaggi_enforce_retention()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER         -- aggira RLS: serve per cancellare messaggi
                          -- di un altro medico se un admin fa INSERT
SET search_path = public  -- safety: evita schema hijacking
AS $$
BEGIN
  -- Broadcast admin: conta TUTTI i messaggi destinatario_ruolo='admin'
  -- del sistema e tieni solo i 500 piu` recenti.
  IF NEW.destinatario_ruolo = 'admin' THEN
    DELETE FROM public.messaggi
    WHERE id IN (
      SELECT id FROM public.messaggi
      WHERE destinatario_ruolo = 'admin'
      ORDER BY created_at DESC
      OFFSET 500
    );
  -- Messaggio diretto a un medico: conta i messaggi di quel medico
  -- e tieni solo gli 80 piu` recenti.
  ELSIF NEW.medico_id IS NOT NULL THEN
    DELETE FROM public.messaggi
    WHERE id IN (
      SELECT id FROM public.messaggi
      WHERE destinatario_ruolo = 'medico'
        AND medico_id = NEW.medico_id
      ORDER BY created_at DESC
      OFFSET 80
    );
  END IF;
  RETURN NULL;  -- AFTER trigger: il valore di ritorno e` ignorato
END;
$$;

-- ── 2) Trigger AFTER INSERT ──────────────────────────────────────────
-- Drop + create per essere idempotente in caso di ri-applicazione.
DROP TRIGGER IF EXISTS trg_messaggi_retention ON public.messaggi;
CREATE TRIGGER trg_messaggi_retention
  AFTER INSERT ON public.messaggi
  FOR EACH ROW
  EXECUTE FUNCTION public.messaggi_enforce_retention();

-- ── 3) Cleanup iniziale: applica retention ai messaggi esistenti ─────
-- Per ogni medico, elimina i suoi messaggi oltre l'80esimo (i piu`
-- vecchi). Per il broadcast admin, elimina oltre il 500esimo.
-- Idempotente: ri-applicabile senza effetti collaterali.

WITH ranked_medico AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY medico_id
    ORDER BY created_at DESC
  ) AS rn
  FROM public.messaggi
  WHERE destinatario_ruolo = 'medico'
)
DELETE FROM public.messaggi
WHERE id IN (SELECT id FROM ranked_medico WHERE rn > 80);

WITH ranked_admin AS (
  SELECT id, ROW_NUMBER() OVER (
    ORDER BY created_at DESC
  ) AS rn
  FROM public.messaggi
  WHERE destinatario_ruolo = 'admin'
)
DELETE FROM public.messaggi
WHERE id IN (SELECT id FROM ranked_admin WHERE rn > 500);
