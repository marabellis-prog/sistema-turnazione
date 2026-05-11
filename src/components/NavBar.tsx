import { useEffect } from 'react'
import { useLocation, useNavigate, useHref } from 'react-router-dom'
import { LogOut, Calendar, CalendarDays, Settings, Users, AlertTriangle, RefreshCw } from 'lucide-react'
import { usePendingActions } from '../contexts/PendingActionsContext'
import { useVersionCheck } from '../hooks/useVersionCheck'
import type { AuthUser } from '../types'

interface Props {
  user: AuthUser | null
  onSignOut: () => void
}

// Due tab nominate:
//  - TAB_TURNI: Calendario, Settimanale, Settimanale Alt (la "tab dei turni").
//    Tutti i 3 link condividono la stessa tab: cliccare uno qualsiasi da
//    un'altra tab focalizza questa, cliccare uno qualsiasi mentre siamo
//    già qui naviga in-tab via SPA routing.
//  - TAB_ADMIN: tutte le pagine /admin/*.
//
// Risultato: al massimo due finestre aperte (turni + admin).
const TAB_TURNI = 'sistema-turni-calendario'
const TAB_ADMIN = 'sistema-turni-admin'

/** Quale tab "nominata" rappresenta una path. null = nessuna (es. /login). */
function tabForPath(pathname: string): string | null {
  if (pathname.startsWith('/admin'))                  return TAB_ADMIN
  if (pathname.startsWith('/calendario'))             return TAB_TURNI
  if (pathname.startsWith('/settimanale-alt'))        return TAB_TURNI
  if (pathname.startsWith('/settimanale'))            return TAB_TURNI
  return null
}

export function NavBar({ user, onSignOut }: Props) {
  const loc      = useLocation()
  const navigate = useNavigate()
  const { needsRegen, needsRefresh } = usePendingActions()
  const { updateAvailable, applyUpdate } = useVersionCheck()
  // useHref → applica il basename "/sistema-turnazione" automaticamente.
  const hrefCalendario     = useHref('/calendario')
  const hrefSettimanale    = useHref('/settimanale')
  const hrefSettimanaleAlt = useHref('/settimanale-alt')
  const hrefAdmin          = useHref('/admin')

  // Auto-rinomina la tab corrente in base alla "famiglia" di pagine.
  // - Su /admin/*       → window.name = TAB_ADMIN
  // - Su /calendario, /settimanale, /settimanale-alt → window.name = TAB_TURNI
  // - Altrove (es. /login) → reset se era una delle due nominate.
  // Cosi` quando un'altra tab fa window.open('', TAB_XXX) trova questa
  // tab e ci salta sopra invece di duplicarla.
  useEffect(() => {
    const target = tabForPath(loc.pathname)
    if (target) {
      window.name = target
    } else if (window.name === TAB_ADMIN || window.name === TAB_TURNI) {
      window.name = ''
    }
  }, [loc.pathname])

  /**
   * Click handler "smart" — gestisce la navigazione fra tab nominate.
   *  - Stessa pagina destinazione → no-op (non ricarica).
   *  - Stessa tab (window.name === tabName) → naviga in-tab via SPA routing.
   *    Niente full reload, niente flash. Esempio: sono su /calendario e
   *    clicco Settimanale → la stessa tab cambia rotta a /settimanale.
   *  - Tab diversa nominata che ESISTE → focus + naviga il suo URL.
   *  - Tab diversa che NON ESISTE → apre una nuova tab col path.
   *  - Popup bloccati → fallback navigation in stessa tab (full reload).
   */
  function handleSmartNav(
    e: React.MouseEvent,
    to: string,
    href: string,
    tabName: string,
    isActive: boolean,
  ) {
    if (isActive) { e.preventDefault(); return }
    e.preventDefault()

    // Se siamo già nella tab giusta (es. clicco Settimanale da Calendario,
    // entrambi nella tab TAB_TURNI), facciamo SPA navigation: niente reload,
    // tutto fluido.
    if (window.name === tabName) {
      navigate(to)
      return
    }

    // Altrimenti cerco una tab nominata esistente con quel nome.
    const existing = window.open('', tabName)
    if (!existing) {
      // Popup bloccati → fallback in-tab con reload completo
      window.location.href = href
      return
    }
    // Edge case: window.open('', tabName) può restituire la nostra stessa
    // tab se il window.name corrente combacia (raro, dopo refresh).
    if (existing === window) {
      navigate(to)
      return
    }

    // Tab "blank" (appena aperta) → naviga al path desiderato.
    // Tab già esistente con contenuto → forza la navigazione anche lì
    // (così l'utente che era su /calendario nella tab turni e clicca
    // Settimanale da admin, atterra direttamente su /settimanale).
    let isBlank = true
    try {
      const cur = existing.location.href
      isBlank = !cur || cur === 'about:blank'
    } catch (_) {
      isBlank = false  // cross-origin guard (non capita qui)
    }
    if (isBlank) {
      existing.location.href = href
    } else {
      // Tab già esistente: naviga a `href` solo se l'URL corrente non
      // combacia già con `to`. Confronto sul pathname per essere robusto
      // anche se href ha query string o trailing slash diversi.
      try {
        if (!existing.location.pathname.endsWith(to)) {
          existing.location.href = href
        }
      } catch {}
    }
    existing.focus()
  }

  /** Genera un link "smart" che usa una tab nominata. */
  const smartLink = (
    to: string, href: string, tabName: string,
    label: string, Icon: React.ElementType,
  ) => {
    // Match esatto OPPURE sub-path (con slash di confine), così:
    //  - to=/settimanale     matcha /settimanale ma NON /settimanale-alt
    //  - to=/admin           matcha /admin, /admin/turni, /admin/medici, ...
    // Senza questo, `.startsWith('/settimanale')` matchava sia /settimanale
    // che /settimanale-alt → "Settimanale" sempre active anche su Alt e
    // non cliccabile (handleSmartNav blocca i click su link active).
    const active = loc.pathname === to || loc.pathname.startsWith(to + '/')
    return (
      <a
        href={href}
        target={tabName}
        onClick={e => handleSmartNav(e, to, href, tabName, active)}
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
            onClick={e => handleSmartNav(e, '/admin/genera', hrefAdmin + '/genera', TAB_ADMIN,
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
            onClick={e => handleSmartNav(e, '/admin/genera', hrefAdmin + '/genera', TAB_ADMIN,
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

        {/* Navigazione — Calendario / Settimanale / Settimanale Alt
            CONDIVIDONO la tab TAB_TURNI: cliccare uno qualsiasi da admin
            la apre/focalizza, cliccare uno qualsiasi quando siamo già qui
            fa SPA navigation in-tab. Admin ha la sua tab dedicata. */}
        {user && (
          <div className="flex items-center gap-1 ml-1">
            {user.ruolo !== 'ospite' &&
              smartLink('/calendario',      hrefCalendario,     TAB_TURNI, 'Calendario',      Calendar)}
            {smartLink('/settimanale',      hrefSettimanale,    TAB_TURNI, 'Settimanale',     CalendarDays)}
            {smartLink('/settimanale-alt',  hrefSettimanaleAlt, TAB_TURNI, 'Settimanale Alt', CalendarDays)}
            {user.ruolo === 'admin' &&
              smartLink('/admin',           hrefAdmin,          TAB_ADMIN, 'Admin',           Settings)}
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
