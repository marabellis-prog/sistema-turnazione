import { createContext, useContext, useState, useEffect, useMemo } from 'react'
import type { ReactNode } from 'react'
import type { AuthUser } from '../types'

// ── Debug: "modalità Admin attivo/disattivo" + Doppelgänger ──────────
// Strumento di debug riservato all'admin REALE (marabelli): permette di
// vedere l'app come la vedono gli altri, senza dover fare logout.
//  - adminMode OFF  → l'admin viene declassato a ruolo 'user' (niente menu
//    Admin, vede il calendario pubblico come un turnista normale).
//  - doppelganger   → l'admin "diventa" un utente specifico (ne assume id,
//    ruolo e nominativo) → vede ESATTAMENTE la sua vista (incl. il suo
//    medico, ferie, cambi).
// Lo stato è persistito in localStorage e sincronizzato fra le finestre
// (così la tab admin e la tab turni mostrano lo stesso debug).

const LS_KEY = 'st_debug'

interface DebugStored { adminMode: boolean; doppleganger: AuthUser | null }

interface Ctx {
  realUser: AuthUser | null          // utente reale loggato
  effectiveUser: AuthUser | null     // utente "efficace" con cui ragiona tutta l'app
  isRealAdmin: boolean               // il reale è admin → mostra i badge di debug
  adminMode: boolean                 // poteri admin attivi (default true)
  doppleganger: AuthUser | null      // utente impersonato (se attivo)
  setAdminMode: (on: boolean) => void
  setDoppleganger: (u: AuthUser | null) => void
}

const DebugCtx = createContext<Ctx>({
  realUser: null, effectiveUser: null, isRealAdmin: false, adminMode: true, doppleganger: null,
  setAdminMode: () => {}, setDoppleganger: () => {},
})

function readStored(): DebugStored {
  try {
    const r = localStorage.getItem(LS_KEY)
    if (r) { const o = JSON.parse(r); return { adminMode: o.adminMode !== false, doppleganger: o.doppleganger ?? null } }
  } catch { /* ignore */ }
  return { adminMode: true, doppleganger: null }
}

export function DebugProvider({ realUser, children }: { realUser: AuthUser | null; children: ReactNode }) {
  const isRealAdmin = realUser?.ruolo === 'admin'
  const [stored, setStored] = useState<DebugStored>(readStored)

  // persistenza + sincronizzazione tra finestre
  useEffect(() => { try { localStorage.setItem(LS_KEY, JSON.stringify(stored)) } catch { /* ignore */ } }, [stored])
  useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (e.key === LS_KEY) setStored(readStored()) }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const adminMode    = isRealAdmin ? stored.adminMode : true
  const doppleganger = isRealAdmin ? stored.doppleganger : null

  const effectiveUser = useMemo<AuthUser | null>(() => {
    if (!realUser) return null
    if (!isRealAdmin) return realUser              // non-admin: nessun override
    if (doppleganger) return doppleganger          // impersona l'utente scelto
    if (!adminMode) return { ...realUser, ruolo: 'user' }  // admin "disattivato" → vede come user
    return realUser                                 // admin a pieni poteri (default)
  }, [realUser, isRealAdmin, doppleganger, adminMode])

  const value: Ctx = {
    realUser, effectiveUser, isRealAdmin, adminMode, doppleganger,
    setAdminMode: (on) => setStored({ adminMode: on, doppleganger: null }),
    setDoppleganger: (u) => setStored(s => ({ ...s, doppleganger: u })),
  }
  return <DebugCtx.Provider value={value}>{children}</DebugCtx.Provider>
}

export function useDebug() { return useContext(DebugCtx) }
