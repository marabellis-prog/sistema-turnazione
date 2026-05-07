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
            ? 'text-white'
            : 'text-olive-200 hover:text-white hover:bg-olive-700/50'
          }`}
        style={active ? { background: 'rgba(255,255,255,0.15)' } : {}}
      >
        <Icon size={15} />
        {label}
      </Link>
    )
  }

  return (
    <nav className="text-white shadow-md print:hidden"
      style={{ background: '#2b3c24' }}>
      <div className="max-w-screen-xl mx-auto px-4 flex items-center justify-between h-12">

        {/* Logo */}
        <div className="flex items-center gap-3">
          <Calendar size={18} style={{ color: '#9ab488' }} />
          <span className="font-bold text-sm tracking-tight text-cream-200">
            Sistema Turni
          </span>
        </div>

        {/* Navigazione */}
        {user && (
          <div className="flex items-center gap-1">
            {navLink('/calendario', 'Calendario', Calendar)}
            {user.ruolo === 'admin' && navLink('/admin', 'Admin', Settings)}
          </div>
        )}

        {/* Utente + logout */}
        {user && (
          <div className="flex items-center gap-3">
            <span className="hidden sm:flex items-center gap-1.5 text-xs"
              style={{ color: '#9ab488' }}>
              <Users size={13} />
              {user.nome || user.email}
              {user.ruolo === 'admin' && (
                <span className="text-[10px] font-bold px-1 rounded"
                  style={{ background: '#9ab488', color: '#1c2818' }}>
                  ADMIN
                </span>
              )}
            </span>
            <button
              onClick={onSignOut}
              className="flex items-center gap-1 text-xs transition-colors"
              style={{ color: '#9ab488' }}
              onMouseEnter={e => (e.currentTarget.style.color = '#fff')}
              onMouseLeave={e => (e.currentTarget.style.color = '#9ab488')}
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
