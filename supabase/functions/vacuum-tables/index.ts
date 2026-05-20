/**
 * Edge Function: vacuum-tables
 *
 * Esegue VACUUM FULL sulle tabelle principali del database per liberare
 * spazio occupato da "dead tuples" (righe DELETE che PostgreSQL ha
 * marcato morte ma non rimosso fisicamente dal file).
 *
 * Workflow:
 *   1. Verifica che il chiamante sia un admin autenticato (utenti_autorizzati)
 *   2. Chiama la Supabase Management API col PAT (segreto) per eseguire
 *      VACUUM FULL su ogni tabella, una per volta (VACUUM non puo` girare
 *      dentro una transazione)
 *   3. Ritorna delta di dimensione DB + risultato per tabella
 *
 * Endpoint:
 *   POST {SUPABASE_URL}/functions/v1/vacuum-tables
 *   Authorization: Bearer <user JWT>
 *
 * Secrets richiesti:
 *   MGMT_API_PAT          → Personal Access Token Supabase (sbp_...)
 *   SUPABASE_PROJECT_REF  → ref del progetto (opzionale: dedotto da SUPABASE_URL)
 *
 * Deploy:
 *   supabase secrets set MGMT_API_PAT=sbp_...
 *   supabase functions deploy vacuum-tables
 */

// @ts-nocheck — questo file viene eseguito dentro Deno (Supabase Edge),
// non da TypeScript del frontend. La sintassi Deno (https-import,
// Deno.serve, Deno.env) e` valida nel runtime di destinazione.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// Tabelle che vacuumiamo. Sono tutte quelle che mostrano dead tuples nei
// tipici pattern d'uso dell'app (DELETE frequenti su backup/cambi/messaggi
// + UPDATE su turni). Ordine: prima quelle con piu` JSONB/TOAST.
const TABLES = [
  'turni_backup',
  'turni',
  'messaggi',
  'cambi_turno',
  'app_version',
  'utenti_autorizzati',
  'medici',
  'ferie',
  'configurazione',
  'festivita_custom',
]

Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Only POST' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    const supabaseUrl     = Deno.env.get('SUPABASE_URL')!
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const pat             = Deno.env.get('MGMT_API_PAT')
    if (!pat) {
      return new Response(JSON.stringify({
        error: 'MGMT_API_PAT non configurato. Esegui:  supabase secrets set MGMT_API_PAT=sbp_...',
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const projectRef =
      Deno.env.get('SUPABASE_PROJECT_REF') ??
      new URL(supabaseUrl).hostname.split('.')[0]

    // ── Verifica autenticazione + role admin ─────────────────────
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user }, error: userErr } = await userClient.auth.getUser()
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const { data: ua } = await userClient.from('utenti_autorizzati')
      .select('ruolo, attivo')
      .eq('email', user.email!)
      .maybeSingle()
    if (!ua || ua.ruolo !== 'admin' || !ua.attivo) {
      return new Response(JSON.stringify({ error: 'Forbidden — admin only' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── Helper: esegue SQL via Management API ─────────────────────
    async function dbQuery(sql: string): Promise<any> {
      const r = await fetch(
        `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${pat}`,
            'Content-Type':  'application/json',
          },
          body: JSON.stringify({ query: sql }),
        },
      )
      if (!r.ok) {
        const text = await r.text()
        throw new Error(`Management API ${r.status}: ${text}`)
      }
      return r.json()
    }

    // ── 1. Dimensione DB prima del VACUUM ────────────────────────
    const beforeRows = await dbQuery(
      'SELECT pg_database_size(current_database()) AS bytes;'
    )
    const sizeBefore = beforeRows[0]?.bytes ?? 0

    // ── 2. VACUUM FULL una tabella alla volta ────────────────────
    const results: Record<string, string> = {}
    for (const t of TABLES) {
      try {
        await dbQuery(`VACUUM FULL public.${t};`)
        results[t] = 'ok'
      } catch (e) {
        results[t] = String((e as Error).message).slice(0, 200)
      }
    }

    // ── 3. Dimensione DB dopo ────────────────────────────────────
    const afterRows = await dbQuery(
      'SELECT pg_database_size(current_database()) AS bytes;'
    )
    const sizeAfter = afterRows[0]?.bytes ?? 0

    return new Response(JSON.stringify({
      size_before_bytes: Number(sizeBefore),
      size_after_bytes:  Number(sizeAfter),
      freed_bytes:       Number(sizeBefore) - Number(sizeAfter),
      tables:            results,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({
      error: (e as Error).message,
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
