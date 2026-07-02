import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, Lock, Search, CalendarClock, Loader2, AlertTriangle, RotateCcw, Eye, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useReparto } from '../../contexts/RepartoContext'
import { REPARTO_11N } from '../../contexts/RepartoContext'
import { useConfigReparto } from '../../hooks/useConfigReparto'
import { BackupTurniPreview } from '../../components/BackupTurniPreview'
import type { Turno, Medico } from '../../types'

interface ArchivioRow {
  id: string
  periodo_inizio: string
  periodo_fine: string
  etichetta: string | null
  note: string | null
  created_at: string
  created_by: string | null
  snapshot: { turni?: unknown[]; medici?: unknown[]; chiusura?: { totale?: boolean } } | null
}

const p2 = (n: number) => String(n).padStart(2, '0')
const fmt = (iso: string) => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}` }
const isoPlusOneDay = (iso: string) => {
  const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + 1)
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
}

export function ArchivioPage() {
  const { repartoAttivo, repartoCorrente } = useReparto()
  const { data: config } = useConfigReparto()
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [showChiudi, setShowChiudi] = useState(false)
  const [finoA, setFinoA] = useState('')
  const [note, setNote] = useState('')
  const [viewId, setViewId] = useState<string | null>(null)

  const { data: archivio = [], isLoading } = useQuery<ArchivioRow[]>({
    queryKey: ['turnazioni-archivio', repartoAttivo],
    queryFn: async () => {
      const { data, error } = await supabase.from('turnazioni_archivio')
        .select('id, periodo_inizio, periodo_fine, etichetta, note, created_at, created_by, snapshot')
        .eq('reparto_id', repartoAttivo)
        .order('periodo_fine', { ascending: false }).order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as ArchivioRow[]
    },
    staleTime: 0, refetchOnMount: 'always',
  })

  // Ultimo turno inserito → limite massimo per la data di chiusura.
  const { data: maxTurno } = useQuery<string | null>({
    queryKey: ['turni-max-data', repartoAttivo],
    queryFn: async () => {
      const { data, error } = await supabase.from('turni')
        .select('data').eq('reparto_id', repartoAttivo)
        .order('data', { ascending: false }).limit(1).maybeSingle()
      if (error) throw error
      return data?.data ?? null
    },
    staleTime: 0, refetchOnMount: 'always',
  })

  // Snapshot on-demand per "Vedi turnazione".
  const { data: viewSnap } = useQuery({
    queryKey: ['archivio-snapshot', viewId], enabled: !!viewId,
    queryFn: async () => {
      const { data, error } = await supabase.from('turnazioni_archivio')
        .select('snapshot').eq('id', viewId!).single()
      if (error) throw error
      return data.snapshot as { turni: Turno[]; medici: Medico[] }
    },
  })

  const inizioConfigISO = config
    ? `${config.anno_inizio}-${p2(config.mese_inizio)}-${p2(config.giorno_inizio ?? 1)}` : null
  // Inizio del periodo ANCORA attivo (dopo eventuali chiusure precedenti).
  const inizioAttivo = config?.chiusa_fino_a ? isoPlusOneDay(config.chiusa_fino_a) : inizioConfigISO
  const periodoAttivo = (inizioAttivo && maxTurno)
    ? `${fmt(inizioAttivo)} → ${fmt(maxTurno)}`
    : (maxTurno ? `fino al ${fmt(maxTurno)}` : 'nessun turno')

  const invalidaTutto = () =>
    ['turnazioni-archivio', 'configurazione', 'turni', 'turni-modifica', 'turni-max-data',
     'schemi-esistenti', 'schema-meta', 'turnazione-anteprima', 'reparto-ha-turni'].forEach(k =>
      qc.invalidateQueries({ queryKey: [k] }))

  async function chiudi() {
    if (!finoA) return
    setBusy(true); setErr(null)
    try {
      const { error } = await supabase.rpc('chiudi_turnazione', {
        p_reparto: repartoAttivo, p_fino_a: finoA, p_note: note.trim() || null,
      })
      if (error) throw error
      setShowChiudi(false); setNote(''); setFinoA('')
      invalidaTutto()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  async function riapri(id: string) {
    if (!window.confirm('Riaprire questa turnazione? I turni archiviati torneranno attivi in Modifica Turni.')) return
    setBusy(true); setErr(null)
    try {
      const { error } = await supabase.rpc('riapri_turnazione', { p_archivio_id: id })
      if (error) throw error
      invalidaTutto()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  const filtro = archivio.filter(a => {
    if (!q.trim()) return true
    const s = `${fmt(a.periodo_inizio)} ${fmt(a.periodo_fine)} ${a.etichetta ?? ''} ${a.note ?? ''}`.toLowerCase()
    return s.includes(q.trim().toLowerCase())
  })
  // "Ultima chiusura" = prima voce dell'elenco NON filtrato (ordinato per periodo_fine desc).
  const ultimaId = archivio[0]?.id ?? null

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-xl font-bold text-stone-800 flex items-center gap-2">
          <Archive size={20} style={{ color: '#476540' }} />
          Archivio turnazioni · {repartoCorrente?.nome ?? '…'}
        </h2>
        <p className="text-sm text-stone-500 mt-0.5">
          Chiudi la turnazione <strong>fino a una data</strong>: il periodo chiuso viene congelato qui (fotografia di sola lettura) e sparisce da Modifica Turni. Puoi <strong>riaprire</strong> l'ultima chiusura o <strong>rivedere</strong> ogni fotografia.
        </p>
      </div>

      {err && (
        <div className="rounded-lg px-3 py-2 text-xs flex items-start gap-2" style={{ background: '#fee2e2', color: '#991b1b' }}>
          <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {err}
        </div>
      )}

      {/* Chiudi turnazione corrente */}
      <div className="card p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-stone-700">
          <CalendarClock size={16} style={{ color: '#0284c7' }} />
          Periodo attivo: <strong>{periodoAttivo}</strong>
        </div>
        <button onClick={() => { setErr(null); setFinoA(''); setShowChiudi(true) }} disabled={!config || !maxTurno}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold text-white shadow-sm disabled:opacity-50"
          style={{ background: '#0284c7' }}>
          <Lock size={14} /> Chiudi turnazione…
        </button>
      </div>

      {/* Ricerca */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Cerca per periodo o nota…"
            className="w-full pl-8 pr-2 py-1.5 text-sm rounded-lg border border-stone-200 focus:border-[#476540] outline-none" />
        </div>
        <span className="text-xs text-stone-400">{filtro.length} archiviate</span>
      </div>

      {/* Elenco */}
      {isLoading ? (
        <div className="flex items-center gap-2 text-stone-500 text-sm py-6"><Loader2 size={16} className="animate-spin" /> Caricamento…</div>
      ) : filtro.length === 0 ? (
        <div className="card p-6 text-sm text-stone-500 text-center">Nessuna turnazione archiviata.</div>
      ) : (
        <div className="divide-y divide-stone-100 rounded-lg border border-stone-200 bg-white">
          {filtro.map(a => (
            <div key={a.id} className="flex items-center gap-3 px-4 py-3">
              <Archive size={15} className="shrink-0 text-stone-400" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-stone-800">
                  {fmt(a.periodo_inizio)} → {fmt(a.periodo_fine)}
                  {a.snapshot?.chiusura?.totale && <span className="ml-2 text-[10px] uppercase tracking-wide text-amber-700 font-bold">totale</span>}
                  {a.etichetta && <span className="ml-2 text-stone-500 font-normal">· {a.etichetta}</span>}
                </div>
                <div className="text-xs text-stone-500 mt-0.5">
                  {(a.snapshot?.turni?.length ?? 0)} turni · {(a.snapshot?.medici?.length ?? 0)} medici
                  {a.note && <span className="italic"> · "{a.note}"</span>}
                </div>
              </div>
              <button onClick={() => setViewId(a.id)}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold border border-stone-200 text-stone-600 hover:bg-stone-50 shrink-0">
                <Eye size={13} /> Vedi turnazione
              </button>
              {a.id === ultimaId && (
                <button onClick={() => riapri(a.id)} disabled={busy}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold text-white shrink-0 disabled:opacity-50"
                  style={{ background: '#b45309' }} title="Riapri l'ultima turnazione chiusa">
                  <RotateCcw size={13} /> Riapri
                </button>
              )}
              <div className="text-[10px] text-stone-400 font-mono shrink-0 text-right">
                {new Date(a.created_at).toLocaleDateString('it')}<br />{a.created_by ?? ''}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal Chiudi turnazione */}
      {showChiudi && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={() => !busy && setShowChiudi(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-stone-800 text-base mb-1 flex items-center gap-2"><Lock size={16} style={{ color: '#0284c7' }} /> Chiudi turnazione</h3>
            <p className="text-sm text-stone-600 mb-3">
              Scegli <strong>fino a quale giorno</strong> chiudere (incluso). Il periodo chiuso viene archiviato e <strong>sparisce</strong> da Modifica Turni. Se chiudi fino all'<strong>ultimo turno</strong> ({maxTurno ? fmt(maxTurno) : '—'}), il reparto torna "da generare".
            </p>
            <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wide mb-1">Chiudi fino al</label>
            <input type="date" value={finoA} onChange={e => setFinoA(e.target.value)}
              min={inizioAttivo ?? undefined} max={maxTurno ?? undefined} required
              className="w-full px-2.5 py-1.5 text-sm rounded-lg border border-stone-200 focus:border-[#476540] outline-none mb-1" />
            <p className="text-[11px] text-stone-400 mb-3">
              Consentito da {inizioAttivo ? fmt(inizioAttivo) : '—'} a {maxTurno ? fmt(maxTurno) : '—'}.
            </p>
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="Nota (facoltativa) — es. motivo della chiusura"
              className="w-full px-2.5 py-1.5 text-sm rounded-lg border border-stone-200 focus:border-[#476540] outline-none mb-4" />
            <div className="flex items-center justify-end gap-2">
              <button onClick={() => setShowChiudi(false)} disabled={busy} className="btn-secondary py-2 px-4 text-sm">Annulla</button>
              <button onClick={chiudi} disabled={busy || !finoA}
                className="inline-flex items-center gap-1.5 py-2 px-4 text-sm rounded-lg font-semibold text-white disabled:opacity-50" style={{ background: '#0284c7' }}>
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Lock size={14} />} Chiudi e archivia
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Vedi turnazione (snapshot read-only) */}
      {viewId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3" style={{ background: 'rgba(0,0,0,0.55)' }} onClick={() => setViewId(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[95vw] max-h-[90vh] overflow-auto p-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-stone-800 text-base flex items-center gap-2"><Eye size={16} style={{ color: '#476540' }} /> Turnazione archiviata</h3>
              <button onClick={() => setViewId(null)} className="text-stone-400 hover:text-stone-600"><X size={18} /></button>
            </div>
            {!viewSnap ? (
              <div className="flex items-center gap-2 text-stone-500 text-sm py-8 justify-center"><Loader2 size={16} className="animate-spin" /> Caricamento fotografia…</div>
            ) : (
              <BackupTurniPreview
                turni={(viewSnap.turni ?? []) as Turno[]}
                medici={(viewSnap.medici ?? []) as Medico[]}
                dinamico={repartoAttivo !== REPARTO_11N} />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
