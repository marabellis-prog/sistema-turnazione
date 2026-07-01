/**
 * AnteprimaTurnazionePage (admin)
 *
 * Mostra la bozza di turnazione in attesa (se esiste): tabella completa coi
 * cambi in rosso + elenco cambi. L'admin può **Approvare** (→ produzione) o
 * **Scartare** la bozza.
 */

import { useState, useEffect, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLegendaDinamica } from '../../hooks/useLegendaDinamica'
import { CalendarClock, CheckCircle, Trash2, Loader2, AlertTriangle, Save } from 'lucide-react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useConfigReparto } from '../../hooks/useConfigReparto'
import { useMediciReparto } from '../../hooks/useMediciReparto'
import { useReparto, REPARTO_11N } from '../../contexts/RepartoContext'
import { useConfirm } from '../../hooks/useConfirm'
import { ConfirmModal } from '../../components/ConfirmModal'
import { usePendingActions } from '../../contexts/PendingActionsContext'
import { useTurnazioneAnteprima } from '../../hooks/useTurnazioneAnteprima'
import { useFestivitaCustom } from '../../hooks/useFestivitaCustom'
import { AnteprimaTurnazioneView } from '../../components/AnteprimaTurnazioneView'
import { RiepilogoTurni } from '../../components/RiepilogoTurni'
import { pubblicaBozza, scartaBozza, salvaModificheBozza } from '../../lib/aggiornaTurnazione'
import { applicaDropCella } from '../../lib/anteprimaEditing'
import { isFestivo } from '../../lib/holidays'
import type { Configurazione, Medico, Turno, ColonnaCal } from '../../types'

export function AnteprimaTurnazionePage() {
  const qc = useQueryClient()
  const { confirm, confirmState } = useConfirm()
  const { clearAll } = usePendingActions()
  const { repartoAttivo } = useReparto()
  const { set: festivitaCustomSet } = useFestivitaCustom(repartoAttivo)
  const [busy, setBusy] = useState<null | 'approva' | 'scarta' | 'salva'>(null)
  const [err, setErr]   = useState<string | null>(null)
  const [turniLocal, setTurniLocal] = useState<Turno[]>([])
  const [dirty, setDirty] = useState(false)

  const { data: anteprima, isLoading } = useTurnazioneAnteprima(repartoAttivo)

  // Carica i turni editabili dallo snapshot quando cambia la bozza.
  useEffect(() => {
    setTurniLocal(anteprima?.snapshot?.turni ?? [])
    setDirty(false)
  }, [anteprima?.id])

  // Drop dalla legenda su una cella della riga "nuova" → modifica locale.
  function handleDropCell(medicoId: string, data: string, payload: string) {
    setTurniLocal(prev => prev.map(t =>
      (t.medico_id === medicoId && t.data === data) ? applicaDropCella(t, payload) : t))
    setDirty(true)
  }

  async function handleSalva() {
    if (!anteprima) return
    setBusy('salva'); setErr(null)
    try {
      await salvaModificheBozza(anteprima.id, turniLocal, anteprima.meta)
      setDirty(false)
      qc.invalidateQueries({ queryKey: ['turnazione-anteprima'] })
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const { data: medici = [] } = useMediciReparto()
  const { data: config } = useConfigReparto()

  const repartoDinamico = repartoAttivo !== REPARTO_11N
  // Legenda DINAMICA = unione dei turni/proprietà dei due schemi che convivono
  // nel range (vecchio prima del cutover, nuovo dal cutover).
  const legNew = useLegendaDinamica(repartoAttivo, anteprima?.meta?.schema_nuovo)
  const legOld = useLegendaDinamica(repartoAttivo, config?.schema_attivo)
  const tipiTurnoLeg = useMemo(() => {
    const by = new Map<string, typeof legNew.tipiTurno[number]>()
    for (const t of [...legNew.tipiTurno, ...legOld.tipiTurno]) if (!by.has(t.sigla)) by.set(t.sigla, t)
    return [...by.values()]
  }, [legNew.tipiTurno, legOld.tipiTurno])
  const proprietaLeg = useMemo(() => {
    const by = new Map<string, typeof legNew.proprieta[number]>()
    for (const p of [...legNew.proprieta, ...legOld.proprieta]) if (!by.has(p.sigla)) by.set(p.sigla, p)
    return [...by.values()]
  }, [legNew.proprieta, legOld.proprieta])

  // Fabbisogno DINAMICO (schema_fabbisogno) di tutti gli schemi del reparto:
  // l'atteso per giorno usa lo schema vecchio (prima del cutover) o nuovo (dal
  // cutover) e l'ambito del giorno (normale/sabato/festivi).
  const { data: fabbisognoAll = [] } = useQuery<{ schema_num: number; ambito: string; turno_sigla: string; totale: number; per_proprieta: Record<string, number> }[]>({
    queryKey: ['antep-fabbisogno', repartoAttivo],
    enabled: repartoDinamico,
    staleTime: 0,
    queryFn: async () => {
      const { data, error } = await supabase.from('schema_fabbisogno')
        .select('schema_num, ambito, turno_sigla, totale, per_proprieta').eq('reparto_id', repartoAttivo)
      if (error) throw error
      return (data ?? []) as { schema_num: number; ambito: string; turno_sigla: string; totale: number; per_proprieta: Record<string, number> }[]
    },
  })
  const attesoDin = useMemo(() => {
    const cutover   = anteprima?.meta?.cutover ?? '9999-99-99'
    const schemaNew = anteprima?.meta?.schema_nuovo
    const schemaOld = config?.schema_attivo
    return (data: string) => {
      const dd = new Date(data + 'T00:00:00')
      const fest = dd.getDay() === 0 || isFestivo(dd, festivitaCustomSet)
      const ambito = fest ? 'festivi' : dd.getDay() === 6 ? 'sabato' : 'normale'
      const schema = data >= cutover ? schemaNew : schemaOld
      let sub = 0, med = 0, tot = 0
      for (const r of fabbisognoAll) {
        if (r.schema_num !== schema || r.ambito !== ambito) continue
        const pp = r.per_proprieta ?? {}
        sub += pp.SUB ?? 0; med += pp.MED ?? 0; tot += r.totale ?? 0
      }
      return { sub, med, sup: Math.max(0, tot - sub - med) }
    }
  }, [fabbisognoAll, anteprima?.meta, config?.schema_attivo, festivitaCustomSet])

  // Riepilogo DINAMICO (righe = turnisti) — riuso RiepilogoTurni.
  const riepilogoNode = useMemo(() => {
    if (!repartoDinamico || turniLocal.length === 0) return null
    const byKey = new Map(turniLocal.map(t => [`${t.medico_id}|${t.data}`, t]))
    const dates = [...new Set(turniLocal.map(t => t.data))].sort()
    const colonne: ColonnaCal[] = dates.map(d => {
      const dd = new Date(d + 'T00:00:00')
      return { data: d, giorno: dd.getDate(), mese: dd.getMonth() + 1, anno: dd.getFullYear(), isDomenica: dd.getDay() === 0, isFestivo: isFestivo(dd, festivitaCustomSet) }
    })
    return (
      <RiepilogoTurni medici={medici} colonne={colonne}
        getCellInfo={(mid, d) => {
          const t = byKey.get(`${mid}|${d}`)
          return { tc: (t?.turno_clinico ?? '') as Turno['turno_clinico'], slot_mattina: t?.slot_mattina ?? null, slot_pomeriggio: t?.slot_pomeriggio ?? null, proprieta: t?.proprieta ?? [] }
        }}
        tipiTurno={tipiTurnoLeg} proprieta={proprietaLeg} festivitaCustomSet={festivitaCustomSet} />
    )
  }, [repartoDinamico, turniLocal, medici, tipiTurnoLeg, proprietaLeg, festivitaCustomSet])

  async function handleApprova() {
    if (!anteprima || !config) return
    if (dirty) { setErr('Hai modifiche non salvate: premi prima Salva.'); return }
    const ok = await confirm({
      title:        'Pubblica la turnazione',
      message:      'La bozza diventerà il calendario in produzione (sostituisce quello attuale). Procedere?',
      confirmLabel: 'Approva e pubblica',
    })
    if (!ok) return
    setBusy('approva'); setErr(null)
    try {
      await pubblicaBozza(anteprima, config.id, repartoAttivo)
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
    <div className="flex flex-col gap-3 h-full">
      <ConfirmModal {...confirmState.opts} open={confirmState.open}
        onConfirm={confirmState.onConfirm} onCancel={confirmState.onCancel} />

      <div className="flex items-center justify-between flex-wrap gap-2 shrink-0">
        <h2 className="text-xl font-bold text-stone-800 flex items-center gap-2">
          <CalendarClock size={20} style={{ color: '#0284c7' }} />
          Anteprima turnazione
        </h2>
        {anteprima && (
          <div className="flex items-center gap-2">
            <button onClick={handleSalva} disabled={busy !== null || !dirty}
              className="py-1.5 px-3 text-xs rounded-lg font-semibold text-white shadow-sm inline-flex items-center gap-1 disabled:opacity-50"
              style={{ background: dirty ? '#16a34a' : '#9ca3af' }}
              title="Salva i cambi preliminari nella bozza (aggiorna l'anteprima per tutti)">
              {busy === 'salva' ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
              Salva
            </button>
            <button onClick={handleScarta} disabled={busy !== null}
              className="btn-secondary py-1.5 px-3 text-xs gap-1">
              {busy === 'scarta' ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
              Scarta
            </button>
            <button onClick={handleApprova} disabled={busy !== null}
              className="py-1.5 px-3 text-xs rounded-lg font-semibold text-white shadow-sm inline-flex items-center gap-1 disabled:opacity-50"
              style={{ background: '#0284c7' }}>
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
        <div className="flex-1 min-h-0">
          <AnteprimaTurnazioneView turni={turniLocal} meta={anteprima.meta} medici={medici}
            festivitaCustomSet={festivitaCustomSet}
            editable={!repartoDinamico} onDropCell={handleDropCell} fullHeight
            dinamico={repartoDinamico}
            tipiTurnoLeg={repartoDinamico ? tipiTurnoLeg : undefined}
            proprietaLeg={repartoDinamico ? proprietaLeg : undefined}
            attesoDin={repartoDinamico ? attesoDin : undefined}
            riepilogoNode={repartoDinamico ? riepilogoNode : undefined} />
        </div>
      )}
    </div>
  )
}
