/**
 * ManutenzionePage
 *
 * Mostrata a TUTTI gli utenti tranne l'admin permanente durante il refactor.
 * Solo lettura: nessun bottone/funzione che scriva sul DB → impossibile
 * danneggiare i dati mentre si lavora alla nuova versione. Mostra il
 * calendario attuale (read-only) + un avviso di manutenzione.
 */

import { useQuery } from '@tanstack/react-query'
import { Wrench, LogOut } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useFestivitaCustom } from '../hooks/useFestivitaCustom'
import { BackupTurniPreview } from '../components/BackupTurniPreview'
import type { Turno, Medico } from '../types'

/** Fetch read-only di TUTTI i turni (paginato: il cap Supabase è 1000/righe). */
async function fetchAllTurni(): Promise<Turno[]> {
  const all: Turno[] = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from('turni').select('*')
      .order('data').range(from, from + PAGE - 1)
    if (error) throw error
    all.push(...((data ?? []) as Turno[]))
    if (!data || data.length < PAGE) break
  }
  return all
}

export function ManutenzionePage({ onSignOut }: { onSignOut: () => void }) {
  const { set: festivitaCustomSet } = useFestivitaCustom()

  const { data: medici = [] } = useQuery<Medico[]>({
    queryKey: ['medici'],
    queryFn: async () => {
      const { data, error } = await supabase.from('medici').select('*')
        .eq('attivo', true).order('numero_ordine')
      if (error) throw error
      return (data ?? []) as Medico[]
    },
    retry: false,
  })

  const { data: turni = [], isLoading, isError } = useQuery<Turno[]>({
    queryKey: ['manutenzione-turni'],
    queryFn: fetchAllTurni,
    retry: false,
    staleTime: Infinity,
  })

  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#f4f1ea' }}>
      {/* Avviso manutenzione */}
      <div className="px-4 py-3 flex items-start gap-3 text-white shadow print:hidden"
        style={{ background: 'linear-gradient(135deg, #7a5a2f 0%, #b07a2f 100%)' }}>
        <Wrench size={22} className="shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="font-bold text-base">Sistema in manutenzione</div>
          <div className="text-sm opacity-95 leading-snug">
            Questo è il calendario <strong>statico</strong> dei turni. Presto tornerà online.
            Ci sto lavorando sodo&nbsp;— abbiate pazienza. 🙏
          </div>
        </div>
        <button onClick={onSignOut}
          className="shrink-0 inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md font-semibold"
          style={{ background: 'rgba(255,255,255,0.2)' }}
          title="Esci">
          <LogOut size={13} /> Esci
        </button>
      </div>

      {/* Calendario in sola lettura — nessuna funzione attiva */}
      <div className="flex-1 overflow-auto p-3">
        {isLoading ? (
          <div className="text-sm text-stone-500 py-12 text-center">Caricamento calendario…</div>
        ) : isError || turni.length === 0 ? (
          <div className="text-sm text-stone-600 py-12 text-center">
            Calendario momentaneamente non disponibile durante la manutenzione.
          </div>
        ) : (
          <BackupTurniPreview turni={turni} medici={medici} festivitaCustomSet={festivitaCustomSet} />
        )}
      </div>
    </div>
  )
}
