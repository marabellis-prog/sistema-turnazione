import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NavBar }            from './components/NavBar'
import { ProtectedRoute }    from './components/ProtectedRoute'
import { LoginPage }         from './pages/LoginPage'
import { AuthCallbackPage }  from './pages/AuthCallbackPage'
import { CalendarioPage }     from './pages/CalendarioPage'
import { SettimanalePage }    from './pages/SettimanalePage'
import { SettimanaleAltPage } from './pages/SettimanaleAltPage'
import { AdminLayout }       from './pages/admin/AdminLayout'
import { GeneraCalendarioPage } from './pages/admin/GeneraCalendarioPage'
import { GestioneMediciPage }   from './pages/admin/GestioneMediciPage'
import { GestioneFeriePage }    from './pages/admin/GestioneFeriePage'
import { ModificaTurniPage }   from './pages/admin/ModificaTurniPage'
import { GestioneUtentiPage }   from './pages/admin/GestioneUtentiPage'
import { ConfigPage }           from './pages/admin/ConfigPage'
import { GestioneSchemaPage }   from './pages/admin/GestioneSchemaPage'
import { useAuth }                from './hooks/useAuth'
import { PendingActionsProvider } from './contexts/PendingActionsContext'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime:    5 * 60_000,   // dati validi per 5 min → no refetch inutili
      gcTime:      10 * 60_000,   // cache in memoria per 10 min
      refetchOnWindowFocus: false, // non ricaricare quando si torna sulla tab
    },
  },
})

// Componente interno per accedere al routing
function AppRoutes() {
  const { user, loading, signInWithGoogle, signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  // Ripristina il path salvato da 404.html (GitHub Pages trick)
  useEffect(() => {
    const redirect = sessionStorage.getItem('redirect')
    if (redirect) {
      sessionStorage.removeItem('redirect')
      navigate(redirect, { replace: true })
    }
  }, [navigate])

  // Titolo della scheda + favicon dinamici in base alla rotta.
  // - /admin/* → "Admin · Sistema Turnazione" + favicon-admin.svg
  // - resto    → "Sistema Turnazione" + favicon.svg
  // Cosi` a colpo d'occhio distingui la tab admin dalla tab turni anche
  // quando il browser mostra molte schede in barra.
  useEffect(() => {
    const isAdmin = location.pathname.startsWith('/admin')
    document.title = isAdmin
      ? 'Admin · Sistema Turnazione'
      : 'Sistema Turnazione'
    const link = document.querySelector("link[rel='icon']") as HTMLLinkElement | null
    if (link) {
      const target = isAdmin
        ? '/sistema-turnazione/favicon-admin.svg'
        : '/sistema-turnazione/favicon.svg'
      if (link.getAttribute('href') !== target) {
        link.setAttribute('href', target)
      }
    }
  }, [location.pathname])

  return (
    <div className="min-h-screen flex flex-col">
      {/* NavBar solo se loggati */}
      {user && <NavBar user={user} onSignOut={signOut} />}

      <Routes>
        {/* Pagina di login */}
        <Route
          path="/login"
          element={<LoginPage user={user} onSignIn={signInWithGoogle} />}
        />

        {/* Callback OAuth */}
        <Route path="/auth/callback" element={<AuthCallbackPage />} />

        {/* Calendario (richiede login).
            NIENTE loadingComponent: ProtectedRoute usa lo spinner default
            durante il check auth (è breve). Il CalendarLoadingScreen
            pesante con i contatori lo gestisce CalendarioPage internamente
            durante il caricamento dei dati. Così su mobile l'utente vede
            uno spinnerino veloce + box "Verifica…" invece del rendering
            pesante che confonde quando l'auth fallisce. */}
        <Route
          path="/calendario"
          element={
            <ProtectedRoute user={user} loading={loading}>
              <CalendarioPage />
            </ProtectedRoute>
          }
        />

        {/* Vista settimanale — accessibile a tutti i loggati (anche ospiti) */}
        <Route
          path="/settimanale"
          element={
            <ProtectedRoute user={user} loading={loading}
              allowedRoles={['admin', 'user', 'ospite']}>
              <SettimanalePage />
            </ProtectedRoute>
          }
        />

        {/* Vista settimanale alternativa — colonne per orario (Mattina /
            Pomeriggio / RM / RP / Reperibile). Accessibile a tutti come
            la classica /settimanale. */}
        <Route
          path="/settimanale-alt"
          element={
            <ProtectedRoute user={user} loading={loading}
              allowedRoles={['admin', 'user', 'ospite']}>
              <SettimanaleAltPage />
            </ProtectedRoute>
          }
        />

        {/* Admin (richiede login + admin) */}
        <Route
          path="/admin"
          element={
            <ProtectedRoute user={user} loading={loading} requireAdmin>
              <AdminLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="/admin/genera" replace />} />
          <Route path="genera"  element={<GeneraCalendarioPage />} />
          <Route path="medici"  element={<GestioneMediciPage />} />
          <Route path="ferie"   element={<GestioneFeriePage />} />
          <Route path="utenti"  element={<GestioneUtentiPage />} />
          <Route path="config"  element={<ConfigPage />} />
          <Route path="schema"  element={<GestioneSchemaPage />} />
          <Route path="turni"   element={<ModificaTurniPage />} />
        </Route>

        {/* Root → redirect (spinner durante loading, mai pagina bianca).
            Anche il post-OAuth atterra qui via AuthCallbackPage pass-through.
            useAuth gestisce setupAuth con getSession() + check whitelist.
            Box centrato con sfondo coerente al login così la transizione
            visiva non è "rotta".
            Ospiti → /settimanale (unica pagina visibile), gli altri → /calendario. */}
        <Route
          path="/"
          element={
            loading
              ? (
                <div className="min-h-screen flex items-center justify-center p-4"
                  style={{ background: 'linear-gradient(135deg, #1c2818 0%, #456b3a 50%, #577a45 100%)' }}>
                  <div className="rounded-2xl shadow-2xl p-8 w-full max-w-sm text-center"
                    style={{ background: '#faf8f3' }}>
                    <div className="animate-spin rounded-full h-10 w-10 border-b-2 mx-auto mb-4"
                      style={{ borderColor: '#476540' }} />
                    <p className="text-sm font-semibold" style={{ color: '#2b3c24' }}>
                      Verifica accesso…
                    </p>
                    <p className="text-xs mt-2" style={{ color: '#7a7a6a' }}>
                      Attendi qualche istante
                    </p>
                  </div>
                </div>
              )
              : !user
                ? <Navigate to="/login" replace />
                : user.ruolo === 'ospite'
                  ? <Navigate to="/settimanale" replace />
                  : <Navigate to="/calendario" replace />
          }
        />

        {/* 404 */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <PendingActionsProvider>
        <BrowserRouter basename="/sistema-turnazione">
          <AppRoutes />
        </BrowserRouter>
      </PendingActionsProvider>
    </QueryClientProvider>
  )
}
