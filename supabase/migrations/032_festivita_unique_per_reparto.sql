-- 032_festivita_unique_per_reparto.sql
-- Ogni reparto è un mondo a parte: la stessa data può essere festività in più
-- reparti. Il vincolo UNIQUE(data) globale lo impediva → lo rendo per-reparto.
ALTER TABLE festivita_custom DROP CONSTRAINT IF EXISTS festivita_custom_data_key;
ALTER TABLE festivita_custom
  ADD CONSTRAINT festivita_custom_reparto_data_key UNIQUE (reparto_id, data);
