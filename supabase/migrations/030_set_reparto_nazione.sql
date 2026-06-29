-- 030_set_reparto_nazione.sql
-- RPC per impostare la nazione di un reparto: consentita a chi PUO' GESTIRE
-- il reparto (super-admin o responsabile), non solo super-admin.
CREATE OR REPLACE FUNCTION set_reparto_nazione(p_reparto_id uuid, p_nazione text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT puo_gestire_reparto(p_reparto_id) THEN
    RAISE EXCEPTION 'Permesso negato sul reparto';
  END IF;
  UPDATE reparti SET nazione = p_nazione WHERE id = p_reparto_id;
END $$;
GRANT EXECUTE ON FUNCTION set_reparto_nazione(uuid, text) TO authenticated;
