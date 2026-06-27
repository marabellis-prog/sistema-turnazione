/**
 * AnteprimaTurnazionePage (admin)
 *
 * Mostra la bozza di turnazione in attesa (se esiste): tabella completa coi
 * cambi in rosso + elenco cambi. L'admin può **Approvare** (→ produzione) o
 * **Scartare** la bozza.
 */

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarClock, CheckCircle, Trash2, Loader2, AlertTriangle } from 'lucide-react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useConfirm } from '../../hooks/useConfirm'
import { ConfirmModal } from '../../components/ConfirmModal'
import { usePendingActions } from '../../contexts/PendingActionsContext'
import { useTurnazioneAnteprima } from '../../hooks/useTurnazioneAnteprima'
import { useFestivitaCustom } from '../../hooks/useFestivitaCustom'
import { AnteprimaTurnazioneView } from '../../components/AnteprimaTurnazioneView'
import { pubblicaBozza, scartaBozza } from '../../lib/aggiornaTurnazione'
import type { Configurazione, Medico } from '../../types'

export function AnteprimaTurnazionePage() {
  const qc = useQueryClient()
  const { confirm, confirmState } = useConfirm()
  const { clearAll } = usePendingActions()
  const { set: festivitaCustomSet } = useFestivitaCustom()
  const [busy, setBusy] = useState<null | 'approva' | 'scarta'>(null)
  const [err, setErr]   = useState<string | null>(null)

  const { data: anteprima, isLoading } = useTurnazioneAnteprima()

  const { data: medici = [] } = useQuery<Medico[]>({
    queryKey: ['medici'],
    queryFn: async () => {
      const { data, error } = await supabase.from('medici').select('*').eq('attivo', true).order('numero_ordine')
      if (error) throw error
      return data
    },
  })
  const { data: config } = useQuery<Configurazione | null>({
    queryKey: ['configurazione'],
    queryFn: async () => {
      const { data, error } = await supabase.from('configurazione').select('*')
        .order('updated_at', { ascending: false }).limit(1).maybeSingle()
      if (error) throw error
      return data
    },
  })

  async function handleApprova() {
    if (!anteprima || !config) return
    const ok = await confirm({
      title:        'Pubblica la turnazione',
      message:      'La bozza diventerà il calendario in produzione (sostituisce quello attuale). Procedere?',
      confirmLabel: 'Approva e pubblica',
    })
    if (!ok) return
    setBusy('approva'); setErr(null)
    try {
      await pubblicaBozza(anteprima, config.id)
      clearAll()
      ;['turni', 'turni-modifica', 'ferie-ranges', 'configurazione', 'cambi-turno', 'turnazione-anteprima']
        .forEach(k => qc.invalidateQueries({ queryKey: [k] }))
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function handleScarta() {
    if (!anteprima) return
    const ok = await confirm({
      title:        'Scarta la bozza',
      message:      'L\'anteprima verrà eliminata. La produzione resta invariata. Procedere?',
      confirmLabel: 'Scarta', danger: true,
    })
    if (!ok) return
    setBusy('scarta'); setErr(null)
    try {
      await scartaBozza(anteprima.id)
      qc.invalidateQueries({ queryKey: ['turnazione-anteprima'] })
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="max-w-6xl space-y-4">
      <ConfirmModal {...confirmState.opts} open={confirmState.open}
        onConfirm={confirmState.onConfirm} onCancel={confirmState.onCancel} />

      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-xl font-bold text-stone-800 flex items-center gap-2">
          <CalendarClock size={20} style={{ color: '#0284c7' }} />
          Anteprima turnazione
        </h2>
        {anteprima && (
          <div className="flex items-center gap-2">
            <button onClick={handleScarta} disabled={busy !== null}
              className="btn-secondary py-1.5 px-3 text-xs gap-1">
              {busy === 'scarta' ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
              Scarta
            </button>
            <button onClick={handleApprova} disabled={busy !== null}
              className="py-1.5 px-3 text-xs rounded-lg font-semibold text-white shadow-sm inline-flex items-center gap-1 disabled:opacity-50"
              style={{ background: '#166534' }}>
              {busy === 'approva' ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle size={13} />}
              Approva e pubblica
            </button>
          </div>
        )}
      </div>

      {err && (
        <div className="rounded-lg px-3 py-2 text-xs flex items-start gap-2"
          style={{ background: '#fee2e2', color: '#991b1b' }}>
          <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {err}
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 text-stone-500 text-sm py-10">
          <Loader2 size={18} className="animate-spin" /> Caricamento…
        </div>
      ) : !anteprima ? (
        <div className="card p-6 text-sm text-stone-600">
          Nessuna anteprima in attesa. Creane una da{' '}
          <Link to="/admin/genera" className="font-semibold" style={{ color: '#0284c7' }}>
            Genera Calendario → Aggiorna turnazione
          </Link>.
        </div>
      ) : (
        <AnteprimaTurnazioneView anteprima={anteprima} medici={medici} festivitaCustomSet={festivitaCustomSet} />
      )}
    </div>
  )
}
