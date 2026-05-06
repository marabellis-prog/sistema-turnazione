import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { AuthUser } from '../types'

// Timeout per evitare spinner infinito
const TIMEOUT_MS = 8000

export function useAuth() {
  const [user, setUser]       = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        if (session?.user?.email) {
          await loadUser(session.user.email)
        } else {
          setUser(null)
          setLoading(false)
        }
      }
    )
    return () => subscription.unsubscribe()
  }, [])

  async function loadUser(email: string) {
    // Promise con timeout: se la query non risponde entro 8s → fallback
    const queryPromise = supabase.rpc('get_my_profile')
    const timeoutPromise = new Promise<{ data: null; error: Error }>(resolve =>
      setTimeout(() => resolve({ data: null, error: new Error('timeout') }), TIMEOUT_MS)
    )

    try {
      const result = await Promise.race([queryPromise, timeoutPromise])
      const { data, error } = result as Awaited<typeof queryPromise>

      if (error) {
        console.error('[Auth] Errore get_my_profile:', error.message)
        // Non fare signOut su errori di rete/timeout: mostra pagina login
        setUser(null)
        return
      }

      // rpc() restituisce un array; prendi il primo elemento
      const profile = Array.isArray(data) ? data[0] : data

      if (!profile) {
        // Utente autenticato con Google ma non nella whitelist
        console.warn('[Auth] Profilo non trovato per:', email.toLowerCase())
        await supabase.auth.signOut()
        setUser(null)
      } else {
        setUser({
          id:    profile.id,
          email: profile.email,
          ruolo: profile.ruolo as 'admin' | 'user',
          nome:  profile.nome ?? null,
        })
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
    await supabase.auth.signOut()
    setUser(null)
  }

  return { user, loading, signInWithGoogle, signOut }
}
