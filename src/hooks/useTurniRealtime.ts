/**
 * useTurniRealtime
 *
 * Sottoscrive ai cambiamenti sulla tabella `turni` via Supabase Realtime
 * (WebSocket). Quando l'admin modifica un turno in ModificaTurniPage o
 * GeneraCalendarioPage rigenera tutto, le altre tab/utenti vedono il
 * cambiamento istantaneamente sul calendario pubblico, su Modifica Turni
 * stesso e su qualsiasi vista che mostri i turni.
 *
 * Setup richiesto su Supabase (UNA VOLTA, da SQL Editor):
 *   ALTER PUBLICATION supabase_realtime ADD TABLE public.turni;
 *
 * Senza il setup il listener si registra (returna SUBSCRIBED) ma non
 * riceve eventi.
 *
 * Differenza con useFerieRealtime:
 * - I turni sono molti (~migliaia) e gli upsert in ModificaTurniPage
 *   possono produrre N eventi consecutivi (uno per riga modificata).
 *   Per evitare N fetch a raffica, applichiamo un debounce 500ms: dopo
 *   l'ultimo evento aspettiamo mezzo secondo e poi facciamo UN solo
 *   invalidate + UN onChange.
 * - Il `onChange` opzionale serve per CalendarioPage che NON usa
 *   useQuery per i turni ma un fetch manuale per mese: deve poter
 *   richiamare `caricaTurni()` al cambio.
 */

import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

interface UseTurniRealtimeOpts {
  /** Chiamato dopo il debounce, in aggiunta all'invalidateQueries */
  onChange?: () => void
}

export function useTurniRealtime(opts: UseTurniRealtimeOpts = {}) {
  const qc = useQueryClient()
  const [realtimeOn, setRealtimeOn] = useState(false)

  // Ref sempre aggiornata al callback più recente, così non dobbiamo
  // riscriversi l'effect a ogni render del chiamante.
  const onChangeRef = useRef(opts.onChange)
  onChangeRef.current = opts.onChange

  useEffect(() => {
    let debounceId: number | null = null

    const fire = () => {
      if (debounceId !== null) clearTimeout(debounceId)
      debounceId = window.setTimeout(() => {
        debounceId = null
        qc.invalidateQueries({ queryKey: ['turni'] })
        qc.invalidateQueries({ queryKey: ['turni-modifica'] })
        onChangeRef.current?.()
      }, 500)
    }

    const channel = supabase
      .channel(`turni-watch-${Math.random().toString(36).slice(2, 8)}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'turni' },
        fire,
      )
      .subscribe(status => {
        setRealtimeOn(status === 'SUBSCRIBED')
      })

    return () => {
      if (debounceId !== null) clearTimeout(debounceId)
      supabase.removeChannel(channel)
    }
  }, [qc])

  return { realtimeOn }
}
