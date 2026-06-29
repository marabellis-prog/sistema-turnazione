import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useReparto } from '../contexts/RepartoContext'
import type { Configurazione } from '../types'

/**
 * Configurazione (l'ultima) del REPARTO ATTIVO.
 *
 * Scoping per-reparto: ogni reparto ha la sua configurazione. Sostituisce le
 * letture inline "ultima configurazione" sparse nelle pagine admin, con una
 * query-key scopata `['configurazione', repartoAttivo]` (così reparti diversi
 * non si pestano la cache) e il filtro `.eq('reparto_id', repartoAttivo)`.
 *
 * No-op per 11N: tutta la configurazione attuale è già su 11N.
 *
 * NB: gli UPDATE delle impostazioni restano `.eq('id', config.id)` nelle
 * pagine — corretti perché `config.id` arriva da questa lettura già scopata.
 */
export function useConfigReparto() {
  const { repartoAttivo } = useReparto()
  return useQuery<Configurazione | null>({
    queryKey: ['configurazione', repartoAttivo],
    queryFn: async () => {
      const { data, error } = await supabase.from('configurazione')
        .select('*').eq('reparto_id', repartoAttivo)
        .order('updated_at', { ascending: false }).limit(1).maybeSingle()
      if (error) throw error
      return data
    },
  })
}
