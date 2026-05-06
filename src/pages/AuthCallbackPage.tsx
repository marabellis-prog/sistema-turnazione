import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export function AuthCallbackPage() {
  const navigate = useNavigate()
  const handled  = useRef(false)

  useEffect(() => {
    // Evita doppia esecuzione in StrictMode
    if (handled.current) return
    handled.current = true

    // Con PKCE flow, Supabase scambia il codice async.
    // onAuthStateChange si attiva quando lo scambio è completato.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event === 'SIGNED_IN' && session) {
          subscription.unsubscribe()
          navigate('/calendario', { replace: true })
          return
        }
        if (event === 'SIGNED_OUT') {
          subscription.unsubscribe()
          navigate('/login', { replace: true })
        }
      }
    )

    // Controlla se la sessione esiste già (es. refresh della pagina)
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        subscription.unsubscribe()
        navigate('/calendario', { replace: true })
      }
    })

    // Timeout di sicurezza: se dopo 15s non arriva nulla → login
    const timeout = setTimeout(() => {
      subscription.unsubscribe()
      navigate('/login', { replace: true })
    }, 15_000)

    return () => {
      clearTimeout(timeout)
      subscription.unsubscribe()
    }
  }, [navigate])

  return (
    <div className="flex min-h-screen items-center justify-center bg-blue-50">
      <div className="text-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mx-auto mb-3" />
        <p className="text-gray-600 text-sm">Accesso in corso...</p>
      </div>
    </div>
  )
}
