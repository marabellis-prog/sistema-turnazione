import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, Lock, Search, CalendarClock, Loader2, AlertTriangle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useReparto } from '../../contexts/RepartoContext'
import { useConfigReparto } from '../../hooks/useConfigReparto'

interface ArchivioRow {
  id: string
  periodo_inizio: string
  periodo_fine: string
  etichetta: string | null
  note: string | null
  created_at: string
  created_by: string | null
  snapshot: { turni?: unknown[]; medici?: unknown[] } | null
}

const fmt = (iso: string) => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}` }

export function ArchivioPage() {
  const { repartoAttivo, repartoCorrente } = useReparto()
  const { data: config } = useConfigReparto()
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [showChiudi, setShowChiudi] = useState(false)
  const [svuota, setSvuota] = useState(false)
  const [note, setNote] = useState('')

  const { data: archivio = [], isLoading } = useQuery<ArchivioRow[]>({
    queryKey: ['turnazioni-archivio', repartoAttivo],
    queryFn: async () => {
      const { data, error } = await supabase.from('turnazioni_archivio')
        .select('id, periodo_inizio, periodo_fine, etichetta, note, created_at, created_by, snapshot')
        .eq('reparto_id', repartoAttivo).order('periodo_inizio', { ascending: false })
      if (error) throw error
      return (data ?? []) as ArchivioRow[]
    },
    staleTime: 0, refetchOnMount: 'always',
  })

  const periodoCorrente = config
    ? `${fmt(`${config.anno_inizio}-${String(config.mese_inizio).padStart(2, '0')}-${String(config.giorno_inizio ?? 1).padStart(2, '0')}`)} → ${config.anno_fine}/${String(config.mese_fine).padStart(2, '0')}`
    : '—'

  async function chiudi() {
    setBusy(true); setErr(null)
    try {
      const { error } = await supabase.rpc('chiudi_turnazione', {
        p_reparto: repartoAttivo, p_svuota_turni: svuota, p_note: note.trim() || null,
      })
      if (error) throw error
      setShowChiudi(false); setNote(''); setSvuota(false)
      ;['turnazioni-archivio', 'configurazione', 'turni', 'turni-modifica',
        'schemi-esistenti', 'schema-meta', 'turnazione-anteprima'].forEach(k =>
        qc.invalidateQueries({ queryKey: [k] }))
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  const filtro = archivio.filter(a => {
    if (!q.trim()) return true
    const s = `${fmt(a.periodo_inizio)} ${fmt(a.periodo_fine)} ${a.etichetta ?? ''} ${a.note ?? ''}`.toLowerCase()
    return s.includes(q.trim().toLowerCase())
  })

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-xl font-bold text-stone-800 flex items-center gap-2">
          <Archive size={20} style={{ color: '#476540' }} />
          Archivio turnazioni · {repartoCorrente?.nome ?? '…'}
        </h2>
        <p className="text-sm text-stone-500 mt-0.5">
          Chiudi la turnazione corrente per congelarla qui (snapshot di sola lettura) e liberare lo schema per una nuova.
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
          Turnazione corrente: <strong>{periodoCorrente}</strong>
        </div>
        <button onClick={() => { setErr(null); setShowChiudi(true) }} disabled={!config}
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
                  {a.etichetta && <span className="ml-2 text-stone-500 font-normal">· {a.etichetta}</span>}
                </div>
                <div className="text-xs text-stone-500 mt-0.5">
                  {(a.snapshot?.turni?.length ?? 0)} turni · {(a.snapshot?.medici?.length ?? 0)} medici
                  {a.note && <span className="italic"> · "{a.note}"</span>}
                </div>
              </div>
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
              Salva uno <strong>snapshot congelato</strong> della turnazione corrente ({periodoCorrente}) nell'archivio e <strong>libera lo schema</strong> (potrai modificarlo/eliminarlo o crearne uno nuovo).
            </p>
            <label className="flex items-start gap-2 text-sm text-stone-700 mb-3 cursor-pointer">
              <input type="checkbox" checked={svuota} onChange={e => setSvuota(e.target.checked)} className="mt-0.5" />
              <span><strong>Svuota anche i turni correnti</strong> (calendario vuoto, pronto per una nuova turnazione). Se lasci deselezionato, i turni restano visibili finché non rigeneri.</span>
            </label>
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="Nota (facoltativa) — es. motivo della chiusura"
              className="w-full px-2.5 py-1.5 text-sm rounded-lg border border-stone-200 focus:border-[#476540] outline-none mb-4" />
            <div className="flex items-center justify-end gap-2">
              <button onClick={() => setShowChiudi(false)} disabled={busy} className="btn-secondary py-2 px-4 text-sm">Annulla</button>
              <button onClick={chiudi} disabled={busy}
                className="inline-flex items-center gap-1.5 py-2 px-4 text-sm rounded-lg font-semibold text-white disabled:opacity-50" style={{ background: '#0284c7' }}>
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Lock size={14} />} Chiudi e archivia
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
