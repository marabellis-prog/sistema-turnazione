import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { REPARTO_11N } from '../contexts/RepartoContext'

/**
 * Restituisce una funzione che formatta uno schema come **"Nome (Schema N)"**
 * (titolo da `schema_meta`). Per 11N (classico, senza titolo) o titolo mancante
 * → "Schema N". Legge sempre fresco (staleTime 0 + refetchOnMount) così rinomine
 * e nuovi schemi si vedono subito senza restare in cache.
 *
 * Uso: `const labelSchema = useSchemaLabeler(repartoId); labelSchema(schemaNum)`.
 */
export function useSchemaLabeler(
  repartoId: string | null | undefined,
): (schemaNum: number | null | undefined) => string {
  const { data: titoli } = useQuery({
    queryKey: ['schemi-titoli', repartoId],
    enabled: !!repartoId && repartoId !== REPARTO_11N,
    staleTime: 0,
    refetchOnMount: 'always',
    queryFn: async () => {
      const { data, error } = await supabase.from('schema_meta')
        .select('schema_num, titolo').eq('reparto_id', repartoId as string)
      if (error) throw error
      const m = new Map<number, string>()
      for (const r of data ?? []) if (r.titolo) m.set(r.schema_num as number, r.titolo as string)
      return m
    },
  })
  return (schemaNum) => {
    if (schemaNum == null) return '—'
    const t = titoli?.get(schemaNum)
    if (!repartoId || repartoId === REPARTO_11N || !t) return `Schema ${schemaNum}`
    return `${t} (Schema ${schemaNum})`
  }
}
