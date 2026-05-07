/**
 * PendingActionsContext
 *
 * Traccia le azioni pendenti sul calendario che l'admin deve eseguire.
 * Persiste in localStorage → sopravvive ai refresh di pagina.
 *
 * DUE TIPI DISTINTI:
 *
 * 🔴 RIGENERA (needsRegen)
 *    Richiede "Genera Calendario" da zero — sovrascrive tutto.
 *    Si attiva quando:
 *    - Schema turni modificato/salvato
 *    - Medico aggiunto, eliminato o con numero_ordine cambiato
 *    - Configurazione periodo/schema cambiata
 *    Si azzera quando: generazione completata con successo
 *
 * 🟠 AGGIORNA (needsRefresh)
 *    Richiede solo un aggiornamento parziale — non sovrascrive modifiche manuali.
 *    Si attiva quando:
 *    - Ferie inserite o rimosse
 *    - Note/annotazioni sui turni modificate
 *    Si azzera quando: aggiornamento eseguito (o nuova generazione)
 *
 * REGOLA: se c'è un pendingRegen, il pendingRefresh è irrilevante
 * (la rigenerazione risolve entrambi).
 */

import { createContext, useContext, useState, useCallback, ReactNode } from 'react'

// ── Tipi ──────────────────────────────────────────────────────────

export interface PendingAction {
  reason:    string      // es. "Schema 1 modificato", "COGNATA eliminato"
  timestamp: string      // ISO string
}

interface PendingActionsState {
  needsRegen:    PendingAction | null
  needsRefresh:  PendingAction | null
}

interface PendingActionsCtx extends PendingActionsState {
  /** 🔴 Segna che serve una rigenerazione completa */
  setNeedsRegen:   (reason: string) => void
  /** 🟠 Segna che serve un aggiornamento parziale */
  setNeedsRefresh: (reason: string) => void
  /** Azzera solo il flag di aggiornamento */
  clearRefresh: () => void
  /** Azzera tutto (chiamato dopo generazione riuscita) */
  clearAll: () => void
}

// ── Persistenza localStorage ───────────────────────────────────────

const LS_KEY = 'st-pending-actions'

function loadFromStorage(): PendingActionsState {
  try {
    const raw = localStorage.getItem(LS_KEY)
    return raw ? JSON.parse(raw) : { needsRegen: null, needsRefresh: null }
  } catch {
    return { needsRegen: null, needsRefresh: null }
  }
}

function saveToStorage(state: PendingActionsState) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(state)) } catch {}
}

// ── Context ───────────────────────────────────────────────────────

const Ctx = createContext<PendingActionsCtx | null>(null)

export function PendingActionsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PendingActionsState>(loadFromStorage)

  const update = useCallback((next: PendingActionsState) => {
    setState(next)
    saveToStorage(next)
  }, [])

  const setNeedsRegen = useCallback((reason: string) => {
    update({
      needsRegen:   { reason, timestamp: new Date().toISOString() },
      needsRefresh: null,   // regen risolve anche refresh
    })
  }, [update])

  const setNeedsRefresh = useCallback((reason: string) => {
    // Non sovrascrive un regen già pendente
    setState(prev => {
      if (prev.needsRegen) return prev
      const next = { ...prev, needsRefresh: { reason, timestamp: new Date().toISOString() } }
      saveToStorage(next)
      return next
    })
  }, [])

  const clearRefresh = useCallback(() => {
    update({ ...state, needsRefresh: null })
  }, [update, state])

  const clearAll = useCallback(() => {
    update({ needsRegen: null, needsRefresh: null })
  }, [update])

  return (
    <Ctx.Provider value={{ ...state, setNeedsRegen, setNeedsRefresh, clearRefresh, clearAll }}>
      {children}
    </Ctx.Provider>
  )
}

/** Hook per usare il context — lancia errore se usato fuori dal provider */
export function usePendingActions(): PendingActionsCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('usePendingActions must be used within PendingActionsProvider')
  return ctx
}
