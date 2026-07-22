-- #48 — SUP promosso a piazzamento per metà: gli slot possono contenere la
-- SIGLA di QUALSIASI proprietà dello schema (SUB/MED/SUP/…), non più solo
-- SUB/MED. I vecchi CHECK rigidi facevano fallire il Salva di Modifica Turni
-- ("violates check constraint turni_slot_pomeriggio_check").
-- Restano un vincolo di sanità: sigla non vuota, max 20 caratteri.

ALTER TABLE turni DROP CONSTRAINT IF EXISTS turni_slot_mattina_check;
ALTER TABLE turni DROP CONSTRAINT IF EXISTS turni_slot_pomeriggio_check;

ALTER TABLE turni ADD CONSTRAINT turni_slot_mattina_check
  CHECK (slot_mattina IS NULL OR length(slot_mattina) BETWEEN 1 AND 20);
ALTER TABLE turni ADD CONSTRAINT turni_slot_pomeriggio_check
  CHECK (slot_pomeriggio IS NULL OR length(slot_pomeriggio) BETWEEN 1 AND 20);
