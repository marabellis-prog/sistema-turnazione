/**
 * AuthCallbackPage — pagina di "atterraggio" dopo OAuth Google (implicit flow).
 *
 * Con flowType:'implicit' + detectSessionInUrl:true, il client supabase-js
 * legge automaticamente il token dall'URL hash al boot. Noi qui aspettiamo
 * SIGNED_IN (oppure leggiamo getSession() se la sessione è già attiva per
 * un refresh manuale) e poi facciamo il check del profilo via RPC.
 *
 * Decisione:
 *  - profilo OK         → salva cache, navigate('/calendario')
 *  - profilo vuoto      → flag "accesso negato", signOut, navigate('/login')
 *  - errore di rete/RPC → flag "errore tecnico", signOut, navigate('/login')
 *
 * UI: spinner + status text. Niente CalendarLoadingScreen.
 */

import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import {
  setCachedProfile,
  flagUnauthorized,
  detachedSignOut,
  fetchProfile,
} from '../lib/authHelpers'
import type { Session } from '@supabase/supabase-js'

const TIMEOUT_MS = 20_000

export function AuthCallbackPage() {
  const navigate = useNavigate()
  const handled  = useRef(false)
  const [status, setStatus] = useState('Accesso in corso…')

  useEffect(() => {
    if (handled.current) return
    handled.current = true

    /** Check del profilo via RPC e redirect. */
    async function processSession(session: Session) {
      const email = session.user.email ?? '(email mancante)'
      setStatus('Verifica autorizzazione…')

      const result = await fetchProfile(session.access_token)

      if (result && typeof result === 'object' && 'error' in result) {
        flagUnauthorized(email, `errore RPC: ${result.error}`)
        detachedSignOut()
        navigate('/login', { replace: true })
        return
      }
      if (!result) {
        flagUnauthorized(email, 'email non in elenco utenti autorizzati')
        detachedSignOut()
        navigate('/login', { replace: true })
        return
      }
      setCachedProfile(result)
      navigate('/calendario', { replace: true })
    }

    // Gestione errori OAuth nell'URL (utente cancella su Google, ecc.).
    // Con implicit flow l'errore arriva nell'hash (#error=...) o nei
    // query params (?error=...) a seconda di Google.
    const url   = new URL(window.location.href)
    const hashParams  = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    const errParam    = url.searchParams.get('error') ?? hashParams.get('error')
    const errDesc     = url.searchParams.get('error_description') ?? hashParams.get('error_description')

    if (errParam) {
      flagUnauthorized('(errore OAuth)', `Google: ${errDesc ?? errParam}`)
      navigate('/login', { replace: true })
      return
    }

    // Subscription a SIGNED_IN — il client supabase-js fa l'auto-detect
    // del token dall'hash al boot, poi fires l'evento.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event === 'SIGNED_IN' && session) {
          subscription.unsubscribe()
          processSession(session)
        }
      },
    )

    // Edge case: la session è già stata stabilita prima del mount
    // (es. refresh di /auth/callback con session valida). getSession()
    // la ritorna senza aspettare SIGNED_IN.
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        subscription.unsubscribe()
        processSession(data.session)
      }
    }).catch(() => {})

    const timeoutId = setTimeout(() => {
      subscription.unsubscribe()
      flagUnauthorized('(timeout)', 'timeout sul callback OAuth (>20s)')
      navigate('/login', { replace: true })
    }, TIMEOUT_MS)

    return () => {
      clearTimeout(timeoutId)
      subscription.unsubscribe()
    }
  }, [navigate])

  return (
    <div className="min-h-screen flex items-center justify-center p-4"
      style={{ background: 'linear-gradient(135deg, #1c2818 0%, #456b3a 50%, #577a45 100%)' }}>
      <div className="rounded-2xl shadow-2xl p-8 w-full max-w-sm text-center"
        style={{ background: '#faf8f3' }}>
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 mx-auto mb-4"
          style={{ borderColor: '#476540' }} />
        <p className="text-sm font-semibold" style={{ color: '#2b3c24' }}>
          {status}
        </p>
        <p className="text-xs mt-2" style={{ color: '#7a7a6a' }}>
          Attendi qualche istante…
        </p>
      </div>
    </div>
  )
}
