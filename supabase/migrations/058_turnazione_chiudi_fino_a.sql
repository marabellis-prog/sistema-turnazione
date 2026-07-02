-- 058_turnazione_chiudi_fino_a.sql
--
-- Redesign "Chiudi turnazione / Archivio":
--  * configurazione.chiusa_fino_a (date): ultimo giorno CHIUSO. generaColonne
--    nasconde le colonne <= chiusa_fino_a e aggiornaTurnazione non ripopola quei
--    giorni. L'anchor di rotazione (primoLunediDelPeriodo) NON cambia perche'
--    anno_inizio/mese_inizio restano intatti → continuita' automatica.
--  * chiudi_turnazione(p_reparto, p_fino_a, p_note): chiude FINO A una data
--    (inizio implicito = chiusa_fino_a+1 o inizio config). Snapshotta+cancella i
--    turni del periodo chiuso. Se chiude fino all'ultimo turno → chiusura TOTALE
--    (svuota tutto, libera schema, chiusa_fino_a=NULL → reparto "da generare").
--  * riapri_turnazione(p_archivio_id): riapre SOLO l'ultima chiusura, con blocco
--    se ci sono turni attivi sovrapposti anche di 1 giorno.
--  * snapshot medici ARRICCHITO (attivo/cognome/nome_proprio) per "Vedi turnazione".
-- Applicare con: node scripts/run-sql.mjs --file supabase/migrations/058_turnazione_chiudi_fino_a.sql --confirm-destructive

-- 1) Colonna stato chiusura
ALTER TABLE configurazione ADD COLUMN IF NOT EXISTS chiusa_fino_a date;
COMMENT ON COLUMN configurazione.chiusa_fino_a IS
  'Ultimo giorno CHIUSO/archiviato. generaColonne nasconde le colonne con data <= chiusa_fino_a; aggiornaTurnazione non ripopola quei giorni. NULL = niente chiuso. Anchor di rotazione invariato.';

-- 2) Chiudi turnazione FINO A una data
DROP FUNCTION IF EXISTS public.chiudi_turnazione(uuid, boolean, text);
DROP FUNCTION IF EXISTS public.chiudi_turnazione(uuid, date, text);

CREATE OR REPLACE FUNCTION public.chiudi_turnazione(
  p_reparto uuid, p_fino_a date, p_note text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $function$
DECLARE
  v_cfg configurazione%ROWTYPE;
  v_inizio_conf date; v_inizio_att date; v_max_turni date;
  v_snap jsonb; v_id uuid; v_totale boolean;
BEGIN
  IF NOT puo_gestire_reparto(p_reparto) THEN RAISE EXCEPTION 'Permesso negato'; END IF;
  SELECT * INTO v_cfg FROM configurazione WHERE reparto_id = p_reparto ORDER BY updated_at DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nessuna turnazione da chiudere per questo reparto'; END IF;

  v_inizio_conf := make_date(v_cfg.anno_inizio, v_cfg.mese_inizio, COALESCE(v_cfg.giorno_inizio, 1));
  v_inizio_att  := COALESCE(v_cfg.chiusa_fino_a + 1, v_inizio_conf);

  SELECT max(data) INTO v_max_turni FROM turni WHERE reparto_id = p_reparto;
  IF v_max_turni IS NULL THEN RAISE EXCEPTION 'Non ci sono turni da chiudere.'; END IF;
  IF p_fino_a < v_inizio_att THEN
    RAISE EXCEPTION 'La data di fine (%) e'' precedente all''inizio del periodo attivo (%).', p_fino_a, v_inizio_att; END IF;
  IF p_fino_a > v_max_turni THEN
    RAISE EXCEPTION 'La data di fine (%) supera l''ultimo turno inserito (%).', p_fino_a, v_max_turni; END IF;

  v_totale := (p_fino_a >= v_max_turni);

  v_snap := jsonb_build_object(
    'turni',  COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM turni t
                 WHERE t.reparto_id = p_reparto AND t.data >= v_inizio_att AND t.data <= p_fino_a), '[]'::jsonb),
    'config', to_jsonb(v_cfg),
    'medici', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                 'id', m.id, 'nome', m.nome, 'numero_ordine', m.numero_ordine,
                 'ruolo_reparto', m.ruolo_reparto, 'attivo', m.attivo,
                 'cognome', m.cognome, 'nome_proprio', m.nome_proprio))
                 FROM medici m WHERE m.reparto_id = p_reparto), '[]'::jsonb),
    'schema_meta', COALESCE((SELECT jsonb_agg(to_jsonb(s)) FROM schema_meta s WHERE s.reparto_id = p_reparto), '[]'::jsonb),
    'chiusura', jsonb_build_object('inizio', v_inizio_att, 'fine', p_fino_a, 'totale', v_totale)
  );

  INSERT INTO turnazioni_archivio (reparto_id, periodo_inizio, periodo_fine, snapshot, note, created_by)
    VALUES (p_reparto, v_inizio_att, p_fino_a, v_snap, p_note, (auth.jwt() ->> 'email'))
    RETURNING id INTO v_id;

  DELETE FROM turni WHERE reparto_id = p_reparto AND data >= v_inizio_att AND data <= p_fino_a;

  IF v_totale THEN
    DELETE FROM turni WHERE reparto_id = p_reparto;
    DELETE FROM turnazione_anteprima WHERE reparto_id = p_reparto;
    UPDATE configurazione SET schema_storico = '[]'::jsonb, chiusa_fino_a = NULL, updated_at = now()
      WHERE reparto_id = p_reparto;
  ELSE
    UPDATE configurazione SET chiusa_fino_a = p_fino_a, updated_at = now()
      WHERE reparto_id = p_reparto;
  END IF;

  RETURN v_id;
END; $function$;
GRANT EXECUTE ON FUNCTION public.chiudi_turnazione(uuid, date, text) TO authenticated;

-- 3) Riapri turnazione (solo l'ultima chiusura, con blocco anti-sovrapposizione)
CREATE OR REPLACE FUNCTION public.riapri_turnazione(p_archivio_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $function$
DECLARE
  v_arch turnazioni_archivio%ROWTYPE; v_last_id uuid;
  v_turni jsonb; v_overlap int; v_ins int := 0; v_prev_fine date;
BEGIN
  SELECT * INTO v_arch FROM turnazioni_archivio WHERE id = p_archivio_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Voce d''archivio inesistente.'; END IF;
  IF NOT puo_gestire_reparto(v_arch.reparto_id) THEN RAISE EXCEPTION 'Permesso negato'; END IF;

  SELECT id INTO v_last_id FROM turnazioni_archivio
    WHERE reparto_id = v_arch.reparto_id ORDER BY periodo_fine DESC, created_at DESC LIMIT 1;
  IF v_last_id <> p_archivio_id THEN
    RAISE EXCEPTION 'Si puo'' riaprire solo l''ultima turnazione chiusa.'; END IF;

  SELECT count(*) INTO v_overlap FROM turni
    WHERE reparto_id = v_arch.reparto_id AND data >= v_arch.periodo_inizio AND data <= v_arch.periodo_fine;
  IF v_overlap > 0 THEN
    RAISE EXCEPTION 'Non riapribile: ci sono % turni attivi sovrapposti al periodo (% -> %). Rimuovili prima.',
      v_overlap, v_arch.periodo_inizio, v_arch.periodo_fine; END IF;

  -- Reinserisce i turni dallo snapshot verbatim (id vecchi liberi perche' i turni
  -- del periodo erano stati cancellati; reparto_id gia' corretto nello snapshot).
  v_turni := COALESCE(v_arch.snapshot -> 'turni', '[]'::jsonb);
  INSERT INTO turni SELECT * FROM jsonb_populate_recordset(NULL::turni, v_turni);
  GET DIAGNOSTICS v_ins = ROW_COUNT;

  -- Roll-back chiusa_fino_a alla fine della chiusura precedente (o NULL).
  SELECT max(periodo_fine) INTO v_prev_fine FROM turnazioni_archivio
    WHERE reparto_id = v_arch.reparto_id AND id <> p_archivio_id;
  UPDATE configurazione SET chiusa_fino_a = v_prev_fine, updated_at = now()
    WHERE reparto_id = v_arch.reparto_id;

  DELETE FROM turnazioni_archivio WHERE id = p_archivio_id;
  RETURN jsonb_build_object('turni_ripristinati', v_ins, 'chiusa_fino_a', v_prev_fine);
END; $function$;
GRANT EXECUTE ON FUNCTION public.riapri_turnazione(uuid) TO authenticated;
