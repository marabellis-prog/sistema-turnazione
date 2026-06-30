-- 038_tipi_turno_per_schema.sql
-- I TIPI DI TURNO e le PROPRIETA' diventano PER-SCHEMA (non piu' solo per-reparto):
-- ogni schema_num del reparto ha i suoi turni/flag, cosi' uno schema puo' avere
-- p.es. il pomeriggio e un altro no. Additivo + retro-compatibile:
--   - le righe esistenti diventano schema_num = 1 (il setup attuale = schema 1);
--   - gli schemi gia' disegnati (schema_giorno con schema_num <> 1) ereditano
--     una COPIA dei tipi/proprietà di schema 1, cosi' non perdono i loro turni.
-- 11N non e' toccato: usa il vecchio modello (schemi_modello), non queste tabelle.

-- 1) Colonna schema_num (default 1 = setup attuale).
ALTER TABLE tipi_turno      ADD COLUMN IF NOT EXISTS schema_num integer NOT NULL DEFAULT 1;
ALTER TABLE proprieta_turno ADD COLUMN IF NOT EXISTS schema_num integer NOT NULL DEFAULT 1;

-- 2) Sostituisci la UNIQUE(reparto_id, sigla) con UNIQUE(reparto_id, schema_num, sigla).
--    Drop robusto: rimuove qualunque vincolo UNIQUE esistente sulle due tabelle
--    (ce n'e' uno solo), senza dipendere dal nome autogenerato.
DO $$
DECLARE c text;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid = 'tipi_turno'::regclass AND contype = 'u'
  LOOP EXECUTE format('ALTER TABLE tipi_turno DROP CONSTRAINT %I', c); END LOOP;
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid = 'proprieta_turno'::regclass AND contype = 'u'
  LOOP EXECUTE format('ALTER TABLE proprieta_turno DROP CONSTRAINT %I', c); END LOOP;
END $$;

ALTER TABLE tipi_turno
  ADD CONSTRAINT tipi_turno_reparto_schema_sigla_key UNIQUE (reparto_id, schema_num, sigla);
ALTER TABLE proprieta_turno
  ADD CONSTRAINT proprieta_turno_reparto_schema_sigla_key UNIQUE (reparto_id, schema_num, sigla);

CREATE INDEX IF NOT EXISTS idx_tipi_turno_reparto_schema      ON tipi_turno(reparto_id, schema_num);
CREATE INDEX IF NOT EXISTS idx_proprieta_turno_reparto_schema ON proprieta_turno(reparto_id, schema_num);

-- 3) Propaga i tipi/proprietà (ora schema 1) agli ALTRI schemi gia' esistenti
--    (quelli con righe in schema_giorno), cosi' gli schemi 2/3 gia' disegnati
--    mantengono i loro turni/flag invece di restare senza.
INSERT INTO tipi_turno (reparto_id, schema_num, sigla, nome, ora_inizio, ora_fine, peso,
    copre_mattina, copre_pomeriggio, is_reperibilita, colore_bg, colore_fg, ordine)
  SELECT t.reparto_id, g.schema_num, t.sigla, t.nome, t.ora_inizio, t.ora_fine, t.peso,
    t.copre_mattina, t.copre_pomeriggio, t.is_reperibilita, t.colore_bg, t.colore_fg, t.ordine
  FROM tipi_turno t
  JOIN (SELECT DISTINCT reparto_id, schema_num FROM schema_giorno WHERE schema_num <> 1) g
    ON g.reparto_id = t.reparto_id
  WHERE t.schema_num = 1
  ON CONFLICT (reparto_id, schema_num, sigla) DO NOTHING;

INSERT INTO proprieta_turno (reparto_id, schema_num, sigla, nome, colore_bg, ordine, esclusiva)
  SELECT p.reparto_id, g.schema_num, p.sigla, p.nome, p.colore_bg, p.ordine, p.esclusiva
  FROM proprieta_turno p
  JOIN (SELECT DISTINCT reparto_id, schema_num FROM schema_giorno WHERE schema_num <> 1) g
    ON g.reparto_id = p.reparto_id
  WHERE p.schema_num = 1
  ON CONFLICT (reparto_id, schema_num, sigla) DO NOTHING;
