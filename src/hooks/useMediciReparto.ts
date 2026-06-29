import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useReparto } from '../contexts/RepartoContext'
import type { Medico } from '../types'

/**
 * Turnisti ATTIVI del REPARTO ATTIVO, in ordine di rotazione (numero_ordine).
 *
 * Scoping per-reparto con query-key `['medici', repartoAttivo]`: le
 * invalidazioni "broad" `['medici']` sparse nell'app la coprono per prefisso,
 * quindi resta coerente con la cache esistente. No-op per 11N (tutti i medici
 * attuali sono su 11N).
 */
export function useMediciReparto() {
  const { repartoAttivo } = useReparto()
  return useQuery<Medico[]>({
    queryKey: ['medici', repartoAttivo],
    queryFn: async () => {
      const { data, error } = await supabase.from('medici').select('*')
        .eq('reparto_id', repartoAttivo).eq('attivo', true)
        .not('numero_ordine', 'is', null).order('numero_ordine')
      if (error) throw error
      return data ?? []
    },
  })
}
