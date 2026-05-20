-- Migration 008 — Messaggi destinati agli ADMIN
--
-- Contesto:
-- Fino ad ora la tabella `messaggi` permetteva SOLO messaggi diretti a un
-- medico specifico (medico_id NOT NULL, FK su medici). Gli admin, che non
-- hanno un record in `medici`, non potevano ricevere nulla nella loro
-- casella di posta personale.
--
-- Obiettivo: quando un medico submitta una richiesta (ferie, cambio
-- turno) o quando l'admin stesso esegue un'azione (approva, rifiuta,
-- ripristina), tutti gli admin ricevono una notifica nella loro casella
-- cosi` sanno cosa accade nel sistema senza dover navigare nelle pagine
-- admin a caccia di richieste pending.
--
-- Modello: broadcast — UNA riga per messaggio (non N righe x admin).
-- Identificata da `destinatario_ruolo = 'admin'` + `medico_id IS NULL`.
-- Tutti gli admin vedono e marcano-come-letti la stessa riga
-- indipendentemente. Trade-off accettato: se 5 admin leggono lo stesso
-- messaggio, l'ultimo che mette `letto=true` "lo legge" per tutti — ma
-- il caso d'uso e` 1-2 admin che gestiscono insieme, non un team grosso.

-- ── 1) Estende schema ───────────────────────────────────────────────

-- Rende medico_id NULLABLE (era NOT NULL): broadcast admin senza
-- destinatario medico.
ALTER TABLE public.messaggi
  ALTER COLUMN medico_id DROP NOT NULL;

-- Nuova colonna `destinatario_ruolo`: 'medico' (default, retrocompat) o
-- 'admin'. NOT NULL con default 'medico' per i record esistenti.
ALTER TABLE public.messaggi
  ADD COLUMN IF NOT EXISTS destinatario_ruolo TEXT NOT NULL DEFAULT 'medico'
  CHECK (destinatario_ruolo IN ('medico', 'admin'));

-- Vincolo di coerenza: ruolo + colonna che lo identifica devono coincidere.
-- 'medico' → medico_id obbligatorio. 'admin' → medico_id deve essere NULL
-- (e` un broadcast generico, non destinato a un admin specifico).
ALTER TABLE public.messaggi
  DROP CONSTRAINT IF EXISTS messaggi_destinatario_coerente;
ALTER TABLE public.messaggi
  ADD CONSTRAINT messaggi_destinatario_coerente CHECK (
    (destinatario_ruolo = 'medico' AND medico_id IS NOT NULL) OR
    (destinatario_ruolo = 'admin'  AND medico_id IS NULL)
  );

-- Estende l'enum `tipo` con i nuovi valori per gli eventi user→admin.
-- Sostituisce il CHECK esistente includendo i vecchi + i nuovi.
ALTER TABLE public.messaggi
  DROP CONSTRAINT IF EXISTS messaggi_tipo_check;
ALTER TABLE public.messaggi
  ADD CONSTRAINT messaggi_tipo_check CHECK (tipo IN (
    -- esistenti (medico ← admin)
    'cambio_approvato', 'cambio_rifiutato', 'cambio_ripristinato',
    'ferie_approvate',  'ferie_rifiutate',
    -- nuovi (admin ← medico)
    'ferie_richiesta',  'ferie_annullata',
    'cambio_richiesto', 'cambio_annullato',
    -- nuovo (admin ← admin) per log condiviso fra piu` admin
    'admin_azione'
  ));

-- Indice per il count "messaggi admin non letti" usato dal badge NavBar.
CREATE INDEX IF NOT EXISTS idx_messaggi_admin_unread
  ON public.messaggi (destinatario_ruolo, letto)
  WHERE destinatario_ruolo = 'admin';

-- ── 2) Aggiornamento Row Level Security ────────────────────────────

-- SELECT: medico vede i propri messaggi (medico_id = me), admin vede
-- tutto (sia i messaggi destinati ai medici che quelli broadcast admin).
-- N.B. la clausola is_admin() copre TUTTO per gli admin, inclusi i
-- messaggi destinati ai medici (cosi` un admin puo` consultare la posta
-- altrui se serve). Per i medici resta isolato come prima.
DROP POLICY IF EXISTS m_select ON public.messaggi;
CREATE POLICY m_select ON public.messaggi
  FOR SELECT TO authenticated
  USING (
    medico_id = public.my_medico_id()
    OR (destinatario_ruolo = 'admin' AND public.is_admin())
    OR public.is_admin()
  );

-- INSERT: admin puo` inserire qualsiasi cosa; un medico autenticato puo`
-- inserire SOLO messaggi destinati agli admin (broadcast), con tipi
-- ristretti agli eventi che e` legittimato a generare.
DROP POLICY IF EXISTS m_insert ON public.messaggi;
CREATE POLICY m_insert ON public.messaggi
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_admin()
    OR (
      destinatario_ruolo = 'admin'
      AND medico_id IS NULL
      AND public.my_medico_id() IS NOT NULL
      AND tipo IN (
        'ferie_richiesta', 'ferie_annullata',
        'cambio_richiesto', 'cambio_annullato'
      )
    )
  );

-- UPDATE: medico marca-letti i propri messaggi (medico_id = me); admin
-- puo` marcare-letti sia i messaggi destinati ai medici che quelli
-- broadcast admin. Stesso pattern di m_select.
DROP POLICY IF EXISTS m_update ON public.messaggi;
CREATE POLICY m_update ON public.messaggi
  FOR UPDATE TO authenticated
  USING (
    medico_id = public.my_medico_id()
    OR (destinatario_ruolo = 'admin' AND public.is_admin())
    OR public.is_admin()
  );

-- DELETE: solo admin (invariato).
DROP POLICY IF EXISTS m_delete ON public.messaggi;
CREATE POLICY m_delete ON public.messaggi
  FOR DELETE TO authenticated
  USING (public.is_admin());

-- ── 3) Backfill: notifiche admin retroattive ────────────────────────
--
-- Per ogni ferie e cambio turno esistente, genera UNA notifica admin
-- (broadcast) con letto=TRUE cosi` non gonfia il badge "non letti".
-- Cosi` la cronologia admin parte gia` popolata con il pregresso.

-- Backfill: una notifica admin per ogni RICHIESTA di ferie (a prescindere
-- dallo stato attuale).
INSERT INTO public.messaggi (
  medico_id, destinatario_ruolo, tipo, titolo, corpo,
  letto, ferie_id, created_at
)
SELECT
  NULL,
  'admin',
  'ferie_richiesta',
  'Richiesta ferie da ' || m.nome,
  format('%s ha richiesto ferie dal %s al %s.',
    m.nome,
    to_char(f.data_inizio, 'DD/MM/YYYY'),
    to_char(f.data_fine,   'DD/MM/YYYY')),
  TRUE,
  f.id,
  f.created_at
FROM public.ferie f
JOIN public.medici m ON m.id = f.medico_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.messaggi mm
  WHERE mm.ferie_id = f.id
    AND mm.destinatario_ruolo = 'admin'
    AND mm.tipo = 'ferie_richiesta'
);

-- Backfill: una notifica admin per ogni RICHIESTA di cambio turno.
INSERT INTO public.messaggi (
  medico_id, destinatario_ruolo, tipo, titolo, corpo,
  letto, cambio_turno_id, created_at
)
SELECT
  NULL,
  'admin',
  'cambio_richiesto',
  'Richiesta cambio turno da ' || m.nome,
  format('%s ha proposto %s modifich%s al calendario.',
    m.nome,
    jsonb_array_length(c.modifiche)::text,
    CASE WHEN jsonb_array_length(c.modifiche) = 1 THEN 'a' ELSE 'e' END),
  TRUE,
  c.id,
  c.created_at
FROM public.cambi_turno c
JOIN public.medici m ON m.id = c.medico_richiedente_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.messaggi mm
  WHERE mm.cambio_turno_id = c.id
    AND mm.destinatario_ruolo = 'admin'
    AND mm.tipo = 'cambio_richiesto'
);
