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
import { Settings, Save, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useConfigurazioneRealtime } from '../../hooks/useConfigurazioneRealtime'
import type { Configurazione } from '../../types'

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

  // Local form state — uso stringhe per evitare problemi con input "0"
  // e con eventuali valori non ancora sincronizzati dal DB.
  const [draft,   setDraft]   = useState<Record<SettingKey, string>>({} as any)
  const [dirty,   setDirty]   = useState(false)
  const [saving,  setSaving]  = useState(false)
  const [msg,     setMsg]     = useState<string | null>(null)
  const [err,     setErr]     = useState<string | null>(null)

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
    </div>
  )
}
