/**
 * useMessaggiRealtime
 *
 * Sottoscrive ai cambiamenti sulla tabella `messaggi` via Supabase
 * Realtime (WebSocket). Su ogni INSERT/UPDATE/DELETE:
 *   1) invalida le query React ['messaggi', ...] e ['messaggi-unread-count'],
 *      cosi` la casella di posta + il badge in NavBar si aggiornano sui
 *      tutti i client connessi (incluso il medico interessato);
 *   2) sugli INSERT lancia un CustomEvent('messaggio-nuovo') sul `window`
 *      con il payload del nuovo messaggio. La NavBar ascolta questo
 *      evento per mostrare un toast pop-up al volo.
 *
 * Le policy RLS garantiscono che ogni client riceva via realtime SOLO i
 * messaggi indirizzati a lui (medico_id = my_medico_id()) o tutti se admin.
 * Quindi nessun filtro client-side aggiuntivo serve per evitare leak.
 *
 * Setup richiesto su Supabase (gia` fatto nella migration 004):
 *   ALTER PUBLICATION supabase_realtime ADD TABLE public.messaggi;
 */

import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { Messaggio } from '../types'

export function useMessaggiRealtime() {
  const qc = useQueryClient()
  const [realtimeOn, setRealtimeOn] = useState(false)

  useEffect(() => {
    const channel = supabase
      .channel(`messaggi-watch-${Math.random().toString(36).slice(2, 8)}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'messaggi' },
        (payload) => {
          qc.invalidateQueries({ queryKey: ['messaggi'] })
          qc.invalidateQueries({ queryKey: ['messaggi-unread-count'] })
          // Toast pop-up: dispatch CustomEvent per la NavBar
          if (payload.eventType === 'INSERT') {
            const m = payload.new as Messaggio
            window.dispatchEvent(new CustomEvent<Messaggio>('messaggio-nuovo', {
              detail: m,
            }))
          }
        }
      )
      .subscribe(status => {
        setRealtimeOn(status === 'SUBSCRIBED')
      })

    return () => { supabase.removeChannel(channel) }
  }, [qc])

  return { realtimeOn }
}
