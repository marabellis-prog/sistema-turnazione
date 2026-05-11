import { createClient } from '@supabase/supabase-js'

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
export const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    '[Supabase] Variabili d\'ambiente mancanti. ' +
    'Copia .env.example in .env e inserisci le credenziali Supabase.'
  )
}

/**
 * Storage adapter "robusto" per Supabase auth.
 *
 * Problema risolto: il flow PKCE di OAuth (necessario perché Google ha
 * deprecato l'implicit) richiede che il code_verifier scritto al signIn
 * sia leggibile al callback. Su Chrome Android (in particolare in
 * incognito) e Safari iOS in alcuni casi, localStorage viene "perso"
 * tra il redirect a Google e il ritorno → "Invalid flow state".
 *
 * Strategia: write-through su 3 storage paralleli + read-through come
 * cascata. Il cookie è il più affidabile perché sopravvive ai redirect
 * cross-site (con SameSite=Lax), localStorage è il primary, sessionStorage
 * il backup veloce.
 *
 * Il code_verifier è valido solo per pochi secondi (durata del round-trip
 * OAuth), e il cookie max-age=600 (10 min) è ampio. Path=/ così il
 * cookie è disponibile sia su /login sia su /auth/callback.
 */
const robustStorage = {
  getItem(key: string): string | null {
    try {
      const fromLS = localStorage.getItem(key)
      if (fromLS != null) return fromLS
    } catch {}
    try {
      const fromSS = sessionStorage.getItem(key)
      if (fromSS != null) return fromSS
    } catch {}
    try {
      const re = new RegExp(`(?:^|; )${encodeURIComponent(key).replace(/[-.*+?^${}()|[\]\\]/g, '\\$&')}=([^;]*)`)
      const m = document.cookie.match(re)
      if (m) return decodeURIComponent(m[1])
    } catch {}
    return null
  },
  setItem(key: string, value: string): void {
    try { localStorage.setItem(key, value) } catch {}
    try { sessionStorage.setItem(key, value) } catch {}
    try {
      const isHttps = location.protocol === 'https:'
      document.cookie = `${encodeURIComponent(key)}=${encodeURIComponent(value)}; path=/; max-age=600; SameSite=Lax${isHttps ? '; Secure' : ''}`
    } catch {}
  },
  removeItem(key: string): void {
    try { localStorage.removeItem(key) } catch {}
    try { sessionStorage.removeItem(key) } catch {}
    try {
      document.cookie = `${encodeURIComponent(key)}=; path=/; max-age=0; SameSite=Lax`
    } catch {}
  },
}

export const supabase = createClient(
  supabaseUrl  || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder',
  {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      // PKCE flow + storage robusto = sicuro come PKCE deve essere,
      // ma con sopravvivenza del code_verifier garantita anche su mobile.
      detectSessionInUrl: true,
      flowType: 'pkce',
      storage: robustStorage,
    },
  }
)
