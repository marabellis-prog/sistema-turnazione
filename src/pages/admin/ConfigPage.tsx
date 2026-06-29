/**
 * ConfigPage
 *
 * Pagina admin per le impostazioni globali del sistema. Attualmente contiene:
 *
 * - Numero atteso di medici per slot/mezza-giornata/tipo-giorno (8 campi):
 *   serve al check "inconsistenze nei turni" in ModificaTurniPage per
 *   confrontare il count effettivo coi valori attesi e produrre un report.
 *
 *   Convenzione: 0 = nessun controllo per quel slot (no warning).
 *   Solo valori > 0 attivano la verifica.
 *
 * Le impostazioni sono salvate sulla tabella `configurazione` (record
 * unico per il periodo corrente). Sono condivise fra tutti gli admin via
 * realtime (useConfigurazioneRealtime).
 */

import { useState, useEffect, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Settings, Save, AlertTriangle, CheckCircle2, CalendarPlus, Trash2, Loader2,
  CalendarDays, Database, Archive, Sparkles, CalendarClock, X,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useConfigReparto } from '../../hooks/useConfigReparto'
import { useConfigurazioneRealtime } from '../../hooks/useConfigurazioneRealtime'
import { useFestivitaCustom, useFestivitaCustomRealtime } from '../../hooks/useFestivitaCustom'
import { useConfirm } from '../../hooks/useConfirm'
import { ConfirmModal } from '../../components/ConfirmModal'
import { getItalianHolidaysWithNames } from '../../lib/holidays'
import { MESI_IT } from '../../lib/algorithm'
import type { Configurazione, DbStats, SoglieSlot, SogliaEpoca } from '../../types'

// Soglie free tier Supabase (al momento di scrittura).
const FREE_DB_LIMIT_BYTES      = 500 * 1024 * 1024     // 500 MB
const FREE_STORAGE_LIMIT_BYTES = 1024 * 1024 * 1024    // 1 GB
const FREE_MAU_LIMIT           = 50_000                // 50k MAU

function fmtMB(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Restituisce colori (bar + bg + fg) coerenti col livello di utilizzo. */
function pctColors(pct: number) {
  if (pct < 50)  return { bar: '#16a34a', bg: '#dcfce7', fg: '#166534' }
  if (pct < 75)  return { bar: '#d97706', bg: '#fef3c7', fg: '#92400e' }
  return            { bar: '#dc2626', bg: '#fee2e2', fg: '#991b1b' }
}

const MESI_ABBR = [
  'gen','feb','mar','apr','mag','giu','lug','ago','set','ott','nov','dic',
]
function fmtDataLunga(iso: string): string {
  const [y, m, d] = iso.split('-').map(s => parseInt(s, 10))
  if (!y || !m || !d) return iso
  return `${d} ${MESI_ABBR[m-1] ?? '?'} ${y}`
}

// Le 18 chiavi delle impostazioni (SUB, MED e SUPPORTO × mattina/pomeriggio
// × feriale/sabato/festivo) in ordine di rendering.
const KEYS = [
  'sub_mattina_feriale',    'sub_mattina_sabato',    'sub_mattina_festivo',
  'sub_pomeriggio_feriale', 'sub_pomeriggio_sabato', 'sub_pomeriggio_festivo',
  'med_mattina_feriale',    'med_mattina_sabato',    'med_mattina_festivo',
  'med_pomeriggio_feriale', 'med_pomeriggio_sabato', 'med_pomeriggio_festivo',
  'sup_mattina_feriale',    'sup_mattina_sabato',    'sup_mattina_festivo',
  'sup_pomeriggio_feriale', 'sup_pomeriggio_sabato', 'sup_pomeriggio_festivo',
] as const

type SettingKey = typeof KEYS[number]

// Input numerico STABILE (definito fuori dal componente pagina): se fosse
// dichiarato dentro ConfigPage verrebbe ricreato ad ogni render e l'input
// perderebbe il focus ad ogni carattere digitato.
function NumInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="text"
      inputMode="numeric"
      value={value ?? ''}
      onChange={e => onChange(e.target.value)}
      className="w-14 px-2 py-1 rounded border border-stone-300 text-center text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-green-300"
    />
  )
}

export function ConfigPage() {
  const qc = useQueryClient()
  useConfigurazioneRealtime()
  useFestivitaCustomRealtime()
  const { confirm, confirmState } = useConfirm()

  // Local form state — uso stringhe per evitare problemi con input "0"
  // e con eventuali valori non ancora sincronizzati dal DB.
  const [draft,   setDraft]   = useState<Record<SettingKey, string>>({} as any)
  const [dirty,   setDirty]   = useState(false)
  const [saving,  setSaving]  = useState(false)
  const [msg,     setMsg]     = useState<string | null>(null)
  const [err,     setErr]     = useState<string | null>(null)

  // Modal "Salva impostazioni con validità dal…" (impostazioni datate):
  // archivia le soglie correnti nello storico con valido_fino = data scelta
  // e imposta le nuove dal form a partire da quella data.
  const [validitaOpen,   setValiditaOpen]   = useState(false)
  const [validitaData,   setValiditaData]   = useState('')
  const [savingValidita, setSavingValidita] = useState(false)

  // Form festività custom
  const [festData,    setFestData]    = useState('')
  const [festDescr,   setFestDescr]   = useState('')
  const [festSaving,  setFestSaving]  = useState(false)
  const [festErr,     setFestErr]     = useState<string | null>(null)
  const { festivita: festivitaList } = useFestivitaCustom()

  // Backup settings draft
  const [backupInt,   setBackupInt]   = useState('7')
  const [backupKeep,  setBackupKeep]  = useState('10')
  const [bkSaving,    setBkSaving]    = useState(false)
  const [bkDirty,     setBkDirty]     = useState(false)
  const [vacuumLoading, setVacuumLoading] = useState(false)

  // ── Stats DB Supabase (free tier monitoring) ─────────────────────
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

  const { data: config } = useConfigReparto()

  // Festività italiane che cadono nel periodo della configurazione attiva.
  // Itera anno_inizio..anno_fine, prende le festività italiane di ogni anno
  // e filtra quelle nel range [data_inizio, data_fine] del periodo.
  const festivitaItaliane = useMemo(() => {
    if (!config) return []
    const pad = (n: number) => String(n).padStart(2, '0')
    const startISO = `${config.anno_inizio}-${pad(config.mese_inizio)}-01`
    const lastDay = new Date(config.anno_fine, config.mese_fine, 0).getDate()
    const endISO   = `${config.anno_fine}-${pad(config.mese_fine)}-${pad(lastDay)}`
    const out: Array<{ data: string; nome: string }> = []
    for (let y = config.anno_inizio; y <= config.anno_fine; y++) {
      for (const f of getItalianHolidaysWithNames(y)) {
        if (f.data >= startISO && f.data <= endISO) out.push(f)
      }
    }
    return out.sort((a, b) => a.data.localeCompare(b.data))
  }, [config])

  // Etichetta del periodo per l'header della sezione festività italiane:
  // - stesso anno → "Maggio - Ottobre 2026"
  // - anni diversi → "Maggio 2026 - Aprile 2027"
  const periodoLabel = useMemo(() => {
    if (!config) return ''
    const mIn  = MESI_IT[config.mese_inizio] ?? ''
    const mFi  = MESI_IT[config.mese_fine]   ?? ''
    if (config.anno_inizio === config.anno_fine) {
      return `${mIn} - ${mFi} ${config.anno_inizio}`
    }
    return `${mIn} ${config.anno_inizio} - ${mFi} ${config.anno_fine}`
  }, [config])

  // Sync iniziale del draft dal DB
  useEffect(() => {
    if (!config) return
    const next: Record<SettingKey, string> = {} as any
    for (const k of KEYS) next[k] = String(config[k] ?? 0)
    setDraft(next)
    setDirty(false)
    setBackupInt(String(config.backup_intervallo_giorni ?? 7))
    setBackupKeep(String(config.backup_da_tenere ?? 10))
    setBkDirty(false)
  }, [config])

  async function handleSaveBackup() {
    if (!config) return
    setBkSaving(true); setErr(null); setMsg(null)
    try {
      const intN  = Math.max(0, parseInt(backupInt  || '0', 10) || 0)
      const keepN = Math.max(1, parseInt(backupKeep || '1', 10) || 1)
      const { error } = await supabase.from('configurazione').update({
        backup_intervallo_giorni: intN,
        backup_da_tenere:         keepN,
      }).eq('id', config.id)
      if (error) throw error
      setMsg('Impostazioni backup salvate.')
      setBkDirty(false)
      qc.invalidateQueries({ queryKey: ['configurazione'] })
      setTimeout(() => setMsg(null), 3000)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBkSaving(false)
    }
  }

  function setField(k: SettingKey, value: string) {
    // Solo cifre, max 2 caratteri (0..99 sufficiente)
    const clean = value.replace(/[^0-9]/g, '').slice(0, 2)
    setDraft(prev => ({ ...prev, [k]: clean }))
    setDirty(true)
  }

  async function handleSave() {
    if (!config) return
    setSaving(true); setErr(null); setMsg(null)
    try {
      const update: Record<string, number> = {}
      for (const k of KEYS) {
        const n = parseInt(draft[k] || '0', 10)
        update[k] = Number.isFinite(n) && n >= 0 ? n : 0
      }
      const { error } = await supabase.from('configurazione')
        .update(update).eq('id', config.id)
      if (error) throw error
      setMsg('Impostazioni salvate.')
      setDirty(false)
      qc.invalidateQueries({ queryKey: ['configurazione'] })
      setTimeout(() => setMsg(null), 3000)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  // Apre il modal "Salva con validità dal…" con default = oggi.
  function openValiditaModal() {
    const d = new Date()
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    setValiditaData(iso)
    setErr(null)
    setValiditaOpen(true)
  }

  // ── Salva con validità temporale ──────────────────────────────────
  // Archivia le soglie ATTUALI (colonne DB) nello storico marcandole valide
  // fino a `validitaData` (esclusivo), poi scrive nelle colonne le NUOVE
  // soglie del form e imposta impostazioni_valido_dal = validitaData.
  // Risultato: prima di X valgono le vecchie soglie, da X le nuove — cosi`
  // un cambio composizione dopo un "Aggiorna turnazione" non genera errori
  // falsi sulla vecchia turnazione.
  async function handleSaveConValidita() {
    if (!config) return
    if (!validitaData) { setErr('Seleziona la data di inizio validità.'); return }
    setSavingValidita(true); setErr(null); setMsg(null)
    try {
      // Soglie ATTUALI dal DB = epoca che stiamo chiudendo
      const soglieAttuali = {} as SoglieSlot
      for (const k of KEYS) soglieAttuali[k] = config[k] ?? 0
      // Push dell'epoca corrente nello storico (valido_fino esclusivo)
      const storicoPrec = Array.isArray(config.impostazioni_storico)
        ? config.impostazioni_storico : []
      const epoca: SogliaEpoca = {
        valido_dal:  config.impostazioni_valido_dal ?? null,
        valido_fino: validitaData,
        soglie:      soglieAttuali,
      }
      // Payload: nuove soglie del form + valido_dal + storico aggiornato
      const payload: Record<string, unknown> = {}
      for (const k of KEYS) {
        const n = parseInt(draft[k] || '0', 10)
        payload[k] = Number.isFinite(n) && n >= 0 ? n : 0
      }
      payload.impostazioni_valido_dal = validitaData
      payload.impostazioni_storico    = [...storicoPrec, epoca]
      const { error } = await supabase.from('configurazione')
        .update(payload).eq('id', config.id)
      if (error) throw error
      setMsg('Impostazioni salvate con validità dal ' + fmtDataLunga(validitaData) +
        '. Prima di quella data restano valide le soglie precedenti.')
      setDirty(false)
      setValiditaOpen(false)
      qc.invalidateQueries({ queryKey: ['configurazione'] })
      setTimeout(() => setMsg(null), 6000)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setSavingValidita(false)
    }
  }

  // ── Pulisci database (VACUUM FULL via Edge Function) ───────────────
  // VACUUM FULL non gira dentro transazioni → non e` chiamabile dal
  // PostgREST. Serve passare per l'Edge Function `vacuum-tables` che
  // usa la Management API col PAT come secret (MGMT_API_PAT).
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
      const { data, error } = await supabase.functions.invoke('vacuum-tables', {
        method: 'POST',
      })
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
      // Invalida stats DB cosi` il box stesso si aggiorna
      qc.invalidateQueries({ queryKey: ['db-stats'] })
      setTimeout(() => setMsg(null), 8000)
    } catch (e) {
      setErr('Errore pulizia: ' + (e as Error).message)
    } finally {
      setVacuumLoading(false)
    }
  }

  // ── Aggiungi festività custom ─────────────────────────────────
  async function handleAggiungiFestivita() {
    setFestErr(null)
    if (!festData)  { setFestErr('Seleziona una data.'); return }
    if (!festDescr.trim()) { setFestErr('Inserisci una descrizione (es. "Santo Patrono").'); return }
    setFestSaving(true)
    try {
      const { error } = await supabase.from('festivita_custom').insert({
        data:        festData,
        descrizione: festDescr.trim(),
      })
      if (error) throw error
      setFestData(''); setFestDescr('')
      qc.invalidateQueries({ queryKey: ['festivita-custom'] })
    } catch (e) {
      const msg = (e as Error).message
      // Vincolo UNIQUE su data → messaggio piu` chiaro
      setFestErr(msg.includes('duplicate') || msg.includes('unique')
        ? 'Esiste gia una festività su questa data.'
        : 'Errore: ' + msg)
    } finally {
      setFestSaving(false)
    }
  }

  // ── Elimina festività custom ──────────────────────────────────
  async function handleEliminaFestivita(id: string, descrizione: string, data: string) {
    const ok = await confirm({
      title:   'Eliminare la festività?',
      message: 'Eliminare "' + descrizione + '" del ' + fmtDataLunga(data) +
        '? Quel giorno tornera ad essere considerato feriale ' +
        '(se non e domenica o festivita nazionale).',
      confirmLabel: 'Elimina',
      danger: true,
    })
    if (!ok) return
    try {
      const { error } = await supabase.from('festivita_custom').delete().eq('id', id)
      if (error) throw error
      qc.invalidateQueries({ queryKey: ['festivita-custom'] })
    } catch (e) {
      setFestErr('Errore eliminazione: ' + (e as Error).message)
    }
  }

  // Cella <td> con input numerico per una soglia (NumInput e' stabile).
  const numCell = (k: SettingKey) => (
    <td className="text-center"><NumInput value={draft[k] ?? ''} onChange={v => setField(k, v)} /></td>
  )

  // ── Metriche e percentuali ────────────────────────────────────
  const dbPct      = dbStats ? (dbStats.db_size_bytes / FREE_DB_LIMIT_BYTES) * 100 : 0
  const storagePct = dbStats ? (dbStats.storage_bytes / FREE_STORAGE_LIMIT_BYTES) * 100 : 0
  const mauPct     = dbStats ? (dbStats.mau_approx    / FREE_MAU_LIMIT)        * 100 : 0
  // Box bg/border: peggior livello fra tutte le 3 metriche
  const worstPct = Math.max(dbPct, storagePct, mauPct)
  const boxColors = pctColors(worstPct)

  // Componente locale per una singola barra metrica
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

  return (
    <div className="flex flex-col gap-4 max-w-3xl">
      {/* ── Box utilizzo free tier Supabase (in cima) ────────────── */}
      {dbStats && (
        <div className="rounded-lg border p-3"
          style={{ background: boxColors.bg, borderColor: boxColors.bar }}>
          <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
            <div className="flex items-center gap-2">
              <Database size={16} style={{ color: boxColors.fg }} />
              <span className="font-bold text-sm" style={{ color: boxColors.fg }}>
                Utilizzo Supabase (free tier)
              </span>
            </div>
            {/* Pulisci database (VACUUM FULL via Edge Function vacuum-tables) */}
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
            <MetricBar
              label="Database"
              used={fmtMB(dbStats.db_size_bytes)}
              total="500 MB"
              pct={dbPct}
            />
            <MetricBar
              label="Storage (file)"
              used={fmtMB(dbStats.storage_bytes)}
              total="1 GB"
              pct={storagePct}
            />
            <MetricBar
              label="MAU (approx 30g)"
              used={String(dbStats.mau_approx)}
              total="50 000"
              pct={mauPct}
            />
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
      )}

      {/* ── SEZIONE BACKUP AUTOMATICO ──────────────────────────────── */}
      <div>
        <h3 className="text-lg font-bold text-stone-800 flex items-center gap-2">
          <Archive size={18} style={{ color: '#476540' }} />
          Backup automatico turni
        </h3>
        <p className="text-sm text-stone-600 mt-0.5">
          Gli snapshot dei turni vengono creati automaticamente al primo accesso
          admin trascorso l'intervallo. La gestione (creazione manuale, eliminazione,
          ripristino) e` in <strong>Admin → Backup/Ripristino</strong>.
        </p>

        <div className="mt-3 rounded-lg border border-stone-300 bg-white p-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="text-xs">
              <span className="block text-stone-600 mb-0.5 font-medium">
                Intervallo auto-backup (giorni)
              </span>
              <input type="text"
                inputMode="numeric"
                value={backupInt}
                onChange={e => {
                  const v = e.target.value.replace(/[^0-9]/g, '').slice(0, 3)
                  setBackupInt(v); setBkDirty(true)
                }}
                className="w-24 px-2 py-1.5 rounded border border-stone-300 text-sm font-semibold text-center" />
              <span className="block text-[10px] text-stone-500 mt-0.5">
                0 = auto-backup disattivato
              </span>
            </label>
            <label className="text-xs">
              <span className="block text-stone-600 mb-0.5 font-medium">
                Quanti backup tenere
              </span>
              <input type="text"
                inputMode="numeric"
                value={backupKeep}
                onChange={e => {
                  const v = e.target.value.replace(/[^0-9]/g, '').slice(0, 3)
                  setBackupKeep(v); setBkDirty(true)
                }}
                className="w-24 px-2 py-1.5 rounded border border-stone-300 text-sm font-semibold text-center" />
              <span className="block text-[10px] text-stone-500 mt-0.5">
                Oltre questo numero, i piu` vecchi vengono cancellati
              </span>
            </label>
          </div>
          <div className="mt-3 flex justify-end">
            <button
              onClick={handleSaveBackup}
              disabled={!bkDirty || bkSaving || !config}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold text-white shadow disabled:opacity-50 transition-colors"
              style={{ background: bkDirty && !bkSaving ? '#476540' : '#9ca3af' }}>
              <Save size={13} />
              {bkSaving ? 'Salvataggio…' : 'Salva backup'}
            </button>
          </div>
        </div>
      </div>

      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-stone-800 flex items-center gap-2">
          <Settings size={20} style={{ color: '#476540' }} />
          Impostazioni
        </h2>
        <p className="text-sm text-stone-600 mt-0.5">
          Numero atteso di medici per slot / mezza giornata / tipo di giorno.
          Usato dal check di consistenza in <strong>Modifica Turni</strong> per
          segnalare giorni in cui il count effettivo non corrisponde all'atteso.
        </p>
        <p className="text-xs text-stone-500 mt-1">
          Convenzione: <strong>0</strong> = nessun controllo per quello slot.
        </p>
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

      {/* Form a tabella: 3 colonne (Feriale | Sabato | Festivo) × 6 righe */}
      <div className="rounded-lg border border-stone-300 bg-white p-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-200">
              <th className="text-left py-2 px-2 font-semibold text-stone-700" style={{ width: '40%' }}>
                Slot
              </th>
              <th className="text-center py-2 px-2 font-semibold text-stone-700">
                Feriale
                <div className="text-[10px] font-normal text-stone-500">(Lun – Ven)</div>
              </th>
              <th className="text-center py-2 px-2 font-semibold text-stone-700">
                Sabato
                <div className="text-[10px] font-normal text-stone-500">(solo sabato)</div>
              </th>
              <th className="text-center py-2 px-2 font-semibold text-stone-700">
                Festivo
                <div className="text-[10px] font-normal text-stone-500">(Dom + festivi)</div>
              </th>
            </tr>
          </thead>
          <tbody>
            {/* SUB */}
            <tr className="border-b border-stone-100">
              <td className="py-2 px-2"><div className="flex items-center gap-2">
                <span className="inline-block w-3 h-3 rounded-full" style={{ background: '#fecaca', border: '1px solid #dc2626' }} />
                <span className="font-medium">SUB mattina</span></div></td>
              {numCell('sub_mattina_feriale')}{numCell('sub_mattina_sabato')}{numCell('sub_mattina_festivo')}
            </tr>
            <tr className="border-b border-stone-100">
              <td className="py-2 px-2"><div className="flex items-center gap-2">
                <span className="inline-block w-3 h-3 rounded-full" style={{ background: '#fecaca', border: '1px solid #dc2626' }} />
                <span className="font-medium">SUB pomeriggio</span></div></td>
              {numCell('sub_pomeriggio_feriale')}{numCell('sub_pomeriggio_sabato')}{numCell('sub_pomeriggio_festivo')}
            </tr>
            {/* MED */}
            <tr className="border-b border-stone-100">
              <td className="py-2 px-2"><div className="flex items-center gap-2">
                <span className="inline-block w-3 h-3 rounded-full" style={{ background: '#bae6fd', border: '1px solid #0284c7' }} />
                <span className="font-medium">MED mattina</span></div></td>
              {numCell('med_mattina_feriale')}{numCell('med_mattina_sabato')}{numCell('med_mattina_festivo')}
            </tr>
            <tr className="border-b border-stone-100">
              <td className="py-2 px-2"><div className="flex items-center gap-2">
                <span className="inline-block w-3 h-3 rounded-full" style={{ background: '#bae6fd', border: '1px solid #0284c7' }} />
                <span className="font-medium">MED pomeriggio</span></div></td>
              {numCell('med_pomeriggio_feriale')}{numCell('med_pomeriggio_sabato')}{numCell('med_pomeriggio_festivo')}
            </tr>
            {/* SUPPORTO (jolly grigio): celle che lavorano senza flag SUB/MED */}
            <tr className="border-b border-stone-100">
              <td className="py-2 px-2"><div className="flex items-center gap-2">
                <span className="inline-block w-3 h-3 rounded-full" style={{ background: '#d4d4d4', border: '1px solid #6b7280' }} />
                <span className="font-medium">Supporto mattina</span></div></td>
              {numCell('sup_mattina_feriale')}{numCell('sup_mattina_sabato')}{numCell('sup_mattina_festivo')}
            </tr>
            <tr>
              <td className="py-2 px-2"><div className="flex items-center gap-2">
                <span className="inline-block w-3 h-3 rounded-full" style={{ background: '#d4d4d4', border: '1px solid #6b7280' }} />
                <span className="font-medium">Supporto pomeriggio</span></div></td>
              {numCell('sup_pomeriggio_feriale')}{numCell('sup_pomeriggio_sabato')}{numCell('sup_pomeriggio_festivo')}
            </tr>
          </tbody>
        </table>
      </div>

      {/* Pulsanti salva */}
      <div className="flex justify-end gap-2 flex-wrap">
        {/* Salva con validità dal… — sempre visibile. Applica le soglie del
            form solo da una certa data, archiviando le precedenti nello
            storico (per non far scattare errori sulla vecchia turnazione). */}
        <button
          onClick={openValiditaModal}
          disabled={!config || saving || savingValidita}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white shadow disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          style={{ background: !config || saving || savingValidita ? '#9ca3af' : '#7a5a2f' }}
          title="Applica queste soglie solo a partire da una certa data, mantenendo le precedenti per i giorni anteriori">
          <CalendarClock size={14} />
          Salva con validità dal…
        </button>
        <button
          onClick={handleSave}
          disabled={!dirty || saving || !config}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white shadow disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          style={{ background: dirty && !saving ? '#476540' : '#9ca3af' }}>
          <Save size={14} />
          {saving ? 'Salvataggio…' : 'Salva impostazioni'}
        </button>
      </div>

      {/* Esempio interpretativo */}
      <div className="rounded-lg p-3 text-xs text-stone-600 space-y-1.5"
        style={{ background: '#f4f1ea', border: '1px solid #d5ccb8' }}>
        <p>
          <strong className="text-stone-700">Come funziona il count:</strong> ogni cella di calendario contribuisce in base
          al suo TC e ai placement SUB/MED. Esempio: <code>L</code> con <code>slot_mattina=SUB</code> e
          <code> slot_pomeriggio=MED</code> conta 1 per "SUB mattina" e 1 per "MED pomeriggio". Una <code>M</code>
          con <code>slot_mattina=SUB</code> conta 1 per "SUB mattina" (e niente pomeriggio).
        </p>
        <p>
          <strong className="text-stone-700">Supporto (jolly, cerchio grigio):</strong> una cella che <em>lavora</em>
          (M/P/L) ma <em>non</em> e` assegnata né a SUB né a MED conta come Supporto. È il caso del pomeridiano
          "aiuto" che fa da spalla a entrambi: nel giorno ti aspetti es. 2 SUB + 2 MED + 1 Supporto.
        </p>
        <p>
          <strong className="text-stone-700">Salva con validità dal…:</strong> applica queste soglie solo ai giorni
          <strong> ≥ </strong> alla data scelta; per i giorni precedenti restano valide le soglie salvate prima.
          Utile dopo un <strong>Aggiorna turnazione</strong>, quando la composizione cambia da una certa data in poi.
        </p>
      </div>

      {/* ── SEZIONE FESTIVITÀ LOCALI (custom) ───────────────────────── */}
      <div className="mt-4">
        <h3 className="text-lg font-bold text-stone-800 flex items-center gap-2">
          <CalendarPlus size={18} style={{ color: '#476540' }} />
          Festività Locali
        </h3>
        <p className="text-sm text-stone-600 mt-0.5">
          Aggiungi date trattate come festive oltre alle festività nazionali italiane
          (es. <strong>santo patrono</strong>, eventi locali). Quel giorno appare come
          festivo nel calendario, nel conteggio "F" del riepilogo e nei check di consistenza
          (atteso "festivo" invece di "feriale"). Eliminando una festività, tutto torna come prima.
        </p>

        {/* Form aggiunta */}
        <div className="mt-3 rounded-lg border border-stone-300 bg-white p-3">
          <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr_auto] gap-2 items-end">
            <label className="text-xs">
              <span className="block text-stone-600 mb-0.5">Data</span>
              <input type="date"
                value={festData}
                onChange={e => setFestData(e.target.value)}
                className="px-2 py-1.5 rounded border border-stone-300 text-sm" />
            </label>
            <label className="text-xs">
              <span className="block text-stone-600 mb-0.5">Descrizione</span>
              <input type="text"
                value={festDescr}
                onChange={e => setFestDescr(e.target.value)}
                placeholder="Es. Santo Patrono, San Vito, …"
                className="w-full px-2 py-1.5 rounded border border-stone-300 text-sm" />
            </label>
            <button
              onClick={handleAggiungiFestivita}
              disabled={festSaving}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold text-white shadow disabled:opacity-50 transition-colors"
              style={{ background: '#476540' }}>
              {festSaving ? <Loader2 size={13} className="animate-spin" /> : <CalendarPlus size={13} />}
              Aggiungi
            </button>
          </div>
          {festErr && (
            <div className="mt-2 px-2 py-1 rounded text-xs"
              style={{ background: '#fde0e0', color: '#7a2020', border: '1px solid #f0c0c0' }}>
              {festErr}
            </div>
          )}
        </div>

        {/* Lista festività locali */}
        {festivitaList.length === 0 ? (
          <p className="mt-3 text-xs text-stone-500 italic">
            Nessuna festività locale configurata.
          </p>
        ) : (
          <div className="mt-3 rounded-lg border border-stone-300 bg-white overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: '#f4f1ea' }}>
                  <th className="px-3 py-2 text-left font-semibold text-stone-700" style={{ width: 180 }}>Data</th>
                  <th className="px-3 py-2 text-left font-semibold text-stone-700">Descrizione</th>
                  <th className="px-3 py-2" style={{ width: 60 }}></th>
                </tr>
              </thead>
              <tbody>
                {festivitaList.map(f => (
                  <tr key={f.id} className="border-t border-stone-200">
                    <td className="px-3 py-2 font-mono text-xs">
                      {fmtDataLunga(f.data)}
                    </td>
                    <td className="px-3 py-2 text-stone-700">{f.descrizione}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => handleEliminaFestivita(f.id, f.descrizione, f.data)}
                        className="text-red-600 hover:text-red-800 transition-colors p-1"
                        title="Elimina festività">
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── SEZIONE FESTIVITÀ ITALIANE NEL PERIODO ──────────────────── */}
      {/* Read-only: serve all'admin per ricordarsi quali festività nazionali
          ricadono nel periodo della configurazione attiva. Non si possono
          eliminare/modificare (sono hardcoded in src/lib/holidays.ts). */}
      {config && festivitaItaliane.length > 0 && (
        <div className="mt-2">
          <h3 className="text-lg font-bold text-stone-800 flex items-center gap-2">
            <CalendarDays size={18} style={{ color: '#7a2233' }} />
            Festività Italiane nel periodo
            <span className="text-xs font-normal text-stone-500">
              ({periodoLabel})
            </span>
          </h3>
          <p className="text-sm text-stone-600 mt-0.5">
            Riferimento delle festività nazionali italiane (incluse Pasqua e Pasquetta
            calcolate) che cadono nel periodo. Sono <strong>sempre</strong> considerate
            festive nei calcoli e nei check.
          </p>
          <div className="mt-3 rounded-lg border border-stone-300 bg-white overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: '#f4f1ea' }}>
                  <th className="px-3 py-2 text-left font-semibold text-stone-700" style={{ width: 180 }}>Data</th>
                  <th className="px-3 py-2 text-left font-semibold text-stone-700">Festività</th>
                </tr>
              </thead>
              <tbody>
                {festivitaItaliane.map(f => (
                  <tr key={f.data} className="border-t border-stone-200">
                    <td className="px-3 py-2 font-mono text-xs">
                      {fmtDataLunga(f.data)}
                    </td>
                    <td className="px-3 py-2 text-stone-700">{f.nome}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Modal: Salva impostazioni con validità dal… ─────────────── */}
      {validitaOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.45)' }}
          onClick={() => { if (!savingValidita) setValiditaOpen(false) }}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-5"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-bold text-stone-800 flex items-center gap-2">
                <CalendarClock size={18} style={{ color: '#7a5a2f' }} />
                Salva con validità dal…
              </h3>
              <button onClick={() => setValiditaOpen(false)}
                disabled={savingValidita}
                className="text-stone-400 hover:text-stone-700 transition-colors disabled:opacity-40">
                <X size={18} />
              </button>
            </div>
            <p className="text-sm text-stone-600 mb-3">
              Le soglie impostate sopra varranno <strong>a partire dal giorno scelto</strong>.
              Per i giorni precedenti restano valide le soglie attuali, che vengono archiviate.
              Usalo quando hai cambiato la composizione con un <strong>Aggiorna turnazione</strong>.
            </p>
            <label className="block text-xs text-stone-600 mb-1 font-medium">
              Valide a partire dal
            </label>
            <input type="date"
              value={validitaData}
              onChange={e => setValiditaData(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-stone-300 text-sm mb-4" />
            {err && (
              <div className="mb-3 px-2 py-1.5 rounded text-xs"
                style={{ background: '#fde0e0', color: '#7a2020', border: '1px solid #f0c0c0' }}>
                {err}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button onClick={() => setValiditaOpen(false)}
                disabled={savingValidita}
                className="px-3 py-1.5 rounded-lg text-sm font-semibold text-stone-700 bg-stone-100 hover:bg-stone-200 disabled:opacity-50 transition-colors">
                Annulla
              </button>
              <button onClick={handleSaveConValidita}
                disabled={savingValidita || !validitaData}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-semibold text-white shadow disabled:opacity-50 transition-colors"
                style={{ background: '#7a5a2f' }}>
                {savingValidita ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                {savingValidita ? 'Salvataggio…' : 'Conferma'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal {...confirmState.opts} open={confirmState.open}
        onConfirm={confirmState.onConfirm} onCancel={confirmState.onCancel} />
    </div>
  )
}
