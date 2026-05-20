import { useEffect, useState, useMemo } from 'react'
import { useLocation, useNavigate, useHref } from 'react-router-dom'
import { LogOut, Calendar, CalendarDays, Settings, Users, AlertTriangle, RefreshCw, Mail, Shield } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { usePendingActions } from '../contexts/PendingActionsContext'
import { useVersionCheck } from '../hooks/useVersionCheck'
import { useMessaggiRealtime } from '../hooks/useMessaggiRealtime'
import { useFerieRealtime } from '../hooks/useFerieRealtime'
import { useCambiTurnoRealtime } from '../hooks/useCambiTurnoRealtime'
import { MessaggiModal } from './MessaggiModal'
import { supabase } from '../lib/supabase'
import type { AuthUser, Medico, Messaggio } from '../types'

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

  // ── Casella messaggi (medici turnisti loggati) ───────────────────
  // Realtime su `messaggi` per aggiornare il badge e mostrare toast pop-up
  // su nuovi messaggi senza ricaricare la pagina. Anche su `ferie` e
  // `cambi_turno` cosi` il badge include anche le richieste pending
  // (es. quando il medico stesso le invia, devono apparire subito).
  useMessaggiRealtime()
  useFerieRealtime()
  useCambiTurnoRealtime()
  const qc = useQueryClient()
  // Quale modal della casella e` aperto: 'medico', 'admin', o nessuno.
  // Permette di tenere DUE bustine in NavBar per chi e` sia medico che
  // admin (es. l'admin principale che gestisce e ha anche turni propri),
  // ognuna apre il proprio modal con i propri filtri.
  const [showMessaggi, setShowMessaggi] = useState<'medico' | 'admin' | null>(null)
  const [toast, setToast] = useState<{ titolo: string; corpo: string | null; mode: 'medico' | 'admin' } | null>(null)

  // Safety net per il badge unread: rinfresca quando la tab torna in
  // primo piano. Safari mobile/iOS in particolare puo` chiudere la
  // WebSocket realtime quando la tab e` in background → al rientro
  // alcuni eventi potrebbero essere stati persi. Il visibilitychange
  // + focus garantiscono che il badge si riallinei al DB.
  useEffect(() => {
    function refresh() {
      qc.invalidateQueries({ queryKey: ['messaggi'] })
      qc.invalidateQueries({ queryKey: ['messaggi-unread-count'] })
    }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [qc])

  // Cerco il medico associato all'utente loggato (match per nome, come
  // gia` fa CalendarioPage.mioMedico). Solo gli account "medico" hanno un
  // record nella tabella `medici` e quindi una casella di posta.
  const { data: medici = [] } = useQuery<Medico[]>({
    queryKey: ['medici'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('medici').select('*').eq('attivo', true)
      if (error) throw error
      return data ?? []
    },
    enabled: !!user,
  })
  const mioMedico = useMemo(() => {
    const myName = (user?.nome ?? '').toUpperCase().trim()
    if (!myName) return undefined
    return medici.find(m => m.nome.toUpperCase().trim() === myName)
  }, [user?.nome, medici])

  // L'utente puo` essere medico, admin, o entrambi. Mostriamo una
  // bustina separata per ognuno dei ruoli applicabili (max 2 in totale).
  // Niente "prevalenza" admin sul medico: chi e` entrambi vede entrambe
  // le caselle con icone diverse (Mail per medico, Shield per admin).
  const showMedicoMail = !!mioMedico
  const showAdminMail  = user?.ruolo === 'admin'

  // Count "items da vedere" per la bustina MEDICO: messaggi non letti del
  // medico + sue ferie/cambi pending.
  const { data: unreadCountMedico = 0 } = useQuery({
    queryKey: ['messaggi-unread-count', 'medico', mioMedico?.id],
    queryFn: async () => {
      if (!mioMedico) return 0
      const [msgRes, ferieRes, cambiRes] = await Promise.all([
        supabase.from('messaggi').select('*', { count: 'exact', head: true })
          .eq('medico_id', mioMedico.id).eq('letto', false),
        supabase.from('ferie').select('*', { count: 'exact', head: true })
          .eq('medico_id', mioMedico.id).eq('approvate', false),
        supabase.from('cambi_turno').select('*', { count: 'exact', head: true })
          .eq('medico_richiedente_id', mioMedico.id).eq('stato', 'pending'),
      ])
      return (msgRes.count ?? 0) + (ferieRes.count ?? 0) + (cambiRes.count ?? 0)
    },
    enabled:                     showMedicoMail,
    staleTime:                   0,
    refetchOnMount:              'always',
    refetchOnWindowFocus:        true,
    refetchInterval:             30_000,
    refetchIntervalInBackground: false,
  })

  // Count per la bustina ADMIN: messaggi broadcast admin non letti +
  // tutte le ferie/cambi pending del sistema (cosi` il badge sale
  // appena qualcuno richiede qualcosa).
  const { data: unreadCountAdmin = 0 } = useQuery({
    queryKey: ['messaggi-unread-count', 'admin'],
    queryFn: async () => {
      const [msgRes, ferieRes, cambiRes] = await Promise.all([
        supabase.from('messaggi').select('*', { count: 'exact', head: true })
          .eq('destinatario_ruolo', 'admin').eq('letto', false),
        supabase.from('ferie').select('*', { count: 'exact', head: true })
          .eq('approvate', false),
        supabase.from('cambi_turno').select('*', { count: 'exact', head: true })
          .eq('stato', 'pending'),
      ])
      return (msgRes.count ?? 0) + (ferieRes.count ?? 0) + (cambiRes.count ?? 0)
    },
    enabled:                     showAdminMail,
    staleTime:                   0,
    refetchOnMount:              'always',
    refetchOnWindowFocus:        true,
    refetchInterval:             30_000,
    refetchIntervalInBackground: false,
  })

  // Toast pop-up su nuovi messaggi. Per utenti BOTH (medico+admin)
  // mostriamo il toast per entrambe le sorgenti, con indicazione del
  // modal da aprire al click. Se un messaggio "doppio" arrivasse
  // simultaneamente (es. un admin che e` anche medico riceve un
  // ferie_richiesta admin nel momento in cui un'altra azione genera un
  // messaggio medico), prevale il piu` recente (lo state e` singolo).
  useEffect(() => {
    function onNuovoMessaggio(e: Event) {
      const m = (e as CustomEvent<Messaggio>).detail
      const mineMedico = showMedicoMail && mioMedico && m.medico_id === mioMedico.id
      const mineAdmin  = showAdminMail  && m.destinatario_ruolo === 'admin'
      if (!mineMedico && !mineAdmin) return
      // Se e` entrambe le cose (improbabile ma possibile), prevale 'admin'
      // perche` di solito le azioni admin sono prioritarie da gestire.
      const mode: 'medico' | 'admin' = mineAdmin ? 'admin' : 'medico'
      setToast({ titolo: m.titolo, corpo: m.corpo, mode })
      const t = setTimeout(() => setToast(null), 5000)
      return () => clearTimeout(t)
    }
    window.addEventListener('messaggio-nuovo', onNuovoMessaggio)
    return () => window.removeEventListener('messaggio-nuovo', onNuovoMessaggio)
  }, [mioMedico, showMedicoMail, showAdminMail])

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
        className={`flex items-center gap-1.5 px-3 py-2.5 lg:py-1.5 rounded-lg text-sm font-medium transition-colors
          ${active ? '' : 'hover:text-white'}`}
        style={active
          ? { background: 'rgba(255,255,255,0.15)', color: '#fff' }
          : { color: '#9ab488' }}
      >
        <Icon size={16} />
        {/* Label nascosta sotto lg (1024px): mobile + tablet piccoli
            mostrano icona-only per stare comodi in landscape. */}
        <span className="hidden lg:inline">{label}</span>
      </a>
    )
  }

  /** Variante CalendarDays con piccola badge "A" che indica
   *  "Settimanale Alternativo". Usata come Icon per il link
   *  /settimanale-alt cosi` non si confonde con /settimanale. */
  function AltCalendarIcon({ size = 16 }: { size?: number }) {
    return (
      <span className="relative inline-flex items-center">
        <CalendarDays size={size} />
        <span className="absolute -top-1.5 -right-1.5 leading-none px-0.5 py-px rounded-sm font-bold"
          style={{
            background: '#fbbf24', color: '#1c2818',
            fontSize: 7, lineHeight: 1,
          }}>A</span>
      </span>
    )
  }

  return (
    <nav className="text-white shadow-md print:hidden"
      style={{ background: '#2b3c24' }}>
      <div className="max-w-screen-xl mx-auto px-4 flex items-center gap-3 h-12">

        {/* Logo + nome app — sempre visibili */}
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
            {smartLink('/settimanale-alt',  hrefSettimanaleAlt, TAB_TURNI, 'Settimanale Alt', AltCalendarIcon)}
            {user.ruolo === 'admin' &&
              smartLink('/admin',           hrefAdmin,          TAB_ADMIN, 'Admin',           Settings)}
          </div>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Utente + casella messaggi + logout + versione */}
        {user && (
          <div className="flex items-center gap-3">
            <span className="hidden lg:flex items-center gap-1.5 text-xs"
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
            {/* Bustina MEDICO (icona Mail): messaggi del medico turnista
                + sue richieste pending. Visibile se l'utente ha un record
                in `medici`. */}
            {showMedicoMail && (
              <button
                onClick={() => setShowMessaggi('medico')}
                className="relative flex items-center px-2 py-2 lg:py-1 rounded-lg transition-colors"
                style={{ color: unreadCountMedico > 0 ? '#fbbf24' : '#9ab488' }}
                onMouseEnter={e => (e.currentTarget.style.color = '#fff')}
                onMouseLeave={e => (e.currentTarget.style.color = unreadCountMedico > 0 ? '#fbbf24' : '#9ab488')}
                title={unreadCountMedico > 0
                  ? `Casella personale — ${unreadCountMedico} messagg${unreadCountMedico === 1 ? 'io' : 'i'} non lett${unreadCountMedico === 1 ? 'o' : 'i'}`
                  : 'Casella messaggi personale'}>
                <Mail size={18} />
                {unreadCountMedico > 0 && (
                  <span
                    className="absolute top-0 right-0 min-w-[16px] h-[16px] px-1 rounded-full text-[9px] font-bold flex items-center justify-center animate-pulse"
                    style={{ background: '#d97706', color: '#fff' }}>
                    {unreadCountMedico > 99 ? '99+' : unreadCountMedico}
                  </span>
                )}
              </button>
            )}
            {/* Bustina ADMIN (icona Shield): notifiche broadcast admin +
                richieste pending del sistema. Visibile se ruolo='admin'.
                Icona scudo per distinguerla chiaramente dalla busta
                personale, anche per chi e` sia admin che medico. */}
            {showAdminMail && (
              <button
                onClick={() => setShowMessaggi('admin')}
                className="relative flex items-center px-2 py-2 lg:py-1 rounded-lg transition-colors"
                style={{ color: unreadCountAdmin > 0 ? '#fbbf24' : '#9ab488' }}
                onMouseEnter={e => (e.currentTarget.style.color = '#fff')}
                onMouseLeave={e => (e.currentTarget.style.color = unreadCountAdmin > 0 ? '#fbbf24' : '#9ab488')}
                title={unreadCountAdmin > 0
                  ? `Notifiche admin — ${unreadCountAdmin} da gestire`
                  : 'Notifiche admin'}>
                <Shield size={18} />
                {unreadCountAdmin > 0 && (
                  <span
                    className="absolute top-0 right-0 min-w-[16px] h-[16px] px-1 rounded-full text-[9px] font-bold flex items-center justify-center animate-pulse"
                    style={{ background: '#d97706', color: '#fff' }}>
                    {unreadCountAdmin > 99 ? '99+' : unreadCountAdmin}
                  </span>
                )}
              </button>
            )}
            <button
              onClick={onSignOut}
              className="flex items-center gap-1 px-2 py-2 lg:py-1 rounded-lg text-xs transition-colors"
              style={{ color: '#9ab488' }}
              onMouseEnter={e => (e.currentTarget.style.color = '#fff')}
              onMouseLeave={e => (e.currentTarget.style.color = '#9ab488')}
              title="Esci"
            >
              <LogOut size={18} />
              <span className="hidden lg:inline">Esci</span>
            </button>
          </div>
        )}

        {/* Modal casella messaggi — uno alla volta in base allo state */}
        {showMessaggi === 'medico' && mioMedico && (
          <MessaggiModal
            mode="medico"
            medico={mioMedico}
            onClose={() => setShowMessaggi(null)}
          />
        )}
        {showMessaggi === 'admin' && (
          <MessaggiModal
            mode="admin"
            onClose={() => setShowMessaggi(null)}
          />
        )}

        {/* Toast pop-up al nuovo messaggio (realtime). Cliccabile per
            aprire la casella di posta del mode corretto (medico/admin). */}
        {toast && (
          <button
            onClick={() => { setShowMessaggi(toast.mode); setToast(null) }}
            className="fixed bottom-4 right-4 z-[60] flex items-start gap-3 px-4 py-3 rounded-xl shadow-2xl text-left max-w-sm animate-in fade-in slide-in-from-bottom"
            style={{ background: '#fffbeb', border: '2px solid #fbbf24' }}>
            {toast.mode === 'admin'
              ? <Shield size={20} style={{ color: '#d97706' }} className="mt-0.5 shrink-0" />
              : <Mail   size={20} style={{ color: '#d97706' }} className="mt-0.5 shrink-0" />}
            <div className="flex-1 min-w-0">
              <div className="text-xs font-bold uppercase tracking-wider mb-0.5"
                style={{ color: '#92400e' }}>
                {toast.mode === 'admin' ? 'Nuova notifica admin' : 'Nuovo messaggio'}
              </div>
              <div className="text-sm font-semibold text-stone-800 truncate">
                {toast.titolo}
              </div>
              {toast.corpo && (
                <div className="text-xs text-stone-600 mt-0.5 line-clamp-2">
                  {toast.corpo}
                </div>
              )}
              <div className="text-[10px] text-stone-500 mt-1">
                Clicca per aprire la casella
              </div>
            </div>
          </button>
        )}

        {/* Versione build — dopo il pulsante Esci */}
        <span className="hidden lg:block text-[10px] font-mono shrink-0"
          style={{ color: '#c0d0b0' }}
          title={`Commit ${__APP_VERSION__} — build del ${__BUILD_DATE__}`}>
          v{__APP_VERSION__} · {__BUILD_DATE__}
        </span>
      </div>
    </nav>
  )
}
