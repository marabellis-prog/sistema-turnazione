-- Migration 002 — Flag globale autocalc_sub_med + trigger updated_at "smart"
--
-- Contesto:
--  - Aggiunta colonna `autocalc_sub_med` a `configurazione` per condividere
--    fra tutti gli admin il flag che governa il calcolo automatico di
--    TR/SUB/MED in Modifica Turni.
--  - Il trigger BEFORE UPDATE che bumpava `updated_at` su QUALSIASI
--    modifica forzava il refetch della query `['turni-modifica', updated_at]`
--    di ModificaTurniPage anche quando si cambiava solo il flag autocalc —
--    una "ricarica fastidiosa" della pagina senza necessità.
--  - Soluzione: trigger condizionale (clausola WHEN) che bumpa `updated_at`
--    SOLO se cambia un campo che influenza i turni o il calendario.
--    Cambiare solo `autocalc_sub_med` non lo tocca → niente refetch turni.

-- ── 1) Colonna autocalc_sub_med ──────────────────────────────────────
ALTER TABLE configurazione
  ADD COLUMN IF NOT EXISTS autocalc_sub_med BOOLEAN NOT NULL DEFAULT TRUE;

-- ── 2) Aggiungi tabella alla publication realtime ────────────────────
-- (Idempotente: ignora se già aggiunta)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'configurazione'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.configurazione';
  END IF;
END $$;

-- ── 3) Trigger smart updated_at ──────────────────────────────────────
DROP TRIGGER IF EXISTS trg_config_updated_at ON configurazione;
CREATE TRIGGER trg_config_updated_at
BEFORE UPDATE ON configurazione
FOR EACH ROW
WHEN (
  NEW.anno_inizio            IS DISTINCT FROM OLD.anno_inizio OR
  NEW.mese_inizio            IS DISTINCT FROM OLD.mese_inizio OR
  NEW.anno_fine              IS DISTINCT FROM OLD.anno_fine OR
  NEW.mese_fine              IS DISTINCT FROM OLD.mese_fine OR
  NEW.schema_attivo          IS DISTINCT FROM OLD.schema_attivo OR
  NEW.max_ferie_concomitanti IS DISTINCT FROM OLD.max_ferie_concomitanti
)
EXECUTE FUNCTION aggiorna_updated_at();

-- ── 4) Policy RLS self_read whitelist (con normalizzazione Gmail dot) ─
-- Già esistente come `ua_select`, aggiunta `self_read_whitelist` come
-- backup permissivo per il Gmail dot-trick (foo.bar@gmail.com vs
-- foobar@gmail.com sono lo stesso account).
DROP POLICY IF EXISTS self_read_whitelist ON utenti_autorizzati;
CREATE POLICY self_read_whitelist ON utenti_autorizzati
  FOR SELECT TO authenticated
  USING (
    lower(email) = lower(auth.jwt()->>'email')
    OR (
      lower(email) LIKE '%@gmail.com'
      AND lower(auth.jwt()->>'email') LIKE '%@gmail.com'
      AND replace(split_part(lower(email), '@', 1), '.', '')
        = replace(split_part(lower(auth.jwt()->>'email'), '@', 1), '.', '')
    )
  );
