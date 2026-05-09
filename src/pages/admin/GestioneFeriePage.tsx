import { useState, useMemo, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Calendar, Check, X, Plus, Clock, Wifi, WifiOff, Settings, Save } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useConfirm } from '../../hooks/useConfirm'
import { useFerieRealtime } from '../../hooks/useFerieRealtime'
import { ConfirmModal } from '../../components/ConfirmModal'
import { FerieModal, expandRange, toRanges, type DayChange } from '../../components/FerieModal'
import type { Medico, Ferie, Configurazione } from '../../types'

// ══════════════════════════════════════════════════════════════════
// HELPER LOCALI
// ══════════════════════════════════════════════════════════════════

/** Formatta una data ISO in dd/mm o dd/mm/yy se anno diverso da corrente */
function fmtIt(iso: string): string {
  const [y, m, d] = iso.split('-')
  const curY = String(new Date().getFullYear())
  return y !== curY ? `${d}/${m}/${y.slice(2)}` : `${d}/${m}`
}

// ══════════════════════════════════════════════════════════════════
// PAGINA PRINCIPALE
// ══════════════════════════════════════════════════════════════════

export function GestioneFeriePage() {
  const qc = useQueryClient()
  const { confirm, confirmState } = useConfirm()

  const [modalMedico,    setModalMedico]    = useState<Medico | null>(null)
  const [insertMedicoId, setInsertMedicoId] = useState('')
  const [errore,         setErrore]         = useState('')
  // Impostazioni: form locale + dirty tracking. Sync iniziale dal config DB.
  const [maxFerieDraft,    setMaxFerieDraft]   = useState<string>('2')
  const [maxFerieSaving,   setMaxFerieSaving]  = useState(false)
  const [maxFerieMsg,      setMaxFerieMsg]     = useState<string | null>(null)
  const { realtimeOn } = useFerieRealtime()

  // ── Query ────────────────────────────────────────────────────
  const { data: medici = [] } = useQuery<Medico[]>({
    queryKey: ['medici-tutti'],
    queryFn: async () => {
      // Ordine alfabetico per la pagina Gestione Ferie: la rotazione
      // (numero_ordine) qui non serve, è più utile trovare il medico
      // a colpo d'occhio. Sort lato client con localeCompare 'it' per
      // gestire correttamente accenti e maiuscole/minuscole.
      const { data, error } = await supabase.from('medici').select('*')
      if (error) throw error
      return (data ?? []).sort((a, b) =>
        a.nome.localeCompare(b.nome, 'it', { sensitivity: 'base' })
      )
    },
  })

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

  // Sync del draft quando il config arriva dal DB
  useEffect(() => {
    if (config?.max_ferie_concomitanti != null) {
      setMaxFerieDraft(String(config.max_ferie_concomitanti))
    }
  }, [config?.max_ferie_concomitanti])

  const { data: ferie = [] } = useQuery<Ferie[]>({
    queryKey: ['ferie'],
    queryFn: async () => {
      const { data, error } = await supabase.from('ferie').select('*').order('data_inizio')
      if (error) throw error
      return data ?? []
    },
    // staleTime: 0 + refetchOnMount sempre = ogni volta che l'admin entra
    // in questa pagina (es. veniva da Genera Calendario), React Query
    // rifetcha SUBITO le ferie. Senza, il queryClient globale ha staleTime
    // 5min → la cache vecchia veniva servita e le richieste arrivate
    // nel frattempo restavano invisibili fino al timeout.
    staleTime:      0,
    refetchOnMount: 'always',
    // Polling di fallback ogni 15s. Se il Supabase Realtime è correttamente
    // configurato (ALTER PUBLICATION supabase_realtime ADD TABLE ferie)
    // gli aggiornamenti sono già istantanei via WebSocket; questo poll è
    // una rete di sicurezza per garantire visibilità entro 15s al massimo.
    refetchInterval: 15_000,
    refetchIntervalInBackground: false, // sospende quando la tab è nascosta
  })

  // ── Ferie raggruppate per medico ─────────────────────────────
  const ferieByMedico = useMemo(() => {
    const m = new Map<string, Ferie[]>()
    for (const f of ferie) {
      if (!m.has(f.medico_id)) m.set(f.medico_id, [])
      m.get(f.medico_id)!.push(f)
    }
    return m
  }, [ferie])

  const ferieInAttesa = useMemo(() => ferie.filter(f => !f.approvate), [ferie])

  // ── Salva modifiche da modal ─────────────────────────────────
  async function handleSaveChanges(medicoId: string, changes: Map<string, DayChange>) {
    setErrore('')
    try {
      const toRemove    = [...changes.entries()].filter(([,v]) => v === 'remove').map(([k]) => k)
      const toAdd       = [...changes.entries()].filter(([,v]) => v === 'add').map(([k]) => k)
      const toRemoveSet = new Set(toRemove)

      // ── Gestisci rimozioni ───────────────────────────────────
      const doctorFerie = ferieByMedico.get(medicoId) ?? []
      const affected    = doctorFerie.filter(f =>
        expandRange(f.data_inizio, f.data_fine).some(d => toRemoveSet.has(d))
      )

      for (const record of affected) {
        const allDays       = expandRange(record.data_inizio, record.data_fine)
        const removedFromThis = allDays.filter(d => toRemoveSet.has(d))
        const remaining       = allDays.filter(d => !toRemoveSet.has(d))

        const { error } = await supabase.from('ferie').delete().eq('id', record.id)
        if (error) throw error

        // Resetta is_ferie per i giorni rimossi (solo se erano approvati)
        if (record.approvate && removedFromThis.length > 0) {
          for (const { start, end } of toRanges(removedFromThis)) {
            await supabase.from('turni')
              .update({ is_ferie: false })
              .eq('medico_id', medicoId)
              .gte('data', start).lte('data', end)
          }
        }

        // Ricrea i giorni rimanenti come nuovi record (stesso approvate)
        for (const { start, end } of toRanges(remaining)) {
          await supabase.from('ferie').insert({
            medico_id: medicoId, data_inizio: start, data_fine: end,
            note: record.note, approvate: record.approvate,
          })
        }
      }

      // ── Gestisci aggiunte: crea richieste (approvate=false) ──
      for (const { start, end } of toRanges(toAdd)) {
        await supabase.from('ferie').insert({
          medico_id: medicoId, data_inizio: start, data_fine: end,
          note: null, approvate: false,
        })
      }

      qc.invalidateQueries({ queryKey: ['ferie'] })
      qc.invalidateQueries({ queryKey: ['ferie-ranges'] })
      qc.invalidateQueries({ queryKey: ['turni'] })
    } catch (e: unknown) {
      setErrore((e as Error).message)
    }
  }

  // ── Approva ferie ────────────────────────────────────────────
  async function approvaFerie(f: Ferie) {
    const { error } = await supabase.from('ferie').update({ approvate: true }).eq('id', f.id)
    if (error) { setErrore(error.message); return }
    await supabase.from('turni')
      .update({ is_ferie: true })
      .eq('medico_id', f.medico_id)
      .gte('data', f.data_inizio).lte('data', f.data_fine)
    qc.invalidateQueries({ queryKey: ['ferie'] })
    qc.invalidateQueries({ queryKey: ['ferie-ranges'] })
    qc.invalidateQueries({ queryKey: ['turni'] })
  }

  // ── Elimina ferie ────────────────────────────────────────────
  async function eliminaFerie(f: Ferie) {
    const ok = await confirm({
      title:        'Elimina richiesta ferie',
      message:      `Eliminare definitivamente le ferie dal ${fmtIt(f.data_inizio)} al ${fmtIt(f.data_fine)}?`,
      confirmLabel: 'Elimina', danger: true,
    })
    if (!ok) return
    await supabase.from('ferie').delete().eq('id', f.id)
    if (f.approvate) {
      await supabase.from('turni')
        .update({ is_ferie: false })
        .eq('medico_id', f.medico_id)
        .gte('data', f.data_inizio).lte('data', f.data_fine)
    }
    qc.invalidateQueries({ queryKey: ['ferie'] })
    qc.invalidateQueries({ queryKey: ['ferie-ranges'] })
    qc.invalidateQueries({ queryKey: ['turni'] })
  }

  // ── Helpers display ──────────────────────────────────────────
  function medNome(id: string) {
    return medici.find(m => m.id === id)?.nome ?? '—'
  }

  function ferieText(medicoId: string): string {
    const appr = (ferieByMedico.get(medicoId) ?? []).filter(f => f.approvate)
    if (!appr.length) return '—'
    return appr.map(f =>
      f.data_inizio === f.data_fine
        ? fmtIt(f.data_inizio)
        : `${fmtIt(f.data_inizio)}→${fmtIt(f.data_fine)}`
    ).join('  ·  ')
  }

  const insertMedico = medici.find(m => m.id === insertMedicoId) ?? null

  // ── Salva impostazioni ferie ─────────────────────────────────
  async function salvaImpostazioniFerie() {
    const n = parseInt(maxFerieDraft, 10)
    if (isNaN(n) || n < 0) {
      setMaxFerieMsg('⚠ Valore non valido (deve essere un intero ≥ 0)')
      setTimeout(() => setMaxFerieMsg(null), 4000)
      return
    }
    if (!config?.id) {
      setMaxFerieMsg('⚠ Configurazione non trovata. Salva prima il calendario in "Genera Calendario".')
      setTimeout(() => setMaxFerieMsg(null), 4000)
      return
    }
    setMaxFerieSaving(true)
    try {
      const { error } = await supabase.from('configurazione')
        .update({
          max_ferie_concomitanti: n,
          updated_at: new Date().toISOString(),
        })
        .eq('id', config.id)
      if (error) throw error
      setMaxFerieMsg(`✓ Salvato — max ${n} ${n === 1 ? 'persona' : 'persone'} in ferie/giorno`)
      qc.invalidateQueries({ queryKey: ['configurazione'] })
      setTimeout(() => setMaxFerieMsg(null), 3000)
    } catch (e) {
      setMaxFerieMsg(`Errore: ${(e as Error).message}`)
      setTimeout(() => setMaxFerieMsg(null), 5000)
    } finally {
      setMaxFerieSaving(false)
    }
  }

  // Dirty: il draft è diverso dal valore salvato → bottone Salva attivo
  const maxFerieDirty = String(config?.max_ferie_concomitanti ?? '') !== maxFerieDraft

  // ─────────────────────────────────────────────────────────────
  return (
    <div className="max-w-3xl space-y-5">
      <ConfirmModal {...confirmState.opts} open={confirmState.open}
        onConfirm={confirmState.onConfirm} onCancel={confirmState.onCancel} />

      {/* Modal calendario ferie */}
      {modalMedico && (
        <FerieModal
          medico={modalMedico}
          ferie={ferieByMedico.get(modalMedico.id) ?? []}
          onSave={changes => handleSaveChanges(modalMedico.id, changes)}
          onClose={() => { setModalMedico(null); setInsertMedicoId('') }}
        />
      )}

      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-stone-800 flex items-center gap-2">
            <Calendar size={20} style={{ color: '#476540' }} />
            Gestione Ferie
          </h2>
          <p className="text-sm text-stone-600 mt-0.5">
            Inserisci e approva le ferie dei medici.
          </p>
        </div>
        {/* Indicatore real-time: verde quando il canale è SUBSCRIBED, grigio
            altrimenti. Le richieste dei medici dalla pagina pubblica entrano
            in lista in pochi ms senza ricaricare la pagina. */}
        <span
          className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-full shrink-0"
          style={realtimeOn
            ? { background: '#d5e5d0', color: '#1f4a18', border: '1px solid #9ab488' }
            : { background: '#f3f4f6', color: '#6b7280', border: '1px solid #d1d5db' }}
          title={realtimeOn
            ? 'In ascolto: le richieste dei medici compaiono qui in tempo reale'
            : 'Realtime non attivo — clicca refresh manuale'}>
          {realtimeOn
            ? <><Wifi size={12} /> Live</>
            : <><WifiOff size={12} /> Offline</>}
        </span>
      </div>

      {errore && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {errore}
        </div>
      )}

      {/* ══ 1 · FERIE DA APPROVARE ══════════════════════════════ */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-stone-200 flex items-center gap-2"
          style={{ background: '#fef9ec' }}>
          <Clock size={14} className="text-amber-500 shrink-0" />
          <h3 className="font-semibold text-stone-800 text-sm">Ferie da approvare</h3>
          {ferieInAttesa.length > 0 && (
            <span className="ml-auto text-xs font-bold px-2 py-0.5 rounded-full"
              style={{ background: '#f59e0b', color: '#fff' }}>
              {ferieInAttesa.length}
            </span>
          )}
        </div>

        {ferieInAttesa.length === 0 ? (
          <p className="px-4 py-8 text-sm text-stone-400 italic text-center">
            Nessuna richiesta in attesa di approvazione.
          </p>
        ) : (
          <div className="divide-y divide-stone-100">
            {ferieInAttesa.map(f => (
              <div key={f.id} className="flex items-center gap-3 px-4 py-3">
                <div className="w-2 h-2 rounded-full shrink-0"
                  style={{ background: '#f59e0b' }} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-stone-800">{medNome(f.medico_id)}</p>
                  <p className="text-xs text-stone-500 mt-0.5">
                    {fmtIt(f.data_inizio)} → {fmtIt(f.data_fine)}
                    {f.data_inizio !== f.data_fine && (
                      <span className="ml-1 text-stone-400">
                        ({expandRange(f.data_inizio, f.data_fine).length} giorni)
                      </span>
                    )}
                    {f.note && <span className="ml-2 italic text-stone-400">"{f.note}"</span>}
                  </p>
                </div>
                <button onClick={() => approvaFerie(f)}
                  className="btn-primary py-1 px-3 text-xs gap-1 shrink-0">
                  <Check size={12} /> Approva
                </button>
                <button onClick={() => eliminaFerie(f)}
                  className="p-1.5 rounded text-stone-400 hover:text-red-500 hover:bg-red-50 transition-colors shrink-0"
                  title="Elimina richiesta">
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ══ 2 · FERIE APPROVATE ═════════════════════════════════ */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-stone-200 flex items-center gap-2"
          style={{ background: '#f0f4ee' }}>
          <Check size={14} className="shrink-0" style={{ color: '#476540' }} />
          <h3 className="font-semibold text-stone-800 text-sm">Ferie approvate</h3>
          <span className="text-xs text-stone-500 ml-1">
            · clicca 📅 per modificare
          </span>
        </div>
        <div className="divide-y divide-stone-100">
          {medici.map(med => (
            <div key={med.id} className="flex items-center gap-3 px-4 py-2.5 group">
              <span className="text-sm font-semibold text-stone-800 w-36 shrink-0 truncate"
                title={med.nome}>
                {med.nome}
              </span>
              <input
                readOnly
                value={ferieText(med.id)}
                className="flex-1 text-xs text-stone-600 bg-stone-50 border border-stone-200
                           rounded px-2.5 py-1.5 focus:outline-none cursor-default min-w-0"
                style={{ fontFamily: 'ui-monospace, monospace' }}
              />
              <button
                onClick={() => setModalMedico(med)}
                className="p-1.5 rounded shrink-0 transition-colors"
                style={{ color: '#476540' }}
                onMouseEnter={e => (e.currentTarget.style.background = '#e0e8d8')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                title={`Gestisci ferie di ${med.nome}`}>
                <Calendar size={16} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* ══ 3 · INSERISCI MANUALMENTE ═══════════════════════════ */}
      <div className="card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Plus size={14} style={{ color: '#476540' }} />
          <h3 className="font-semibold text-stone-800 text-sm">Inserisci ferie manualmente</h3>
        </div>
        <div className="flex gap-3 items-center">
          <select
            value={insertMedicoId}
            onChange={e => setInsertMedicoId(e.target.value)}
            className="input flex-1 text-sm">
            <option value="">Seleziona turnista…</option>
            {medici.map(m => (
              <option key={m.id} value={m.id}>{m.nome}</option>
            ))}
          </select>
          <button
            onClick={() => insertMedico && setModalMedico(insertMedico)}
            disabled={!insertMedicoId}
            className="btn-primary py-2 px-4 text-sm gap-1.5 shrink-0">
            <Calendar size={14} /> Apri calendario
          </button>
        </div>
        <p className="text-xs text-stone-500 leading-relaxed">
          I giorni selezionati vengono salvati come <strong>richiesta</strong> (non ancora approvata) e
          appariranno in "Ferie da approvare" per conferma. Per approvare direttamente usa il pulsante
          nella sezione sopra.
        </p>
      </div>

      {/* ══ 4 · IMPOSTAZIONI FERIE ════════════════════════════════ */}
      <div className="card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Settings size={14} style={{ color: '#476540' }} />
          <h3 className="font-semibold text-stone-800 text-sm">Impostazioni Ferie</h3>
        </div>

        <div className="flex flex-wrap gap-3 items-center">
          <label className="text-sm text-stone-600 flex items-center gap-2 flex-1 min-w-[260px]">
            <span>Persone in ferie nello stesso giorno (max):</span>
            <input
              type="number"
              min={0}
              step={1}
              value={maxFerieDraft}
              onChange={e => setMaxFerieDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') salvaImpostazioniFerie() }}
              disabled={maxFerieSaving}
              className="input w-20 text-sm text-center"
              placeholder="2"
            />
          </label>
          <button
            onClick={salvaImpostazioniFerie}
            disabled={!maxFerieDirty || maxFerieSaving || !config}
            className="btn-primary py-1.5 px-4 text-sm gap-1.5 shrink-0">
            <Save size={13} />
            {maxFerieSaving ? 'Salvataggio…' : 'Salva'}
          </button>
        </div>

        {maxFerieMsg && (
          <div className="text-xs px-2 py-1.5 rounded"
            style={maxFerieMsg.startsWith('✓')
              ? { background: '#d5e5d0', color: '#2e5a28' }
              : { background: '#fde0e0', color: '#7a2020' }}>
            {maxFerieMsg}
          </div>
        )}

        <p className="text-xs text-stone-500 leading-relaxed">
          Numero massimo di medici che possono essere in ferie contemporaneamente nello
          stesso giorno. Verrà usato per validare le richieste in arrivo.
        </p>
      </div>
    </div>
  )
}
