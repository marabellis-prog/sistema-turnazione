-- 027: rende robusta la gestione del nome utente → medici.
-- Bug: salvando un utente con i campi nome vuoti, la RPC metteva
-- utenti_autorizzati.nome = NULL e il trigger lo propagava a medici.nome
-- (NOT NULL) → "null value in column nome of relation medici".

-- 1) RPC: NON azzerare il nome se p_nome è NULL/vuoto (mantieni l'esistente).
CREATE OR REPLACE FUNCTION public.update_utente_autorizzato(
    p_id uuid, p_email text, p_nome text, p_ruolo text,
    p_cognome text DEFAULT NULL, p_nome_proprio text DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE utenti_autorizzati
     SET email        = p_email,
         nome         = COALESCE(NULLIF(btrim(p_nome), ''), nome),
         ruolo        = p_ruolo,
         cognome      = COALESCE(p_cognome, cognome),
         nome_proprio = COALESCE(p_nome_proprio, nome_proprio)
   WHERE id = p_id;
$$;

-- 2) Trigger: non propagare mai un nome NULL/vuoto a medici.nome.
CREATE OR REPLACE FUNCTION propaga_nome_utente() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE medici
     SET cognome      = NEW.cognome,
         nome_proprio = NEW.nome_proprio,
         nome         = COALESCE(NULLIF(btrim(NEW.nome), ''), nome)
   WHERE utente_id = NEW.id;
  RETURN NEW;
END $$;
