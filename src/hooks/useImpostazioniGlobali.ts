/**
 * useImpostazioniGlobali
 *
 * Legge la riga singleton `impostazioni_globali` (policy backup centrale,
 * decisa dal super-admin in Centro di Controllo). Non è per-reparto.
 */

import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { ImpostazioniGlobali } from '../types'

export function useImpostazioniGlobali() {
  return useQuery<ImpostazioniGlobali | null>({
    queryKey: ['impostazioni-globali'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('impostazioni_globali').select('*').limit(1).maybeSingle()
      if (error) throw error
      return data as ImpostazioniGlobali | null
    },
    staleTime: 60_000,
  })
}
