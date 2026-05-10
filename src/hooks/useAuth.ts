import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { AuthUser } from '../types'

const CACHE_KEY  = 'auth_user_profile'
const TIMEOUT_MS = 8000

// ── Cache sessionStorage ──────────────────────────────────────────
function getCached(): AuthUser | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY)
    return raw ? (JSON.parse(raw) as AuthUser) : null
  } catch { return null }
}
function setCached(u: AuthUser) {
  try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(u)) } catch {}
}
function clearCached() {
  try { sessionStorage.removeItem(CACHE_KEY) } catch {}
}

// ─────────────────────────────────────────────────────────────────

export function useAuth() {
  const [user, setUser]       = useState<AuthUser | null>(() => getCached())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {

        // ── SIGNED_OUT: unico evento che causa logout reale ──────
        if (event === 'SIGNED_OUT') {
          clearCached()
          setUser(null)
          setLoading(false)
          return
        }

        // ── INITIAL_SESSION: fired una volta sola all'avvio ─────
        if (event === 'INITIAL_SESSION') {
          if (session?.user?.email) {
            const cached = getCached()
            if (cached && cached.email.toLowerCase() === session.user.email.toLowerCase()) {
              // Profilo già in cache → nessuna chiamata al DB
              setUser(cached)
              setLoading(false)
            } else {
              await loadUser(session.user.email)
            }
          } else {
            // Nessuna sessione all'avvio (utente non loggato)
            clearCached()
            setUser(null)
            setLoading(false)
          }
          return
        }

        // ── SIGNED_IN: dopo OAuth callback ──────────────────────
        if (event === 'SIGNED_IN' && session?.user?.email) {
          const cached = getCached()
          if (cached && cached.email.toLowerCase() === session.user.email.toLowerCase()) {
            setUser(cached)
            setLoading(false)
          } else {
            await loadUser(session.user.email)
          }
          return
        }

        // ── TOKEN_REFRESHED / USER_UPDATED / altri: ignora ──────
        // NON cambiare lo stato — l'utente è già loggato
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  async function loadUser(email: string) {
    const queryPromise   = supabase.rpc('get_my_profile')
    const timeoutPromise = new Promise<{ data: null; error: Error }>(resolve =>
      setTimeout(() => resolve({ data: null, error: new Error('timeout') }), TIMEOUT_MS)
    )

    try {
      const result  = await Promise.race([queryPromise, timeoutPromise])
      const { data, error } = result as Awaited<typeof queryPromise>

      if (error) {
        console.error('[Auth] Errore get_my_profile:', error.message)
        setUser(null)
        return
      }

      const profile = Array.isArray(data) ? data[0] : data

      if (!profile) {
        // Email Google non nella whitelist (o con dot-trick non compatibile,
        // o l'utente ha scelto un account Google diverso da quello previsto).
        // Segnaliamo motivo via sessionStorage così LoginPage può mostrare
        // un messaggio chiaro invece di un silenzioso ritorno a /login.
        console.warn('[Auth] Non autorizzato:', email.toLowerCase())
        try {
          sessionStorage.setItem('auth_unauthorized_email', email.toLowerCase())
        } catch {}
        await supabase.auth.signOut()
        setUser(null)
      } else {
        const authUser: AuthUser = {
          id:    profile.id,
          email: profile.email,
          ruolo: profile.ruolo as 'admin' | 'user',
          nome:  profile.nome ?? null,
        }
        setCached(authUser)
        setUser(authUser)
      }
    } catch (e) {
      console.error('[Auth] Errore imprevisto:', e)
      setUser(null)
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
    clearCached()
    await supabase.auth.signOut()
    setUser(null)
  }

  return { user, loading, signInWithGoogle, signOut }
}
