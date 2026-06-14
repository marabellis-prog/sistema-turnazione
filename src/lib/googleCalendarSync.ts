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
const LS_CAL_HINT  = 'turnazione_gcal_id'     // hint localStorage per ritrovare il calendario
const LS_CAL_COLOR = 'turnazione_gcal_color'  // ultimo colorId noto del calendario TURNAZIONE

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

// ── Palette colori EVENTI di Google Calendar (colorId 1-11) ─────────
// I turni vengono colorati impostando event.colorId: i colori sono
// quelli reali di Google Calendar, quindi lo swatch scelto coincide
// ESATTAMENTE col colore dei turni sul calendario. (Funziona con lo
// scope minimale calendar.app.created, a differenza del colore del
// calendario che richiederebbe permessi piu` ampi.)
export interface CalColor { colorId: string; hex: string; nome: string }
export const CAL_COLORS: CalColor[] = [
  { colorId: '7',  hex: '#039be5', nome: 'Pavone' },
  { colorId: '9',  hex: '#3f51b5', nome: 'Mirtillo' },
  { colorId: '1',  hex: '#7986cb', nome: 'Lavanda' },
  { colorId: '10', hex: '#0b8043', nome: 'Basilico' },
  { colorId: '2',  hex: '#33b679', nome: 'Salvia' },
  { colorId: '5',  hex: '#f6bf26', nome: 'Banana' },
  { colorId: '6',  hex: '#f4511e', nome: 'Mandarino' },
  { colorId: '11', hex: '#d50000', nome: 'Pomodoro' },
  { colorId: '4',  hex: '#e67c73', nome: 'Salmone' },
  { colorId: '3',  hex: '#8e24aa', nome: 'Uva' },
  { colorId: '8',  hex: '#616161', nome: 'Grafite' },
]

/** Hex corrispondente a un colorId evento (preview + best-effort calendar bg). */
function hexForColorId(colorId: string): string {
  return CAL_COLORS.find(c => c.colorId === colorId)?.hex ?? CAL_COLORS[0].hex
}

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

const MAX_RETRY = 6

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function gcal<T = unknown>(
  token: string, method: string, path: string, body?: unknown, attempt = 0,
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
    // Errori transitori → retry con backoff esponenziale + jitter.
    // Google Calendar limita le scritture in burst sullo stesso calendario
    // (specie se appena creato): risponde 403 rateLimitExceeded o 429.
    // Si risolve riprovando con attese crescenti (0.8s, 1.6s, 3.2s, …).
    const transient =
      res.status === 429 ||
      res.status >= 500 ||
      (res.status === 403 && /rate ?limit|userratelimit|quota/i.test(txt))
    if (transient && attempt < MAX_RETRY) {
      const delay = Math.min(30000, 800 * 2 ** attempt) + Math.floor(Math.random() * 400)
      await sleep(delay)
      return gcal<T>(token, method, path, body, attempt + 1)
    }
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

/** Salva l'ultimo colorId scelto, per pre-selezionarlo nel modal. */
function saveColor(colorId: string | undefined): void {
  if (!colorId) return
  try { localStorage.setItem(LS_CAL_COLOR, colorId) } catch {}
}

/** Legge l'ultimo colorId scelto (o null). */
export function getSavedCalendarColor(): string | null {
  try { return localStorage.getItem(LS_CAL_COLOR) } catch { return null }
}

/** Testo leggibile (bianco/scuro) sul colore di sfondo, in base alla
 *  luminanza. Usato per foregroundColor del calendario. */
function readableForeground(hex: string): string {
  const h = hex.replace('#', '')
  if (h.length < 6) return '#1d1d1d'
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return lum > 0.6 ? '#1d1d1d' : '#ffffff'
}

// Errore sentinella: il calendario TURNAZIONE non esiste piu` (es.
// eliminato a mano su Google Calendar). Il chiamante lo intercetta,
// ricrea il calendario e riprova la sincronizzazione una volta.
function calendarGone(): Error { return new Error('CALENDAR_GONE') }
function isCalendarGone(e: unknown): boolean {
  return e instanceof Error && e.message === 'CALENDAR_GONE'
}

async function findOrCreateCalendar(token: string, colorId: string, forceCreate = false): Promise<string> {
  // I turni vengono colorati a livello di EVENTO (vedi eventBody). Qui
  // proviamo anche a dare al calendario lo stesso colore (best-effort:
  // con lo scope minimale puo` non avere effetto, ma gli eventi restano
  // colorati comunque).
  //
  // forceCreate=true: salta l'hint localStorage (puo` puntare a un
  // calendario eliminato). Usato nel retry dopo un CALENDAR_GONE.

  // 1) hint da localStorage (re-sync sullo stesso dispositivo)
  if (!forceCreate) try {
    const hint = localStorage.getItem(LS_CAL_HINT)
    if (hint) {
      try {
        await gcal(token, 'GET', `/calendars/${encodeURIComponent(hint)}`)
        await applyColor(token, hint, colorId)
        saveColor(colorId)
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
      saveColor(colorId)
      return found.id
    }
  } catch { /* calendarList non accessibile con questo scope: procedo a creare */ }

  // 3) crea (e prova ad applicare il colore al calendario)
  const created = await gcal<{ id: string }>(token, 'POST', '/calendars', {
    summary: CAL_SUMMARY,
    timeZone: TZ,
    description: 'Turni di servizio — sincronizzati automaticamente dall\'app Sistema Turni. ' +
      'Non modificare manualmente: gli eventi vengono sovrascritti ad ogni sincronizzazione.',
  })
  try { localStorage.setItem(LS_CAL_HINT, created.id) } catch {}
  await applyColor(token, created.id, colorId)
  saveColor(colorId)  // memorizzo il colorId appena scelto
  return created.id
}

/** Best-effort: prova a dare al calendario il colore corrispondente al
 *  colorId scelto (backgroundColor hex + colorRgbFormat). Con lo scope
 *  minimale calendar.app.created puo` fallire silenziosamente: in tal
 *  caso il calendario resta col colore di default, ma i singoli eventi
 *  sono comunque colorati (event.colorId, vedi eventBody). */
async function applyColor(token: string, calId: string, colorId: string): Promise<void> {
  if (!colorId) return
  const hex = hexForColorId(colorId)
  try {
    await gcal(
      token, 'PATCH',
      `/users/me/calendarList/${encodeURIComponent(calId)}?colorRgbFormat=true`,
      { backgroundColor: hex, foregroundColor: readableForeground(hex) },
    )
  } catch { /* colore del calendario non applicabile con lo scope corrente */ }
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
 *  suffisso sub/med dai placement.
 *  - Es: "POMERIGGIO (med)"
 *  - LUNGA con le due meta` UGUALI → sigla singola: "LUNGA (med)"
 *  - LUNGA con le due meta` DIVERSE → entrambe: "LUNGA (med/sub)" */
function eventTitle(tc: 'M' | 'P' | 'L' | 'REP', sm: SlotPlacement, sp: SlotPlacement): string {
  if (tc === 'REP') return 'REP'
  const base = tc === 'M' ? 'MATTINA' : tc === 'P' ? 'POMERIGGIO' : 'LUNGA'
  let slots = [sm, sp].filter(Boolean).map(s => (s as string).toLowerCase())
  // Due meta` identiche (es. sub/sub, med/med) → una sola scritta.
  if (slots.length === 2 && slots[0] === slots[1]) slots = [slots[0]]
  return slots.length > 0 ? `${base} (${slots.join('/')})` : base
}

/** Signature del contenuto: cambia se cambia TC, placement o COLORE →
 *  guida il diff (cosi` cambiando colore tutti gli eventi si aggiornano). */
function sig(tc: string, sm: SlotPlacement, sp: SlotPlacement, colorId: string): string {
  return `${tc}|${sm ?? '-'}|${sp ?? '-'}|c${colorId}`
}

interface Desiderato {
  id: string; date: string; start: string; end: string
  title: string; sig: string; colorId: string
}

function buildDesiderati(turni: Turno[], medicoId: string, colorId: string): Map<string, Desiderato> {
  const m = new Map<string, Desiderato>()
  for (const t of turni) {
    if (t.medico_id !== medicoId) continue
    const tc = t.turno_clinico
    if (!TC_SINCRONIZZABILI.includes(tc)) continue
    const key = tc as 'M' | 'P' | 'L' | 'REP'
    const { start, end } = SHIFT_TIMES[key]
    const id = eventId(medicoId, t.data)
    m.set(id, {
      id, date: t.data, start, end, colorId,
      title: eventTitle(key, t.slot_mattina, t.slot_pomeriggio),
      sig:   sig(tc, t.slot_mattina, t.slot_pomeriggio, colorId),
    })
  }
  return m
}

function eventBody(d: Desiderato) {
  return {
    id: d.id,
    summary: d.title,
    colorId: d.colorId,  // colore dell'evento (palette eventi Google)
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
    let res: EventsResp
    try {
      res = await gcal<EventsResp>(token, 'GET', `/calendars/${encodeURIComponent(calId)}/events?${qs}`)
    } catch (e) {
      // 404 sulla lista eventi = il calendario non esiste piu`.
      if (/HTTP 404/.test((e as Error).message)) throw calendarGone()
      throw e
    }
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

  // Prova la sincronizzazione. Se durante l'operazione si scopre che il
  // calendario non esiste piu` (eliminato a mano su Google → CALENDAR_GONE),
  // si azzera l'hint, si ricrea il calendario da zero e si riprova UNA volta.
  try {
    return await runSyncOnce(token, medicoId, turni, colorId, false, onProgress)
  } catch (e) {
    if (isCalendarGone(e)) {
      try { localStorage.removeItem(LS_CAL_HINT) } catch {}
      return await runSyncOnce(token, medicoId, turni, colorId, true, onProgress)
    }
    throw e
  }
}

async function runSyncOnce(
  token: string,
  medicoId: string,
  turni: Turno[],
  colorId: string,
  forceCreate: boolean,
  onProgress?: (p: SyncProgress) => void,
): Promise<SyncResult> {
  onProgress?.({ phase: 'calendar' })
  const calId = await findOrCreateCalendar(token, colorId, forceCreate)

  onProgress?.({ phase: 'reading' })
  // Se appena ricreato (forceCreate) la lista e` vuota → tutto da creare.
  const existing = forceCreate ? new Map<string, GEvent>() : await listManagedEvents(token, calId)
  const desired = buildDesiderati(turni, medicoId, colorId)

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

  const eventsPath = `/calendars/${encodeURIComponent(calId)}/events`

  // Helper: crea un evento gestendo 409 (esiste → update) e 404 (calendario
  // sparito → CALENDAR_GONE).
  const createEvent = async (d: Desiderato) => {
    try {
      await gcal(token, 'POST', eventsPath, eventBody(d))
    } catch (e) {
      const msg = (e as Error).message
      if (/HTTP 409/.test(msg)) {
        // ID gia` esistente (lista non aggiornata) → aggiorno.
        await gcal(token, 'PUT', `${eventsPath}/${d.id}`, eventBody(d))
      } else if (/HTTP 404/.test(msg)) {
        throw calendarGone()
      } else {
        throw e
      }
    }
  }

  // Concorrenza bassa (2) per non saturare il rate limit di scrittura del
  // calendario; il backoff in gcal() copre eventuali picchi residui.
  const WRITE_CONCURRENCY = 2

  await pool(toCreate, WRITE_CONCURRENCY, async d => {
    await createEvent(d)
    tick()
  })
  await pool(toUpdate, WRITE_CONCURRENCY, async d => {
    try {
      await gcal(token, 'PUT', `${eventsPath}/${d.id}`, eventBody(d))
    } catch (e) {
      // 404 in update: l'evento non c'e` piu`. Potrebbe mancare solo
      // l'evento (→ lo creo) oppure l'intero calendario (→ CALENDAR_GONE,
      // rilevato dalla createEvent che a sua volta becca 404).
      if (/HTTP 404/.test((e as Error).message)) await createEvent(d)
      else throw e
    }
    tick()
  })
  await pool(toDelete, WRITE_CONCURRENCY, async id => {
    try {
      await gcal(token, 'DELETE', `${eventsPath}/${id}`)
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
