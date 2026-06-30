-- 033_backup_server_side.sql
-- Backup TURNI lato SERVER: snapshot fatto nel DB (non nel browser) → immune a
-- cambio pagina/reparto, tab chiuso, backup concorrenti. Trigger on-access via
-- RPC + garanzia giornaliera via pg_cron. Tutto PER-REPARTO. 11N intoccato.

-- ── Helper interni (NIENTE check permessi: chiamati solo dai wrapper/cron) ──

-- Snapshot dei turni di un reparto in un nuovo record turni_backup.
CREATE OR REPLACE FUNCTION _backup_reparto_snapshot(p_reparto_id uuid, p_descrizione text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_id uuid; v_turni jsonb; v_count integer;
BEGIN
  SELECT COALESCE(jsonb_agg(to_jsonb(t) - 'id' - 'created_at' - 'updated_at'), '[]'::jsonb),
         count(*)
    INTO v_turni, v_count
    FROM turni t WHERE t.reparto_id = p_reparto_id;
  INSERT INTO turni_backup (reparto_id, descrizione, num_turni, snapshot)
    VALUES (p_reparto_id, p_descrizione, v_count, jsonb_build_object('turni', v_turni))
    RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- Rotazione: tieni solo gli ultimi N backup del reparto.
CREATE OR REPLACE FUNCTION _ruota_backup_reparto(p_reparto_id uuid, p_da_tenere integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF p_da_tenere < 1 THEN RETURN; END IF;
  DELETE FROM turni_backup WHERE id IN (
    SELECT id FROM turni_backup WHERE reparto_id = p_reparto_id
    ORDER BY created_at DESC OFFSET p_da_tenere
  );
END $$;

-- ── Auto-backup di UN reparto (due-check sulla policy globale) ──────────────
-- Idempotente: crea il backup solo se l'ultimo è più vecchio dell'intervallo.
-- Il cron (auth.uid() NULL) bypassa il check permessi; gli utenti devono poter
-- gestire il reparto (responsabile/admin) altrimenti è un no-op silenzioso.
CREATE OR REPLACE FUNCTION auto_backup_reparto(p_reparto_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_interval integer; v_keep integer; v_last timestamptz;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT puo_gestire_reparto(p_reparto_id) THEN
    RETURN;
  END IF;
  SELECT backup_intervallo_giorni, backup_da_tenere INTO v_interval, v_keep
    FROM impostazioni_globali LIMIT 1;
  IF v_interval IS NULL OR v_interval <= 0 THEN RETURN; END IF;   -- 0 = disattivato
  SELECT max(created_at) INTO v_last FROM turni_backup WHERE reparto_id = p_reparto_id;
  IF v_last IS NOT NULL AND v_last > now() - (v_interval || ' days')::interval THEN
    RETURN;   -- backup recente → non serve
  END IF;
  PERFORM _backup_reparto_snapshot(p_reparto_id,
    'Auto-backup ' || to_char(now() AT TIME ZONE 'Europe/Rome', 'DD/MM/YYYY HH24:MI'));
  PERFORM _ruota_backup_reparto(p_reparto_id, COALESCE(v_keep, 10));
END $$;

-- ── Backup MANUALE di un reparto (responsabile/admin) ──────────────────────
CREATE OR REPLACE FUNCTION backup_reparto(p_reparto_id uuid, p_descrizione text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_id uuid; v_count integer; v_keep integer;
BEGIN
  IF NOT puo_gestire_reparto(p_reparto_id) THEN
    RAISE EXCEPTION 'Permesso negato sul backup del reparto';
  END IF;
  v_id := _backup_reparto_snapshot(p_reparto_id, p_descrizione);
  SELECT backup_da_tenere INTO v_keep FROM impostazioni_globali LIMIT 1;
  PERFORM _ruota_backup_reparto(p_reparto_id, COALESCE(v_keep, 10));
  SELECT num_turni INTO v_count FROM turni_backup WHERE id = v_id;
  RETURN jsonb_build_object('id', v_id, 'num_turni', v_count);
END $$;

-- ── Auto-backup di TUTTI i reparti attivi (per il cron) ────────────────────
CREATE OR REPLACE FUNCTION auto_backup_tutti()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM reparti WHERE attivo = true LOOP
    PERFORM auto_backup_reparto(r.id);
  END LOOP;
END $$;

-- ── Permessi: solo i wrapper pubblici sono chiamabili dagli utenti ─────────
REVOKE ALL ON FUNCTION _backup_reparto_snapshot(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION _ruota_backup_reparto(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION auto_backup_tutti() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auto_backup_reparto(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION backup_reparto(uuid, text) TO authenticated;
