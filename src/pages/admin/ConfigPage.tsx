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

import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Settings, Save, AlertTriangle, CheckCircle2, CalendarPlus, Trash2, Loader2,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useConfigurazioneRealtime } from '../../hooks/useConfigurazioneRealtime'
import { useFestivitaCustom, useFestivitaCustomRealtime } from '../../hooks/useFestivitaCustom'
import { useConfirm } from '../../hooks/useConfirm'
import { ConfirmModal } from '../../components/ConfirmModal'
import type { Configurazione } from '../../types'

const MESI_IT = [
  'gen','feb','mar','apr','mag','giu','lug','ago','set','ott','nov','dic',
]
function fmtDataLunga(iso: string): string {
  const [y, m, d] = iso.split('-').map(s => parseInt(s, 10))
  if (!y || !m || !d) return iso
  return `${d} ${MESI_IT[m-1] ?? '?'} ${y}`
}

// Le 8 chiavi delle impostazioni in ordine di rendering
const KEYS = [
  'sub_mattina_feriale',
  'sub_mattina_festivo',
  'sub_pomeriggio_feriale',
  'sub_pomeriggio_festivo',
  'med_mattina_feriale',
  'med_mattina_festivo',
  'med_pomeriggio_feriale',
  'med_pomeriggio_festivo',
] as const

type SettingKey = typeof KEYS[number]

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

  // Form festività custom
  const [festData,    setFestData]    = useState('')
  const [festDescr,   setFestDescr]   = useState('')
  const [festSaving,  setFestSaving]  = useState(false)
  const [festErr,     setFestErr]     = useState<string | null>(null)
  const { festivita: festivitaList } = useFestivitaCustom()

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

  // Sync iniziale del draft dal DB
  useEffect(() => {
    if (!config) return
    const next: Record<SettingKey, string> = {} as any
    for (const k of KEYS) next[k] = String(config[k] ?? 0)
    setDraft(next)
    setDirty(false)
  }, [config])

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

  // Helper: input numerico per una specifica impostazione
  function NumInput({ k }: { k: SettingKey }) {
    return (
      <input
        type="text"
        inputMode="numeric"
        value={draft[k] ?? ''}
        onChange={e => setField(k, e.target.value)}
        className="w-14 px-2 py-1 rounded border border-stone-300 text-center text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-green-300"
      />
    )
  }

  return (
    <div className="flex flex-col gap-4 max-w-3xl">
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

      {/* Form a tabella: 2 colonne (Feriale | Festivo) × 4 righe (sub/med × mattina/pomeriggio) */}
      <div className="rounded-lg border border-stone-300 bg-white p-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-200">
              <th className="text-left py-2 px-2 font-semibold text-stone-700" style={{ width: '50%' }}>
                Slot
              </th>
              <th className="text-center py-2 px-2 font-semibold text-stone-700">
                Feriale
                <div className="text-[10px] font-normal text-stone-500">(Lun – Sab)</div>
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
              <td className="py-2 px-2">
                <div className="flex items-center gap-2">
                  <span className="inline-block w-3 h-3 rounded-full" style={{ background: '#fecaca', border: '1px solid #dc2626' }} />
                  <span className="font-medium">SUB mattina</span>
                </div>
              </td>
              <td className="text-center"><NumInput k="sub_mattina_feriale" /></td>
              <td className="text-center"><NumInput k="sub_mattina_festivo" /></td>
            </tr>
            <tr className="border-b border-stone-100">
              <td className="py-2 px-2">
                <div className="flex items-center gap-2">
                  <span className="inline-block w-3 h-3 rounded-full" style={{ background: '#fecaca', border: '1px solid #dc2626' }} />
                  <span className="font-medium">SUB pomeriggio</span>
                </div>
              </td>
              <td className="text-center"><NumInput k="sub_pomeriggio_feriale" /></td>
              <td className="text-center"><NumInput k="sub_pomeriggio_festivo" /></td>
            </tr>
            {/* MED */}
            <tr className="border-b border-stone-100">
              <td className="py-2 px-2">
                <div className="flex items-center gap-2">
                  <span className="inline-block w-3 h-3 rounded-full" style={{ background: '#bae6fd', border: '1px solid #0284c7' }} />
                  <span className="font-medium">MED mattina</span>
                </div>
              </td>
              <td className="text-center"><NumInput k="med_mattina_feriale" /></td>
              <td className="text-center"><NumInput k="med_mattina_festivo" /></td>
            </tr>
            <tr>
              <td className="py-2 px-2">
                <div className="flex items-center gap-2">
                  <span className="inline-block w-3 h-3 rounded-full" style={{ background: '#bae6fd', border: '1px solid #0284c7' }} />
                  <span className="font-medium">MED pomeriggio</span>
                </div>
              </td>
              <td className="text-center"><NumInput k="med_pomeriggio_feriale" /></td>
              <td className="text-center"><NumInput k="med_pomeriggio_festivo" /></td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Pulsante salva */}
      <div className="flex justify-end gap-2">
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
      <div className="rounded-lg p-3 text-xs text-stone-600"
        style={{ background: '#f4f1ea', border: '1px solid #d5ccb8' }}>
        <strong className="text-stone-700">Come funziona il count:</strong> ogni cella di calendario contribuisce in base
        al suo TC e ai placement SUB/MED. Esempio: <code>L</code> con <code>slot_mattina=SUB</code> e
        <code> slot_pomeriggio=MED</code> conta 1 per "SUB mattina" e 1 per "MED pomeriggio". Una <code>M</code>
        con <code>slot_mattina=SUB</code> conta 1 per "SUB mattina" (e niente pomeriggio).
      </div>

      {/* ── SEZIONE FESTIVITÀ E RICORRENZE CUSTOM ───────────────────── */}
      <div className="mt-4">
        <h3 className="text-lg font-bold text-stone-800 flex items-center gap-2">
          <CalendarPlus size={18} style={{ color: '#476540' }} />
          Festività e ricorrenze
        </h3>
        <p className="text-sm text-stone-600 mt-0.5">
          Aggiungi date che devono essere trattate come festive oltre alle festività nazionali italiane
          (es. <strong>santo patrono</strong>, eventi locali). Da quel momento in poi quel giorno appare
          come festivo nel calendario, nel conteggio "F" del riepilogo e nei check di consistenza
          (atteso "festivo" invece di "feriale").
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

        {/* Lista festività esistenti */}
        {festivitaList.length === 0 ? (
          <p className="mt-3 text-xs text-stone-500 italic">
            Nessuna festività custom configurata. Aggiungi date sopra per integrarle col calendario italiano.
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

      <ConfirmModal {...confirmState.opts} open={confirmState.open}
        onConfirm={confirmState.onConfirm} onCancel={confirmState.onCancel} />
    </div>
  )
}
