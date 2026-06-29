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
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { ImpostazioniGlobali, Turno, TurnoBackup } from '../types'

const CHUNK = 500   // batch size per INSERT bulk in restore (PostgREST limit)

// ── Helper: snapshot dei turni di UN REPARTO in un nuovo record backup ────
export async function createBackup(repartoId: string, descrizione: string): Promise<TurnoBackup> {
  // Snapshot dei soli turni del reparto indicato (backup per-reparto).
  const all: Turno[] = []
  let offset = 0
  const PAGE = 1000
  while (true) {
    const { data, error } = await supabase.from('turni').select('*')
      .eq('reparto_id', repartoId)
      .order('data').range(offset, offset + PAGE - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    all.push(...data as Turno[])
    if (data.length < PAGE) break
    offset += PAGE
  }

  // Insert nel turni_backup (taggato col reparto)
  const { data: inserted, error: insErr } = await supabase.from('turni_backup')
    .insert({
      reparto_id: repartoId,
      descrizione,
      num_turni: all.length,
      snapshot:  { turni: all },
    })
    .select()
    .single()
  if (insErr) throw insErr
  return inserted as TurnoBackup
}

// ── Rotazione: mantieni solo gli ultimi N backup DEL REPARTO ─────────
export async function ruotaBackup(repartoId: string, daTenere: number): Promise<number> {
  if (daTenere < 1) return 0
  const { data: list, error } = await supabase.from('turni_backup')
    .select('id').eq('reparto_id', repartoId).order('created_at', { ascending: false })
  if (error) throw error
  if (!list || list.length <= daTenere) return 0
  const toDelete = list.slice(daTenere).map(x => x.id)
  const { error: delErr } = await supabase.from('turni_backup')
    .delete().in('id', toDelete)
  if (delErr) throw delErr
  return toDelete.length
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

// ── Hook auto-backup (chiamato da AdminLayout al mount) ──────────────
// Controlla la data dell'ultimo backup; se piu` vecchia dell'intervallo
// configurato (`configurazione.backup_intervallo_giorni`), crea un
// auto-backup e applica la rotazione. Usa una ref per evitare doppi
// trigger in caso di Strict Mode o re-mount.
export function useAutoBackup(repartoId: string) {
  const qc = useQueryClient()
  const triggered = useRef<string | null>(null)

  // Policy GLOBALE (intervallo + retention): impostata in Centro di Controllo.
  const { data: policy } = useQuery<ImpostazioniGlobali | null>({
    queryKey: ['impostazioni-globali'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('impostazioni_globali').select('*').limit(1).maybeSingle()
      if (error) throw error
      return data as ImpostazioniGlobali | null
    },
    staleTime: 60_000,
  })

  // Ultimo backup DI QUESTO REPARTO. `isFetched` evita un backup spurio
  // mentre la query è ancora in loading (data === undefined).
  const { data: lastBackup, isFetched: backupFetched } = useQuery<TurnoBackup | null>({
    queryKey: ['turni-backup', 'latest', repartoId],
    queryFn: async () => {
      const { data, error } = await supabase.from('turni_backup')
        .select('id, created_at, descrizione, num_turni')
        .eq('reparto_id', repartoId)
        .order('created_at', { ascending: false })
        .limit(1).maybeSingle()
      if (error) throw error
      return data as TurnoBackup | null
    },
    staleTime: 5 * 60_000,
  })

  useEffect(() => {
    // Riarma quando cambia il reparto attivo (un auto-backup per reparto).
    if (triggered.current === repartoId) return
    if (!policy) return
    if (!backupFetched) return
    if (lastBackup === undefined) return

    const interval = policy.backup_intervallo_giorni ?? 7
    if (interval <= 0) return    // 0 = disattiva auto-backup
    const retention = policy.backup_da_tenere ?? 10

    let serve = false
    if (lastBackup === null) {
      serve = true
    } else {
      const diffDays = (Date.now() - new Date(lastBackup.created_at).getTime()) / (1000 * 60 * 60 * 24)
      if (diffDays >= interval) serve = true
    }
    if (!serve) return

    triggered.current = repartoId
    ;(async () => {
      try {
        const descr = `Auto-backup ${new Date().toLocaleString('it-IT', {
          day: '2-digit', month: '2-digit', year: 'numeric',
          hour: '2-digit', minute: '2-digit',
        })}`
        await createBackup(repartoId, descr)
        await ruotaBackup(repartoId, retention)
        qc.invalidateQueries({ queryKey: ['turni-backup'] })
      } catch (e) {
        console.error('[autoBackup]', (e as Error).message)
      }
    })()
  }, [policy, lastBackup, backupFetched, qc, repartoId])
}
