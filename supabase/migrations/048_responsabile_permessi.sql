-- 048_responsabile_permessi.sql
--
-- Un RESPONSABILE (reparto_responsabili, può esserlo di più reparti) deve poter
-- fare TUTTO in amministrazione ma SOLO sui suoi reparti: approvare ferie/cambi,
-- generare, modificare turni, medici, festività, backup, anteprima. NON deve
-- vedere il Centro di Controllo (globale, admin-only) né gestire gli utenti
-- globali.
--
-- Le tabelle schema_*/tipi_turno/proprieta_turno usano già
-- puo_gestire_reparto(reparto_id) (= super-admin OR responsabile del reparto),
-- e gli RPC schema controllano già lo stesso. Qui allineiamo le tabelle
-- "vecchie" che usavano ancora is_admin(). ADDITIVO: gli admin (super-admin)
-- mantengono l'accesso completo; non tocca i DATI di 11N (solo le policy).
--
-- Resta is_admin()-only: utenti_autorizzati (gestione utenti globale) e i
-- messaggi broadcast admin.

-- ── FOR ALL (USING + WITH CHECK), reparto-scoped ─────────────────────────────
ALTER POLICY config_modify ON configurazione       USING (puo_gestire_reparto(reparto_id)) WITH CHECK (puo_gestire_reparto(reparto_id));
ALTER POLICY ferie_modify  ON ferie                 USING (puo_gestire_reparto(reparto_id)) WITH CHECK (puo_gestire_reparto(reparto_id));
ALTER POLICY fc_modify     ON festivita_custom      USING (puo_gestire_reparto(reparto_id)) WITH CHECK (puo_gestire_reparto(reparto_id));
ALTER POLICY medici_modify ON medici                USING (puo_gestire_reparto(reparto_id)) WITH CHECK (puo_gestire_reparto(reparto_id));
ALTER POLICY ta_modify     ON turnazione_anteprima  USING (puo_gestire_reparto(reparto_id)) WITH CHECK (puo_gestire_reparto(reparto_id));
ALTER POLICY turni_modify  ON turni                 USING (puo_gestire_reparto(reparto_id)) WITH CHECK (puo_gestire_reparto(reparto_id));
ALTER POLICY schemi_modify ON schemi_modello        USING (puo_gestire_reparto(reparto_id)) WITH CHECK (puo_gestire_reparto(reparto_id));
ALTER POLICY tb_modify     ON turni_backup          USING (puo_gestire_reparto(reparto_id)) WITH CHECK (puo_gestire_reparto(reparto_id));
ALTER POLICY tb_select     ON turni_backup          USING (puo_gestire_reparto(reparto_id));

-- ── cambi_turno: gestire i cambi del proprio reparto (oltre alle proprie) ────
ALTER POLICY ct_select ON cambi_turno USING ((medico_richiedente_id IN (SELECT my_medici_ids())) OR puo_gestire_reparto(reparto_id));
ALTER POLICY ct_update ON cambi_turno USING (puo_gestire_reparto(reparto_id) OR ((medico_richiedente_id IN (SELECT my_medici_ids())) AND (stato = 'pending'::text)));
ALTER POLICY ct_delete ON cambi_turno USING (puo_gestire_reparto(reparto_id) OR ((medico_richiedente_id IN (SELECT my_medici_ids())) AND (stato = 'pending'::text)));

-- ── messaggi: il responsabile può notificare i medici del suo reparto ────────
-- (es. messaggio di ferie/cambio approvato). Il ramo admin e il ramo
-- "medico che invia richiesta all'admin" restano invariati.
ALTER POLICY m_insert ON messaggi WITH CHECK (
  is_admin()
  OR (medico_id IS NOT NULL AND puo_gestire_reparto((SELECT m.reparto_id FROM medici m WHERE m.id = medico_id)))
  OR (destinatario_ruolo = 'admin' AND medico_id IS NULL AND my_medico_id() IS NOT NULL
      AND tipo = ANY (ARRAY['ferie_richiesta','ferie_annullata','cambio_richiesto','cambio_annullato']))
);
