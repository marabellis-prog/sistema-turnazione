-- 060_schema_in_uso_turni_aware.sql
-- FIX: la guardia DB schema_in_uso() considerava uno schema "in uso" quando
-- schema_storico=[] e schema_attivo=p_num, ANCHE senza alcun turno generato.
-- Così su un reparto fresco/copiato (0 turni) salva_schema_struttura falliva con
-- "Schema N in uso" mentre il client (schemiInUso turni-aware) chiamava proprio
-- quella RPC. Allineo il DB al client: senza turni non c'è turnazione attiva →
-- nessuno schema è in uso. Il resto della logica (epoche schema_storico) invariato.
CREATE OR REPLACE FUNCTION public.schema_in_uso(p_reparto uuid, p_num integer)
 RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
AS $function$
DECLARE
  v_cfg configurazione%ROWTYPE;
  v_storico jsonb;
  v_inizio date; v_fine date; v_g date; v_eff int;
BEGIN
  SELECT * INTO v_cfg FROM configurazione WHERE reparto_id = p_reparto
    ORDER BY updated_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN false; END IF;

  -- Senza turni GENERATI non c'e' turnazione attiva → nessuno schema e' "in uso".
  IF NOT EXISTS (SELECT 1 FROM turni WHERE reparto_id = p_reparto) THEN RETURN false; END IF;

  v_storico := COALESCE(v_cfg.schema_storico, '[]'::jsonb);
  IF jsonb_array_length(v_storico) = 0 THEN
    RETURN COALESCE(v_cfg.schema_attivo, -1) = p_num;
  END IF;

  v_inizio := make_date(v_cfg.anno_inizio, v_cfg.mese_inizio, COALESCE(v_cfg.giorno_inizio, 1));
  v_fine := make_date(v_cfg.anno_fine, v_cfg.mese_fine,
    COALESCE(v_cfg.giorno_fine,
      EXTRACT(DAY FROM (make_date(v_cfg.anno_fine, v_cfg.mese_fine, 1) + interval '1 month - 1 day'))::int));

  v_g := v_inizio;
  WHILE v_g <= v_fine LOOP
    SELECT (e.val->>'schema')::int INTO v_eff
    FROM jsonb_array_elements(v_storico) WITH ORDINALITY AS e(val, ord)
    WHERE (e.val->>'dal') <= to_char(v_g, 'YYYY-MM-DD')
    ORDER BY (e.val->>'dal') DESC, e.ord DESC LIMIT 1;
    IF v_eff IS NULL THEN
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
