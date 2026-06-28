-- 014: giorno di inizio rotazione
--
-- Aggiunge alla configurazione il giorno del mese da cui far ripartire la
-- rotazione: la "settimana 1" (sett=0) e' il primo lunedi' >= (anno_inizio,
-- mese_inizio, giorno_inizio). Il CALENDARIO continua a partire dal 1° del
-- mese; i giorni precedenti al primo lunedi' restano coda del ciclo
-- precedente (settimane negative), esattamente come prima.
--
-- Default 1 = comportamento storico (anchor = primo lunedi' del mese):
-- le righe esistenti non cambiano comportamento.

ALTER TABLE configurazione
  ADD COLUMN IF NOT EXISTS giorno_inizio INTEGER NOT NULL DEFAULT 1;

COMMENT ON COLUMN configurazione.giorno_inizio IS
  'Giorno del mese_inizio da cui ancorare la rotazione: sett=0 al primo lunedi'' >= (anno_inizio, mese_inizio, giorno_inizio). Default 1 = primo lunedi'' del mese. Il calendario parte comunque dal 1° del mese.';
