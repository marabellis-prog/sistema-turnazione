import { Link, useLocation } from 'react-router-dom'
import { LogOut, Calendar, Settings, Users } from 'lucide-react'
import type { AuthUser } from '../types'

interface Props {
  user: AuthUser | null
  onSignOut: () => void
}

export function NavBar({ user, onSignOut }: Props) {
  const loc = useLocation()

  const navLink = (to: string, label: string, Icon: React.ElementType) => {
    const active = loc.pathname.startsWith(to)
    return (
      <Link
        to={to}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors
          ${active
            ? 'bg-blue-700 text-white'
            : 'text-blue-100 hover:bg-blue-700/60'
          }`}
      >
        <Icon size={15} />
        {label}
      </Link>
    )
  }

  return (
    <nav className="bg-blue-800 text-white shadow-md print:hidden">
      <div className="max-w-screen-xl mx-auto px-4 flex items-center justify-between h-12">
        {/* Logo / nome app */}
        <div className="flex items-center gap-3">
          <Calendar size={20} className="text-blue-200" />
          <span className="font-bold text-base tracking-tight">Sistema Turni</span>
        </div>

        {/* Link navigazione */}
        {user && (
          <div className="flex items-center gap-1">
            {navLink('/calendario', 'Calendario', Calendar)}
            {user.ruolo === 'admin' && navLink('/admin', 'Admin', Settings)}
          </div>
        )}

        {/* Utente + logout */}
        {user && (
          <div className="flex items-center gap-3">
            <span className="hidden sm:flex items-center gap-1.5 text-blue-200 text-xs">
              <Users size={13} />
              {user.nome || user.email}
              {user.ruolo === 'admin' && (
                <span className="bg-amber-400 text-amber-900 text-[10px] font-bold px-1 rounded">
                  ADMIN
                </span>
              )}
            </span>
            <button
              onClick={onSignOut}
              className="flex items-center gap-1 text-blue-200 hover:text-white text-xs transition-colors"
              title="Esci"
            >
              <LogOut size={14} />
              <span className="hidden sm:inline">Esci</span>
            </button>
          </div>
        )}
      </div>
    </nav>
  )
}
