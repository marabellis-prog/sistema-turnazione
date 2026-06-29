-- 024: le RPC su utenti_autorizzati accettano cognome + nome_proprio.
--
-- L'UPDATE diretto sulla tabella è bloccato da RLS, quindi cognome/nome si
-- scrivono solo tramite queste RPC SECURITY DEFINER. I nuovi parametri hanno
-- DEFAULT NULL (retro-compatibili con la bundle precedente) e in UPDATE si usa
-- COALESCE così una vecchia chiamata a 4 argomenti NON azzera cognome/nome.

DROP FUNCTION IF EXISTS insert_utente_autorizzato(text, text, text);
CREATE OR REPLACE FUNCTION public.insert_utente_autorizzato(
    p_email text, p_nome text, p_ruolo text,
    p_cognome text DEFAULT NULL, p_nome_proprio text DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  INSERT INTO utenti_autorizzati (email, nome, ruolo, attivo, cognome, nome_proprio)
  VALUES (p_email, p_nome, p_ruolo, true, p_cognome, p_nome_proprio)
  ON CONFLICT (email) DO NOTHING;
$$;

DROP FUNCTION IF EXISTS update_utente_autorizzato(uuid, text, text, text);
CREATE OR REPLACE FUNCTION public.update_utente_autorizzato(
    p_id uuid, p_email text, p_nome text, p_ruolo text,
    p_cognome text DEFAULT NULL, p_nome_proprio text DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE utenti_autorizzati
     SET email        = p_email,
         nome         = p_nome,
         ruolo        = p_ruolo,
         cognome      = COALESCE(p_cognome, cognome),
         nome_proprio = COALESCE(p_nome_proprio, nome_proprio)
   WHERE id = p_id;
$$;

GRANT EXECUTE ON FUNCTION insert_utente_autorizzato(text,text,text,text,text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION update_utente_autorizzato(uuid,text,text,text,text,text) TO anon, authenticated;
