/**
 * googleCalendarSync — sincronizzazione dei turni (Clinica) del medico
 * loggato con il suo Google Calendar.
 *
 * Architettura: 100% client-side (siamo su GitHub Pages, niente backend).
 *   1. Google Identity Services (GIS) → token OAuth on-demand (~1h) con
 *      scope `calendar.app.created`: l'app puo` toccare SOLO i calendari
 *      che ha creato lei (il "TURNAZIONE"). Gli eventi personali del
 *      medico restano invisibili e intoccabili.
 *   2. Google Calendar REST API per creare il calendario + diff degli eventi.
 *
 * Sync intelligente: ogni evento ha un ID DETERMINISTICO derivato da
 * (medico, data). Ad ogni sincronizzazione si confronta lo stato desiderato
 * con quello presente:
 *   - turno nuovo            → crea
 *   - turno modificato       → aggiorna (confronto via "signature")
 *   - turno sparito/cancellato → elimina
 *   - turno identico         → NON tocca (zero chiamate API)
 * Cosi` cambi turno e cancellazioni si riflettono senza distruggere e
 * ricreare tutto.
 *
 * Setup richiesto (lato Google Cloud, una volta):
 *   - progetto Google Cloud (lo stesso del login Google va bene)
 *   - Calendar API abilitata
 *   - OAuth Client ID (Web) con origine JS = https://marabellis-prog.github.io
 *   - scope calendario nella schermata consenso + medici come utenti test
 *   - Client ID in VITE_GOOGLE_OAUTH_CLIENT_ID (build env)
 */

import type { Turno, TurnoClinico, SlotPlacement } from '../types'

// Client ID OAuth (pubblico, sicuro nel bundle). Vuoto finche` non
// configurato → la UI mostra un avviso "funzione non ancora attiva".
export const GOOGLE_OAUTH_CLIENT_ID =
  (import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID as string | undefined) ?? ''

// Scope minimale: solo i calendari creati dall'app. Massima privacy.
const SCOPE = 'https://www.googleapis.com/auth/calendar.app.created'

const CAL_API = 'https://www.googleapis.com/calendar/v3'
const CAL_SUMMARY = 'TURNAZIONE'
const TZ = 'Europe/Rome'
const LS_CAL_HINT = 'turnazione_gcal_id'  // hint localStorage per ritrovare il calendario

// ── Orari turni (configurabili qui) ─────────────────────────────────
//   M = Mattina, P = Pomeriggio, L = Lunga, REP = Reperibilita`
const SHIFT_TIMES: Record<'M' | 'P' | 'L' | 'REP', { start: string; end: string }> = {
  M:   { start: '08:00', end: '14:00' },
  P:   { start: '14:00', end: '20:00' },
  L:   { start: '08:00', end: '20:00' },
  REP: { start: '10:00', end: '16:00' },
}

// Solo questi TC finiscono sul calendario. EM/EP/EL (ceduti a esterno)
// e '' (vuoto) sono esclusi: il medico non li lavora.
const TC_SINCRONIZZABILI: TurnoClinico[] = ['M', 'P', 'L', 'REP']

// ── Palette colori calendario Google (colorId → hex indicativo) ─────
// La selezione e` per colorId: Google applica la sua tinta esatta;
// l'hex qui serve solo per la preview dello swatch nel modal.
export interface CalColor { colorId: string; hex: string; nome: string }
export const CAL_COLORS: CalColor[] = [
  { colorId: '16', hex: '#4986e7', nome: 'Blu' },
  { colorId: '15', hex: '#9fc6e7', nome: 'Azzurro' },
  { colorId: '14', hex: '#9fe1e7', nome: 'Pavone' },
  { colorId: '8',  hex: '#16a765', nome: 'Verde' },
  { colorId: '7',  hex: '#42d692', nome: 'Eucalipto' },
  { colorId: '10', hex: '#b3dc6c', nome: 'Avocado' },
  { colorId: '12', hex: '#fad165', nome: 'Banana' },
  { colorId: '6',  hex: '#ffad46', nome: 'Mango' },
  { colorId: '5',  hex: '#ff7537', nome: 'Zucca' },
  { colorId: '4',  hex: '#fa573c', nome: 'Mandarino' },
  { colorId: '3',  hex: '#f83a22', nome: 'Pomodoro' },
  { colorId: '22', hex: '#f691b2', nome: 'Rosa' },
  { colorId: '23', hex: '#cd74e6', nome: 'Uva' },
  { colorId: '17', hex: '#9a9cff', nome: 'Lavanda' },
  { colorId: '1',  hex: '#ac725e', nome: 'Cacao' },
  { colorId: '19', hex: '#c2c2c2', nome: 'Grafite' },
]

// ════════════════════════════════════════════════════════════════════
// Google Identity Services (token client)
// ════════════════════════════════════════════════════════════════════

interface TokenClient {
  requestAccessToken: (opts?: { prompt?: string }) => void
}
interface GoogleOAuth2 {
  initTokenClient: (cfg: {
    client_id: string
    scope: string
    callback: (resp: { access_token?: string; error?: string }) => void
    error_callback?: (err: { type?: string; message?: string }) => void
  }) => TokenClient
}
declare global {
  interface Window {
    google?: { accounts?: { oauth2?: GoogleOAuth2 } }
  }
}

let gisLoading: Promise<void> | null = null
function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve()
  if (gisLoading) return gisLoading
  gisLoading = new Promise<void>((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'
    s.async = true
    s.defer = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('Impossibile caricare Google Identity Services'))
    document.head.appendChild(s)
  })
  return gisLoading
}

/** Richiede un access token Google per lo scope calendario. Apre il popup
 *  di consenso (la prima volta) o restituisce un token al volo se gia`
 *  autorizzato. */
export async function requestCalendarToken(clientId: string): Promise<string> {
  if (!clientId) throw new Error('Client ID Google non configurato')
  await loadGis()
  const oauth2 = window.google?.accounts?.oauth2
  if (!oauth2) throw new Error('Google Identity Services non disponibile')

  return new Promise<string>((resolve, reject) => {
    const client = oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (resp) => {
        if (resp.access_token) resolve(resp.access_token)
        else reject(new Error(resp.error || 'Autorizzazione negata'))
      },
      error_callback: (err) => {
        reject(new Error(err.message || err.type || 'Autorizzazione annullata'))
      },
    })
    client.requestAccessToken({ prompt: '' })
  })
}

// ════════════════════════════════════════════════════════════════════
// REST helper
// ════════════════════════════════════════════════════════════════════

async function gcal<T = unknown>(
  token: string, method: string, path: string, body?: unknown,
): Promise<T> {
  const res = await fetch(`${CAL_API}${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`Google Calendar ${method} ${path.split('?')[0]} → HTTP ${res.status} ${txt.slice(0, 120)}`)
  }
  // DELETE risponde 204 senza body
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

// ════════════════════════════════════════════════════════════════════
// Calendario TURNAZIONE: find or create + colore
// ════════════════════════════════════════════════════════════════════

interface CalListResp { items?: Array<{ id: string; summary?: string }> }

async function findOrCreateCalendar(token: string, colorId: string): Promise<string> {
  // 1) hint da localStorage (re-sync sullo stesso dispositivo)
  try {
    const hint = localStorage.getItem(LS_CAL_HINT)
    if (hint) {
      try {
        await gcal(token, 'GET', `/calendars/${encodeURIComponent(hint)}`)
        await applyColor(token, hint, colorId)
        return hint
      } catch {
        localStorage.removeItem(LS_CAL_HINT)  // calendario eliminato a mano
      }
    }
  } catch { /* localStorage non disponibile */ }

  // 2) scan della lista calendari (con calendar.app.created ritorna quelli
  //    creati dall'app). Se lo scope non lo consente, si va al create.
  try {
    const list = await gcal<CalListResp>(token, 'GET', '/users/me/calendarList?maxResults=250')
    const found = list.items?.find(c => c.summary === CAL_SUMMARY)
    if (found) {
      try { localStorage.setItem(LS_CAL_HINT, found.id) } catch {}
      await applyColor(token, found.id, colorId)
      return found.id
    }
  } catch { /* calendarList non accessibile con questo scope: procedo a creare */ }

  // 3) crea
  const created = await gcal<{ id: string }>(token, 'POST', '/calendars', {
    summary: CAL_SUMMARY,
    timeZone: TZ,
    description: 'Turni di servizio — sincronizzati automaticamente dall\'app Sistema Turni. ' +
      'Non modificare manualmente: gli eventi vengono sovrascritti ad ogni sincronizzazione.',
  })
  try { localStorage.setItem(LS_CAL_HINT, created.id) } catch {}
  await applyColor(token, created.id, colorId)
  return created.id
}

/** Applica il colore al calendario (best-effort: se lo scope non consente
 *  la PATCH su calendarList, ignoriamo silenziosamente — il calendario
 *  resta col colore di default). */
async function applyColor(token: string, calId: string, colorId: string): Promise<void> {
  if (!colorId) return
  try {
    await gcal(token, 'PATCH', `/users/me/calendarList/${encodeURIComponent(calId)}`, { colorId })
  } catch { /* colore non applicabile con lo scope corrente */ }
}

// ════════════════════════════════════════════════════════════════════
// Eventi: build desiderati + lettura esistenti + diff
// ════════════════════════════════════════════════════════════════════

/** ID evento deterministico in base32hex (a-v, 0-9): prefisso "trn" +
 *  UUID medico senza trattini (hex) + data senza trattini (cifre). */
function eventId(medicoId: string, dataISO: string): string {
  const med = medicoId.replace(/-/g, '').toLowerCase()
  const day = dataISO.replace(/-/g, '')
  return `trn${med}${day}`
}

/** Titolo evento: M→MATTINA, P→POMERIGGIO, L→LUNGA, REP→REP, con il
 *  suffisso sub/med dai placement. Es: "POMERIGGIO (med)", "LUNGA (med/sub)". */
function eventTitle(tc: 'M' | 'P' | 'L' | 'REP', sm: SlotPlacement, sp: SlotPlacement): string {
  if (tc === 'REP') return 'REP'
  const base = tc === 'M' ? 'MATTINA' : tc === 'P' ? 'POMERIGGIO' : 'LUNGA'
  const slots = [sm, sp].filter(Boolean).map(s => (s as string).toLowerCase())
  return slots.length > 0 ? `${base} (${slots.join('/')})` : base
}

/** Signature del contenuto: cambia se cambia TC o placement → guida il diff. */
function sig(tc: string, sm: SlotPlacement, sp: SlotPlacement): string {
  return `${tc}|${sm ?? '-'}|${sp ?? '-'}`
}

interface Desiderato {
  id: string; date: string; start: string; end: string; title: string; sig: string
}

function buildDesiderati(turni: Turno[], medicoId: string): Map<string, Desiderato> {
  const m = new Map<string, Desiderato>()
  for (const t of turni) {
    if (t.medico_id !== medicoId) continue
    const tc = t.turno_clinico
    if (!TC_SINCRONIZZABILI.includes(tc)) continue
    const key = tc as 'M' | 'P' | 'L' | 'REP'
    const { start, end } = SHIFT_TIMES[key]
    const id = eventId(medicoId, t.data)
    m.set(id, {
      id, date: t.data, start, end,
      title: eventTitle(key, t.slot_mattina, t.slot_pomeriggio),
      sig:   sig(tc, t.slot_mattina, t.slot_pomeriggio),
    })
  }
  return m
}

function eventBody(d: Desiderato) {
  return {
    id: d.id,
    summary: d.title,
    start: { dateTime: `${d.date}T${d.start}:00`, timeZone: TZ },
    end:   { dateTime: `${d.date}T${d.end}:00`,   timeZone: TZ },
    extendedProperties: { private: { app: 'turnazione', sig: d.sig } },
    reminders: { useDefault: false },  // niente promemoria pop-up per i turni
  }
}

interface GEvent {
  id: string
  summary?: string
  extendedProperties?: { private?: { sig?: string } }
}
interface EventsResp { items?: GEvent[]; nextPageToken?: string }

/** Legge SOLO gli eventi gestiti dall'app (tag privateExtendedProperty
 *  app=turnazione), cosi` non tocchiamo eventi aggiunti a mano dal medico. */
async function listManagedEvents(token: string, calId: string): Promise<Map<string, GEvent>> {
  const map = new Map<string, GEvent>()
  let pageToken: string | undefined
  do {
    const qs = new URLSearchParams({
      privateExtendedProperty: 'app=turnazione',
      singleEvents: 'true',
      showDeleted: 'false',
      maxResults: '2500',
    })
    if (pageToken) qs.set('pageToken', pageToken)
    const res = await gcal<EventsResp>(token, 'GET', `/calendars/${encodeURIComponent(calId)}/events?${qs}`)
    for (const ev of res.items ?? []) map.set(ev.id, ev)
    pageToken = res.nextPageToken
  } while (pageToken)
  return map
}

// ── Pool di concorrenza per non saturare l'API ─────────────────────
async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++
      await fn(items[idx])
    }
  })
  await Promise.all(workers)
}

// ════════════════════════════════════════════════════════════════════
// API pubblica
// ════════════════════════════════════════════════════════════════════

export type SyncPhase = 'auth' | 'calendar' | 'reading' | 'writing' | 'done'
export interface SyncProgress { phase: SyncPhase; done?: number; total?: number }
export interface SyncResult {
  calendarId: string
  created: number
  updated: number
  deleted: number
  unchanged: number
}

export async function syncToGoogleCalendar(opts: {
  clientId: string
  medicoId: string
  turni: Turno[]
  colorId: string
  onProgress?: (p: SyncProgress) => void
}): Promise<SyncResult> {
  const { clientId, medicoId, turni, colorId, onProgress } = opts

  onProgress?.({ phase: 'auth' })
  const token = await requestCalendarToken(clientId)

  onProgress?.({ phase: 'calendar' })
  const calId = await findOrCreateCalendar(token, colorId)

  onProgress?.({ phase: 'reading' })
  const existing = await listManagedEvents(token, calId)
  const desired = buildDesiderati(turni, medicoId)

  // ── Diff ──────────────────────────────────────────────────────────
  const toCreate: Desiderato[] = []
  const toUpdate: Desiderato[] = []
  const toDelete: string[] = []

  for (const [id, d] of desired) {
    const ex = existing.get(id)
    if (!ex) {
      toCreate.push(d)
    } else if (ex.extendedProperties?.private?.sig !== d.sig || ex.summary !== d.title) {
      toUpdate.push(d)
    }
    // identico → niente
  }
  for (const [id] of existing) {
    if (!desired.has(id)) toDelete.push(id)
  }

  // ── Esecuzione con progress ────────────────────────────────────────
  const total = toCreate.length + toUpdate.length + toDelete.length
  let done = 0
  const tick = () => { done++; onProgress?.({ phase: 'writing', done, total }) }
  onProgress?.({ phase: 'writing', done: 0, total })

  await pool(toCreate, 6, async d => {
    await gcal(token, 'POST', `/calendars/${encodeURIComponent(calId)}/events`, eventBody(d))
    tick()
  })
  await pool(toUpdate, 6, async d => {
    await gcal(token, 'PUT', `/calendars/${encodeURIComponent(calId)}/events/${d.id}`, eventBody(d))
    tick()
  })
  await pool(toDelete, 6, async id => {
    try {
      await gcal(token, 'DELETE', `/calendars/${encodeURIComponent(calId)}/events/${id}`)
    } catch (e) {
      // 404/410 = gia` eliminato → ok. Altri errori: rilancio.
      const msg = (e as Error).message
      if (!/HTTP 4(04|10)/.test(msg)) throw e
    }
    tick()
  })

  onProgress?.({ phase: 'done' })
  return {
    calendarId: calId,
    created: toCreate.length,
    updated: toUpdate.length,
    deleted: toDelete.length,
    unchanged: desired.size - toCreate.length - toUpdate.length,
  }
}
