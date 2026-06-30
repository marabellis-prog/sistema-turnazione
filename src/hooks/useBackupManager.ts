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
import type { Turno } from '../types'

const CHUNK = 500   // batch size per INSERT bulk in restore (PostgREST limit)

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

// ── Restore: applica il backup ────────────────────────────────────────
// Strategia:
//   1. Crea AUTO-BACKUP pre-ripristino (safety net)
//   2. Leggi snapshot del backup richiesto
//   3. DELETE all turni
//   4. INSERT bulk in chunks da CHUNK righe (limit PostgREST payload)
//
// Non e` atomico (transazione DB) ma in caso di fallimento allo step 3-4
// l'admin puo` ripristinare dall'auto-backup creato allo step 1.
export async function restoreBackup(repartoId: string, backupId: string): Promise<{
  inserted: number; preBackupId: string
}> {
  // 1) Crea backup pre-ripristino (solo del reparto)
  const pre = await createBackup(
    repartoId,
    `Auto pre-ripristino del ${new Date().toLocaleString('it-IT')}`
  )

  // 2) Leggi snapshot del backup richiesto
  const { data: bk, error: fetchErr } = await supabase.from('turni_backup')
    .select('snapshot').eq('id', backupId).single()
  if (fetchErr) throw fetchErr
  const snapshot = (bk as { snapshot: { turni: Turno[] } }).snapshot
  const turniFromBk = snapshot?.turni ?? []

  // 3) DELETE dei soli turni DEL REPARTO (NON tocca gli altri reparti, 11N
  //    incluso: un ripristino di un reparto è isolato).
  const { error: delErr } = await supabase.from('turni')
    .delete().eq('reparto_id', repartoId)
  if (delErr) throw delErr

  // 4) INSERT bulk in chunks, forzando il reparto corretto sui turni.
  let inserted = 0
  for (let i = 0; i < turniFromBk.length; i += CHUNK) {
    const chunk = turniFromBk.slice(i, i + CHUNK).map(t => {
      const r = { ...(t as unknown as Record<string, unknown>) }
      delete r.id; delete r.created_at; delete r.updated_at
      r.reparto_id = repartoId
      return r
    })
    const { error: insErr } = await supabase.from('turni').insert(chunk)
    if (insErr) throw insErr
    inserted += chunk.length
  }
  return { inserted, preBackupId: pre.id }
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
