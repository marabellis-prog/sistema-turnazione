-- 050_schema_in_uso_guard.sql
--
-- #36 (enforcement SERVER-SIDE). Il blocco lato client disabilita i pulsanti,
-- ma "dovrebbe dare errore" anche se qualcuno forza la chiamata. Aggiungiamo
-- una guardia negli RPC che modificano/eliminano uno schema: se lo schema è IN
-- USO dalla turnazione attiva (effettivo per ≥1 giorno, da schema_storico) →
-- eccezione. Stessa logica del client (lib/schemiInUso.ts).

CREATE OR REPLACE FUNCTION public.schema_in_uso(p_reparto uuid, p_num integer)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
AS $function$
DECLARE
  v_cfg configurazione%ROWTYPE;
  v_storico jsonb;
  v_inizio date; v_fine date; v_g date; v_eff int;
BEGIN
  SELECT * INTO v_cfg FROM configurazione WHERE reparto_id = p_reparto
    ORDER BY updated_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN false; END IF;

  v_storico := COALESCE(v_cfg.schema_storico, '[]'::jsonb);
  -- Nessuna cronologia → l'intera turnazione usa schema_attivo.
  IF jsonb_array_length(v_storico) = 0 THEN
    RETURN COALESCE(v_cfg.schema_attivo, -1) = p_num;
  END IF;

  v_inizio := make_date(v_cfg.anno_inizio, v_cfg.mese_inizio, COALESCE(v_cfg.giorno_inizio, 1));
  v_fine := make_date(v_cfg.anno_fine, v_cfg.mese_fine,
    COALESCE(v_cfg.giorno_fine,
      EXTRACT(DAY FROM (make_date(v_cfg.anno_fine, v_cfg.mese_fine, 1) + interval '1 month - 1 day'))::int));

  v_g := v_inizio;
  WHILE v_g <= v_fine LOOP
    -- epoca effettiva del giorno: dal massimo <= giorno (pari-dal → ord maggiore)
    SELECT (e.val->>'schema')::int INTO v_eff
    FROM jsonb_array_elements(v_storico) WITH ORDINALITY AS e(val, ord)
    WHERE (e.val->>'dal') <= to_char(v_g, 'YYYY-MM-DD')
    ORDER BY (e.val->>'dal') DESC, e.ord DESC LIMIT 1;
    IF v_eff IS NULL THEN   -- giorni prima della prima 'dal' → prima epoca
      SELECT (e.val->>'schema')::int INTO v_eff
      FROM jsonb_array_elements(v_storico) AS e(val)
      ORDER BY (e.val->>'dal') ASC LIMIT 1;
    END IF;
    IF v_eff = p_num THEN RETURN true; END IF;
    v_g := v_g + 1;
  END LOOP;
  RETURN false;
END;
$function$;

-- ── azzera_schema: + guardia in-uso ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.azzera_schema(p_reparto uuid, p_num integer)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER
AS $function$
DECLARE t text;
BEGIN
  IF NOT puo_gestire_reparto(p_reparto) THEN RAISE EXCEPTION 'Permesso negato'; END IF;
  IF schema_in_uso(p_reparto, p_num) THEN
    RAISE EXCEPTION 'Schema % in uso nella turnazione attiva: duplicalo per modificarlo', p_num;
  END IF;
  FOREACH t IN ARRAY ARRAY['schema_cella','schema_giorno_colonna','schema_colonna',
                           'schema_giorno','schema_fabbisogno','tipi_turno','proprieta_turno'] LOOP
    EXECUTE format('DELETE FROM %I WHERE reparto_id=$1 AND schema_num=$2', t) USING p_reparto, p_num;
  END LOOP;
END;
$function$;

-- ── elimina_schema: + guardia in-uso ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.elimina_schema(p_reparto uuid, p_num integer)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER
AS $function$
DECLARE t text;
BEGIN
  IF NOT puo_gestire_reparto(p_reparto) THEN RAISE EXCEPTION 'Permesso negato'; END IF;
  IF schema_in_uso(p_reparto, p_num) THEN
    RAISE EXCEPTION 'Schema % in uso nella turnazione attiva: duplicalo per modificarlo', p_num;
  END IF;
  FOREACH t IN ARRAY ARRAY['schema_cella','schema_giorno_colonna','schema_colonna',
                           'schema_giorno','schema_fabbisogno','tipi_turno','proprieta_turno','schema_meta'] LOOP
    EXECUTE format('DELETE FROM %I WHERE reparto_id=$1 AND schema_num=$2', t) USING p_reparto, p_num;
    EXECUTE format('UPDATE %I SET schema_num = -schema_num WHERE reparto_id=$1 AND schema_num > $2', t) USING p_reparto, p_num;
    EXECUTE format('UPDATE %I SET schema_num = (-schema_num) - 1 WHERE reparto_id=$1 AND schema_num < 0', t) USING p_reparto;
  END LOOP;
END;
$function$;

-- ── salva_schema_struttura: + guardia in-uso ────────────────────────────────
CREATE OR REPLACE FUNCTION public.salva_schema_struttura(p_reparto uuid, p_num integer, p_giorni jsonb, p_colonne jsonb, p_checks jsonb, p_celle jsonb, p_fabbisogno jsonb)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  IF NOT puo_gestire_reparto(p_reparto) THEN RAISE EXCEPTION 'Permesso negato'; END IF;
  IF schema_in_uso(p_reparto, p_num) THEN
    RAISE EXCEPTION 'Schema % in uso nella turnazione attiva: duplicalo per modificarlo', p_num;
  END IF;

  DELETE FROM schema_cella          WHERE reparto_id = p_reparto AND schema_num = p_num;
  DELETE FROM schema_giorno_colonna WHERE reparto_id = p_reparto AND schema_num = p_num;
  DELETE FROM schema_colonna        WHERE reparto_id = p_reparto AND schema_num = p_num;
  DELETE FROM schema_giorno         WHERE reparto_id = p_reparto AND schema_num = p_num;
  DELETE FROM schema_fabbisogno     WHERE reparto_id = p_reparto AND schema_num = p_num;

  INSERT INTO schema_giorno (reparto_id, schema_num, giorno_settimana, ordine)
    SELECT p_reparto, p_num, (x->>'giorno_settimana')::int, COALESCE((x->>'ordine')::int, 0)
    FROM jsonb_array_elements(p_giorni) x;

  INSERT INTO schema_colonna (reparto_id, schema_num, tipo, sigla, ordine)
    SELECT p_reparto, p_num, x->>'tipo', x->>'sigla', COALESCE((x->>'ordine')::int, 0)
    FROM jsonb_array_elements(p_colonne) x;

  INSERT INTO schema_giorno_colonna (reparto_id, schema_num, giorno_settimana, colonna_sigla, attivo)
    SELECT p_reparto, p_num, (x->>'giorno_settimana')::int, x->>'colonna_sigla', true
    FROM jsonb_array_elements(p_checks) x;

  INSERT INTO schema_cella (reparto_id, schema_num, giorno_settimana, slot_idx, colonna_sigla, numero, attivo)
    SELECT p_reparto, p_num, (x->>'giorno_settimana')::int, (x->>'slot_idx')::int, x->>'colonna_sigla',
           NULLIF(x->>'numero','')::int, COALESCE((x->>'attivo')::boolean, false)
    FROM jsonb_array_elements(p_celle) x;

  INSERT INTO schema_fabbisogno (reparto_id, schema_num, ambito, turno_sigla, totale, per_proprieta)
    SELECT p_reparto, p_num, x->>'ambito', x->>'turno_sigla',
           COALESCE((x->>'totale')::int, 0), COALESCE(x->'per_proprieta', '{}'::jsonb)
    FROM jsonb_array_elements(p_fabbisogno) x;
END;
$function$;
