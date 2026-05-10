import { useEffect, useState } from 'react'
import { supabase, supabaseUrl, supabaseAnonKey } from '../lib/supabase'
import type { AuthUser } from '../types'

const CACHE_KEY     = 'auth_user_profile'
const UNAUTH_KEY    = 'auth_unauthorized_email'
const TIMEOUT_MS    = 10_000  // fetch diretto è veloce (~500ms), 10s basta abbondantemente

// ── Cache sessionStorage ──────────────────────────────────────────
function getCached(): AuthUser | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY)
    return raw ? (JSON.parse(raw) as AuthUser) : null
  } catch { return null }
}
function setCached(u: AuthUser) {
  try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(u)) } catch {}
}
function clearCached() {
  try { sessionStorage.removeItem(CACHE_KEY) } catch {}
}

// ─────────────────────────────────────────────────────────────────

export function useAuth() {
  const [user, setUser]       = useState<AuthUser | null>(() => getCached())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {

        // ── SIGNED_OUT: unico evento che causa logout reale ──────
        if (event === 'SIGNED_OUT') {
          clearCached()
          setUser(null)
          setLoading(false)
          return
        }

        // ── INITIAL_SESSION: fired una volta sola all'avvio ─────
        if (event === 'INITIAL_SESSION') {
          if (session?.user?.email) {
            const cached = getCached()
            if (cached && cached.email.toLowerCase() === session.user.email.toLowerCase()) {
              // Profilo già in cache → nessuna chiamata al DB
              setUser(cached)
              setLoading(false)
            } else {
              await loadUser(session.user.email)
            }
          } else {
            // Nessuna sessione all'avvio (utente non loggato)
            clearCached()
            setUser(null)
            setLoading(false)
          }
          return
        }

        // ── SIGNED_IN: dopo OAuth callback ──────────────────────
        if (event === 'SIGNED_IN' && session?.user?.email) {
          const cached = getCached()
          if (cached && cached.email.toLowerCase() === session.user.email.toLowerCase()) {
            setUser(cached)
            setLoading(false)
          } else {
            await loadUser(session.user.email)
          }
          return
        }

        // ── TOKEN_REFRESHED / USER_UPDATED / altri: ignora ──────
        // NON cambiare lo stato — l'utente è già loggato
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  /** Helper: scrive l'email "non autorizzata" in sessionStorage così
   *  LoginPage può mostrare il banner diagnostico invece di un silenzioso
   *  ritorno a /login. Il `reason` viene loggato in console per debugging. */
  function flagUnauthorized(email: string, reason: string) {
    console.warn(`[Auth] Non autorizzato (${reason}):`, email.toLowerCase())
    try {
      sessionStorage.setItem(UNAUTH_KEY, email.toLowerCase())
    } catch {}
  }

  async function loadUser(email: string) {
    // ⚠️ Bypass completo del client supabase-js per la lettura del profilo:
    //   - supabase.rpc('get_my_profile') va in timeout durante l'auth-state
    //     handler (lock interno del client su INITIAL_SESSION / SIGNED_IN)
    //   - supabase.auth.getSession() rispetta lo stesso lock → anche quello
    //     è in stallo
    // Soluzione: leggiamo il JWT direttamente da localStorage (la chiave
    // `sb-<project_ref>-auth-token` è popolata da supabase-js prima ancora
    // di fire l'evento auth) e facciamo fetch al REST endpoint. Risposta
    // ~500ms invece di >15s.
    const queryPromise = (async () => {
      // Project ref deriva dall'URL Supabase (es. https://abc.supabase.co → abc)
      const refMatch = supabaseUrl.match(/https?:\/\/([a-z0-9]+)\.supabase\.co/i)
      const projectRef = refMatch?.[1]
      if (!projectRef) return { data: null, error: new Error('no_project_ref') as Error }
      const raw = localStorage.getItem(`sb-${projectRef}-auth-token`)
      if (!raw) return { data: null, error: new Error('no_session_in_storage') as Error }
      let token: string | undefined
      try {
        const parsed = JSON.parse(raw) as { access_token?: string }
        token = parsed.access_token
      } catch {
        return { data: null, error: new Error('storage_parse_error') as Error }
      }
      if (!token) return { data: null, error: new Error('no_access_token') as Error }

      const res = await fetch(`${supabaseUrl}/rest/v1/rpc/get_my_profile`, {
        method: 'POST',
        headers: {
          'apikey':         supabaseAnonKey,
          'Authorization':  `Bearer ${token}`,
          'Content-Type':   'application/json',
        },
        body: '{}',
      })
      if (!res.ok) {
        const txt = await res.text().catch(() => '')
        return { data: null, error: new Error(`HTTP ${res.status} ${txt.slice(0, 80)}`) as Error }
      }
      const json = await res.json().catch(() => null) as unknown
      return { data: json, error: null as Error | null }
    })()

    const timeoutPromise = new Promise<{ data: null; error: Error }>(resolve =>
      setTimeout(() => resolve({ data: null, error: new Error('timeout') }), TIMEOUT_MS)
    )

    try {
      const result = await Promise.race([queryPromise, timeoutPromise])
      const { data, error } = result

      if (error) {
        // RPC failure (timeout / 5xx / RLS): non sappiamo se l'utente è
        // autorizzato o no. Flagga comunque l'email così l'utente vede
        // un banner spiegativo invece di un kick-out muto.
        console.error('[Auth] Errore get_my_profile:', error.message)
        flagUnauthorized(email, `errore RPC: ${error.message}`)
        await supabase.auth.signOut()
        setUser(null)
        return
      }

      const profile = Array.isArray(data) ? data[0] : data

      if (!profile) {
        // Email Google non in whitelist (caso più comune).
        flagUnauthorized(email, 'email non in elenco utenti autorizzati')
        await supabase.auth.signOut()
        setUser(null)
      } else {
        const authUser: AuthUser = {
          id:    profile.id,
          email: profile.email,
          ruolo: profile.ruolo as 'admin' | 'user' | 'ospite',
          nome:  profile.nome ?? null,
        }
        setCached(authUser)
        setUser(authUser)
      }
    } catch (e) {
      // Eccezione imprevista (es. parsing JSON, rete persa, ecc.).
      // Stesso pattern: flagga e signOut, così la UI può spiegare.
      console.error('[Auth] Errore imprevisto:', e)
      flagUnauthorized(email, `eccezione: ${(e as Error).message ?? 'sconosciuta'}`)
      try { await supabase.auth.signOut() } catch {}
      setUser(null)
    } finally {
      setLoading(false)
    }
  }

  async function signInWithGoogle() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/sistema-turnazione/auth/callback`,
        queryParams: { prompt: 'select_account' },
      },
    })
    if (error) console.error('[Auth] Errore login Google:', error)
  }

  async function signOut() {
    clearCached()
    await supabase.auth.signOut()
    setUser(null)
  }

  return { user, loading, signInWithGoogle, signOut }
}
