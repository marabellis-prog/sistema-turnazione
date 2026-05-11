/**
 * useAuth — hook globale per lo stato di autenticazione dell'app.
 *
 * Nuova architettura (post 2026-05-11):
 *  - Il "check di autorizzazione" (fetch RPC get_my_profile) viene fatto
 *    SOLO in due punti specifici:
 *      a) AuthCallbackPage  → quando l'utente atterra dal flow OAuth.
 *         È lì che decidiamo /calendario vs /login. Vedi quel file.
 *      b) useAuth.loadUser   → fallback per INITIAL_SESSION quando la
 *         cache profilo non c'è (es. reload con sessione esistente).
 *  - SIGNED_IN qui non triggera più la fetch RPC — la cache è già stata
 *    settata da AuthCallbackPage prima del navigate('/calendario'),
 *    quindi basta leggerla. Niente race con CalendarLoadingScreen.
 *  - SIGNED_OUT azzera lo stato.
 *
 * La logica di "kick out muto" è stata risolta perché qualunque cammino
 * di fallimento ora flag-ga sessionStorage UNAUTH_KEY prima del redirect,
 * e LoginPage mostra il banner con email + motivo.
 */

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  getCachedProfile, setCachedProfile, clearCachedProfile,
  flagUnauthorized, detachedSignOut, fetchProfile,
} from '../lib/authHelpers'
import type { AuthUser } from '../types'

const TIMEOUT_MS = 10_000

export function useAuth() {
  // Inizializza con la cache se disponibile — così reload + nav istantanei.
  const [user,    setUser]    = useState<AuthUser | null>(() => getCachedProfile())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {

        // ── SIGNED_OUT: logout reale ────────────────────────────
        if (event === 'SIGNED_OUT') {
          clearCachedProfile()
          setUser(null)
          setLoading(false)
          return
        }

        // ── INITIAL_SESSION: fired una volta sola all'avvio ─────
        // Caso comune: refresh pagina con sessione ancora valida.
        // Se abbiamo già la cache profilo (sessionStorage), usiamola
        // direttamente. Altrimenti fai un check al volo.
        if (event === 'INITIAL_SESSION') {
          if (session?.user?.email) {
            const cached = getCachedProfile()
            if (cached && cached.email.toLowerCase() === session.user.email.toLowerCase()) {
              setUser(cached)
              setLoading(false)
            } else {
              await loadUser(session.user.email, session.access_token)
            }
          } else {
            // Nessuna sessione → utente non loggato
            clearCachedProfile()
            setUser(null)
            setLoading(false)
          }
          return
        }

        // ── SIGNED_IN: dopo OAuth callback ──────────────────────
        // AuthCallbackPage ha già fatto il check e settato la cache.
        // Noi leggiamo solo la cache. Se per qualche motivo è vuota
        // (race / cleanup), fallback a loadUser.
        if (event === 'SIGNED_IN' && session?.user?.email) {
          const cached = getCachedProfile()
          if (cached && cached.email.toLowerCase() === session.user.email.toLowerCase()) {
            setUser(cached)
            setLoading(false)
          } else {
            // Cache mancante: fallback check (caso patologico)
            await loadUser(session.user.email, session.access_token)
          }
          return
        }

        // TOKEN_REFRESHED / USER_UPDATED / altri: ignora
      },
    )

    return () => subscription.unsubscribe()
  }, [])

  /** Fallback check del profilo. Usato SOLO per INITIAL_SESSION senza
   *  cache (es. reload con nuova tab). In flusso normale post-OAuth è
   *  AuthCallbackPage che fa questo check. */
  async function loadUser(email: string, accessToken: string) {
    try {
      const result = await Promise.race([
        fetchProfile(accessToken),
        new Promise<{ error: string }>(resolve =>
          setTimeout(() => resolve({ error: 'timeout' }), TIMEOUT_MS),
        ),
      ])

      if (result && typeof result === 'object' && 'error' in result) {
        flagUnauthorized(email, `errore RPC: ${result.error}`)
        detachedSignOut()
        setUser(null)
        return
      }
      if (!result) {
        flagUnauthorized(email, 'email non in elenco utenti autorizzati')
        detachedSignOut()
        setUser(null)
        return
      }
      setCachedProfile(result)
      setUser(result)
    } finally {
      setLoading(false)
    }
  }

  async function signInWithGoogle() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/sistema-turnazione/auth/callback`,
        queryParams: { prompt: 'select_account' },
      },
    })
    if (error) console.error('[Auth] Errore login Google:', error)
  }

  async function signOut() {
    clearCachedProfile()
    await supabase.auth.signOut()
    setUser(null)
  }

  return { user, loading, signInWithGoogle, signOut }
}
