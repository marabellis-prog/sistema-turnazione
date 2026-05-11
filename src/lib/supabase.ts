import { createClient } from '@supabase/supabase-js'

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
export const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    '[Supabase] Variabili d\'ambiente mancanti. ' +
    'Copia .env.example in .env e inserisci le credenziali Supabase.'
  )
}

export const supabase = createClient(
  supabaseUrl  || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder',
  {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      // Implicit flow: il token arriva nell'URL hash (#access_token=...)
      // direttamente dal redirect Google, niente "code → token exchange"
      // intermedio. Vantaggi: NON richiede di preservare un code_verifier
      // in localStorage fra signIn e callback (il PKCE crollava su mobile
      // con "Invalid flow state, no valid flow state found"). Supabase
      // legge il token via detectSessionInUrl al mount del client.
      // Trade-off di sicurezza minore: il token transita nell'URL fragment
      // (mai inviato al server), accettabile per una SPA con backend RLS.
      detectSessionInUrl: true,
      flowType: 'implicit',
    },
  }
)
