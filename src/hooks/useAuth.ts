/**
 * useAuth — hook globale di autenticazione.
 *
 * Architettura semplificata (ispirata all'app sorella che funziona):
 *  - All'avvio dell'hook chiamiamo getSession() — il client supabase-js
 *    ha già processato l'URL (detectSessionInUrl: true). Se siamo arrivati
 *    da OAuth con ?code=… o #access_token=…, getSession() ritorna la
 *    session VALIDA (aspetta l'exchange interno se PKCE).
 *  - Se c'è una session valida: check whitelist via RPC, set user.
 *  - Se non c'è session: utente non loggato, ProtectedRoute redirige a /login.
 *  - Listener onAuthStateChange gestisce SOLO eventi successivi
 *    (SIGNED_OUT principalmente; SIGNED_IN se non l'abbiamo già processato).
 *  - Timeout di sicurezza 25s: se nulla risponde, sblocchiamo lo state
 *    per evitare "spinner infinito" — meglio mostrare login con possibile
 *    banner errore che lasciare l'utente bloccato.
 *
 * Niente più pagina /auth/callback dedicata che fa il check: la callback
 * è ora un semplice pass-through. Tutto avviene qui. Stesso pattern di
 * APP CHIAMATE dove funziona da tempo.
 */

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  getCachedProfile, setCachedProfile, clearCachedProfile,
  flagUnauthorized, detachedSignOut, fetchProfile,
} from '../lib/authHelpers'
import type { AuthUser } from '../types'
import type { Session } from '@supabase/supabase-js'

const SETUP_TIMEOUT_MS = 25_000

export function useAuth() {
  const [user,    setUser]    = useState<AuthUser | null>(() => getCachedProfile())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    /** Processa una session: cache hit, oppure check via fetch RPC. */
    async function processSession(session: Session) {
      const email = session.user.email ?? ''

      // Cache hit: nessuna chiamata al DB necessaria
      const cached = getCachedProfile()
      if (cached && cached.email.toLowerCase() === email.toLowerCase()) {
        if (cancelled) return
        setUser(cached)
        setLoading(false)
        return
      }

      // Check whitelist via fetch RPC diretta (bypassa supabase-js lock)
      const result = await fetchProfile(session.access_token)
      if (cancelled) return

      if (result && typeof result === 'object' && 'error' in result) {
        flagUnauthorized(email, `errore RPC: ${result.error}`)
        detachedSignOut()
        setUser(null)
        setLoading(false)
        return
      }
      if (!result) {
        flagUnauthorized(email, 'email non in elenco utenti autorizzati')
        detachedSignOut()
        setUser(null)
        setLoading(false)
        return
      }
      setCachedProfile(result)
      setUser(result)
      setLoading(false)
    }

    // Listener per cambi futuri di stato auth (SIGNED_OUT, SIGNED_IN tardivi)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (cancelled) return

        if (event === 'SIGNED_OUT') {
          clearCachedProfile()
          setUser(null)
          setLoading(false)
          return
        }

        if (event === 'SIGNED_IN' && session?.user?.email) {
          await processSession(session)
          return
        }
        // TOKEN_REFRESHED, USER_UPDATED, INITIAL_SESSION → ignora
        // (INITIAL_SESSION è gestito dal setup eager qui sotto)
      },
    )

    // Setup eager: stessa logica di setupAuth() dell'app sorella.
    // getSession() è async — aspetta che il client abbia processato l'URL
    // (PKCE exchange o implicit hash parse), poi ritorna la session se ok.
    ;(async () => {
      try {
        const { data, error } = await supabase.auth.getSession()
        if (cancelled) return
        if (error) {
          console.error('[Auth] setup getSession error:', error.message)
          flagUnauthorized('(setup)', `getSession: ${error.message}`)
          setUser(null)
          setLoading(false)
          return
        }
        if (data.session?.user?.email) {
          await processSession(data.session)
        } else {
          // Nessuna session — utente non loggato
          clearCachedProfile()
          setUser(null)
          setLoading(false)
        }
      } catch (e) {
        if (cancelled) return
        console.error('[Auth] setup exception:', e)
        flagUnauthorized('(setup)', `eccezione: ${(e as Error).message}`)
        setUser(null)
        setLoading(false)
      }
    })()

    // Timeout di sicurezza: se nessuno step risponde entro 25s, sbloccca
    // così la pagina non resta in caricamento all'infinito.
    const timeoutId = setTimeout(() => {
      if (cancelled) return
      console.warn('[Auth] setup timeout (25s) — fallback a stato non loggato')
      // Non flagghiamo qui — magari l'utente è semplicemente non loggato
      setLoading(false)
    }, SETUP_TIMEOUT_MS)

    return () => {
      cancelled = true
      clearTimeout(timeoutId)
      subscription.unsubscribe()
    }
  }, [])

  async function signInWithGoogle() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/sistema-turnazione/`,
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
