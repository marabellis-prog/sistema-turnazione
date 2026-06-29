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
import { buildFestivoSet } from '../lib/holidays'
import type { FestivitaCustom } from '../types'

export function useFestivitaCustom(repartoId: string) {
  const { data = [], isLoading } = useQuery<FestivitaCustom[]>({
    queryKey: ['festivita-custom', repartoId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('festivita_custom').select('*').eq('reparto_id', repartoId)
        .order('data', { ascending: true })
      if (error) throw error
      return data ?? []
    },
    staleTime: 60_000,   // 1 min — l'admin non le aggiunge di continuo
  })

  // Nazione del reparto → guida le festività nazionali (deduplicata via key).
  const { data: nazione = 'IT' } = useQuery<string>({
    queryKey: ['reparto-nazione', repartoId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('reparti').select('nazione').eq('id', repartoId).maybeSingle()
      if (error) throw error
      return ((data?.nazione as string | null) ?? 'IT')
    },
    staleTime: 5 * 60_000,
  })

  // Set festivo = nazionali (della nazione) su un range ampio di anni + custom.
  // O(1) lookup in isFestivo / generaColonne.
  const set = useMemo(() => {
    const thisYear = new Date().getFullYear()
    const years: number[] = []
    for (let y = thisYear - 2; y <= thisYear + 5; y++) years.push(y)
    return buildFestivoSet(nazione, data.map(f => f.data), years)
  }, [data, nazione])

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
