/**
 * AuthCallbackPage — pagina di "atterraggio" dopo OAuth Google.
 *
 * Flusso:
 *  1. Utente clicca "Accedi con Google" → OAuth Google → questa pagina
 *     (URL: /auth/callback?code=...&state=...)
 *  2. Eseguiamo MANUALMENTE supabase.auth.exchangeCodeForSession() per
 *     scambiare il code OAuth con una session valida. Non ci affidiamo a
 *     `detectSessionInUrl: true` perché su mobile/browser strict il code
 *     verifier può non essere trovato in localStorage in tempo, causando
 *     un fallimento silenzioso (timeout). Lo scambio manuale espone
 *     l'errore reale invece di farci aspettare 15s a vuoto.
 *  3. SUBITO fa il check del profilo via fetch RPC `get_my_profile`
 *  4. Decisione:
 *     - profilo OK         → salva cache, navigate('/calendario')
 *     - profilo vuoto      → flag "accesso negato", signOut, navigate('/login')
 *     - errore di rete/RPC → flag "errore tecnico", signOut, navigate('/login')
 *
 * UI minimale (solo spinner + testo) — niente CalendarLoadingScreen.
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

const TIMEOUT_MS = 20_000   // 20s — generoso per cold start mobile

export function AuthCallbackPage() {
  const navigate = useNavigate()
  const handled  = useRef(false)
  const [status, setStatus] = useState('Accesso in corso…')

  useEffect(() => {
    if (handled.current) return
    handled.current = true

    /** Esegue il check del profilo via RPC e fa il redirect appropriato. */
    async function processSession(session: Session) {
      const email = session.user.email ?? '(email mancante)'
      setStatus('Verifica autorizzazione…')

      const result = await fetchProfile(session.access_token)

      // Errore di rete / RPC / HTTP non-2xx
      if (result && typeof result === 'object' && 'error' in result) {
        flagUnauthorized(email, `errore RPC: ${result.error}`)
        detachedSignOut()
        navigate('/login', { replace: true })
        return
      }
      // Profilo vuoto = email non in whitelist
      if (!result) {
        flagUnauthorized(email, 'email non in elenco utenti autorizzati')
        detachedSignOut()
        navigate('/login', { replace: true })
        return
      }
      // OK
      setCachedProfile(result)
      navigate('/calendario', { replace: true })
    }

    /** Punto d'ingresso async — orchestra il flusso completo. */
    async function init() {
      try {
        const url = new URL(window.location.href)
        const code  = url.searchParams.get('code')
        const errParam = url.searchParams.get('error')

        // Caso A: Google ha restituito un errore (es. utente ha cliccato Cancel)
        if (errParam) {
          const desc = url.searchParams.get('error_description') ?? errParam
          flagUnauthorized('(errore OAuth)', `Google: ${desc}`)
          navigate('/login', { replace: true })
          return
        }

        // Caso B: c'è un code OAuth → scambio esplicito (più robusto del
        // detectSessionInUrl automatico, soprattutto su mobile)
        if (code) {
          setStatus('Scambio del codice di accesso…')
          // exchangeCodeForSession legge code + code_verifier (da localStorage)
          // e contatta /auth/v1/token su Supabase. Se code_verifier è mancato
          // (race / privacy strict) ritorna un errore esplicito invece di
          // restare in stallo per sempre.
          const { data, error } = await supabase.auth.exchangeCodeForSession(
            window.location.href,
          )
          if (error) {
            flagUnauthorized(
              '(scambio code OAuth)',
              `exchangeCodeForSession: ${error.message}`,
            )
            detachedSignOut()
            navigate('/login', { replace: true })
            return
          }
          if (data.session) {
            await processSession(data.session)
            return
          }
          // exchange OK ma niente session (caso patologico)
          flagUnauthorized('(scambio code OAuth)', 'session vuota dopo exchange')
          detachedSignOut()
          navigate('/login', { replace: true })
          return
        }

        // Caso C: nessun code nell'URL (refresh manuale di /auth/callback)
        // Se c'è già una sessione valida in localStorage → la usiamo.
        const { data: sessionData } = await supabase.auth.getSession()
        if (sessionData.session) {
          await processSession(sessionData.session)
          return
        }

        // Niente da fare: torna al login
        navigate('/login', { replace: true })
      } catch (e) {
        flagUnauthorized(
          '(eccezione callback)',
          `${(e as Error).message ?? 'sconosciuta'}`,
        )
        detachedSignOut()
        navigate('/login', { replace: true })
      }
    }

    // Timeout di sicurezza
    const timeoutId = setTimeout(() => {
      flagUnauthorized('(timeout)', 'timeout sul callback OAuth (>20s)')
      navigate('/login', { replace: true })
    }, TIMEOUT_MS)

    init().finally(() => clearTimeout(timeoutId))

    return () => clearTimeout(timeoutId)
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
