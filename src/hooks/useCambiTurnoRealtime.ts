/**
 * useCambiTurnoRealtime
 *
 * Sottoscrive ai cambiamenti sulla tabella `cambi_turno` via Supabase
 * Realtime (WebSocket). Ogni INSERT/UPDATE/DELETE invalida le cache di
 * React Query relative ai cambi turno → tutte le pagine che li
 * visualizzano (GestioneCambiPage, eventuali badge sidebar) si
 * aggiornano istantaneamente.
 *
 * Setup richiesto su Supabase (gia` fatto nella migration 003):
 *   ALTER PUBLICATION supabase_realtime ADD TABLE public.cambi_turno;
 *
 * Senza il setup il listener si registra (returna SUBSCRIBED) ma non
 * riceve eventi. Il polling 30s nelle singole useQuery e` la safety net.
 */

import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

export function useCambiTurnoRealtime() {
  const qc = useQueryClient()
  const [realtimeOn, setRealtimeOn] = useState(false)

  useEffect(() => {
    const channel = supabase
      .channel(`cambi-turno-watch-${Math.random().toString(36).slice(2, 8)}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'cambi_turno' },
        () => {
          qc.invalidateQueries({ queryKey: ['cambi-turno'] })
          qc.invalidateQueries({ queryKey: ['cambi-turno-pending-count'] })
          // Badge "posta" della NavBar conta anche i cambi turno pending
          // del medico richiedente → invalida cosi` il numerello sale
          // subito quando uno user inserisce una richiesta di cambio.
          qc.invalidateQueries({ queryKey: ['messaggi-unread-count'] })
        }
      )
      .subscribe(status => {
        setRealtimeOn(status === 'SUBSCRIBED')
      })

    return () => { supabase.removeChannel(channel) }
  }, [qc])

  return { realtimeOn }
}
