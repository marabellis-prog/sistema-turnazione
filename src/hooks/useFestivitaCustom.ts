/**
 * useFestivitaCustom + useFestivitaCustomRealtime
 *
 * Helper centralizzati per leggere le festività custom (configurate
 * dall'admin in /admin/config) e tenerle aggiornate in realtime.
 *
 * - `useFestivitaCustom()` ritorna l'array + un Set di date ISO per il
 *   passaggio a `isFestivo(date, customSet)` / `generaColonne(cfg, customSet)`.
 * - `useFestivitaCustomRealtime()` subscriber al postgres_changes della
 *   tabella e invalida le query relative (e quelle che dipendono dalle
 *   colonne calendario, perche` un cambio di festivita` cambia il flag
 *   isFestivo di una colonna).
 */

import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { FestivitaCustom } from '../types'

export function useFestivitaCustom() {
  const { data = [], isLoading } = useQuery<FestivitaCustom[]>({
    queryKey: ['festivita-custom'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('festivita_custom').select('*')
        .order('data', { ascending: true })
      if (error) throw error
      return data ?? []
    },
    staleTime: 60_000,   // 1 min — l'admin non le aggiunge di continuo
  })

  // Set di stringhe ISO per O(1) lookup in isFestivo / generaColonne
  const set = useMemo(() => new Set(data.map(f => f.data)), [data])

  return { festivita: data, set, isLoading }
}

export function useFestivitaCustomRealtime() {
  const qc = useQueryClient()
  const [realtimeOn, setRealtimeOn] = useState(false)

  useEffect(() => {
    const channel = supabase
      .channel(`festivita-custom-watch-${Math.random().toString(36).slice(2, 8)}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'festivita_custom' },
        () => {
          qc.invalidateQueries({ queryKey: ['festivita-custom'] })
        },
      )
      .subscribe(status => {
        setRealtimeOn(status === 'SUBSCRIBED')
      })

    return () => { supabase.removeChannel(channel) }
  }, [qc])

  return { realtimeOn }
}
