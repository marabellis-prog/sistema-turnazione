-- 015: giorno di fine periodo (date picker esatti)
--
-- Permette di scegliere la data di FINE esatta del calendario (oltre a quella
-- di inizio, gia' gestita da giorno_inizio). Con i due date picker in Genera
-- Calendario il periodo copre esattamente [data_inizio, data_fine].
--
-- NULL = ultimo giorno del mese_fine (comportamento storico): le righe
-- esistenti non cambiano comportamento.

ALTER TABLE configurazione
  ADD COLUMN IF NOT EXISTS giorno_fine INTEGER;

COMMENT ON COLUMN configurazione.giorno_fine IS
  'Giorno del mese_fine a cui termina il calendario. NULL = ultimo giorno del mese (legacy). Con i date picker esatti il calendario copre [inizio, fine] esatti.';
