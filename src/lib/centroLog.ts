// centroLog.ts — helper per il log eventi del Centro di Controllo.
//
// Registra gli eventi importanti del gestionale (creazione/generazione/
// approvazione aggiornamento/ripristino backup/disattivazione/eliminazione
// reparto). Vengono mostrati nel Centro di Controllo (super-admin) e
// sopravvivono alla cancellazione del reparto (nome congelato lato DB).

import { supabase } from './supabase'

export type CentroEventoTipo =
  | 'reparto_creato'
  | 'calendario_generato'
  | 'aggiornamento_approvato'
  | 'backup_ripristinato'
  | 'reparto_disattivato'
  | 'reparto_eliminato'

export interface CentroEvento {
  id: string
  created_at: string
  tipo: CentroEventoTipo
  reparto_id: string | null
  reparto_nome: string
  descrizione: string | null
  autore: string | null
}

/**
 * Registra un evento nel log. NON lancia mai: il fallimento del log non deve
 * mai rompere l'azione principale (generazione, approvazione, ecc.).
 */
export async function registraEventoCentro(
  tipo: CentroEventoTipo,
  repartoId: string | null,
  repartoNome: string,
  descrizione?: string,
): Promise<void> {
  try {
    const { error } = await supabase.rpc('registra_evento_centro', {
      p_tipo:        tipo,
      p_reparto_id:  repartoId,
      p_reparto_nome: repartoNome,
      p_descrizione: descrizione ?? null,
    })
    if (error) console.warn('[centro-log] registrazione fallita:', error.message)
  } catch (e) {
    console.warn('[centro-log] errore registrazione:', (e as Error).message)
  }
}
