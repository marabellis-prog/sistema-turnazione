/**
 * AuthCallbackPage — pass-through dopo OAuth Google.
 *
 * Nuova architettura (ispirata all'app sorella):
 *  - Quando arriviamo qui da Google con ?code=… (o #access_token=…), il
 *    client supabase-js ha già letto l'URL al boot del modulo
 *    (detectSessionInUrl: true) e ha avviato l'exchange.
 *  - Noi qui rediriger SUBITO a `/` — la rotta root gestisce il flow
 *    `loading? → user? → /calendario o /login` basandosi su useAuth, che
 *    nel frattempo processa il SIGNED_IN.
 *  - Vantaggi: zero logica di mount/subscribe duplicata, zero race con
 *    AuthCallbackPage che timeout-a perché SIGNED_IN arriva in un timing
 *    non previsto.
 */

import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

export function AuthCallbackPage() {
  const navigate = useNavigate()

  useEffect(() => {
    navigate('/', { replace: true })
  }, [navigate])

  return (
    <div className="min-h-screen flex items-center justify-center p-4"
      style={{ background: 'linear-gradient(135deg, #1c2818 0%, #456b3a 50%, #577a45 100%)' }}>
      <div className="rounded-2xl shadow-2xl p-8 w-full max-w-sm text-center"
        style={{ background: '#faf8f3' }}>
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 mx-auto mb-4"
          style={{ borderColor: '#476540' }} />
        <p className="text-sm font-semibold" style={{ color: '#2b3c24' }}>
          Reindirizzamento…
        </p>
      </div>
    </div>
  )
}
