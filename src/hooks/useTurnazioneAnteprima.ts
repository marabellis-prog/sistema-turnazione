/**
 * useTurnazioneAnteprima
 *
 * Carica la bozza di turnazione attiva (l'ultima riga di
 * `turnazione_anteprima`, o null se nessuna) con aggiornamento realtime
 * (così il badge "anteprima disponibile" in NavBar e le pagine si
 * aggiornano quando l'admin crea/approva/scarta una bozza).
 */

import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { TurnazioneAnteprima } from '../types'

export function useTurnazioneAnteprima(repartoId: string) {
  const qc = useQueryClient()

  useEffect(() => {
    const ch = supabase
      .channel(`anteprima-watch-${Math.random().toString(36).slice(2, 8)}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'turnazione_anteprima' },
        () => qc.invalidateQueries({ queryKey: ['turnazione-anteprima'] }),
      )
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [qc])

  // Bozza del REPARTO indicato (ogni reparto ha la sua). Il prefisso
  // ['turnazione-anteprima'] dell'invalidate realtime copre la chiave scoped.
  return useQuery<TurnazioneAnteprima | null>({
    queryKey: ['turnazione-anteprima', repartoId],
    queryFn: async () => {
      const { data, error } = await supabase.from('turnazione_anteprima')
        .select('*').eq('reparto_id', repartoId)
        .order('created_at', { ascending: false }).limit(1).maybeSingle()
      if (error) throw error
      return (data as TurnazioneAnteprima | null) ?? null
    },
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
  })
}
