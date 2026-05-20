/**
 * BackupRipristinoPage
 *
 * Pagina admin per gestire backup e ripristino dei turni.
 * - Lista backup esistenti ordinati per data desc
 * - Pulsante "Backup ora" per creare uno snapshot manuale
 * - Per ogni backup: bottoni Elimina e Ripristina (con conferma)
 *
 * Gli auto-backup avvengono in background tramite `useAutoBackup` montato
 * in AdminLayout, secondo l'intervallo definito in Impostazioni.
 */

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Archive, Plus, Trash2, RotateCcw, AlertTriangle, CheckCircle2,
  Loader2, Clock, Sparkles, Eye, X,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useConfirm } from '../../hooks/useConfirm'
import { ConfirmModal } from '../../components/ConfirmModal'
import {
  createBackup, restoreBackup, deleteBackup, ruotaBackup,
} from '../../hooks/useBackupManager'
import { BackupTurniPreview } from '../../components/BackupTurniPreview'
import { useFestivitaCustom } from '../../hooks/useFestivitaCustom'
import type { Configurazione, Medico, Turno } from '../../types'

// Lista record che ritorno dal SELECT (senza il pesante snapshot JSONB).
interface BackupRow {
  id:          string
  created_at:  string
  descrizione: string | null
  num_turni:   number | null
}

function fmtDataOra(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ` +
         `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function BackupRipristinoPage() {
  const qc = useQueryClient()
  const { confirm, confirmState } = useConfirm()
  const [busyId,        setBusyId]        = useState<string | null>(null)
  const [creating,      setCreating]      = useState(false)
  const [descrManuale,  setDescrManuale]  = useState('')
  const [msg,           setMsg]           = useState<string | null>(null)
  const [err,           setErr]           = useState<string | null>(null)
  const [vacuumLoading, setVacuumLoading] = useState(false)
  const [previewId,     setPreviewId]     = useState<string | null>(null)
  const { set: festivitaCustomSet } = useFestivitaCustom()

  // ── Snapshot completo del backup selezionato per anteprima ────────
  // Query separata che fetcha il JSONB snapshot (pesante: lo prendiamo
  // solo quando l'utente clicca Anteprima). enabled gating + staleTime
  // alto per evitare refetch inutili.
  const { data: previewSnapshot, isLoading: previewLoading } = useQuery<
    { turni: Turno[] } | null
  >({
    queryKey: ['turni-backup-snapshot', previewId],
    queryFn: async () => {
      if (!previewId) return null
      const { data, error } = await supabase.from('turni_backup')
        .select('snapshot').eq('id', previewId).single()
      if (error) throw error
      return (data as { snapshot: { turni: Turno[] } }).snapshot
    },
    enabled: !!previewId,
    staleTime: 10 * 60_000,
  })

  // ── Medici per la preview ─────────────────────────────────────────
  const { data: medici = [] } = useQuery<Medico[]>({
    queryKey: ['medici-tutti'],
    queryFn: async () => {
      const { data, error } = await supabase.from('medici').select('*')
      if (error) throw error
      return data ?? []
    },
  })

  // ── Lista backup (senza snapshot, troppo pesante) ──────────────────
  const { data: backups = [], isLoading } = useQuery<BackupRow[]>({
    queryKey: ['turni-backup'],
    queryFn: async () => {
      const { data, error } = await supabase.from('turni_backup')
        .select('id, created_at, descrizione, num_turni')
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as BackupRow[]
    },
    staleTime: 0,
    refetchOnMount: 'always',
  })

  // ── Settings backup dalla configurazione (intervallo + retention) ──
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

  // ── Crea backup manuale ────────────────────────────────────────────
  async function handleCreaBackup() {
    setCreating(true); setErr(null); setMsg(null)
    try {
      const descr = descrManuale.trim() ||
        `Backup manuale ${new Date().toLocaleString('it-IT')}`
      const bk = await createBackup(descr)
      // Rotazione automatica anche per i backup manuali
      const retention = config?.backup_da_tenere ?? 10
      const rotati = await ruotaBackup(retention)
      setMsg(
        `Backup creato (${bk.num_turni ?? 0} turni)` +
        (rotati > 0 ? ` — ${rotati} backup vecchi rimossi per rotazione.` : '.')
      )
      setDescrManuale('')
      qc.invalidateQueries({ queryKey: ['turni-backup'] })
      setTimeout(() => setMsg(null), 5000)
    } catch (e) {
      setErr('Errore creazione backup: ' + (e as Error).message)
    } finally {
      setCreating(false)
    }
  }

  // ── Elimina backup ─────────────────────────────────────────────────
  async function handleElimina(b: BackupRow) {
    const ok = await confirm({
      title:   'Eliminare il backup?',
      message: 'Eliminazione definitiva. Lo snapshot non sara` piu` ripristinabile.',
      confirmLabel: 'Elimina',
      danger: true,
    })
    if (!ok) return
    setBusyId(b.id); setErr(null); setMsg(null)
    try {
      await deleteBackup(b.id)
      setMsg('Backup eliminato.')
      qc.invalidateQueries({ queryKey: ['turni-backup'] })
      setTimeout(() => setMsg(null), 3000)
    } catch (e) {
      setErr('Errore eliminazione: ' + (e as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  // ── Ripristina backup ─────────────────────────────────────────────
  async function handleRipristina(b: BackupRow) {
    const ok = await confirm({
      title:   'Ripristinare questo backup?',
      message:
        'Verranno SOSTITUITI tutti i turni attualmente nel calendario con ' +
        'quelli contenuti nel backup "' + (b.descrizione ?? '?') + '" del ' +
        fmtDataOra(b.created_at) + '. Operazione irreversibile, ma viene ' +
        'creato automaticamente un backup "pre-ripristino" come safety net.',
      confirmLabel: 'Ripristina',
      danger: true,
    })
    if (!ok) return
    setBusyId(b.id); setErr(null); setMsg(null)
    try {
      const res = await restoreBackup(b.id)
      setMsg(
        `Ripristino completato: ${res.inserted} turni reinseriti. ` +
        `Backup pre-ripristino creato come safety net.`
      )
      qc.invalidateQueries({ queryKey: ['turni-backup'] })
      qc.invalidateQueries({ queryKey: ['turni-modifica'] })
      qc.invalidateQueries({ queryKey: ['turni'] })
      setTimeout(() => setMsg(null), 6000)
    } catch (e) {
      setErr('Errore ripristino: ' + (e as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  // ── Pulisci database (VACUUM FULL via Edge Function) ───────────────
  // VACUUM FULL non gira dentro transazioni → non e` chiamabile dal
  // PostgREST. Serve passare per la nostra Edge Function `vacuum-tables`
  // che usa la Management API col PAT come secret.
  // Se la function non e` deployata, mostriamo un messaggio chiaro che
  // rimanda al README per il setup + suggerisce lo script CLI.
  async function handlePulisciDb() {
    const ok = await confirm({
      title: 'Pulisci database?',
      message:
        'Eseguira` VACUUM FULL sulle tabelle principali per ricompattare ' +
        'lo spazio occupato da DELETE precedenti. Operazione sicura: ' +
        'recupera spazio fisico nel database. Richiede l\'Edge Function ' +
        '`vacuum-tables` deployata su Supabase (vedi README in ' +
        'supabase/functions/vacuum-tables/).',
      confirmLabel: 'Esegui pulizia',
    })
    if (!ok) return
    setVacuumLoading(true); setErr(null); setMsg(null)
    try {
      const { data, error } = await supabase.functions.invoke('vacuum-tables', {
        method: 'POST',
      })
      if (error) {
        // Function non deployata o errore di rete
        const m = (error as Error).message || String(error)
        if (m.includes('Failed to fetch') || m.includes('404')) {
          setErr(
            'Edge Function `vacuum-tables` non deployata. Vedi guida in ' +
            'supabase/functions/vacuum-tables/README.md per il deploy, oppure ' +
            'usa il fallback CLI: `node scripts/vacuum-full.mjs`'
          )
        } else {
          setErr('Errore pulizia: ' + m)
        }
        return
      }
      const fmt = (b: number) =>
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
        `Pulizia completata. DB: ${fmt(r.size_before_bytes)} → ${fmt(r.size_after_bytes)} ` +
        `(liberati ${fmt(r.freed_bytes)})` +
        (errs.length > 0 ? ` — ${errs.length} tabelle con errore` : '.')
      )
      // Invalida stats DB cosi` il box in /admin/config si aggiorna
      qc.invalidateQueries({ queryKey: ['db-stats'] })
      setTimeout(() => setMsg(null), 8000)
    } catch (e) {
      setErr('Errore pulizia: ' + (e as Error).message)
    } finally {
      setVacuumLoading(false)
    }
  }

  return (
    <div className={`flex gap-4 ${previewId ? '' : 'max-w-4xl flex-col'}`}>
      {/* Colonna sinistra: header, form, tabella backups */}
      <div className={`flex flex-col gap-4 ${previewId ? 'shrink-0 w-[520px]' : ''}`}>

      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-stone-800 flex items-center gap-2">
            <Archive size={20} style={{ color: '#476540' }} />
            Backup / Ripristino turni
          </h2>
          <p className="text-sm text-stone-600 mt-0.5">
            Snapshot completi dei turni. Auto-backup ogni{' '}
            <strong>{config?.backup_intervallo_giorni ?? '?'} giorni</strong>,
            mantenuti gli ultimi <strong>{config?.backup_da_tenere ?? '?'}</strong>.
            Modifica i parametri in <em>Impostazioni</em>.
          </p>
        </div>
        {/* Pulisci database (VACUUM FULL via Edge Function) */}
        <button
          onClick={handlePulisciDb}
          disabled={vacuumLoading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold text-white shadow disabled:opacity-50 transition-colors shrink-0"
          style={{ background: '#7a5a2f' }}
          title="Esegue VACUUM FULL per liberare spazio dopo eliminazioni"
        >
          {vacuumLoading ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
          Pulisci database
        </button>
      </div>

      {/* Messaggi */}
      {msg && (
        <div className="px-3 py-2 rounded-lg text-sm flex items-center gap-2"
          style={{ background: '#d5e5d0', color: '#2e5a28', border: '1px solid #a8c4a0' }}>
          <CheckCircle2 size={15} /> {msg}
        </div>
      )}
      {err && (
        <div className="px-3 py-2 rounded-lg text-sm flex items-center gap-2"
          style={{ background: '#fde0e0', color: '#7a2020', border: '1px solid #f0c0c0' }}>
          <AlertTriangle size={15} /> {err}
        </div>
      )}

      {/* Form crea backup manuale */}
      <div className="rounded-lg border border-stone-300 bg-white p-3">
        <h3 className="font-semibold text-stone-700 text-sm mb-2">
          Crea backup manuale
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 items-end">
          <label className="text-xs">
            <span className="block text-stone-600 mb-0.5">Descrizione (opzionale)</span>
            <input type="text"
              value={descrManuale}
              onChange={e => setDescrManuale(e.target.value)}
              placeholder="Es. Prima di rigenerare il calendario"
              className="w-full px-2 py-1.5 rounded border border-stone-300 text-sm" />
          </label>
          <button
            onClick={handleCreaBackup}
            disabled={creating}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold text-white shadow disabled:opacity-50 transition-colors"
            style={{ background: '#476540' }}>
            {creating ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
            Backup ora
          </button>
        </div>
      </div>

      {/* Lista backup */}
      <div>
        <h3 className="font-semibold text-stone-700 text-sm mb-2 flex items-center gap-2">
          <Clock size={14} />
          Backup esistenti
          {backups.length > 0 && (
            <span className="text-xs font-normal text-stone-500">
              ({backups.length})
            </span>
          )}
        </h3>
        {isLoading ? (
          <div className="text-stone-500 text-sm flex items-center gap-2">
            <Loader2 size={14} className="animate-spin" /> Caricamento…
          </div>
        ) : backups.length === 0 ? (
          <p className="text-xs text-stone-500 italic">
            Nessun backup. L'auto-backup partira` al primo accesso admin dopo l'intervallo configurato.
          </p>
        ) : (
          <div className="rounded-lg border border-stone-300 bg-white overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: '#f4f1ea' }}>
                  <th className="px-3 py-2 text-left font-semibold text-stone-700">Data</th>
                  <th className="px-3 py-2 text-left font-semibold text-stone-700">Descrizione</th>
                  <th className="px-3 py-2 text-right font-semibold text-stone-700" style={{ width: 100 }}>Turni</th>
                  <th className="px-3 py-2 text-right font-semibold text-stone-700" style={{ width: 180 }}>Azioni</th>
                </tr>
              </thead>
              <tbody>
                {backups.map(b => (
                  <tr key={b.id} className="border-t border-stone-200">
                    <td className="px-3 py-2 text-xs font-mono text-stone-600 whitespace-nowrap">
                      {fmtDataOra(b.created_at)}
                    </td>
                    <td className="px-3 py-2 text-stone-700">
                      {b.descrizione ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-right text-xs font-mono text-stone-600">
                      {b.num_turni ?? '?'}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-1.5 flex-wrap">
                        <button
                          onClick={() => setPreviewId(prev => prev === b.id ? null : b.id)}
                          className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold transition-colors"
                          style={previewId === b.id
                            ? { background: '#476540', color: '#fff', border: '1px solid #2b3c24' }
                            : { background: '#e0e8d8', color: '#456b3a', border: '1px solid #9ab488' }}
                          title="Visualizza il calendario del backup nella colonna a destra">
                          <Eye size={11} /> Anteprima
                        </button>
                        <button
                          onClick={() => handleRipristina(b)}
                          disabled={busyId === b.id}
                          className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold transition-colors"
                          style={{
                            background: '#fef3c7', color: '#a16207',
                            border: '1px solid #fde68a',
                            opacity: busyId === b.id ? 0.6 : 1,
                          }}
                          title="Sovrascrivi i turni attuali con questo backup">
                          <RotateCcw size={11} /> Ripristina
                        </button>
                        <button
                          onClick={() => handleElimina(b)}
                          disabled={busyId === b.id}
                          className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold transition-colors"
                          style={{
                            background: '#fee2e2', color: '#991b1b',
                            border: '1px solid #fecaca',
                            opacity: busyId === b.id ? 0.6 : 1,
                          }}
                          title="Elimina questo backup">
                          <Trash2 size={11} /> Elimina
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      </div>{/* /colonna sinistra */}

      {/* Colonna destra: anteprima del backup selezionato */}
      {previewId && (
        <div className="flex-1 min-w-0 flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-stone-700 flex items-center gap-2">
              <Eye size={14} style={{ color: '#476540' }} />
              Anteprima backup
              <span className="text-xs font-normal text-stone-500">
                {backups.find(b => b.id === previewId)?.descrizione ?? ''}
              </span>
            </h3>
            <button
              onClick={() => setPreviewId(null)}
              className="text-stone-400 hover:text-stone-700 transition-colors p-1"
              title="Chiudi anteprima">
              <X size={16} />
            </button>
          </div>
          {previewLoading ? (
            <div className="text-stone-500 text-sm flex items-center gap-2 p-4">
              <Loader2 size={14} className="animate-spin" /> Caricamento snapshot…
            </div>
          ) : previewSnapshot && Array.isArray(previewSnapshot.turni) ? (
            <BackupTurniPreview
              turni={previewSnapshot.turni}
              medici={medici}
              festivitaCustomSet={festivitaCustomSet}
            />
          ) : (
            <div className="text-stone-500 text-sm italic p-4">
              Snapshot vuoto o non disponibile.
            </div>
          )}
        </div>
      )}

      <ConfirmModal {...confirmState.opts} open={confirmState.open}
        onConfirm={confirmState.onConfirm} onCancel={confirmState.onCancel} />
    </div>
  )
}
