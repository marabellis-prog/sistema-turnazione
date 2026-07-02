-- 057_pulisci_cambi_turnazione.sql
--
-- All'approvazione di un "Aggiorna turnazione", i cambi turno dalla data di
-- entrata in vigore (cutover) non hanno più senso: il nuovo calendario
-- riscrive quei giorni. Questa RPC, chiamata DOPO la pubblicazione della bozza:
--   1) cancella i record cambi_turno che toccano date >= cutover;
--   2) ripristina i turni dal cutover al valore PULITO della rotazione
--      (turno_clinico_base), togliendo il marcatore di cambio
--      (turno_clinico_originario) e modificato_manualmente.
-- I cambi PRIMA del cutover (già passati) NON vengono toccati.

CREATE OR REPLACE FUNCTION public.pulisci_cambi_turnazione(p_reparto uuid, p_dal date)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
AS $function$
DECLARE v_cambi int; v_turni int;
BEGIN
  IF NOT puo_gestire_reparto(p_reparto) THEN RAISE EXCEPTION 'Permesso negato'; END IF;

  -- 1) Cancella i cambi turno che toccano almeno un giorno dal cutover in poi.
  WITH del AS (
    DELETE FROM cambi_turno c
     WHERE c.reparto_id = p_reparto
       AND EXISTS (SELECT 1 FROM jsonb_array_elements(c.modifiche) m
                    WHERE (m->>'data') >= p_dal::text)
    RETURNING 1)
  SELECT count(*) INTO v_cambi FROM del;

  -- 2) Ripristina i turni "cambiati" dal cutover al valore pulito (base).
  WITH upd AS (
    UPDATE turni t SET
      turno_clinico            = COALESCE(t.turno_clinico_base, t.turno_clinico),
      turno_ricerca            = COALESCE(t.turno_ricerca_base, t.turno_ricerca),
      turno_clinico_originario = NULL,
      modificato_manualmente   = false
     WHERE t.reparto_id = p_reparto
       AND t.data >= p_dal
       AND t.turno_clinico_originario IS NOT NULL
    RETURNING 1)
  SELECT count(*) INTO v_turni FROM upd;

  RETURN jsonb_build_object('cambi_eliminati', v_cambi, 'turni_ripuliti', v_turni);
END;
$function$;
GRANT EXECUTE ON FUNCTION public.pulisci_cambi_turnazione(uuid, date) TO authenticated;
