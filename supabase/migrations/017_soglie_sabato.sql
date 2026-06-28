-- 017: soglie "Sabato" (terza colonna tra feriale e festivo)
--
-- Il sabato ha spesso una copertura diversa sia dai feriali (Lun-Ven) sia
-- dai festivi (Dom + festivita'). Aggiungiamo 6 soglie dedicate: sub/med/sup
-- x mattina/pomeriggio. Default 0 = nessun controllo (come le altre).

ALTER TABLE configurazione
  ADD COLUMN IF NOT EXISTS sub_mattina_sabato    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sub_pomeriggio_sabato INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS med_mattina_sabato    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS med_pomeriggio_sabato INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sup_mattina_sabato    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sup_pomeriggio_sabato INTEGER NOT NULL DEFAULT 0;
