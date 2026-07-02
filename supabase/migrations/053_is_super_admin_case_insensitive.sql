-- 053_is_super_admin_case_insensitive.sql
--
-- Coerenza permessi: is_admin() confronta l'email case-INSENSITIVE
-- (lower(email)=lower(jwt)), mentre is_super_admin() era case-SENSITIVE
-- (email = jwt). Poiché puo_gestire_reparto() -> is_super_admin() gate TUTTE
-- le policy di gestione (turni/ferie/cambi/config/schemi/medici/...) + le RPC
-- (copia_setup_reparto, elimina/azzera/salva schema, chiudi_turnazione), un
-- admin che loggasse con casing diverso perderebbe i poteri GLOBALI e resterebbe
-- solo responsabile dei reparti in cui è esplicitamente elencato.
--
-- Fix: allineo is_super_admin a is_admin (case-insensitive). Cambiamento
-- STRETTAMENTE più permissivo SOLO per utenti ruolo='admin' attivi: non può
-- concedere nulla a un non-admin. Nessun impatto sui dati attuali (l'email
-- admin è già lowercase), ma elimina il footgun latente.

CREATE OR REPLACE FUNCTION public.is_super_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT EXISTS (SELECT 1 FROM utenti_autorizzati
                 WHERE lower(email) = lower(auth.jwt() ->> 'email')
                   AND ruolo = 'admin' AND attivo)
$function$;
