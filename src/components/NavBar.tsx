import { useEffect } from 'react'
import { useLocation, useHref } from 'react-router-dom'
import { LogOut, Calendar, Settings, Users, AlertTriangle, RefreshCw } from 'lucide-react'
import { usePendingActions } from '../contexts/PendingActionsContext'
import { useVersionCheck } from '../hooks/useVersionCheck'
import type { AuthUser } from '../types'

interface Props {
  user: AuthUser | null
  onSignOut: () => void
}

// Nomi unici delle window/tab — il target HTML usa questi per ritrovare
// la tab già aperta invece di duplicarla. Nomi prefissati per evitare
// collisioni con eventuali altre app aperte dall'utente.
const TAB_CALENDARIO = 'sistema-turni-calendario'
const TAB_ADMIN      = 'sistema-turni-admin'

export function NavBar({ user, onSignOut }: Props) {
  const loc = useLocation()
  const { needsRegen, needsRefresh } = usePendingActions()
  const { updateAvailable, applyUpdate } = useVersionCheck()
  // useHref → applica il basename "/sistema-turnazione" automaticamente
  const hrefCalendario = useHref('/calendario')
  const hrefAdmin      = useHref('/admin')

  // Auto-rinomina la tab corrente in base alla pagina su cui è.
  // Quando un'altra tab apre target="sistema-turni-calendario", il browser
  // trova questa tab (se è sul calendario) e ci salta sopra.
  useEffect(() => {
    if (loc.pathname.startsWith('/admin')) {
      window.name = TAB_ADMIN
    } else if (loc.pathname.startsWith('/calendario')) {
      window.name = TAB_CALENDARIO
    }
  }, [loc.pathname])

  /**
   * Click handler "smart" per i link Calendario/Admin:
   *  - Se sei già sulla pagina destinazione → no-op (non ricarica).
   *  - Altrimenti `window.open('', tabName)` → trick noto: se esiste una
   *    tab con quel nome, restituisce la sua reference SENZA navigarla
   *    (preserva stato e scroll). Solo focus.
   *  - Se non esiste, ne apre una blank, poi la naviga al path desiderato.
   *  - Se i popup sono bloccati → fallback a navigation in stessa tab.
   */
  const handleSmartNav = (
    e: React.MouseEvent,
    href: string,
    tabName: string,
    isActive: boolean,
  ) => {
    if (isActive) { e.preventDefault(); return }
    e.preventDefault()
    const existing = window.open('', tabName)
    if (!existing) { window.location.href = href; return }

    // Se la tab nominata è la NOSTRA tab corrente (succede quando
    // il window.name di questa tab coincide col target — es. clicco
    // "Rigenera calendario" da una pagina /admin/qualcos'altro che
    // ha window.name = TAB_ADMIN), navighiamo normalmente in-app.
    // Altrimenti window.open ci restituisce noi stessi e poi `isBlank=false`
    // farebbe un focus() no-op, lasciando l'utente bloccato.
    if (existing === window) {
      window.location.href = href
      return
    }

    let isBlank = true
    try {
      const cur = existing.location.href
      isBlank = !cur || cur === 'about:blank'
    } catch (_) {
      isBlank = false // cross-origin guard (in pratica non capita qui)
    }
    if (isBlank) existing.location.href = href
    existing.focus()
  }

  const smartLink = (
    to: string, href: string, tabName: string,
    label: string, Icon: React.ElementType,
  ) => {
    const active = loc.pathname.startsWith(to)
    return (
      <a
        href={href}
        target={tabName}
        onClick={e => handleSmartNav(e, href, tabName, active)}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors
          ${active ? '' : 'hover:text-white'}`}
        style={active
          ? { background: 'rgba(255,255,255,0.15)', color: '#fff' }
          : { color: '#9ab488' }}
      >
        <Icon size={15} />
        {label}
      </a>
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
        {/* Aprono la tab Admin (coerenti con il link "Admin" qui sopra). */}
        {user?.ruolo === 'admin' && needsRegen && (
          <a
            href={hrefAdmin + '/genera'}
            target={TAB_ADMIN}
            onClick={e => handleSmartNav(e, hrefAdmin + '/genera', TAB_ADMIN,
                                          loc.pathname.startsWith('/admin/genera'))}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold
                       animate-pulse transition-colors hover:opacity-90 shrink-0"
            style={{ background: '#b91c1c', color: '#fff' }}
            title={`Rigenerazione richiesta: ${needsRegen.reason}`}
          >
            <AlertTriangle size={13} />
            Rigenera calendario
          </a>
        )}

        {user?.ruolo === 'admin' && !needsRegen && needsRefresh && (
          <a
            href={hrefAdmin + '/genera'}
            target={TAB_ADMIN}
            onClick={e => handleSmartNav(e, hrefAdmin + '/genera', TAB_ADMIN,
                                          loc.pathname.startsWith('/admin/genera'))}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold
                       transition-colors hover:opacity-90 shrink-0"
            style={{ background: '#92400e', color: '#fff' }}
            title={`Aggiornamento consigliato: ${needsRefresh.reason}`}
          >
            <RefreshCw size={12} />
            Aggiorna calendario
          </a>
        )}

        {/* Navigazione — Calendario e Admin in tab separate.
            Se la tab esiste già, il browser ci salta sopra invece di duplicarla. */}
        {user && (
          <div className="flex items-center gap-1 ml-1">
            {smartLink('/calendario', hrefCalendario, TAB_CALENDARIO, 'Calendario', Calendar)}
            {user.ruolo === 'admin' &&
              smartLink('/admin', hrefAdmin, TAB_ADMIN, 'Admin', Settings)}
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
          title={`Commit ${__APP_VERSION__} — build del ${__BUILD_DATE__}`}>
          v{__APP_VERSION__} · {__BUILD_DATE__}
        </span>
      </div>
    </nav>
  )
}
