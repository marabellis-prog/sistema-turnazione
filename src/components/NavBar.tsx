import { Link, useLocation } from 'react-router-dom'
import { LogOut, Calendar, Settings, Users, AlertTriangle, RefreshCw } from 'lucide-react'
import { usePendingActions } from '../contexts/PendingActionsContext'
import { useVersionCheck } from '../hooks/useVersionCheck'
import type { AuthUser } from '../types'

interface Props {
  user: AuthUser | null
  onSignOut: () => void
}

export function NavBar({ user, onSignOut }: Props) {
  const loc = useLocation()
  const { needsRegen, needsRefresh } = usePendingActions()
  const { updateAvailable, applyUpdate } = useVersionCheck()

  const navLink = (to: string, label: string, Icon: React.ElementType) => {
    const active = loc.pathname.startsWith(to)
    return (
      <Link
        to={to}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors
          ${active ? '' : 'hover:text-white'}`}
        style={active
          ? { background: 'rgba(255,255,255,0.15)', color: '#fff' }
          : { color: '#9ab488' }}
      >
        <Icon size={15} />
        {label}
      </Link>
    )
  }

  return (
    <nav className="text-white shadow-md print:hidden"
      style={{ background: '#2b3c24' }}>
      <div className="max-w-screen-xl mx-auto px-4 flex items-center gap-3 h-12">

        {/* Logo + nome app */}
        <div className="flex items-center gap-2 shrink-0">
          <Calendar size={17} style={{ color: '#9ab488' }} />
          <span className="font-bold text-sm tracking-tight" style={{ color: '#e0e8d8' }}>
            Sistema Turni
          </span>
        </div>

        {/* ── Aggiornamento disponibile (tutti gli utenti) ─────── */}
        {updateAvailable && (
          <button
            onClick={applyUpdate}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold
                       transition-colors hover:opacity-90 shrink-0"
            style={{ background: '#d97706', color: '#fff' }}
            title="Clicca per ricaricare con la versione aggiornata">
            <RefreshCw size={12} className="animate-spin" style={{ animationDuration: '2s' }} />
            Aggiornamento disponibile — ricarica
          </button>
        )}

        {/* ── Avviso pendente (solo admin) ──────────────────────── */}
        {user?.ruolo === 'admin' && needsRegen && (
          <Link
            to="/admin/genera"
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold
                       animate-pulse transition-colors hover:opacity-90 shrink-0"
            style={{ background: '#b91c1c', color: '#fff' }}
            title={`Rigenerazione richiesta: ${needsRegen.reason}`}
          >
            <AlertTriangle size={13} />
            Rigenera calendario
          </Link>
        )}

        {user?.ruolo === 'admin' && !needsRegen && needsRefresh && (
          <Link
            to="/admin/genera"
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold
                       transition-colors hover:opacity-90 shrink-0"
            style={{ background: '#92400e', color: '#fff' }}
            title={`Aggiornamento consigliato: ${needsRefresh.reason}`}
          >
            <RefreshCw size={12} />
            Aggiorna calendario
          </Link>
        )}

        {/* Navigazione */}
        {user && (
          <div className="flex items-center gap-1 ml-1">
            {navLink('/calendario', 'Calendario', Calendar)}
            {user.ruolo === 'admin' && navLink('/admin', 'Admin', Settings)}
          </div>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Utente + logout + versione */}
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

        {/* Versione build — dopo il pulsante Esci */}
        <span className="hidden sm:block text-[10px] font-mono shrink-0"
          style={{ color: '#c0d0b0' }}
          title={`Versione ${__APP_VERSION__} — build del ${__BUILD_DATE__}`}>
          v{__APP_VERSION__} · {__BUILD_DATE__}
        </span>
      </div>
    </nav>
  )
}
