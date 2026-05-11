/**
 * AuthCallbackPage — pagina di "atterraggio" dopo OAuth Google.
 *
 * Flusso:
 *  1. Utente clicca "Accedi con Google" → OAuth Google → questa pagina
 *  2. Aspetta che Supabase completi lo scambio code → session (SIGNED_IN)
 *  3. SUBITO fa il check del profilo via fetch RPC `get_my_profile`
 *  4. Decisione:
 *     - profilo OK         → salva cache, navigate('/calendario')
 *     - profilo vuoto      → flag "accesso negato", signOut, navigate('/login')
 *     - errore di rete/RPC → flag "errore tecnico", signOut, navigate('/login')
 *
 * Punti chiave:
 *  - UI minimale (solo spinner + testo) — NIENTE CalendarLoadingScreen
 *    pesante, niente fetch dati. Vediamo questa pagina solo per il tempo
 *    necessario al check del profilo (~500 ms con rete normale).
 *  - Il check viene fatto QUI prima del redirect, non in ProtectedRoute.
 *    Cosicché l'utente non vede mai una pagina "intermedia caricamento
 *    calendario" se non è autorizzato — appare direttamente il banner
 *    sulla LoginPage.
 *  - Su mobile lento il flusso è identico, solo più lento. Lo status
 *    text aggiorna ("Verifica autorizzazione…") così l'utente capisce
 *    che sta accadendo qualcosa.
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

const TIMEOUT_MS = 15_000

export function AuthCallbackPage() {
  const navigate = useNavigate()
  const handled  = useRef(false)
  const [status, setStatus] = useState('Accesso in corso…')

  useEffect(() => {
    if (handled.current) return
    handled.current = true

    /** Esegue il check del profilo e fa il redirect appropriato. */
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

      // OK! Salva cache e naviga al calendario.
      setCachedProfile(result)
      navigate('/calendario', { replace: true })
    }

    // Listener SIGNED_IN: dopo che Supabase ha completato lo scambio code,
    // arriva l'evento con la session piena. Processiamo subito.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event === 'SIGNED_IN' && session) {
          subscription.unsubscribe()
          processSession(session)
        }
      },
    )

    // Edge case: refresh manuale di /auth/callback con session già esistente.
    // In quel caso SIGNED_IN non viene fired, ma getSession() ritorna la
    // sessione attiva — processiamo lo stesso.
    supabase.auth.getSession().then(({ data }) => {
      if (data.session && !handled.current) return  // già handled
      if (data.session) {
        subscription.unsubscribe()
        processSession(data.session)
      }
    }).catch(() => {})

    // Timeout di sicurezza: se nessun SIGNED_IN entro 15 s c'è qualcosa
    // che non va — torna al login senza spegnere l'app.
    const timeout = setTimeout(() => {
      subscription.unsubscribe()
      flagUnauthorized('(timeout autenticazione)', 'timeout sul callback OAuth')
      navigate('/login', { replace: true })
    }, TIMEOUT_MS)

    return () => {
      clearTimeout(timeout)
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
