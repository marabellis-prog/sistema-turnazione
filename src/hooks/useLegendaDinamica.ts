import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { REPARTO_11N } from '../contexts/RepartoContext'

export interface TipoTurnoLegenda { sigla: string; nome: string; colore_bg: string; colore_fg: string; is_reperibilita: boolean }
export interface ProprietaLegenda { sigla: string; nome: string; colore_bg: string }

/**
 * Legenda DINAMICA di un reparto: restituisce i tipi di turno e le proprietà
 * EFFETTIVAMENTE messi nella struttura dello schema attivo (`schema_colonna`),
 * nell'ordine delle colonne — così una proprietà configurata ma non usata
 * (es. Supporto) non compare. Stessa logica di ModificaTurni, condivisa dalle
 * viste pubbliche (Calendario, Settimanale, Settimanale Alt).
 *
 * Per 11N (classico) `repartoDinamico=false` e le liste sono vuote → il
 * chiamante passa `undefined` a `<LegendaCalendario>` e ottiene la legenda
 * classica hardcoded.
 *
 * Uso:
 *   const { repartoDinamico, tipiTurno, proprieta } = useLegendaDinamica(repartoId, schemaNum)
 *   <LegendaCalendario tipiTurno={repartoDinamico ? tipiTurno : undefined}
 *                       proprieta={repartoDinamico ? proprieta : undefined} />
 */
export function useLegendaDinamica(
  repartoId: string | null | undefined,
  schemaNum: number | null | undefined,
): { repartoDinamico: boolean; tipiTurno: TipoTurnoLegenda[]; proprieta: ProprietaLegenda[] } {
  const repartoDinamico = !!repartoId && repartoId !== REPARTO_11N
  const schema = schemaNum ?? 1
  const enabled = repartoDinamico && schemaNum != null

  const { data: tipiTurnoDin = [] } = useQuery({
    queryKey: ['legdin-tipiturno', repartoId, schema],
    enabled,
    staleTime: 0, refetchOnMount: 'always',
    queryFn: async () => {
      const { data, error } = await supabase.from('tipi_turno')
        .select('sigla, nome, colore_bg, colore_fg, is_reperibilita, ordine')
        .eq('reparto_id', repartoId as string).eq('schema_num', schema)
      if (error) throw error
      return (data ?? []) as (TipoTurnoLegenda & { ordine: number })[]
    },
  })
  const { data: proprietaDin = [] } = useQuery({
    queryKey: ['legdin-proprieta', repartoId, schema],
    enabled,
    staleTime: 0, refetchOnMount: 'always',
    queryFn: async () => {
      const { data, error } = await supabase.from('proprieta_turno')
        .select('sigla, nome, colore_bg, ordine')
        .eq('reparto_id', repartoId as string).eq('schema_num', schema)
      if (error) throw error
      return (data ?? []) as (ProprietaLegenda & { ordine: number })[]
    },
  })
  // Colonne EFFETTIVAMENTE messe nella tabella (schema_colonna): la legenda
  // mostra solo queste, nel loro ordine.
  const { data: schemaColonneDin = [] } = useQuery({
    queryKey: ['legdin-colonne', repartoId, schema],
    enabled,
    staleTime: 0, refetchOnMount: 'always',
    queryFn: async () => {
      const { data, error } = await supabase.from('schema_colonna')
        .select('tipo, sigla, ordine')
        .eq('reparto_id', repartoId as string).eq('schema_num', schema)
      if (error) throw error
      return (data ?? []) as { tipo: 'turno' | 'flag'; sigla: string; ordine: number }[]
    },
  })

  const tipiTurno = useMemo(() => {
    const by = new Map(tipiTurnoDin.map(t => [t.sigla, t]))
    return schemaColonneDin.filter(c => c.tipo === 'turno').sort((a, b) => a.ordine - b.ordine)
      .map(c => by.get(c.sigla)).filter((t): t is (TipoTurnoLegenda & { ordine: number }) => !!t)
  }, [schemaColonneDin, tipiTurnoDin])
  const proprieta = useMemo(() => {
    const by = new Map(proprietaDin.map(p => [p.sigla, p]))
    return schemaColonneDin.filter(c => c.tipo === 'flag').sort((a, b) => a.ordine - b.ordine)
      .map(c => by.get(c.sigla)).filter((p): p is (ProprietaLegenda & { ordine: number }) => !!p)
  }, [schemaColonneDin, proprietaDin])

  return { repartoDinamico, tipiTurno, proprieta }
}
