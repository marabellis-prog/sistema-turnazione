/**
 * ImpostazioniBackupBox
 *
 * Policy di backup GLOBALE (centrale): ogni quanti giorni fare l'auto-backup
 * e quanti tenerne. È una decisione dell'admin valida per TUTTI i reparti
 * (i singoli backup/ripristini restano per-reparto in Backup/Ripristino).
 * Vive in Centro di Controllo → visibile solo al super-admin.
 */

import { useState, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Archive, Save, CheckCircle2, Loader2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useImpostazioniGlobali } from '../hooks/useImpostazioniGlobali'

export function ImpostazioniBackupBox() {
  const qc = useQueryClient()
  const { data: policy } = useImpostazioniGlobali()
  const [intervallo, setIntervallo] = useState('7')
  const [daTenere,   setDaTenere]   = useState('10')
  const [dirty,   setDirty]   = useState(false)
  const [saving,  setSaving]  = useState(false)
  const [msg,     setMsg]     = useState<string | null>(null)
  const [err,     setErr]     = useState<string | null>(null)

  useEffect(() => {
    if (!policy) return
    setIntervallo(String(policy.backup_intervallo_giorni ?? 7))
    setDaTenere(String(policy.backup_da_tenere ?? 10))
    setDirty(false)
  }, [policy])

  async function salva() {
    setSaving(true); setErr(null); setMsg(null)
    try {
      const intN  = Math.max(0, parseInt(intervallo || '0', 10) || 0)
      const keepN = Math.max(1, parseInt(daTenere   || '1', 10) || 1)
      const { error } = await supabase.from('impostazioni_globali')
        .update({ backup_intervallo_giorni: intN, backup_da_tenere: keepN, updated_at: new Date().toISOString() })
        .eq('id', true)
      if (error) throw error
      setMsg('Policy backup salvata.')
      setDirty(false)
      qc.invalidateQueries({ queryKey: ['impostazioni-globali'] })
      setTimeout(() => setMsg(null), 3000)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <h2 className="text-xl font-bold text-stone-800 flex items-center gap-2">
        <Archive size={20} style={{ color: '#476540' }} />
        Backup automatico (policy globale)
      </h2>
      <p className="text-sm text-stone-600 mt-0.5">
        Vale per <strong>tutti i reparti</strong>: ogni reparto viene snapshottato
        automaticamente secondo questo intervallo. Backup manuali e ripristino si
        gestiscono per reparto in <em>Backup/Ripristino</em>.
      </p>

      <div className="mt-3 rounded-lg border border-stone-300 bg-white p-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="text-xs">
            <span className="block text-stone-600 mb-0.5 font-medium">Intervallo auto-backup (giorni)</span>
            <input type="text" inputMode="numeric" value={intervallo}
              onChange={e => { setIntervallo(e.target.value.replace(/[^0-9]/g, '').slice(0, 3)); setDirty(true) }}
              className="w-24 px-2 py-1.5 rounded border border-stone-300 text-sm font-semibold text-center" />
            <span className="block text-[10px] text-stone-500 mt-0.5">0 = auto-backup disattivato</span>
          </label>
          <label className="text-xs">
            <span className="block text-stone-600 mb-0.5 font-medium">Quanti backup tenere (per reparto)</span>
            <input type="text" inputMode="numeric" value={daTenere}
              onChange={e => { setDaTenere(e.target.value.replace(/[^0-9]/g, '').slice(0, 3)); setDirty(true) }}
              className="w-24 px-2 py-1.5 rounded border border-stone-300 text-sm font-semibold text-center" />
            <span className="block text-[10px] text-stone-500 mt-0.5">Oltre questo numero, i più vecchi vengono cancellati</span>
          </label>
        </div>
        {(msg || err) && (
          <div className="mt-2 text-xs flex items-center gap-1.5" style={{ color: err ? '#991b1b' : '#2e5a28' }}>
            {!err && <CheckCircle2 size={13} />}{err || msg}
          </div>
        )}
        <div className="mt-3 flex justify-end">
          <button onClick={salva} disabled={!dirty || saving}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold text-white shadow disabled:opacity-50 transition-colors"
            style={{ background: dirty && !saving ? '#476540' : '#9ca3af' }}>
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            {saving ? 'Salvataggio…' : 'Salva policy'}
          </button>
        </div>
      </div>
    </div>
  )
}
