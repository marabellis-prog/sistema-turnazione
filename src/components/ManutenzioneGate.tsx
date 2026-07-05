import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Construction } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useReparto } from '../contexts/RepartoContext'
import { useMioReparto } from '../contexts/MioRepartoContext'

/**
 * Gate "in manutenzione" per le VISTE PUBBLICHE.
 *
 * Se il reparto correntemente in vista ha `in_manutenzione = true`, mostra un
 * messaggio a TUTTI tranne: super-admin e responsabili DI QUEL reparto (che
 * devono poter continuare a lavorarci). Il blocco è per-reparto: cambiando
 * reparto dal selettore in NavBar il gate si ricalcola.
 *
 * Query dedicata (poll 20s) → quando l'admin attiva/disattiva dal Centro di
 * Controllo, i turnisti vedono comparire/sparire l'avviso entro pochi secondi.
 */
export function ManutenzioneGate({ children }: { children: ReactNode }) {
  const { isSuperAdmin, reparti } = useReparto()
  const { repartoVista } = useMioReparto()

  const { data } = useQuery<{ in_manutenzione: boolean; nome: string } | null>({
    queryKey: ['reparto-manutenzione', repartoVista],
    enabled: !!repartoVista,
    refetchInterval: 20000,
    queryFn: async () => {
      const { data, error } = await supabase.from('reparti')
        .select('in_manutenzione, nome').eq('id', repartoVista).maybeSingle()
      if (error) throw error
      return data as { in_manutenzione: boolean; nome: string } | null
    },
  })

  // Esenti dal blocco: super-admin e responsabili di QUESTO reparto.
  const esente = isSuperAdmin || reparti.some(r => r.id === repartoVista)

  if (data?.in_manutenzione && !esente) {
    return (
      <div className="flex flex-col items-center justify-center text-center px-6" style={{ minHeight: '60vh' }}>
        <div className="rounded-full p-4 mb-4" style={{ background: '#fef9c3' }}>
          <Construction size={40} style={{ color: '#ca8a04' }} />
        </div>
        <h2 className="text-xl font-bold text-stone-800">Reparto in manutenzione</h2>
        <p className="text-stone-600 mt-2 max-w-md">
          Il calendario di <strong>{data.nome}</strong> è temporaneamente{' '}
          <strong>in manutenzione</strong>. Riprova più tardi. Se sei turnista di un
          altro reparto, puoi selezionarlo dal menu in alto.
        </p>
      </div>
    )
  }

  return <>{children}</>
}
