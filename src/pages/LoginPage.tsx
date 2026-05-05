import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Calendar } from 'lucide-react'
import type { AuthUser } from '../types'

interface Props {
  user: AuthUser | null
  onSignIn: () => void
}

export function LoginPage({ user, onSignIn }: Props) {
  const navigate = useNavigate()

  useEffect(() => {
    if (user) navigate('/calendario', { replace: true })
  }, [user, navigate])

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 to-blue-700 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-sm text-center">
        {/* Logo */}
        <div className="flex justify-center mb-6">
          <div className="bg-blue-100 rounded-full p-4">
            <Calendar size={40} className="text-blue-700" />
          </div>
        </div>

        <h1 className="text-2xl font-bold text-gray-800 mb-1">Sistema Turni</h1>
        <p className="text-sm text-gray-500 mb-8">
          Gestione turni medici
        </p>

        <button
          onClick={onSignIn}
          className="w-full flex items-center justify-center gap-3 rounded-xl border border-gray-300
                     bg-white px-4 py-3 text-sm font-semibold text-gray-700 shadow-sm
                     hover:bg-gray-50 hover:shadow-md transition-all"
        >
          {/* Google icon SVG */}
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path d="M17.64 9.2a10.3 10.3 0 0 0-.16-1.8H9v3.4h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92C16.66 14.25 17.64 11.93 17.64 9.2z" fill="#4285F4"/>
            <path d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.83.86-3.04.86-2.34 0-4.32-1.58-5.03-3.71H.96v2.33A8.99 8.99 0 0 0 9 18z" fill="#34A853"/>
            <path d="M3.97 10.71A5.41 5.41 0 0 1 3.68 9c0-.59.1-1.17.28-1.71V4.96H.96A8.99 8.99 0 0 0 0 9c0 1.45.35 2.82.96 4.04l3.01-2.33z" fill="#FBBC05"/>
            <path d="M9 3.58c1.32 0 2.5.45 3.44 1.34l2.58-2.58C13.46.89 11.43 0 9 0A8.99 8.99 0 0 0 .96 4.96l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" fill="#EA4335"/>
          </svg>
          Accedi con Google
        </button>

        <p className="mt-6 text-xs text-gray-400">
          Solo gli account autorizzati possono accedere.
        </p>
      </div>
    </div>
  )
}
