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
      // detectSessionInUrl = false: lo scambio code → session lo facciamo
      // manualmente in AuthCallbackPage via exchangeCodeForSession(). In
      // automatico c'erano race condition su mobile/Safari che causavano
      // timeout silenziosi (code consumato dal client prima che il code
      // verifier fosse pronto in localStorage). Manuale → errori espliciti.
      detectSessionInUrl: false,
      flowType: 'pkce',
    },
  }
)
