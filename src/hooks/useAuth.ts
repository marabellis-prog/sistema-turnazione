import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { AuthUser } from '../types'

const CACHE_KEY    = 'auth_user_profile'
const TIMEOUT_MS   = 8000

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
        if (event === 'SIGNED_OUT') {
          clearCached()
          setUser(null)
          setLoading(false)
          return
        }

        if (session?.user?.email) {
          // Se abbiamo la cache E l'email corrisponde → usa subito la cache
          const cached = getCached()
          if (cached && cached.email.toLowerCase() === session.user.email.toLowerCase()) {
            setUser(cached)
            setLoading(false)
            return
          }
          // Altrimenti recupera dal DB
          await loadUser(session.user.email)
        } else {
          clearCached()
          setUser(null)
          setLoading(false)
        }
      }
    )
    return () => subscription.unsubscribe()
  }, [])

  async function loadUser(email: string) {
    const queryPromise = supabase.rpc('get_my_profile')
    const timeoutPromise = new Promise<{ data: null; error: Error }>(resolve =>
      setTimeout(() => resolve({ data: null, error: new Error('timeout') }), TIMEOUT_MS)
    )

    try {
      const result = await Promise.race([queryPromise, timeoutPromise])
      const { data, error } = result as Awaited<typeof queryPromise>

      if (error) {
        console.error('[Auth] Errore get_my_profile:', error.message)
        setUser(null)
        return
      }

      const profile = Array.isArray(data) ? data[0] : data

      if (!profile) {
        console.warn('[Auth] Profilo non trovato per:', email.toLowerCase())
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
