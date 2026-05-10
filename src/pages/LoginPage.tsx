import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Calendar, AlertCircle } from 'lucide-react'
import type { AuthUser } from '../types'

interface Props {
  user: AuthUser | null
  onSignIn: () => void
}

export function LoginPage({ user, onSignIn }: Props) {
  const navigate = useNavigate()

  // Se siamo arrivati qui dopo un tentativo di login non autorizzato,
  // useAuth ha lasciato l'email problematica in sessionStorage. La
  // mostriamo all'utente così capisce cosa è andato storto invece di
  // vedere un misterioso "kick out".
  const [unauthorizedEmail, setUnauthorizedEmail] = useState<string | null>(null)
  useEffect(() => {
    try {
      const e = sessionStorage.getItem('auth_unauthorized_email')
      if (e) {
        setUnauthorizedEmail(e)
        sessionStorage.removeItem('auth_unauthorized_email')
      }
    } catch {}
  }, [])

  useEffect(() => {
    if (user) navigate('/calendario', { replace: true })
  }, [user, navigate])

  return (
    <div className="min-h-screen flex items-center justify-center p-4"
      style={{ background: 'linear-gradient(135deg, #1c2818 0%, #456b3a 50%, #577a45 100%)' }}>

      <div className="rounded-2xl shadow-2xl p-8 w-full max-w-sm text-center"
        style={{ background: '#faf8f3' }}>

        {/* Logo */}
        <div className="flex justify-center mb-6">
          <div className="rounded-full p-4" style={{ background: '#e0e8d8' }}>
            <Calendar size={40} style={{ color: '#476540' }} />
          </div>
        </div>

        <h1 className="text-2xl font-bold mb-1" style={{ color: '#2b3c24' }}>
          Sistema Turni
        </h1>
        <p className="text-sm mb-6" style={{ color: '#7a7a6a' }}>
          Gestione turni medici
        </p>

        {/* Messaggio "non autorizzato" — se useAuth ci ha rimandato qui
            dopo un login fallito (email non in elenco). */}
        {unauthorizedEmail && (
          <div className="rounded-lg p-3 mb-4 text-left flex items-start gap-2"
            style={{ background: '#fef2f2', border: '1px solid #fecaca' }}>
            <AlertCircle size={16} className="shrink-0 mt-0.5" style={{ color: '#b91c1c' }} />
            <div className="text-xs" style={{ color: '#991b1b' }}>
              <strong>Accesso negato.</strong> L'account{' '}
              <span style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{unauthorizedEmail}</span>{' '}
              non è abilitato. Verifica di aver scelto l'account Google
              corretto (clic su "Accedi con un altro account" qui sotto)
              o chiedi all'amministratore di aggiungerti.
            </div>
          </div>
        )}

        <button
          onClick={onSignIn}
          className="w-full flex items-center justify-center gap-3 rounded-xl
                     px-4 py-3 text-sm font-semibold shadow-sm transition-all"
          style={{
            background: '#faf8f3',
            color: '#3a3d30',
            border: '1.5px solid #c0d0b0',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = '#f0ead8')}
          onMouseLeave={e => (e.currentTarget.style.background = '#faf8f3')}
        >
          {/* Google icon */}
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path d="M17.64 9.2a10.3 10.3 0 0 0-.16-1.8H9v3.4h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92C16.66 14.25 17.64 11.93 17.64 9.2z" fill="#4285F4"/>
            <path d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.83.86-3.04.86-2.34 0-4.32-1.58-5.03-3.71H.96v2.33A8.99 8.99 0 0 0 9 18z" fill="#34A853"/>
            <path d="M3.97 10.71A5.41 5.41 0 0 1 3.68 9c0-.59.1-1.17.28-1.71V4.96H.96A8.99 8.99 0 0 0 0 9c0 1.45.35 2.82.96 4.04l3.01-2.33z" fill="#FBBC05"/>
            <path d="M9 3.58c1.32 0 2.5.45 3.44 1.34l2.58-2.58C13.46.89 11.43 0 9 0A8.99 8.99 0 0 0 .96 4.96l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" fill="#EA4335"/>
          </svg>
          Accedi con Google
        </button>

        {/* Link secondario "altro account": chiama lo stesso onSignIn — Google
            apre comunque la schermata di scelta account perché signInWithGoogle
            usa prompt: 'select_account'. Questo bottone rende esplicito
            all'utente che può scegliere un account diverso da quello
            attualmente loggato in Chrome. */}
        <button
          onClick={onSignIn}
          className="mt-3 text-xs underline transition-colors"
          style={{ color: '#6b6b5a' }}
          onMouseEnter={e => (e.currentTarget.style.color = '#3a3d30')}
          onMouseLeave={e => (e.currentTarget.style.color = '#6b6b5a')}
        >
          Accedi con un altro account
        </button>

        <p className="mt-6 text-xs" style={{ color: '#6b6b5a' }}>
          Solo gli account autorizzati possono accedere.
        </p>
      </div>
    </div>
  )
}
