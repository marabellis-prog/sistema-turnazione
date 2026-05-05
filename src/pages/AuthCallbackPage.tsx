import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export function AuthCallbackPage() {
  const navigate = useNavigate()

  useEffect(() => {
    // Supabase gestisce automaticamente il codice PKCE dall'URL
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        navigate('/calendario', { replace: true })
      } else {
        navigate('/login', { replace: true })
      }
    })
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
