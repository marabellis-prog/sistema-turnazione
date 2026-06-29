-- 025: Subentro — sostituzione di un turnista mantenendo la posizione in
-- rotazione (numero_ordine). Il turnista uscente NON si cancella: si "ritira"
-- (attivo=false, numero_ordine liberato) così i suoi turni storici e le sue
-- statistiche restano suoi (i turni puntano al medico per medico_id → lo split
-- storico/nuovo è automatico, il confine è la data di subentro).

-- numero_ordine nullable: serve a "parcheggiare" l'uscente senza collidere col
-- subentrante che eredita la sua posizione. UNIQUE(reparto_id, numero_ordine)
-- ammette più NULL, quindi i ritirati non si pestano i piedi.
ALTER TABLE medici ALTER COLUMN numero_ordine DROP NOT NULL;

-- Registro dei subentri (per lo storico "Bianchi → Rossi dal …").
CREATE TABLE IF NOT EXISTS subentri (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reparto_id         uuid NOT NULL REFERENCES reparti(id) ON DELETE CASCADE,
  numero_ordine      integer,
  medico_uscente_id  uuid REFERENCES medici(id),
  medico_entrante_id uuid REFERENCES medici(id),
  data_subentro      date NOT NULL,
  nota               text,
  created_at         timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE subentri ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS subentri_select ON subentri;
DROP POLICY IF EXISTS subentri_modify ON subentri;
CREATE POLICY subentri_select ON subentri FOR SELECT USING (puo_vedere_reparto(reparto_id));
CREATE POLICY subentri_modify ON subentri FOR ALL USING (puo_gestire_reparto(reparto_id)) WITH CHECK (puo_gestire_reparto(reparto_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON subentri TO authenticated;
GRANT SELECT ON subentri TO anon;

-- RPC atomica: ritira l'uscente, crea l'entrante nella sua posizione, logga.
CREATE OR REPLACE FUNCTION esegui_subentro(
  p_reparto uuid, p_uscente_id uuid, p_entrante_utente_id uuid,
  p_nome text, p_cognome text, p_nome_proprio text, p_data date, p_nota text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ord integer; v_entrante uuid;
BEGIN
  IF NOT puo_gestire_reparto(p_reparto) THEN RAISE EXCEPTION 'non autorizzato'; END IF;
  SELECT numero_ordine INTO v_ord FROM medici WHERE id = p_uscente_id AND reparto_id = p_reparto AND attivo;
  IF v_ord IS NULL THEN RAISE EXCEPTION 'turnista uscente non valido o gia ritirato'; END IF;
  -- libera la posizione ritirando l'uscente (resta proprietario dei suoi turni)
  UPDATE medici SET attivo = false, numero_ordine = NULL WHERE id = p_uscente_id;
  -- crea l'entrante nella stessa posizione di rotazione
  INSERT INTO medici (nome, cognome, nome_proprio, numero_ordine, is_reperibilita, attivo, reparto_id, utente_id)
    VALUES (p_nome, p_cognome, p_nome_proprio, v_ord, false, true, p_reparto, p_entrante_utente_id)
    RETURNING id INTO v_entrante;
  INSERT INTO subentri (reparto_id, numero_ordine, medico_uscente_id, medico_entrante_id, data_subentro, nota)
    VALUES (p_reparto, v_ord, p_uscente_id, v_entrante, p_data, p_nota);
  RETURN v_entrante;
END $$;
GRANT EXECUTE ON FUNCTION esegui_subentro(uuid,uuid,uuid,text,text,text,date,text) TO authenticated;
