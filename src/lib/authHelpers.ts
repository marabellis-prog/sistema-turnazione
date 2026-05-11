/**
 * authHelpers — utility condivise tra useAuth e AuthCallbackPage.
 *
 * Tutta la logica di "controllo profilo autorizzato" è centralizzata qui
 * così entrambi i punti d'ingresso (login fresco via OAuth callback, reload
 * pagina con sessione esistente) usano lo stesso codice senza duplicazione.
 *
 * Niente JSX / niente hook — solo funzioni pure.
 */

import { supabase, supabaseUrl, supabaseAnonKey } from './supabase'
import type { AuthUser } from '../types'

export const CACHE_KEY  = 'auth_user_profile'
export const UNAUTH_KEY = 'auth_unauthorized_email'

// ── Cache profilo (sessionStorage) ──────────────────────────────────
export function getCachedProfile(): AuthUser | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY)
    return raw ? (JSON.parse(raw) as AuthUser) : null
  } catch { return null }
}
export function setCachedProfile(u: AuthUser) {
  try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(u)) } catch {}
}
export function clearCachedProfile() {
  try { sessionStorage.removeItem(CACHE_KEY) } catch {}
}

// ── Flag "accesso negato" per LoginPage ─────────────────────────────
// LoginPage legge questa chiave e mostra il banner persistente con motivo.
export function flagUnauthorized(email: string, reason: string) {
  console.warn(`[Auth] Non autorizzato (${reason}):`, email.toLowerCase())
  try {
    sessionStorage.setItem(
      UNAUTH_KEY,
      JSON.stringify({ email: email.toLowerCase(), reason }),
    )
  } catch {}
}

// ── Logout "detached" (no await dentro auth event handler) ──────────
// Rimuove SUBITO la chiave localStorage della sessione + chiama signOut
// in background via setTimeout(0) per non bloccare il caller. Evita il
// deadlock auth-state che vedevamo con `await supabase.auth.signOut()`
// dentro un onAuthStateChange handler.
export function detachedSignOut() {
  try {
    const refMatch = supabaseUrl.match(/https?:\/\/([a-z0-9]+)\.supabase\.co/i)
    const projectRef = refMatch?.[1]
    if (projectRef) localStorage.removeItem(`sb-${projectRef}-auth-token`)
  } catch {}
  setTimeout(() => {
    supabase.auth.signOut().catch(err => {
      console.error('[Auth] signOut background error:', err)
    })
  }, 0)
}

// ── Fetch RPC get_my_profile (direct REST, bypass supabase-js lock) ─
// Ritorna:
//  - AuthUser   → profilo trovato (utente autorizzato)
//  - null       → profilo vuoto (email non in whitelist)
//  - { error }  → fallimento di rete / HTTP / parsing
export type FetchProfileResult =
  | AuthUser
  | null
  | { error: string }

export async function fetchProfile(accessToken: string): Promise<FetchProfileResult> {
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/get_my_profile`, {
      method: 'POST',
      headers: {
        'apikey':         supabaseAnonKey,
        'Authorization':  `Bearer ${accessToken}`,
        'Content-Type':   'application/json',
      },
      body: '{}',
    })
    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      return { error: `HTTP ${res.status} ${txt.slice(0, 80)}` }
    }
    const data = await res.json().catch(() => null) as unknown
    const profile = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : (data as Record<string, unknown> | null)
    if (!profile || typeof profile.id !== 'string') return null
    return {
      id:    profile.id as string,
      email: profile.email as string,
      ruolo: profile.ruolo as AuthUser['ruolo'],
      nome:  (profile.nome as string | null | undefined) ?? null,
    }
  } catch (e) {
    return { error: `eccezione: ${(e as Error).message ?? 'sconosciuta'}` }
  }
}
