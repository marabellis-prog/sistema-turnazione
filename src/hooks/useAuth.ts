import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { AuthUser } from '../types'

export function useAuth() {
  const [user, setUser]       = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Un solo listener, gestisce sia l'inizializzazione (INITIAL_SESSION)
    // sia i cambiamenti successivi (SIGNED_IN, SIGNED_OUT, TOKEN_REFRESHED)
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
    try {
      const emailLower = email.toLowerCase().trim()

      const { data, error } = await supabase
        .from('utenti_autorizzati')
        .select('id, email, ruolo, nome, attivo')
        .ilike('email', emailLower)   // case-insensitive
        .eq('attivo', true)
        .maybeSingle()

      if (error) {
        // Errore DB (es. RLS block) – non fare signOut, potrebbe essere temporaneo
        console.error('[Auth] Errore query:', error.code, error.message)
        setUser(null)
        return
      }

      if (!data) {
        // Email non nella whitelist → logout
        console.warn('[Auth] Email non autorizzata:', emailLower)
        await supabase.auth.signOut()
        setUser(null)
      } else {
        setUser({
          id:    data.id,
          email: data.email,
          ruolo: data.ruolo,
          nome:  data.nome,
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
