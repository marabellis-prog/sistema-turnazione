-- 034_backup_completo_reparto.sql
-- Il backup salva TUTTO il reparto (config, turnisti, turni, ferie, cambi,
-- festività, tipi turno, proprietà, schemi, schemi_modello, subentri) in UN
-- SOLO record JSONB (compresso automaticamente da Postgres/TOAST → poco spazio,
-- niente migliaia di righe). Ripristino server-side ATOMICO (o tutto o niente),
-- retrocompatibile coi vecchi backup "solo turni" (versione assente).
--
-- MANUTENIBILITÀ: per aggiungere una tabella al backup, toccare SOLO le due
-- liste qui sotto (snapshot in _backup_reparto_snapshot + ripristino in
-- ripristina_reparto, rispettando l'ordine delle foreign key).

-- ── Snapshot COMPLETO del reparto in un'unica colonna JSONB ────────────────
CREATE OR REPLACE FUNCTION _backup_reparto_snapshot(p_reparto_id uuid, p_descrizione text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_id uuid; v_snap jsonb; v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM turni WHERE reparto_id = p_reparto_id;
  v_snap := jsonb_build_object(
    'versione', 2,
    'configurazione',   COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM configurazione   x WHERE x.reparto_id=p_reparto_id), '[]'::jsonb),
    'medici',           COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM medici           x WHERE x.reparto_id=p_reparto_id), '[]'::jsonb),
    'tipi_turno',       COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM tipi_turno       x WHERE x.reparto_id=p_reparto_id), '[]'::jsonb),
    'proprieta_turno',  COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM proprieta_turno  x WHERE x.reparto_id=p_reparto_id), '[]'::jsonb),
    'schemi',           COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM schemi           x WHERE x.reparto_id=p_reparto_id), '[]'::jsonb),
    'schemi_modello',   COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM schemi_modello   x WHERE x.reparto_id=p_reparto_id), '[]'::jsonb),
    'festivita_custom', COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM festivita_custom x WHERE x.reparto_id=p_reparto_id), '[]'::jsonb),
    'turni',            COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM turni            x WHERE x.reparto_id=p_reparto_id), '[]'::jsonb),
    'ferie',            COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM ferie            x WHERE x.reparto_id=p_reparto_id), '[]'::jsonb),
    'cambi_turno',      COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM cambi_turno      x WHERE x.reparto_id=p_reparto_id), '[]'::jsonb),
    'subentri',         COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM subentri         x WHERE x.reparto_id=p_reparto_id), '[]'::jsonb)
  );
  INSERT INTO turni_backup (reparto_id, descrizione, num_turni, snapshot)
    VALUES (p_reparto_id, p_descrizione, v_count, v_snap)
    RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- ── Ripristino COMPLETO e ATOMICO del reparto da un backup ─────────────────
CREATE OR REPLACE FUNCTION ripristina_reparto(p_backup_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_reparto uuid; v_snap jsonb; v_full boolean; v_count integer;
BEGIN
  SELECT reparto_id, snapshot INTO v_reparto, v_snap FROM turni_backup WHERE id = p_backup_id;
  IF v_reparto IS NULL THEN RAISE EXCEPTION 'Backup non trovato'; END IF;
  IF NOT puo_gestire_reparto(v_reparto) THEN RAISE EXCEPTION 'Permesso negato sul ripristino'; END IF;

  -- Safety net: backup pre-ripristino completo del reparto.
  PERFORM _backup_reparto_snapshot(v_reparto,
    'Pre-ripristino ' || to_char(now() AT TIME ZONE 'Europe/Rome', 'DD/MM/YYYY HH24:MI'));

  v_full := (v_snap ? 'medici');   -- versione 2 (completo) vs legacy (solo turni)

  IF v_full THEN
    -- DELETE figli → padri (rispetta le FK su medici)
    DELETE FROM turni           WHERE reparto_id = v_reparto;
    DELETE FROM ferie           WHERE reparto_id = v_reparto;
    DELETE FROM cambi_turno     WHERE reparto_id = v_reparto;
    DELETE FROM subentri        WHERE reparto_id = v_reparto;
    DELETE FROM schemi_modello  WHERE reparto_id = v_reparto;
    DELETE FROM schemi          WHERE reparto_id = v_reparto;
    DELETE FROM festivita_custom WHERE reparto_id = v_reparto;
    DELETE FROM proprieta_turno WHERE reparto_id = v_reparto;
    DELETE FROM tipi_turno      WHERE reparto_id = v_reparto;
    DELETE FROM configurazione  WHERE reparto_id = v_reparto;
    DELETE FROM medici          WHERE reparto_id = v_reparto;
    -- INSERT padri → figli (id preservati → le FK medico_id tornano coerenti)
    INSERT INTO medici           SELECT * FROM jsonb_populate_recordset(NULL::medici,           COALESCE(v_snap->'medici','[]'::jsonb));
    INSERT INTO configurazione   SELECT * FROM jsonb_populate_recordset(NULL::configurazione,   COALESCE(v_snap->'configurazione','[]'::jsonb));
    INSERT INTO tipi_turno       SELECT * FROM jsonb_populate_recordset(NULL::tipi_turno,       COALESCE(v_snap->'tipi_turno','[]'::jsonb));
    INSERT INTO proprieta_turno  SELECT * FROM jsonb_populate_recordset(NULL::proprieta_turno,  COALESCE(v_snap->'proprieta_turno','[]'::jsonb));
    INSERT INTO schemi           SELECT * FROM jsonb_populate_recordset(NULL::schemi,           COALESCE(v_snap->'schemi','[]'::jsonb));
    INSERT INTO schemi_modello   SELECT * FROM jsonb_populate_recordset(NULL::schemi_modello,   COALESCE(v_snap->'schemi_modello','[]'::jsonb));
    INSERT INTO festivita_custom SELECT * FROM jsonb_populate_recordset(NULL::festivita_custom, COALESCE(v_snap->'festivita_custom','[]'::jsonb));
    INSERT INTO turni            SELECT * FROM jsonb_populate_recordset(NULL::turni,            COALESCE(v_snap->'turni','[]'::jsonb));
    INSERT INTO ferie            SELECT * FROM jsonb_populate_recordset(NULL::ferie,            COALESCE(v_snap->'ferie','[]'::jsonb));
    INSERT INTO cambi_turno      SELECT * FROM jsonb_populate_recordset(NULL::cambi_turno,      COALESCE(v_snap->'cambi_turno','[]'::jsonb));
    INSERT INTO subentri         SELECT * FROM jsonb_populate_recordset(NULL::subentri,         COALESCE(v_snap->'subentri','[]'::jsonb));
  ELSE
    -- Legacy: solo turni (snapshot vecchio {turni:[...]}).
    DELETE FROM turni WHERE reparto_id = v_reparto;
    INSERT INTO turni SELECT * FROM jsonb_populate_recordset(NULL::turni, COALESCE(v_snap->'turni','[]'::jsonb));
  END IF;

  SELECT count(*) INTO v_count FROM turni WHERE reparto_id = v_reparto;
  RETURN jsonb_build_object('turni', v_count, 'completo', v_full);
END $$;

GRANT EXECUTE ON FUNCTION ripristina_reparto(uuid) TO authenticated;
