-- 026: ruolo del medico DENTRO il reparto.
-- 'turnista' = in rotazione; 'ospite' = aggregato al reparto in sola
-- visualizzazione. Il "responsabile" NON è qui: è in reparto_responsabili
-- (assegnato dall'admin nel Centro di controllo) e nella colonna Ruolo della
-- pagina Turnisti prevale sull'etichetta turnista/ospite.

ALTER TABLE medici ADD COLUMN IF NOT EXISTS ruolo_reparto text NOT NULL DEFAULT 'turnista';
ALTER TABLE medici DROP CONSTRAINT IF EXISTS medici_ruolo_reparto_chk;
ALTER TABLE medici ADD  CONSTRAINT medici_ruolo_reparto_chk CHECK (ruolo_reparto IN ('turnista','ospite'));
