import { Navigate } from 'react-router-dom'
import type { AuthUser } from '../types'

interface Props {
  user:              AuthUser | null
  loading:           boolean
  requireAdmin?:     boolean
  /** Ruoli ammessi alla rotta. Default: ['admin','user'] (esclude ospite).
   *  Per /settimanale passare ['admin','user','ospite']. */
  allowedRoles?:     Array<AuthUser['ruolo']>
  /**
   * Componente da mostrare durante l'auth check. Se non specificato,
   * mostra uno spinner generico. Per /calendario passare <CalendarLoadingScreen />
   * così la transizione auth → dati è visivamente continua.
   */
  loadingComponent?: React.ReactNode
  children:          React.ReactNode
}

export function ProtectedRoute({
  user, loading, requireAdmin = false, allowedRoles, loadingComponent, children,
}: Props) {
  if (loading) {
    if (loadingComponent) return <>{loadingComponent}</>
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-olive-600 mx-auto mb-3" />
          <p className="text-stone-600 text-sm">Caricamento…</p>
        </div>
      </div>
    )
  }

  if (!user) return <Navigate to="/login" replace />
  if (requireAdmin && user.ruolo !== 'admin') return <Navigate to="/" replace />

  // Default: vietato agli ospiti (consentiti admin e user). Le rotte che
  // ammettono ospiti devono dichiarare allowedRoles esplicitamente.
  const roles = allowedRoles ?? ['admin', 'user']
  if (!roles.includes(user.ruolo)) return <Navigate to="/" replace />

  return <>{children}</>
}
