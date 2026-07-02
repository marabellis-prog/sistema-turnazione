-- 054_centro_eventi_e_elimina_reparto.sql
--
-- 1) centro_eventi  — log "storico" degli eventi importanti del gestionale,
--    mostrato nel Centro di Controllo (solo super-admin). SOPRAVVIVE alla
--    cancellazione di un reparto (nessuna FK verso reparti: teniamo il NOME
--    congelato) → è la "traccia" che resta quando un reparto viene eliminato.
--
-- 2) elimina_reparto(p_reparto) — cancellazione CONTROLLATA e ATOMICA di un
--    reparto e di TUTTI i suoi dati, scopata ESCLUSIVAMENTE a quel reparto
--    (mondo isolato): turnisti, turni, ferie, cambi, schemi, anteprime, backup,
--    festività, responsabili, tipi/proprietà + le notifiche collegate. Nessuna
--    interazione con altri reparti. Lascia solo l'evento nel log.

-- ── 1) Tabella log ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS centro_eventi (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  tipo         text NOT NULL CHECK (tipo IN (
                 'reparto_creato', 'calendario_generato', 'aggiornamento_approvato',
                 'backup_ripristinato', 'reparto_disattivato', 'reparto_eliminato')),
  reparto_id   uuid,               -- informativo (NO FK → sopravvive alla delete)
  reparto_nome text NOT NULL,      -- nome congelato (resta anche dopo l'eliminazione)
  descrizione  text,
  autore       text                -- email di chi ha compiuto l'azione
);
CREATE INDEX IF NOT EXISTS idx_centro_eventi_created ON centro_eventi (created_at DESC);

ALTER TABLE centro_eventi ENABLE ROW LEVEL SECURITY;
-- GRANT esplicito (policy Data API dal 30/10/2026 per le tabelle nuove).
GRANT SELECT, INSERT ON centro_eventi TO authenticated;

DROP POLICY IF EXISTS ce_select ON centro_eventi;
CREATE POLICY ce_select ON centro_eventi FOR SELECT USING (is_super_admin());
-- Le INSERT passano solo dalle funzioni SECURITY DEFINER qui sotto (che girano
-- come owner e bypassano la RLS): nessuna policy INSERT diretta.

-- ── 2) Registrazione evento (chiamata dal client dopo le azioni) ──────────────
CREATE OR REPLACE FUNCTION public.registra_evento_centro(
  p_tipo text, p_reparto_id uuid, p_reparto_nome text, p_descrizione text DEFAULT NULL)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  -- Chi gestisce quel reparto (o il super-admin) può registrare l'evento.
  IF NOT (is_super_admin() OR (p_reparto_id IS NOT NULL AND puo_gestire_reparto(p_reparto_id))) THEN
    RAISE EXCEPTION 'Permesso negato';
  END IF;
  INSERT INTO centro_eventi (tipo, reparto_id, reparto_nome, descrizione, autore)
    VALUES (p_tipo, p_reparto_id, p_reparto_nome, p_descrizione, auth.jwt() ->> 'email');
END;
$function$;
GRANT EXECUTE ON FUNCTION public.registra_evento_centro(text, uuid, text, text) TO authenticated;

-- ── 3) Eliminazione reparto (super-admin, cascata controllata) ────────────────
CREATE OR REPLACE FUNCTION public.elimina_reparto(p_reparto uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
AS $function$
DECLARE
  v_nome text; v_medici int; v_turni int;
BEGIN
  IF p_reparto = '11111111-1111-4111-8111-111111111111'::uuid THEN
    RAISE EXCEPTION 'Il reparto principale (11N) non può essere eliminato';
  END IF;
  IF NOT is_super_admin() THEN RAISE EXCEPTION 'Permesso negato'; END IF;

  SELECT nome INTO v_nome FROM reparti WHERE id = p_reparto;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reparto inesistente'; END IF;

  SELECT count(*) INTO v_medici FROM medici WHERE reparto_id = p_reparto;
  SELECT count(*) INTO v_turni  FROM turni  WHERE reparto_id = p_reparto;

  -- (1) Notifiche BROADCAST admin legate alle richieste del reparto: vanno
  --     cancellate PRIMA di cambi/ferie (dopo la FK farebbe solo SET NULL e
  --     perderei il legame). Le notifiche personali (medico_id) cascatano da medici.
  DELETE FROM messaggi
    WHERE cambio_turno_id IN (SELECT id FROM cambi_turno WHERE reparto_id = p_reparto)
       OR ferie_id        IN (SELECT id FROM ferie       WHERE reparto_id = p_reparto);

  -- (2) Tabelle con FK NO ACTION verso reparti + FK verso medici: esplicite,
  --     nell'ordine che rispetta i vincoli (figli → medici).
  DELETE FROM turni       WHERE reparto_id = p_reparto;
  DELETE FROM subentri    WHERE reparto_id = p_reparto;   -- FK a medici: prima di medici
  DELETE FROM cambi_turno WHERE reparto_id = p_reparto;
  DELETE FROM ferie       WHERE reparto_id = p_reparto;
  DELETE FROM medici      WHERE reparto_id = p_reparto;   -- cascata messaggi.medico_id

  -- (3) Il reparto: la CASCADE porta via il resto (configurazione, festività,
  --     tipi_turno, proprieta_turno, schemi, schemi_modello, schema_*,
  --     turnazione_anteprima, turnazioni_archivio, turni_backup, responsabili).
  DELETE FROM reparti WHERE id = p_reparto;

  -- (4) Traccia nel log (sopravvive: nessuna FK verso reparti).
  INSERT INTO centro_eventi (tipo, reparto_id, reparto_nome, descrizione, autore)
    VALUES ('reparto_eliminato', p_reparto, v_nome,
      format('Eliminato definitivamente il reparto "%s" con tutti i suoi dati (%s turnisti, %s turni).',
             v_nome, v_medici, v_turni),
      auth.jwt() ->> 'email');

  RETURN jsonb_build_object('nome', v_nome, 'medici', v_medici, 'turni', v_turni);
END;
$function$;
GRANT EXECUTE ON FUNCTION public.elimina_reparto(uuid) TO authenticated;
