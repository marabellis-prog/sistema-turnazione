-- 047_backfill_medici_utente_id.sql
--
-- ROOT del bug Palmieri (#40): i medici creati copiando un reparto avevano
-- utente_id = NULL (non collegati agli account). Conseguenza: il turnista non
-- vedeva quel reparto nella vista pubblica (mitigato da #39 con il match per
-- nome, ma quello e' un cerotto), e ogni logica utente_id-based restava
-- disallineata.
--
-- Backfill: collega ogni medico NON collegato all'utente omonimo, SOLO quando
-- il match per nome e' UNIVOCO (un solo utente_autorizzati con quel nome) per
-- evitare collegamenti errati fra omonimi. Non tocca i medici gia' collegati
-- (utente_id NOT NULL), quindi 11N e gli altri reparti gia' a posto restano
-- invariati.
--
-- Idempotente: rieseguirla non produce effetti (non ci saranno piu' NULL con
-- match univoco).

UPDATE medici m
SET    utente_id = u.id
FROM   utenti_autorizzati u
WHERE  m.utente_id IS NULL
  AND  u.nome = m.nome
  AND  (SELECT count(*) FROM utenti_autorizzati u2 WHERE u2.nome = m.nome) = 1;
