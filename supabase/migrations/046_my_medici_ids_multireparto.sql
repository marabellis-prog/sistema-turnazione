-- 046 — Cambio turno / messaggi: RLS consapevole del MULTI-REPARTO.
--
-- BUG: my_medico_id() trova il medico per NOME su TUTTI i reparti con LIMIT 1
-- (nessun filtro reparto). Con l'utente che ha medici omonimi in più reparti
-- (es. reparto copiato "urgenze secondo test" ha gli stessi nomi di 11N), la
-- richiesta di cambio nel reparto attivo inserisce medico_richiedente_id di
-- QUEL reparto, ma my_medico_id() ne restituisce uno ARBITRARIO (magari di 11N)
-- → medico_richiedente_id <> my_medico_id() → RLS blocca ("new row violates
-- row-level security policy for table cambi_turno").
--
-- FIX: nuova my_medici_ids() = TUTTI i medici (attivi) dell'utente per nome, su
-- qualsiasi reparto. Le policy passano da "= my_medico_id()" a "IN (my_medici_ids())".
-- È un SUPERSET: ciò che passava prima passa ancora (il risultato LIMIT 1 è nel
-- set), più i casi multi-reparto. 11N (nomi unici) resta invariato.
-- my_medico_id() resta (usata da messaggi.m_insert come check di esistenza).
-- Applicata in prod via scripts/run-sql.mjs il 01/07/2026.

CREATE OR REPLACE FUNCTION public.my_medici_ids()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT m.id FROM medici m
  JOIN utenti_autorizzati ua
    ON UPPER(TRIM(ua.nome)) = UPPER(TRIM(m.nome))
  WHERE ua.email = (SELECT email FROM auth.users WHERE id = auth.uid())
    AND ua.attivo = true
    AND m.attivo = true
$function$;

-- ── cambi_turno ─────────────────────────────────────────────────────────────
ALTER POLICY ct_insert ON public.cambi_turno
  WITH CHECK ((medico_richiedente_id IN (SELECT my_medici_ids())) AND (stato = 'pending'::text));

ALTER POLICY ct_select ON public.cambi_turno
  USING ((medico_richiedente_id IN (SELECT my_medici_ids())) OR is_admin());

ALTER POLICY ct_update ON public.cambi_turno
  USING (is_admin() OR ((medico_richiedente_id IN (SELECT my_medici_ids())) AND (stato = 'pending'::text)));

ALTER POLICY ct_delete ON public.cambi_turno
  USING (is_admin() OR ((medico_richiedente_id IN (SELECT my_medici_ids())) AND (stato = 'pending'::text)));

-- ── messaggi (il medico vede/aggiorna i messaggi di uno qualsiasi dei suoi id) ─
ALTER POLICY m_select ON public.messaggi
  USING ((medico_id IN (SELECT my_medici_ids())) OR ((destinatario_ruolo = 'admin'::text) AND is_admin()) OR is_admin());

ALTER POLICY m_update ON public.messaggi
  USING ((medico_id IN (SELECT my_medici_ids())) OR ((destinatario_ruolo = 'admin'::text) AND is_admin()) OR is_admin());
