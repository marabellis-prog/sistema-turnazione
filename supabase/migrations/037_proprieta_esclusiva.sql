-- 037_proprieta_esclusiva.sql
-- Una proprietà può essere "esclusiva" (mutualmente esclusiva: non coesiste con
-- altre proprietà sullo stesso slot) oppure no (può coesistere).
ALTER TABLE proprieta_turno ADD COLUMN IF NOT EXISTS esclusiva boolean NOT NULL DEFAULT false;
