import { useEffect } from 'react'
import { Link, useLocation, useHref } from 'react-router-dom'
import { LogOut, Calendar, CalendarDays, Settings, Users, AlertTriangle, RefreshCw } from 'lucide-react'
import { usePendingActions } from '../contexts/PendingActionsContext'
import { useVersionCheck } from '../hooks/useVersionCheck'
import type { AuthUser } from '../types'

interface Props {
  user: AuthUser | null
  onSignOut: () => void
}

// Solo la tab Admin ha un nome dedicato — quando un'altra tab clicca
// "Admin" il browser focalizza la tab admin esistente invece di duplicarla.
// Calendario e Settimanale invece navigano sempre nella tab corrente.
const TAB_ADMIN = 'sistema-turni-admin'

export function NavBar({ user, onSignOut }: Props) {
  const loc = useLocation()
  const { needsRegen, needsRefresh } = usePendingActions()
  const { updateAvailable, applyUpdate } = useVersionCheck()
  // useHref → applica il basename "/sistema-turnazione" automaticamente.
  // Serve solo per il link Admin e per i badge "Rigenera/Aggiorna"
  // (entrambi orientati a /admin/*). Calendario e Settimanale usano
  // <Link to="..."> che gestisce il basename da sé.
  const hrefAdmin = useHref('/admin')

  // Auto-rinomina la tab corrente quando l'utente si trova su /admin/*
  // — così altre tab che cliccano "Admin" la trovano e ci saltano sopra.
  // Se l'utente lascia /admin (es. naviga su /calendario nella stessa tab),
  // resettiamo il nome: in quel modo un click "Admin" da un'altra tab
  // aprirà una NUOVA tab admin invece di portare l'utente fuori dalla
  // pagina dove sta lavorando.
  useEffect(() => {
    if (loc.pathname.startsWith('/admin')) {
      window.name = TAB_ADMIN
    } else if (window.name === TAB_ADMIN) {
      window.name = ''
    }
  }, [loc.pathname])

  /**
   * Click handler "smart" — usato SOLO per il link Admin (e per i badge
   * "Rigenera/Aggiorna calendario") che vogliono aprire/focalizzare la
   * tab admin dedicata.
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

  /** Link "smart" per Admin: apre/focalizza la tab admin dedicata. */
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

  /** Link "semplice" per Calendario / Settimanale: naviga nella tab
   *  corrente (no target, no smart focus). Usa React Router Link → SPA
   *  navigation senza reload, basename gestito automaticamente. */
  const simpleLink = (
    to: string, label: string, Icon: React.ElementType,
  ) => {
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

        {/* Navigazione — Calendario e Settimanale navigano nella tab corrente.
            Solo Admin apre/focalizza una tab dedicata (così resti sul
            calendario aperto in un'altra tab anche dopo aver lavorato in admin).
            Gli ospiti vedono SOLO Settimanale (l'unica pagina accessibile a loro). */}
        {user && (
          <div className="flex items-center gap-1 ml-1">
            {user.ruolo !== 'ospite' &&
              simpleLink('/calendario', 'Calendario', Calendar)}
            {simpleLink('/settimanale', 'Settimanale', CalendarDays)}
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
