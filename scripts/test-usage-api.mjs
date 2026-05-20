#!/usr/bin/env node
/**
 * test-usage-api.mjs — verifica cosa torna la Supabase Management API
 * per gli endpoint di usage. Usa il PAT in .env.local (SUPABASE_PAT).
 *
 * USO: node scripts/test-usage-api.mjs
 *
 * Stampa:
 *   1. Lista delle organizzazioni associate al PAT
 *   2. Per ogni org: chiamata /v1/organizations/{slug}/usage
 *   3. Per la nostra project ref: prova endpoint platform/projects (non documentato)
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
if (!PAT) { console.error('SUPABASE_PAT non trovato'); process.exit(2) }

const projectRef = env.SUPABASE_PROJECT_REF || (() => {
  const m = (env.VITE_SUPABASE_URL || '').match(/https?:\/\/([a-z0-9]+)\.supabase\.co/i)
  return m ? m[1] : null
})()

async function api(path) {
  const res = await fetch(`https://api.supabase.com${path}`, {
    headers: { Authorization: `Bearer ${PAT}` },
  })
  const text = await res.text()
  let body
  try { body = JSON.parse(text) } catch { body = text }
  return { status: res.status, body }
}

console.log('=== 1) Lista organizzazioni ===')
const orgs = await api('/v1/organizations')
console.log(`status ${orgs.status}`)
if (Array.isArray(orgs.body)) {
  for (const o of orgs.body) {
    console.log(`  ${o.slug}  (${o.name})  id=${o.id}`)
  }
} else {
  console.log(JSON.stringify(orgs.body, null, 2))
}

if (Array.isArray(orgs.body) && orgs.body[0]) {
  const slug = orgs.body[0].slug
  console.log(`\n=== 2) Usage per org "${slug}" ===`)
  const usage = await api(`/v1/organizations/${slug}/usage`)
  console.log(`status ${usage.status}`)
  console.log(JSON.stringify(usage.body, null, 2).slice(0, 4000))
}

console.log(`\n=== 3) Project ref: ${projectRef} ===`)
const proj = await api(`/v1/projects/${projectRef}`)
console.log(`status ${proj.status}`)
console.log(JSON.stringify(proj.body, null, 2))

console.log('\n=== 4) Sondaggio endpoint usage candidati ===')
const candidates = [
  `/v1/projects/${projectRef}/usage`,
  `/v1/projects/${projectRef}/database/usage`,
  `/v1/projects/${projectRef}/billing`,
  `/v1/projects/${projectRef}/api/usage`,
  `/v1/projects/${projectRef}/auth/users`,
  // Platform (non documentato, usato dal dashboard)
  `/platform/projects/${projectRef}/daily-stats`,
  `/platform/projects/${projectRef}/usage`,
  `/platform/organizations/${orgs.body?.[0]?.slug}/usage`,
]
for (const path of candidates) {
  const r = await api(path)
  const preview = typeof r.body === 'string'
    ? r.body.slice(0, 150)
    : JSON.stringify(r.body).slice(0, 200)
  console.log(`  [${r.status}] ${path}  →  ${preview}`)
}

console.log('\n=== 5) Host alternativi ===')
const altHosts = [
  `https://api.supabase.com/v0/projects/${projectRef}/usage`,
  `https://api.supabase.com/v0/organizations/${orgs.body?.[0]?.slug}/usage`,
  `https://api.supabase.com/v1/projects/${projectRef}/services-health`,
  `https://api.supabase.com/v1/projects/${projectRef}/postgrest`,
  `https://api.supabase.com/v1/projects/${projectRef}/functions`,
  `https://api.supabase.com/v1/projects/${projectRef}/network-bans`,
  `https://api.supabase.com/v1/snippets`,
]
for (const url of altHosts) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${PAT}` } })
  const t = await res.text()
  console.log(`  [${res.status}] ${url.replace('https://api.supabase.com', '')}  →  ${t.slice(0, 150)}`)
}
