#!/usr/bin/env node
/**
 * export-backup.mjs — esporta le tabelle del DB in file JSON (per un backup
 * versionabile/archiviabile). Riusa l'auth di run-sql.mjs (PAT + project ref
 * da .env / .env.local).
 *
 * USO: node scripts/export-backup.mjs <cartella-output>
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
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
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    out[m[1]] = v
  }
  return out
}

const env = { ...parseEnvFile(resolve(root, '.env')), ...parseEnvFile(resolve(root, '.env.local')) }
const PAT = env.SUPABASE_PAT
if (!PAT) { console.error('SUPABASE_PAT mancante in .env.local'); process.exit(2) }
let projectRef = env.SUPABASE_PROJECT_REF
if (!projectRef && env.VITE_SUPABASE_URL) {
  const m = env.VITE_SUPABASE_URL.match(/https?:\/\/([a-z0-9]+)\.supabase\.co/i)
  if (m) projectRef = m[1]
}
if (!projectRef) { console.error('project ref non determinato'); process.exit(2) }

const outDir = process.argv[2] || resolve(root, 'backups', 'export')
mkdirSync(outDir, { recursive: true })

const TABLES = [
  'turni', 'schemi_modello', 'configurazione', 'cambi_turno', 'ferie',
  'medici', 'festivita_custom', 'turnazione_anteprima', 'utenti_autorizzati', 'turni_backup',
]

const url = `https://api.supabase.com/v1/projects/${projectRef}/database/query`
async function query(sql) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`)
  return JSON.parse(text)
}

const manifest = { progetto: projectRef, esportato_il: new Date().toISOString(), tabelle: {} }
for (const t of TABLES) {
  try {
    const rows = await query(`SELECT * FROM ${t}`)
    writeFileSync(join(outDir, `${t}.json`), JSON.stringify(rows, null, 2))
    manifest.tabelle[t] = Array.isArray(rows) ? rows.length : 0
    console.log(`  ${t}: ${manifest.tabelle[t]} righe`)
  } catch (e) {
    console.error(`  ${t}: ERRORE ${e.message}`)
    manifest.tabelle[t] = `ERRORE: ${e.message}`
  }
}
writeFileSync(join(outDir, '_manifest.json'), JSON.stringify(manifest, null, 2))
console.log('Backup scritto in', outDir)
