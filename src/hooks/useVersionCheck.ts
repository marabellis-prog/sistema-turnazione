/**
 * useVersionCheck
 *
 * Notifica real-time dei nuovi deploy usando Supabase Realtime (WebSocket).
 * GitHub Actions, dopo ogni deploy su gh-pages, aggiorna la riga `id=1`
 * della tabella `app_version` in Supabase. Tutti i client connessi ricevono
 * l'evento postgres_changes ISTANTANEAMENTE senza polling.
 *
 * IMPORTANTE: il CDN Fastly di GitHub Pages può continuare a servire
 * l'HTML vecchio per qualche minuto dopo il deploy (TTL ~10 min, purge
 * automatico ma con propagazione asincrona fra PoP). Per questo motivo,
 * quando arriva la notifica Realtime, NON mostriamo subito il badge:
 * pollianmo prima che il CDN serva davvero la nuova versione PER L'URL
 * NUDA usata dall'utente. Solo allora il badge compare → cliccarlo
 * (o fare Ctrl+F5) aggiornerà davvero la pagina.
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

import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'

const BUNDLE_RE = /\/sistema-turnazione\/assets\/index-[A-Za-z0-9_-]+\.js/

/** Estrae il path del bundle JS principale (Vite emette <script src="…/assets/index-HASH.js">) */
function extractBundlePath(html: string): string | null {
  const m = html.match(BUNDLE_RE)
  return m ? m[0] : null
}

/** Path del bundle JS attualmente caricato in pagina (dal DOM) */
function getCurrentBundlePath(): string | null {
  const scripts = Array.from(document.querySelectorAll('script[src*="/assets/index-"]'))
  for (const s of scripts) {
    const src = (s as HTMLScriptElement).getAttribute('src') || ''
    const m = src.match(BUNDLE_RE)
    if (m) return m[0]
  }
  return null
}

export function useVersionCheck() {
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const pollHandleRef = useRef<number | null>(null)

  // Verifica se il CDN serve già la nuova versione.
  // ATTENZIONE: dobbiamo fetchare la ROOT dell'app (`import.meta.env.BASE_URL`,
  // es. "/sistema-turnazione/"), NON window.location.pathname. Le pagine SPA
  // tipo "/admin/ferie" su GitHub Pages restituiscono 404 (sono route lato
  // client, non file fisici) → un fetch del pathname corrente fallirebbe e
  // checkFreshAvailable tornerebbe sempre false, impedendo al badge di apparire.
  // La root invece serve sempre l'index.html con i tag <script src="…">.
  // Confrontiamo il bundle referenziato nel response col bundle caricato in
  // pagina: se sono diversi, il fresh è raggiungibile.
  const checkFreshAvailable = useCallback(async (): Promise<boolean> => {
    try {
      const r = await fetch(import.meta.env.BASE_URL, {
        cache:       'reload', // bypassa HTTP cache del browser
        credentials: 'same-origin',
        headers:     { 'Cache-Control': 'no-cache, no-store' },
      })
      if (!r.ok) return false
      const html = await r.text()
      const newBundle = extractBundlePath(html)
      const curBundle = getCurrentBundlePath()
      return !!newBundle && !!curBundle && newBundle !== curBundle
    } catch (_) {
      return false
    }
  }, [])

  const stopPoll = useCallback(() => {
    if (pollHandleRef.current !== null) {
      clearInterval(pollHandleRef.current)
      pollHandleRef.current = null
    }
  }, [])

  // Polling con backoff: aspetta che il CDN serva fresh per URL nuda.
  // Il primo check è immediato, poi ogni 10s. Timeout safety dopo 10 min:
  // mostriamo comunque il badge — l'utente potrà comunque ricevere il fresh
  // tramite la query string (?_r=…) nell'applyUpdate, che bypassa il CDN.
  const startPolling = useCallback(() => {
    if (pollHandleRef.current !== null) return
    let tries = 0
    const tick = async () => {
      tries++
      if (await checkFreshAvailable()) {
        stopPoll()
        setUpdateAvailable(true)
        return
      }
      if (tries >= 60) {
        stopPoll()
        setUpdateAvailable(true) // safety net dopo 10 min
      }
    }
    tick()
    pollHandleRef.current = window.setInterval(tick, 10000)
  }, [checkFreshAvailable, stopPoll])

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
            // NON mostriamo subito il badge: aspettiamo che il fresh
            // sia raggiungibile dal client (purge CDN propagato qui).
            startPolling()
          }
          lastTs = newTs
        }
      )
      .subscribe()

    // ── Fallback visibilitychange ─────────────────────────────────
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
          if (lastTs && remoteTs !== lastTs) startPolling()
          lastTs = remoteTs
        }
      } catch (_) { /* ignora */ }
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      supabase.removeChannel(channel)
      document.removeEventListener('visibilitychange', onVisible)
      stopPoll()
    }
  }, [startPolling, stopPoll])

  // ── Ricarica pulita: hard reload con cache busting ────────────
  // Quando arriviamo qui, checkFreshAvailable() ha già confermato che
  // fresh è disponibile sul CDN. Il pre-fetch + replace garantiscono
  // che il browser usi la response fresca anche se la disk cache
  // contenesse l'HTML vecchio.
  const applyUpdate = useCallback(async () => {
    // 1. Svuota cache API (PWA / SW caches)
    if (window.caches) {
      try {
        const keys = await caches.keys()
        await Promise.all(keys.map(k => caches.delete(k)))
      } catch (_) { /* ignora */ }
    }

    // 1b. Unregistra eventuali Service Worker residui
    if ('serviceWorker' in navigator) {
      try {
        const regs = await navigator.serviceWorker.getRegistrations()
        await Promise.all(regs.map(r => r.unregister()))
      } catch (_) { /* ignora */ }
    }

    // 2. URL target con query univoca: forza nuova cache key sul CDN.
    //    Anche se il CDN servisse ancora vecchio per URL nuda, qui va
    //    sicuramente all'origin perché la query string non era mai vista.
    const reloadUrl = window.location.pathname + '?_r=' + Date.now() + window.location.hash

    // 2b. Pre-fetch con cache:'reload' — bypassa HTTP cache + ripopola
    try {
      const r = await fetch(reloadUrl, {
        cache:       'reload',
        credentials: 'same-origin',
        headers:     { 'Cache-Control': 'no-cache, no-store, must-revalidate' },
      })
      await r.text() // drena body per finalizzare cache entry
    } catch (_) { /* reload comunque */ }

    // 3. Naviga: il browser usa la entry fresca appena popolata.
    window.location.replace(reloadUrl)
  }, [])

  return { updateAvailable, applyUpdate }
}
