/**
 * DatabaseStatsBox
 *
 * Box "Utilizzo Supabase (free tier)": dimensione DB, storage, MAU e
 * conteggi righe per tabella, + bottone "Pulisci database" (VACUUM FULL via
 * Edge Function `vacuum-tables`).
 *
 * È un monitoraggio GLOBALE del progetto Supabase (non per-reparto): per
 * questo vive in Centro di Controllo, visibile solo al super-admin.
 */

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Database, Loader2, Sparkles } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useConfirm } from '../hooks/useConfirm'
import { ConfirmModal } from './ConfirmModal'
import type { DbStats } from '../types'

// Soglie free tier Supabase (al momento di scrittura).
const FREE_DB_LIMIT_BYTES      = 500 * 1024 * 1024     // 500 MB
const FREE_STORAGE_LIMIT_BYTES = 1024 * 1024 * 1024    // 1 GB
const FREE_MAU_LIMIT           = 50_000                // 50k MAU

function fmtMB(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Colori (bar + bg + fg) coerenti col livello di utilizzo. */
function pctColors(pct: number) {
  if (pct < 50)  return { bar: '#16a34a', bg: '#dcfce7', fg: '#166534' }
  if (pct < 75)  return { bar: '#d97706', bg: '#fef3c7', fg: '#92400e' }
  return            { bar: '#dc2626', bg: '#fee2e2', fg: '#991b1b' }
}

function MetricBar({ label, used, total, pct }: {
  label: string; used: string; total: string; pct: number
}) {
  const col = pctColors(pct)
  return (
    <div>
      <div className="flex items-baseline justify-between text-[11px] mb-0.5">
        <span style={{ color: col.fg }}>
          <strong>{label}</strong>
          <span className="opacity-75 ml-1">({used} / {total})</span>
        </span>
        <span className="font-mono font-bold" style={{ color: col.bar }}>
          {pct < 0.1 ? '<0.1' : pct.toFixed(1)}%
        </span>
      </div>
      <div className="w-full h-1.5 rounded-full overflow-hidden"
        style={{ background: 'rgba(0,0,0,0.08)' }}>
        <div className="h-full rounded-full transition-all"
          style={{ width: `${Math.min(100, pct)}%`, background: col.bar }} />
      </div>
    </div>
  )
}

export function DatabaseStatsBox() {
  const qc = useQueryClient()
  const { confirm, confirmState } = useConfirm()
  const [vacuumLoading, setVacuumLoading] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const { data: dbStats } = useQuery<DbStats | null>({
    queryKey: ['db-stats'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_db_stats')
      if (error) throw error
      return data as DbStats
    },
    staleTime: 60_000,       // 1 min: non e` necessario aggiornarlo di continuo
    refetchInterval: 5 * 60_000,  // refresh ogni 5 min
  })

  // ── Pulisci database (VACUUM FULL via Edge Function) ───────────────
  // VACUUM FULL non gira dentro transazioni → non e` chiamabile dal
  // PostgREST. Serve l'Edge Function `vacuum-tables` (Management API + PAT).
  async function handlePulisciDb() {
    const ok = await confirm({
      title:   'Pulisci database?',
      message:
        'Eseguira VACUUM FULL sulle tabelle principali per ricompattare ' +
        'lo spazio occupato da DELETE precedenti. Operazione sicura: ' +
        'recupera spazio fisico nel database.',
      confirmLabel: 'Esegui pulizia',
    })
    if (!ok) return
    setVacuumLoading(true); setErr(null); setMsg(null)
    try {
      const { data, error } = await supabase.functions.invoke('vacuum-tables', { method: 'POST' })
      if (error) {
        const m = (error as Error).message || String(error)
        if (m.includes('Failed to fetch') || m.includes('404')) {
          setErr(
            'Edge Function `vacuum-tables` non deployata. Vedi guida in ' +
            'supabase/functions/vacuum-tables/README.md per il deploy, ' +
            'oppure usa il fallback CLI: `node scripts/vacuum-full.mjs`'
          )
        } else {
          setErr('Errore pulizia: ' + m)
        }
        return
      }
      const fmtBytes = (b: number) =>
        b >= 1024 * 1024 ? `${(b / (1024*1024)).toFixed(2)} MB`
        : b >= 1024      ? `${(b / 1024).toFixed(1)} KB`
        : `${b} bytes`
      const r = data as {
        size_before_bytes: number
        size_after_bytes:  number
        freed_bytes:       number
        tables: Record<string, string>
      }
      const errs = Object.entries(r.tables).filter(([, v]) => v !== 'ok')
      setMsg(
        `Pulizia completata. DB: ${fmtBytes(r.size_before_bytes)} → ` +
        `${fmtBytes(r.size_after_bytes)} (liberati ${fmtBytes(r.freed_bytes)})` +
        (errs.length > 0 ? ` — ${errs.length} tabelle con errore` : '.')
      )
      qc.invalidateQueries({ queryKey: ['db-stats'] })
      setTimeout(() => setMsg(null), 8000)
    } catch (e) {
      setErr('Errore pulizia: ' + (e as Error).message)
    } finally {
      setVacuumLoading(false)
    }
  }

  if (!dbStats) return null

  const dbPct      = (dbStats.db_size_bytes / FREE_DB_LIMIT_BYTES) * 100
  const storagePct = (dbStats.storage_bytes / FREE_STORAGE_LIMIT_BYTES) * 100
  const mauPct     = (dbStats.mau_approx    / FREE_MAU_LIMIT)        * 100
  const worstPct   = Math.max(dbPct, storagePct, mauPct)
  const boxColors  = pctColors(worstPct)

  return (
    <>
      <ConfirmModal {...confirmState.opts} open={confirmState.open}
        onConfirm={confirmState.onConfirm} onCancel={confirmState.onCancel} />
      <div className="rounded-lg border p-3"
        style={{ background: boxColors.bg, borderColor: boxColors.bar }}>
        <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Database size={16} style={{ color: boxColors.fg }} />
            <span className="font-bold text-sm" style={{ color: boxColors.fg }}>
              Utilizzo Supabase (free tier)
            </span>
          </div>
          <button
            onClick={handlePulisciDb}
            disabled={vacuumLoading}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-semibold text-white shadow disabled:opacity-50 transition-colors shrink-0"
            style={{ background: '#7a5a2f' }}
            title="VACUUM FULL: ricompatta le tabelle e libera spazio fisico nel DB">
            {vacuumLoading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
            Pulisci database
          </button>
        </div>

        <div className="space-y-2">
          <MetricBar label="Database"        used={fmtMB(dbStats.db_size_bytes)} total="500 MB" pct={dbPct} />
          <MetricBar label="Storage (file)"  used={fmtMB(dbStats.storage_bytes)} total="1 GB"   pct={storagePct} />
          <MetricBar label="MAU (approx 30g)" used={String(dbStats.mau_approx)}  total="50 000" pct={mauPct} />
        </div>

        {/* Conteggi righe per tabella */}
        <div className="flex flex-wrap gap-1.5 text-[10px] mt-3 pt-2"
          style={{ borderTop: `1px dashed ${boxColors.bar}66` }}>
          {dbStats.tables.map(t => (
            <span key={t.name}
              className="px-2 py-0.5 rounded bg-white/70 font-mono"
              style={{ color: boxColors.fg }}
              title={`${t.name}: ${t.rows} righe`}>
              {t.name}: <strong>{t.rows}</strong>
            </span>
          ))}
        </div>

        {(msg || err) && (
          <div className="mt-2 text-[11px] font-medium" style={{ color: err ? '#991b1b' : boxColors.fg }}>
            {err || msg}
          </div>
        )}

        {/* Nota su metriche non recuperabili via SQL */}
        <div className="mt-2 text-[10px] italic" style={{ color: boxColors.fg, opacity: 0.85 }}>
          Realtime Connections, Realtime Messages, Egress, Edge Functions e altre
          metriche dettagliate sono visibili da{' '}
          <a href="https://supabase.com/dashboard/project/_/settings/billing-and-usage"
            target="_blank" rel="noreferrer"
            className="underline font-semibold">
            Supabase Dashboard → Usage
          </a>.
        </div>
      </div>
    </>
  )
}
