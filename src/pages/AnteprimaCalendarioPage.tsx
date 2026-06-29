/**
 * AnteprimaCalendarioPage (pubblica)
 *
 * Mostra ai turnisti (non agli ospiti) la BOZZA di nuova turnazione in
 * attesa di approvazione, in sola lettura, coi cambi bordati di rosso.
 * La produzione (calendario normale) resta invariata finché l'admin non
 * approva.
 */

import { useQuery } from '@tanstack/react-query'
import { CalendarClock, Info } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useTurnazioneAnteprima } from '../hooks/useTurnazioneAnteprima'
import { useFestivitaCustom } from '../hooks/useFestivitaCustom'
import { useMioReparto } from '../contexts/MioRepartoContext'
import { AnteprimaTurnazioneView } from '../components/AnteprimaTurnazioneView'
import type { Medico } from '../types'

export function AnteprimaCalendarioPage() {
  const { repartoVista } = useMioReparto()
  const { set: festivitaCustomSet } = useFestivitaCustom(repartoVista)
  const { data: anteprima, isLoading } = useTurnazioneAnteprima(repartoVista)
  const { data: medici = [] } = useQuery<Medico[]>({
    queryKey: ['medici', repartoVista],
    queryFn: async () => {
      const { data, error } = await supabase.from('medici').select('*')
        .eq('reparto_id', repartoVista).eq('attivo', true)
        .not('numero_ordine', 'is', null).order('numero_ordine')
      if (error) throw error
      return data
    },
  })

  return (
    <div className="flex flex-col p-3 sm:p-4 gap-3"
      style={{ height: 'calc(100dvh - 48px)' }}>
      <h1 className="text-lg font-bold flex items-center gap-2 shrink-0" style={{ color: '#2b3c24' }}>
        <CalendarClock size={20} style={{ color: '#0284c7' }} />
        Anteprima calendario
      </h1>

      {isLoading ? (
        <div className="text-sm text-stone-500 py-10">Caricamento…</div>
      ) : !anteprima ? (
        <div className="rounded-xl border p-6 text-sm text-stone-600"
          style={{ background: '#faf8f3', borderColor: '#d5ccb8' }}>
          Nessuna anteprima disponibile al momento. Quando l'amministratore proporrà una nuova
          turnazione, la vedrai qui prima che diventi ufficiale.
        </div>
      ) : (
        <>
          <div className="rounded-lg p-3 text-xs flex items-start gap-2 shrink-0"
            style={{ background: '#fff7ed', border: '1px solid #fed7aa', color: '#9a3412' }}>
            <Info size={15} className="mt-0.5 shrink-0" />
            <span>
              <strong>Proposta di turnazione in attesa di approvazione.</strong> Questo NON è ancora il
              calendario ufficiale: serve a farti vedere come cambierebbero i turni. Segnala
              all'amministratore se va bene o se ci sono problemi.
            </span>
          </div>
          <div className="flex-1 min-h-0">
            <AnteprimaTurnazioneView turni={anteprima.snapshot?.turni ?? []} meta={anteprima.meta}
              medici={medici} festivitaCustomSet={festivitaCustomSet} fullHeight />
          </div>
        </>
      )}
    </div>
  )
}
