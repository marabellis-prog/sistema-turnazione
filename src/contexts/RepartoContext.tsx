/**
 * RepartoContext
 *
 * Contesto del REPARTO ATTIVO. Il gestionale e' multi-reparto: admin e
 * responsabili scelgono su quale reparto stanno lavorando; tutte le funzioni
 * per-reparto (Turnisti, Schema, Genera, Anteprima, Cambi, Backup) leggono il
 * reparto da qui. La scelta e' persistita in localStorage.
 */

import { createContext, useContext, useState, useEffect } from 'react'
import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { Reparto } from '../types'

/** Id fisso del reparto seed "11N" (dati storici). */
export const REPARTO_11N = '11111111-1111-4111-8111-111111111111'
const LS_KEY = 'reparto_attivo'

interface RepartoCtx {
  reparti:          Reparto[]
  repartoAttivo:    string
  setRepartoAttivo: (id: string) => void
  repartoCorrente:  Reparto | undefined
  loading:          boolean
}

const Ctx = createContext<RepartoCtx | null>(null)

export function RepartoProvider({ children }: { children: ReactNode }) {
  const { data: reparti = [], isLoading } = useQuery<Reparto[]>({
    queryKey: ['reparti'],
    queryFn: async () => {
      const { data, error } = await supabase.from('reparti').select('*')
        .order('attivo', { ascending: false }).order('nome')
      if (error) throw error
      return (data ?? []) as Reparto[]
    },
    staleTime: 60_000,
  })

  const [repartoAttivo, setStato] = useState<string>(
    () => localStorage.getItem(LS_KEY) || REPARTO_11N,
  )
  function setRepartoAttivo(id: string) {
    localStorage.setItem(LS_KEY, id)
    setStato(id)
  }

  // Se il reparto salvato non esiste piu' (cancellato), fallback al primo.
  useEffect(() => {
    if (reparti.length && !reparti.some(r => r.id === repartoAttivo)) {
      setRepartoAttivo(reparti[0].id)
    }
  }, [reparti, repartoAttivo])

  const repartoCorrente = reparti.find(r => r.id === repartoAttivo)

  return (
    <Ctx.Provider value={{ reparti, repartoAttivo, setRepartoAttivo, repartoCorrente, loading: isLoading }}>
      {children}
    </Ctx.Provider>
  )
}

export function useReparto() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useReparto deve stare dentro <RepartoProvider>')
  return c
}
