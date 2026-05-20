#!/usr/bin/env node
/**
 * vacuum-full.mjs — Esegue VACUUM FULL sulle tabelle principali del DB
 * via Management API (usa il PAT in .env.local).
 *
 * USO:
 *   node scripts/vacuum-full.mjs
 *
 * Stampa la dimensione DB prima/dopo e il risultato per tabella.
 *
 * Fallback CLI per il pulsante "Pulisci database" in /admin/backup —
 * funziona senza dover deployare l'Edge Function `vacuum-tables`.
 */

import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

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
  ...parseEnvFile(resolve(root, '.env.local')),
}
const PAT = env.SUPABASE_PAT
if (!PAT) {
  console.error('SUPABASE_PAT non trovato in .env.local')
  process.exit(2)
}
const projectRef = env.SUPABASE_PROJECT_REF || (() => {
  const m = (env.VITE_SUPABASE_URL || '').match(/https?:\/\/([a-z0-9]+)\.supabase\.co/i)
  return m ? m[1] : null
})()
if (!projectRef) { console.error('Project ref non determinato'); process.exit(2) }

const TABLES = [
  'turni_backup', 'turni', 'messaggi', 'cambi_turno',
  'app_version', 'utenti_autorizzati', 'medici', 'ferie',
  'configurazione', 'festivita_custom',
]

async function dbQuery(sql) {
  const r = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${PAT}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({ query: sql }),
    },
  )
  const text = await r.text()
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${text}`)
  try { return JSON.parse(text) } catch { return text }
}

function fmt(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024*1024)).toFixed(2)} MB`
  if (bytes >= 1024)        return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} bytes`
}

console.log(`Project: ${projectRef}\n`)

const before = await dbQuery('SELECT pg_database_size(current_database()) AS bytes;')
const sizeBefore = Number(before[0]?.bytes ?? 0)
console.log(`Dimensione DB PRIMA: ${fmt(sizeBefore)}\n`)

for (const t of TABLES) {
  process.stdout.write(`  VACUUM FULL public.${t} ... `)
  try {
    await dbQuery(`VACUUM FULL public.${t};`)
    console.log('OK')
  } catch (e) {
    console.log(`ERRORE: ${e.message.slice(0, 100)}`)
  }
}

const after = await dbQuery('SELECT pg_database_size(current_database()) AS bytes;')
const sizeAfter = Number(after[0]?.bytes ?? 0)
const freed = sizeBefore - sizeAfter

console.log(`\nDimensione DB DOPO:  ${fmt(sizeAfter)}`)
console.log(`Liberati:            ${fmt(freed)} ` +
            `(${((freed / sizeBefore) * 100).toFixed(1)}% di riduzione)`)
