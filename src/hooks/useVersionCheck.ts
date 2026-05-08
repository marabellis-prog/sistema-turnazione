/**
 * useVersionCheck
 *
 * Notifica real-time dei nuovi deploy usando Supabase Realtime (WebSocket).
 * GitHub Actions, dopo ogni deploy su gh-pages, aggiorna la riga `id=1`
 * della tabella `app_version` in Supabase. Tutti i client connessi ricevono
 * l'evento postgres_changes ISTANTANEAMENTE senza polling.
 *
 * Come fallback (es. dopo sleep laptop / disconnessione temporanea),
 * la tabella viene riqueryata quando il tab torna visibile.
 *
 * Setup richiesto (da fare UNA VOLTA):
 *   1. Esegui in Supabase → SQL Editor:
 *        CREATE TABLE IF NOT EXISTS public.app_version (
 *          id  int PRIMARY KEY DEFAULT 1,
 *          ts  bigint NOT NULL DEFAULT 0
 *        );
 *        INSERT INTO public.app_version (id, ts) VALUES (1, 0)
 *          ON CONFLICT (id) DO NOTHING;
 *        ALTER TABLE public.app_version ENABLE ROW LEVEL SECURITY;
 *        CREATE POLICY "read_public" ON public.app_version
 *          FOR SELECT TO anon, authenticated USING (true);
 *        ALTER PUBLICATION supabase_realtime ADD TABLE public.app_version;
 *
 *   2. Aggiungi il secret SUPABASE_SERVICE_ROLE_KEY su GitHub
 *      (Settings → Secrets → Actions). Trovalo in Supabase → Settings → API.
 */

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

export function useVersionCheck() {
  const [updateAvailable, setUpdateAvailable] = useState(false)

  useEffect(() => {
    let lastTs: string | null = null

    // ── Legge il ts corrente dal DB (baseline iniziale) ───────────
    ;(async () => {
      try {
        const { data } = await supabase
          .from('app_version').select('ts').eq('id', 1).single()
        if (data) lastTs = String(data.ts)
      } catch (_) { /* tabella non ancora creata — ignora */ }
    })()

    // ── Supabase Realtime: notifica istantanea via WebSocket ──────
    // GitHub Actions fa PATCH su questa riga dopo ogni deploy.
    const channel = supabase
      .channel('app-version-watch')
      .on(
        'postgres_changes',
        {
          event:  'UPDATE',
          schema: 'public',
          table:  'app_version',
          filter: 'id=eq.1',
        },
        (payload) => {
          const newTs = String((payload.new as { ts: number }).ts)
          if (lastTs && lastTs !== newTs) {
            setUpdateAvailable(true)
          }
          lastTs = newTs
        }
      )
      .subscribe()

    // ── Fallback visibilitychange ─────────────────────────────────
    // Se il WebSocket si disconnette (sleep, rete caduta) e si riconnette,
    // Supabase gestisce il reconnect automatico. Questo fallback copre il
    // caso in cui la finestra fosse chiusa/ibernata e l'evento sia stato perso.
    const onVisible = async () => {
      if (document.visibilityState !== 'visible') return
      try {
        const { data } = await supabase
          .from('app_version')
          .select('ts')
          .eq('id', 1)
          .single()
        if (data) {
          const remoteTs = String(data.ts)
          if (lastTs && remoteTs !== lastTs) setUpdateAvailable(true)
          lastTs = remoteTs
        }
      } catch (_) { /* ignora */ }
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      supabase.removeChannel(channel)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  // ── Ricarica pulita ───────────────────────────────────────────
  const applyUpdate = useCallback(() => {
    const go = () => { location.href = location.href }
    if (window.caches) {
      caches.keys()
        .then(keys => Promise.all(keys.map(k => caches.delete(k))))
        .then(go).catch(go)
    } else {
      go()
    }
  }, [])

  return { updateAvailable, applyUpdate }
}
