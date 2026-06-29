-- 023: identità turnista = utente, con Nome e Cognome separati.
--
-- L'utente (utenti_autorizzati) è la SORGENTE DI VERITÀ del nominativo: quando
-- si modificano cognome/nome di un utente, un trigger propaga automaticamente a
-- TUTTI i medici (turnisti) collegati via utente_id, in ogni reparto → "cambio
-- l'utente, cambia ovunque". `nome` resta come display combinato ("COGNOME Nome")
-- per le viste esistenti; cognome/nome_proprio servono per il formato breve
-- "COGNOME I." nei calendari e per i form Cognome/Nome.

ALTER TABLE utenti_autorizzati ADD COLUMN IF NOT EXISTS cognome      TEXT;
ALTER TABLE utenti_autorizzati ADD COLUMN IF NOT EXISTS nome_proprio TEXT;
ALTER TABLE medici             ADD COLUMN IF NOT EXISTS cognome      TEXT;
ALTER TABLE medici             ADD COLUMN IF NOT EXISTS nome_proprio TEXT;

-- Propagazione utente → medici collegati (tutti i reparti).
CREATE OR REPLACE FUNCTION propaga_nome_utente() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE medici
     SET cognome      = NEW.cognome,
         nome_proprio = NEW.nome_proprio,
         nome         = NEW.nome
   WHERE utente_id = NEW.id;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_propaga_nome_utente ON utenti_autorizzati;
CREATE TRIGGER trg_propaga_nome_utente
  AFTER UPDATE OF nome, cognome, nome_proprio ON utenti_autorizzati
  FOR EACH ROW
  WHEN (NEW.nome         IS DISTINCT FROM OLD.nome
     OR NEW.cognome      IS DISTINCT FROM OLD.cognome
     OR NEW.nome_proprio IS DISTINCT FROM OLD.nome_proprio)
  EXECUTE FUNCTION propaga_nome_utente();
