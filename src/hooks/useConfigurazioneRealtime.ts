/**
 * useConfigurazioneRealtime
 *
 * Sottoscrive ai cambiamenti sulla tabella `configurazione` via Supabase
 * Realtime (WebSocket). Quando un admin modifica un parametro (es. il
 * flag `autocalc_sub_med`, anno/mese del periodo, schema_attivo,
 * max_ferie_concomitanti) tutti gli altri admin connessi vedono il
 * nuovo valore istantaneamente — niente bisogno di refresh.
 *
 * Strategia: ogni evento postgres_changes invalida la query
 * `['configurazione']` → React Query rifetcha e i componenti che la
 * usano si rendono di nuovo col valore aggiornato.
 *
 * Setup richiesto su Supabase (UNA VOLTA, già applicato):
 *   ALTER PUBLICATION supabase_realtime ADD TABLE public.configurazione;
 */

import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

export function useConfigurazioneRealtime() {
  const qc = useQueryClient()
  const [realtimeOn, setRealtimeOn] = useState(false)

  useEffect(() => {
    const channel = supabase
      .channel(`config-watch-${Math.random().toString(36).slice(2, 8)}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'configurazione' },
        () => {
          qc.invalidateQueries({ queryKey: ['configurazione'] })
        },
      )
      .subscribe(status => {
        setRealtimeOn(status === 'SUBSCRIBED')
      })

    return () => { supabase.removeChannel(channel) }
  }, [qc])

  return { realtimeOn }
}
