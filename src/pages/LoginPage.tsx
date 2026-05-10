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
  // useAuth ha lasciato l'email problematica + il motivo del fallimento
  // in sessionStorage. La mostriamo all'utente in un banner persistente
  // fino al click su OK — così capisce cosa è andato storto invece di
  // vedere un misterioso "kick out". Tolleriamo sia il formato JSON nuovo
  // (con motivo) sia il vecchio (solo email) per backward compatibility.
  const [denial, setDenial] = useState<{ email: string; reason?: string } | null>(null)
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('auth_unauthorized_email')
      if (!raw) return
      let parsed: { email: string; reason?: string } | null = null
      try {
        const obj = JSON.parse(raw)
        if (obj && typeof obj.email === 'string') parsed = obj
      } catch {
        // Vecchio formato: la chiave conteneva solo l'email come stringa.
        parsed = { email: raw }
      }
      if (parsed) setDenial(parsed)
    } catch {}
  }, [])

  function dismissDenial() {
    setDenial(null)
    try { sessionStorage.removeItem('auth_unauthorized_email') } catch {}
  }

  /** Etichetta human-friendly per le diverse cause di rifiuto. */
  function reasonLabel(reason?: string): string {
    if (!reason) return 'Motivo non specificato.'
    if (reason.startsWith('email non in elenco'))
      return "L'email non risulta tra gli account autorizzati. Verifica di aver scelto l'account Google corretto o chiedi all'amministratore di aggiungerti."
    if (reason.startsWith('errore RPC: timeout'))
      return 'Il server non ha risposto in tempo (timeout). Verifica la connessione e riprova.'
    if (reason.startsWith('errore RPC: HTTP'))
      return `Errore di rete durante la verifica del profilo (${reason.replace('errore RPC: ', '')}). Riprova fra qualche istante.`
    if (reason.startsWith('eccezione'))
      return `Errore tecnico imprevisto (${reason.replace('eccezione: ', '')}). Se persiste, contatta l'amministratore.`
    return reason
  }

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

        {/* Banner "Accesso negato" — persistente fino al click su OK.
            Mostra email + motivo del fallimento (timeout, non in elenco,
            errore RPC, eccezione). Cliccando OK il banner si chiude e la
            chiave sessionStorage viene rimossa. */}
        {denial && (
          <div className="rounded-lg p-3 mb-4 text-left"
            style={{ background: '#fef2f2', border: '1px solid #fecaca' }}>
            <div className="flex items-start gap-2 mb-2">
              <AlertCircle size={18} className="shrink-0 mt-0.5" style={{ color: '#b91c1c' }} />
              <div className="text-xs flex-1" style={{ color: '#991b1b' }}>
                <p className="font-bold text-sm mb-1">Accesso negato</p>
                <p className="mb-1">
                  Account:{' '}
                  <span style={{ fontFamily: 'monospace', wordBreak: 'break-all', fontWeight: 600 }}>
                    {denial.email}
                  </span>
                </p>
                <p>{reasonLabel(denial.reason)}</p>
              </div>
            </div>
            <button
              onClick={dismissDenial}
              className="w-full rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors"
              style={{ background: '#b91c1c', color: '#fff' }}
              onMouseEnter={e => (e.currentTarget.style.background = '#991b1b')}
              onMouseLeave={e => (e.currentTarget.style.background = '#b91c1c')}>
              OK, ho capito
            </button>
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
