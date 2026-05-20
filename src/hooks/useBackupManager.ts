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
import type { Configurazione, Turno, TurnoBackup } from '../types'

const CHUNK = 500   // batch size per INSERT bulk in restore (PostgREST limit)

// ── Helper: snapshot dei turni correnti in un nuovo record backup ────
export async function createBackup(descrizione: string): Promise<TurnoBackup> {
  // Fetch tutti i turni del DB (no filtri: l'idea e` uno snapshot completo)
  const all: Turno[] = []
  let offset = 0
  const PAGE = 1000
  while (true) {
    const { data, error } = await supabase.from('turni').select('*')
      .order('data').range(offset, offset + PAGE - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    all.push(...data as Turno[])
    if (data.length < PAGE) break
    offset += PAGE
  }

  // Insert nel turni_backup
  const { data: inserted, error: insErr } = await supabase.from('turni_backup')
    .insert({
      descrizione,
      num_turni: all.length,
      snapshot:  { turni: all },
    })
    .select()
    .single()
  if (insErr) throw insErr
  return inserted as TurnoBackup
}

// ── Rotazione: mantieni solo gli ultimi N backup ─────────────────────
export async function ruotaBackup(daTenere: number): Promise<number> {
  if (daTenere < 1) return 0
  const { data: list, error } = await supabase.from('turni_backup')
    .select('id').order('created_at', { ascending: false })
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
export async function restoreBackup(backupId: string): Promise<{
  inserted: number; preBackupId: string
}> {
  // 1) Crea backup pre-ripristino
  const pre = await createBackup(
    `Auto pre-ripristino del ${new Date().toLocaleString('it-IT')}`
  )

  // 2) Leggi snapshot del backup richiesto
  const { data: bk, error: fetchErr } = await supabase.from('turni_backup')
    .select('snapshot').eq('id', backupId).single()
  if (fetchErr) throw fetchErr
  const snapshot = (bk as { snapshot: { turni: Turno[] } }).snapshot
  const turniFromBk = snapshot?.turni ?? []

  // 3) DELETE all (la condizione non-eq forza Supabase a non bloccare)
  const { error: delErr } = await supabase.from('turni')
    .delete().neq('id', '00000000-0000-0000-0000-000000000000')
  if (delErr) throw delErr

  // 4) INSERT bulk in chunks
  let inserted = 0
  for (let i = 0; i < turniFromBk.length; i += CHUNK) {
    const chunk = turniFromBk.slice(i, i + CHUNK)
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
export function useAutoBackup() {
  const qc = useQueryClient()
  const triggered = useRef(false)

  // Leggo configurazione (per intervallo + retention)
  const { data: config } = useQuery<Configurazione | null>({
    queryKey: ['configurazione'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('configurazione').select('*')
        .order('updated_at', { ascending: false }).limit(1).maybeSingle()
      if (error) throw error
      return data
    },
  })

  // Leggo l'ultimo backup. NB: `isFetched` ci dice quando la query ha
  // effettivamente RISPOSTO (success o error). Senza questa check si
  // creava un backup spurio ad ogni refresh perche` il data iniziale
  // (undefined, loading) era trattato come "nessun backup esiste".
  const { data: lastBackup, isFetched: backupFetched } = useQuery<TurnoBackup | null>({
    queryKey: ['turni-backup', 'latest'],
    queryFn: async () => {
      const { data, error } = await supabase.from('turni_backup')
        .select('id, created_at, descrizione, num_turni')
        .order('created_at', { ascending: false })
        .limit(1).maybeSingle()
      if (error) throw error
      return data as TurnoBackup | null
    },
    staleTime: 5 * 60_000,
  })

  useEffect(() => {
    if (triggered.current) return
    if (!config) return
    // Gating: aspetta che entrambe le query abbiano risposto. Altrimenti
    // `lastBackup === undefined` (loading) verrebbe scambiato per
    // "nessun backup esiste mai" → backup spurio ad ogni mount.
    if (!backupFetched) return
    if (lastBackup === undefined) return  // safety net per il typeguard

    const interval = config.backup_intervallo_giorni ?? 7
    if (interval <= 0) return    // 0 = disattiva auto-backup
    const retention = config.backup_da_tenere ?? 10

    // Da qui `lastBackup` e` TurnoBackup oppure null (mai undefined)
    let serve = false
    if (lastBackup === null) {
      // Nessun backup mai fatto → serve
      serve = true
    } else {
      const diffMs = Date.now() - new Date(lastBackup.created_at).getTime()
      const diffDays = diffMs / (1000 * 60 * 60 * 24)
      if (diffDays >= interval) serve = true
    }
    if (!serve) return

    triggered.current = true
    ;(async () => {
      try {
        const descr = `Auto-backup ${new Date().toLocaleString('it-IT', {
          day: '2-digit', month: '2-digit', year: 'numeric',
          hour: '2-digit', minute: '2-digit',
        })}`
        await createBackup(descr)
        await ruotaBackup(retention)
        qc.invalidateQueries({ queryKey: ['turni-backup'] })
      } catch (e) {
        console.error('[autoBackup]', (e as Error).message)
      }
    })()
  }, [config, lastBackup, backupFetched, qc])
}
