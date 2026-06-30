/**
 * useBackupManager
 *
 * Helper centralizzati per le operazioni di backup/ripristino dei turni:
 *
 * - `createBackup(descrizione)`: snapshot di TUTTI i turni in un record
 *   `turni_backup`. Dopo il backup, rotazione automatica se il numero di
 *   backup supera `configurazione.backup_da_tenere`.
 *
 * - `restoreBackup(backupId)`: ripristina i turni dallo snapshot del
 *   backup richiesto. Prima crea un backup "pre-ripristino" come safety
 *   net, poi DELETE + INSERT bulk dei turni dal JSONB.
 *
 * - `deleteBackup(backupId)`: rimuove un singolo backup.
 *
 * - `useAutoBackup()`: hook React da montare in AdminLayout. Al mount
 *   verifica se l'ultimo backup e` piu` vecchio di `intervallo_giorni`;
 *   se si`, crea un auto-backup con descrizione "Auto-backup ...".
 *
 * Tutte le operazioni richiedono privilegi admin (verificati dalla RLS
 * tb_modify che usa is_admin()).
 */

import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

// ── Backup di UN REPARTO — snapshot SERVER-SIDE (RPC backup_reparto) ───────
// Il database fa snapshot + rotazione (impostazioni_globali.backup_da_tenere)
// in un'unica operazione: immune a cambio pagina / tab chiuso / concorrenza.
export async function createBackup(repartoId: string, descrizione: string): Promise<{ id: string; num_turni: number }> {
  const { data, error } = await supabase.rpc('backup_reparto', {
    p_reparto_id: repartoId, p_descrizione: descrizione,
  })
  if (error) throw error
  return (data ?? { id: '', num_turni: 0 }) as { id: string; num_turni: number }
}

// Deprecata: la rotazione ora la fa il server dentro backup_reparto. No-op.
export async function ruotaBackup(_repartoId: string, _daTenere: number): Promise<number> {
  return 0
}

// ── Restore SERVER-SIDE e ATOMICO (RPC ripristina_reparto) ────────────────
// Il database, in un'unica transazione: crea un backup pre-ripristino, poi
// sostituisce TUTTO il reparto (config, turnisti, turni, ferie, cambi,
// festività, schemi…) con lo snapshot. O tutto o niente. Retrocompatibile coi
// vecchi backup "solo turni". Non tocca gli altri reparti (11N incluso).
export async function restoreBackup(backupId: string): Promise<{
  inserted: number; completo: boolean
}> {
  const { data, error } = await supabase.rpc('ripristina_reparto', { p_backup_id: backupId })
  if (error) throw error
  const r = (data ?? {}) as { turni?: number; completo?: boolean }
  return { inserted: r.turni ?? 0, completo: !!r.completo }
}

// ── Delete single backup ─────────────────────────────────────────────
export async function deleteBackup(backupId: string): Promise<void> {
  const { error } = await supabase.from('turni_backup').delete().eq('id', backupId)
  if (error) throw error
}

// ── Hook auto-backup (montato in AdminLayout) ────────────────────────
// Fire-and-forget: chiama la RPC `auto_backup_reparto`, che lato SERVER fa
// il due-check (policy globale) + snapshot + rotazione, in modo atomico e
// idempotente. Il browser non aspetta: il backup completa nel database anche
// se l'utente cambia pagina/reparto o chiude il tab. La garanzia "comunque
// eseguito" è data dal cron giornaliero `auto_backup_tutti` (migr. 033).
export function useAutoBackup(repartoId: string) {
  const qc = useQueryClient()
  const triggered = useRef<string | null>(null)

  useEffect(() => {
    if (!repartoId || triggered.current === repartoId) return
    triggered.current = repartoId
    supabase.rpc('auto_backup_reparto', { p_reparto_id: repartoId })
      .then(({ error }) => {
        if (error) { console.error('[autoBackup]', error.message); return }
        qc.invalidateQueries({ queryKey: ['turni-backup'] })
      })
  }, [repartoId, qc])
}
