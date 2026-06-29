/**
 * MioRepartoContext — il reparto "in vista" per le pagine PUBBLICHE.
 *
 * Diverso da RepartoContext (che è il reparto su cui l'admin/responsabile
 * sta LAVORANDO): qui è il reparto di cui il turnista loggato sta GUARDANDO
 * il calendario. Un utente può essere medico in più reparti → `mieiReparti`
 * li elenca e un selettore (in NavBar) sceglie `repartoVista`.
 *
 * Sta SOTTO DebugProvider, quindi usa l'utente "efficace" (doppelgänger).
 */

import { createContext, useContext, useState, useEffect } from 'react'
import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useDebug } from './DebugContext'
import { REPARTO_11N, useReparto } from './RepartoContext'
import type { Reparto } from '../types'

const LS_KEY = 'reparto_vista'

interface MioRepartoCtx {
  mieiReparti:     Reparto[]   // reparti dove l'utente efficace ha un medico attivo
  repartoVista:    string      // reparto scelto per la vista pubblica
  setRepartoVista: (id: string) => void
  loading:         boolean
}

const Ctx = createContext<MioRepartoCtx | null>(null)

export function MioRepartoProvider({ children }: { children: ReactNode }) {
  const { effectiveUser } = useDebug()
  // Sta SOTTO RepartoProvider → può leggere il reparto ATTIVO (admin).
  const { repartoAttivo, setRepartoAttivo, reparti, hasAdminAccess } = useReparto()
  const utenteId = effectiveUser?.id ?? null

  // Reparti dove l'utente efficace è MEDICO attivo (per il visualizzatore puro).
  const { data: mieiRepartiMedico = [], isLoading } = useQuery<Reparto[]>({
    queryKey: ['miei-reparti', utenteId],
    queryFn: async () => {
      if (!utenteId) return []
      const { data, error } = await supabase
        .from('medici')
        .select('reparto:reparti(id, nome, attivo, created_at)')
        .eq('utente_id', utenteId).eq('attivo', true)
      if (error) throw error
      const map = new Map<string, Reparto>()
      for (const row of (data ?? []) as unknown as { reparto: Reparto | null }[]) {
        if (row.reparto) map.set(row.reparto.id, row.reparto)
      }
      return [...map.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'it'))
    },
    enabled: !!utenteId,
    staleTime: 60_000,
  })

  const [repartoVistaState, setStato] = useState<string>(
    () => localStorage.getItem(LS_KEY) || REPARTO_11N,
  )
  function setRepartoVistaState(id: string) {
    localStorage.setItem(LS_KEY, id)
    setStato(id)
  }

  // Fallback SOLO per il visualizzatore puro: se il reparto-vista non è tra i
  // suoi, ripiega sul primo. Gli admin seguono invece repartoAttivo (sotto).
  useEffect(() => {
    if (!hasAdminAccess && mieiRepartiMedico.length &&
        !mieiRepartiMedico.some(r => r.id === repartoVistaState)) {
      setRepartoVistaState(mieiRepartiMedico[0].id)
    }
  }, [mieiRepartiMedico, repartoVistaState, hasAdminAccess])

  // Selezione UNIFICATA per chi ha accesso admin: la vista pubblica SEGUE il
  // reparto attivo → pannello admin e menu in headbar pilotano la STESSA
  // selezione (niente più disallineamento), e il menu elenca i reparti gestiti.
  // Per il visualizzatore puro: stato proprio, limitato ai reparti dove è medico.
  const repartoVista    = hasAdminAccess ? repartoAttivo    : repartoVistaState
  const setRepartoVista = hasAdminAccess ? setRepartoAttivo : setRepartoVistaState
  const mieiReparti     = hasAdminAccess ? reparti          : mieiRepartiMedico

  return (
    <Ctx.Provider value={{ mieiReparti, repartoVista, setRepartoVista, loading: isLoading }}>
      {children}
    </Ctx.Provider>
  )
}

export function useMioReparto() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useMioReparto deve stare dentro <MioRepartoProvider>')
  return c
}
