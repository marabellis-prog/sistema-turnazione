#!/usr/bin/env node
/**
 * run-sql.mjs — esegue SQL arbitrario contro il DB Supabase via Management API.
 *
 * Auth: Personal Access Token (PAT) generato su
 *   https://supabase.com/dashboard/account/tokens
 * salvato in `.env.local` come `SUPABASE_PAT=sbp_...` (gitignored).
 *
 * Il project ref viene estratto automaticamente dall'URL Supabase
 * (`VITE_SUPABASE_URL` in `.env`), ma può essere forzato con
 * `SUPABASE_PROJECT_REF` in `.env.local`.
 *
 * USO:
 *   node scripts/run-sql.mjs "SELECT now();"
 *   node scripts/run-sql.mjs --file migration.sql
 *   echo "SELECT 1;" | node scripts/run-sql.mjs --stdin
 *
 * OUTPUT: JSON dei record o messaggio di stato. Exit 0 = ok, 1 = errore.
 */

import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

// ── 1. Carica variabili da .env e .env.local ──────────────────────
function parseEnvFile(path) {
  if (!existsSync(path)) return {}
  const out = {}
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (!m) continue
    let v = m[2]
    if ((v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    out[m[1]] = v
  }
  return out
}

const env = {
  ...parseEnvFile(resolve(root, '.env')),
  ...parseEnvFile(resolve(root, '.env.local')),  // .local sovrascrive
}

const PAT = env.SUPABASE_PAT
if (!PAT) {
  console.error('[run-sql] errore: SUPABASE_PAT non trovato in .env.local')
  console.error('Crea un Personal Access Token su:')
  console.error('  https://supabase.com/dashboard/account/tokens')
  console.error('e salvalo come `SUPABASE_PAT=sbp_…` in `.env.local`.')
  process.exit(2)
}

let projectRef = env.SUPABASE_PROJECT_REF
if (!projectRef && env.VITE_SUPABASE_URL) {
  // VITE_SUPABASE_URL = https://<ref>.supabase.co
  const m = env.VITE_SUPABASE_URL.match(/https?:\/\/([a-z0-9]+)\.supabase\.co/i)
  if (m) projectRef = m[1]
}
if (!projectRef) {
  console.error('[run-sql] errore: project ref non determinato.')
  console.error('Imposta SUPABASE_PROJECT_REF in .env.local o VITE_SUPABASE_URL in .env.')
  process.exit(2)
}

// ── 2. Leggi SQL da CLI args o stdin ──────────────────────────────
async function readStdin() {
  const chunks = []
  for await (const c of process.stdin) chunks.push(c)
  return Buffer.concat(chunks).toString('utf8')
}

const argv = process.argv.slice(2)
let sql = ''
if (argv.includes('--stdin')) {
  sql = await readStdin()
} else if (argv.includes('--file')) {
  const i = argv.indexOf('--file')
  const path = argv[i + 1]
  if (!path) { console.error('[run-sql] --file richiede un path'); process.exit(2) }
  sql = readFileSync(path, 'utf8')
} else if (argv.length > 0) {
  // NB: escludi i flag (es. --confirm-destructive) dalla SQL inline, altrimenti
  // `--confirm-destructive` finisce nella query e il `--` commenta l'intera riga
  // → lo statement non viene eseguito (HTTP 201, 0 rows) e sembra un no-op.
  sql = argv.filter(a => !a.startsWith('--')).join(' ')
} else {
  console.error('USO: node scripts/run-sql.mjs "SQL" | --file path | --stdin')
  process.exit(2)
}

sql = sql.trim()
if (!sql) { console.error('[run-sql] SQL vuoto'); process.exit(2) }

// ── 3. Safety guard su comandi distruttivi ─────────────────────────
const destructive = /\b(DROP\s+(TABLE|DATABASE|SCHEMA|FUNCTION|TYPE|INDEX|VIEW|TRIGGER|POLICY)|TRUNCATE\s+TABLE|DELETE\s+FROM\s+\w+\s*(;|$)|UPDATE\s+\w+\s+SET\s+[^;]+\s*(;|$))/i
if (destructive.test(sql) && !argv.includes('--confirm-destructive')) {
  console.error('[run-sql] ⚠ rilevato comando potenzialmente distruttivo (DROP / TRUNCATE / DELETE/UPDATE senza WHERE).')
  console.error('Per confermare, riesegui con flag --confirm-destructive')
  console.error('---SQL---')
  console.error(sql)
  process.exit(3)
}

// ── 4. Esegui via Management API ───────────────────────────────────
const url = `https://api.supabase.com/v1/projects/${projectRef}/database/query`
const t0 = Date.now()
let res
try {
  res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${PAT}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  })
} catch (err) {
  console.error('[run-sql] errore di rete:', err.message)
  process.exit(1)
}
const ms = Date.now() - t0

const text = await res.text()
let body
try { body = JSON.parse(text) } catch { body = text }

if (!res.ok) {
  console.error(`[run-sql] HTTP ${res.status} (${ms}ms)`)
  console.error(typeof body === 'string' ? body : JSON.stringify(body, null, 2))
  process.exit(1)
}

console.log(`[run-sql] ok HTTP ${res.status} (${ms}ms) — project ${projectRef}`)
if (Array.isArray(body)) {
  if (body.length === 0) {
    console.log('(0 rows)')
  } else {
    console.log(JSON.stringify(body, null, 2))
    console.log(`(${body.length} row${body.length === 1 ? '' : 's'})`)
  }
} else {
  console.log(JSON.stringify(body, null, 2))
}
