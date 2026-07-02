-- 051_turnazioni_archivio.sql
--
-- #37 — "Chiudi turnazione / Archivio". Congela uno snapshot JSON della
-- turnazione corrente (turni + config + medici + schema) in una tabella
-- consultabile per periodo, e LIBERA lo schema (schema_storico → []), così
-- schemiInUso() torna vuoto e lo schema è di nuovo modificabile/eliminabile.
-- Opzionale: svuota anche i turni correnti (checkbox nel modal). ADDITIVO.

CREATE TABLE IF NOT EXISTS turnazioni_archivio (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reparto_id     uuid NOT NULL REFERENCES reparti(id) ON DELETE CASCADE,
  periodo_inizio date NOT NULL,
  periodo_fine   date NOT NULL,
  etichetta      text,
  snapshot       jsonb NOT NULL,
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     text
);
CREATE INDEX IF NOT EXISTS idx_turnaz_arch_reparto ON turnazioni_archivio (reparto_id, periodo_inizio DESC);

ALTER TABLE turnazioni_archivio ENABLE ROW LEVEL SECURITY;
-- GRANT esplicito (policy Data API dal 30/10/2026: le tabelle nuove lo richiedono).
GRANT SELECT, INSERT, UPDATE, DELETE ON turnazioni_archivio TO authenticated;

DROP POLICY IF EXISTS ta_arch_select ON turnazioni_archivio;
CREATE POLICY ta_arch_select ON turnazioni_archivio FOR SELECT
  USING (puo_vedere_reparto(reparto_id));
DROP POLICY IF EXISTS ta_arch_all ON turnazioni_archivio;
CREATE POLICY ta_arch_all ON turnazioni_archivio FOR ALL
  USING (puo_gestire_reparto(reparto_id)) WITH CHECK (puo_gestire_reparto(reparto_id));

-- ── Chiudi turnazione ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.chiudi_turnazione(p_reparto uuid, p_svuota_turni boolean DEFAULT false, p_note text DEFAULT NULL)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
AS $function$
DECLARE
  v_cfg configurazione%ROWTYPE;
  v_snap jsonb; v_id uuid; v_inizio date; v_fine date;
BEGIN
  IF NOT puo_gestire_reparto(p_reparto) THEN RAISE EXCEPTION 'Permesso negato'; END IF;
  SELECT * INTO v_cfg FROM configurazione WHERE reparto_id = p_reparto ORDER BY updated_at DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nessuna turnazione da chiudere per questo reparto'; END IF;

  v_inizio := make_date(v_cfg.anno_inizio, v_cfg.mese_inizio, COALESCE(v_cfg.giorno_inizio, 1));
  v_fine := make_date(v_cfg.anno_fine, v_cfg.mese_fine,
    COALESCE(v_cfg.giorno_fine,
      EXTRACT(DAY FROM (make_date(v_cfg.anno_fine, v_cfg.mese_fine, 1) + interval '1 month - 1 day'))::int));

  v_snap := jsonb_build_object(
    'turni',  COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM turni t WHERE t.reparto_id = p_reparto), '[]'::jsonb),
    'config', to_jsonb(v_cfg),
    'medici', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', m.id, 'nome', m.nome,
                'numero_ordine', m.numero_ordine, 'ruolo_reparto', m.ruolo_reparto))
                FROM medici m WHERE m.reparto_id = p_reparto), '[]'::jsonb),
    'schema_meta', COALESCE((SELECT jsonb_agg(to_jsonb(s)) FROM schema_meta s WHERE s.reparto_id = p_reparto), '[]'::jsonb)
  );

  INSERT INTO turnazioni_archivio (reparto_id, periodo_inizio, periodo_fine, snapshot, note, created_by)
    VALUES (p_reparto, v_inizio, v_fine, v_snap, p_note, (auth.jwt() ->> 'email'))
    RETURNING id INTO v_id;

  -- Libera lo schema: schema_storico → [] (schemiInUso torna vuoto).
  UPDATE configurazione SET schema_storico = '[]'::jsonb, updated_at = now()
    WHERE reparto_id = p_reparto;

  -- Opzionale: svuota i turni correnti (blank slate per la nuova turnazione).
  IF p_svuota_turni THEN
    DELETE FROM turni WHERE reparto_id = p_reparto;
    DELETE FROM turnazione_anteprima WHERE reparto_id = p_reparto;
  END IF;

  RETURN v_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.chiudi_turnazione(uuid, boolean, text) TO authenticated;
