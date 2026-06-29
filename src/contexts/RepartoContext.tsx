/**
 * RepartoContext
 *
 * Contesto del REPARTO ATTIVO. Il gestionale e' multi-reparto: admin e
 * responsabili scelgono su quale reparto stanno lavorando.
 *
 * SCOPING: il super-admin vede TUTTI i reparti; un responsabile vede SOLO i
 * reparti di cui e' responsabile (reparto_responsabili). `hasAdminAccess` =
 * true se l'utente e' super-admin OPPURE responsabile di almeno un reparto →
 * guida l'accesso al pannello admin. Sta SOTTO DebugProvider, quindi usa
 * l'utente "efficace" (doppelganger / admin-mode compresi).
 */

import { createContext, useContext, useState, useEffect } from 'react'
import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useDebug } from './DebugContext'
import type { Reparto } from '../types'

/** Id fisso del reparto seed "11N" (dati storici). */
export const REPARTO_11N = '11111111-1111-4111-8111-111111111111'
const LS_KEY = 'reparto_attivo'

interface RepartoCtx {
  reparti:          Reparto[]        // reparti VISIBILI all'utente corrente
  repartoAttivo:    string
  setRepartoAttivo: (id: string) => void
  repartoCorrente:  Reparto | undefined
  isSuperAdmin:     boolean
  hasAdminAccess:   boolean          // super-admin OPPURE responsabile di >=1 reparto
  loading:          boolean
}

const Ctx = createContext<RepartoCtx | null>(null)

export function RepartoProvider({ children }: { children: ReactNode }) {
  const { effectiveUser } = useDebug()
  const utenteId     = effectiveUser?.id ?? null
  const isSuperAdmin = effectiveUser?.ruolo === 'admin'

  const { data: tutti = [], isLoading } = useQuery<Reparto[]>({
    queryKey: ['reparti'],
    queryFn: async () => {
      const { data, error } = await supabase.from('reparti').select('*')
        .order('attivo', { ascending: false }).order('nome')
      if (error) throw error
      return (data ?? []) as Reparto[]
    },
    staleTime: 60_000,
  })

  // Reparti di cui l'utente è responsabile (per il super-admin è irrilevante).
  const { data: gestitiIds = [] } = useQuery<string[]>({
    queryKey: ['reparti-gestiti', utenteId],
    queryFn: async () => {
      if (!utenteId) return []
      const { data, error } = await supabase.from('reparto_responsabili')
        .select('reparto_id').eq('utente_id', utenteId)
      if (error) throw error
      return (data ?? []).map((r: { reparto_id: string }) => r.reparto_id)
    },
    enabled: !!utenteId && !isSuperAdmin,
    staleTime: 60_000,
  })

  const reparti = isSuperAdmin ? tutti : tutti.filter(r => gestitiIds.includes(r.id))
  const hasAdminAccess = isSuperAdmin || reparti.length > 0

  const [repartoAttivo, setStato] = useState<string>(
    () => localStorage.getItem(LS_KEY) || REPARTO_11N,
  )
  function setRepartoAttivo(id: string) {
    localStorage.setItem(LS_KEY, id)
    setStato(id)
  }

  // Se il reparto attivo non è tra quelli visibili (cambiato/perso accesso),
  // ripiega sul primo reparto visibile.
  useEffect(() => {
    if (reparti.length && !reparti.some(r => r.id === repartoAttivo)) {
      setRepartoAttivo(reparti[0].id)
    }
  }, [reparti, repartoAttivo])

  const repartoCorrente = reparti.find(r => r.id === repartoAttivo)

  return (
    <Ctx.Provider value={{
      reparti, repartoAttivo, setRepartoAttivo, repartoCorrente,
      isSuperAdmin, hasAdminAccess, loading: isLoading,
    }}>
      {children}
    </Ctx.Provider>
  )
}

export function useReparto() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useReparto deve stare dentro <RepartoProvider>')
  return c
}
