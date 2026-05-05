import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NavBar }            from './components/NavBar'
import { ProtectedRoute }    from './components/ProtectedRoute'
import { LoginPage }         from './pages/LoginPage'
import { AuthCallbackPage }  from './pages/AuthCallbackPage'
import { CalendarioPage }    from './pages/CalendarioPage'
import { AdminLayout }       from './pages/admin/AdminLayout'
import { GeneraCalendarioPage } from './pages/admin/GeneraCalendarioPage'
import { GestioneMediciPage }   from './pages/admin/GestioneMediciPage'
import { GestioneFeriePage }    from './pages/admin/GestioneFeriePage'
import { GestioneUtentiPage }   from './pages/admin/GestioneUtentiPage'
import { ConfigPage }           from './pages/admin/ConfigPage'
import { useAuth }           from './hooks/useAuth'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
})

// Componente interno per accedere al routing
function AppRoutes() {
  const { user, loading, signInWithGoogle, signOut } = useAuth()
  const navigate = useNavigate()

  // Ripristina il path salvato da 404.html (GitHub Pages trick)
  useEffect(() => {
    const redirect = sessionStorage.getItem('redirect')
    if (redirect) {
      sessionStorage.removeItem('redirect')
      navigate(redirect, { replace: true })
    }
  }, [navigate])

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

        {/* Calendario (richiede login) */}
        <Route
          path="/calendario"
          element={
            <ProtectedRoute user={user} loading={loading}>
              <CalendarioPage />
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
          {/* turni: placeholder, sviluppato nella prossima iterazione */}
          <Route path="turni"   element={
            <div className="text-gray-500 text-sm">
              Modifica turni – in sviluppo nella prossima versione.
            </div>
          } />
        </Route>

        {/* Root → redirect */}
        <Route
          path="/"
          element={
            loading
              ? null
              : user
                ? <Navigate to="/calendario" replace />
                : <Navigate to="/login" replace />
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
      <BrowserRouter basename="/sistema-turnazione">
        <AppRoutes />
      </BrowserRouter>
    </QueryClientProvider>
  )
}
