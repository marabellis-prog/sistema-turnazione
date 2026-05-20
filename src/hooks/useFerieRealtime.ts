/**
 * useFerieRealtime
 *
 * Sottoscrive ai cambiamenti sulla tabella `ferie` via Supabase Realtime
 * (WebSocket). Ogni INSERT/UPDATE/DELETE invalida le cache di React Query
 * relative alle ferie → tutte le pagine che le visualizzano
 * (CalendarioPage, ModificaTurniPage, GestioneFeriePage) si aggiornano
 * istantaneamente.
 *
 * Setup richiesto su Supabase (UNA VOLTA, da SQL Editor):
 *   ALTER PUBLICATION supabase_realtime ADD TABLE public.ferie;
 *
 * Senza il setup il listener si registra (returna SUBSCRIBED) ma non
 * riceve eventi. Il polling di 15s nelle singole useQuery è la safety
 * net per quel caso.
 */

import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

export function useFerieRealtime() {
  const qc = useQueryClient()
  const [realtimeOn, setRealtimeOn] = useState(false)

  useEffect(() => {
    // Channel name unique-ish per evitare collisioni se più pagine usano
    // l'hook contemporaneamente nella stessa sessione browser. Math.random
    // è sufficiente per il PoP e non serve crittograficamente sicuro.
    const channel = supabase
      .channel(`ferie-watch-${Math.random().toString(36).slice(2, 8)}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'ferie' },
        () => {
          qc.invalidateQueries({ queryKey: ['ferie'] })
          qc.invalidateQueries({ queryKey: ['ferie-ranges'] })
          // Count ferie pending per il badge "Ferie da approvare"
          // nell'AdminLayout sidebar — deve aggiornarsi in realtime
          // quando un user richiede o un admin approva.
          qc.invalidateQueries({ queryKey: ['ferie-pending-count'] })
          // Badge "posta" della NavBar conta anche ferie pending del
          // medico loggato → invalida cosi` il numerello sale subito
          // quando uno user inserisce una richiesta di ferie.
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
