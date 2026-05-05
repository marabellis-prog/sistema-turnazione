import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { AuthUser } from '../types'

export function useAuth() {
  const [user, setUser]       = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Recupera sessione iniziale
    supabase.auth.getSession().then(({ data }) => {
      if (data.session?.user) {
        loadUser(data.session.user.email!)
      } else {
        setLoading(false)
      }
    })

    // Ascolta cambiamenti di sessione
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        if (session?.user) {
          await loadUser(session.user.email!)
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
      const { data, error } = await supabase
        .from('utenti_autorizzati')
        .select('*')
        .eq('email', email)
        .eq('attivo', true)
        .maybeSingle()

      if (error || !data) {
        // Email non in whitelist → logout
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
    if (error) console.error('Errore login Google:', error)
  }

  async function signOut() {
    await supabase.auth.signOut()
    setUser(null)
  }

  return { user, loading, signInWithGoogle, signOut }
}
