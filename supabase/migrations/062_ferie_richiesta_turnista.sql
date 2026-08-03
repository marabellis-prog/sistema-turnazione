-- FIX: il turnista non riusciva a RICHIEDERE le ferie.
--
-- Sulla tabella `ferie` esistevano solo:
--   ferie_select (SELECT) → is_utente_attivo()
--   ferie_modify (ALL)    → puo_gestire_reparto()   ← solo admin/responsabili
-- quindi l'INSERT dal modal "Richiedi ferie" veniva respinto dalla RLS: il
-- pulsante restava in "Salvataggio…" e all'admin non arrivava nessuna
-- richiesta. Che fosse una svista lo dimostra la policy `m_insert` su
-- `messaggi`, che PREVEDE già il messaggio di tipo 'ferie_richiesta'
-- inviato dal turnista.
--
-- Si aggiungono due policy col MINIMO privilegio necessario al flusso di
-- CalendarioPage.handleSaveSelfFerie (delete + insert, niente update):
--   • crea SOLO ferie proprie e SOLO come pending (approvate = false),
--     quindi un turnista non può auto-approvarsi le ferie;
--   • cancella SOLO ferie proprie ANCORA pending: quelle già approvate
--     dall'admin restano intoccabili.

CREATE POLICY ferie_insert_self ON ferie
  FOR INSERT TO authenticated
  WITH CHECK (
    medico_id IN (SELECT my_medici_ids())
    AND approvate IS NOT DISTINCT FROM false
  );

CREATE POLICY ferie_delete_self ON ferie
  FOR DELETE TO authenticated
  USING (
    medico_id IN (SELECT my_medici_ids())
    AND approvate IS NOT DISTINCT FROM false
  );
