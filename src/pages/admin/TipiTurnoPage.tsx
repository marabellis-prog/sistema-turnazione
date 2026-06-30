/**
 * TipiTurnoPage (per-reparto)
 *
 * Definisce i TIPI DI TURNO (M, P, L, REP, o custom es. SWING 10-16) e le
 * PROPRIETA' (SUB / MED / SUP) del reparto attivo, con colore, orario, peso
 * (quanti "turni" vale: L=2, REP=0) e quali meta'-giornata copre.
 *
 * Modello dinamico: ogni reparto ha i suoi tipi. (Il cablaggio nel motore di
 * generazione/rendering arriva in un passo successivo; qui si configurano.)
 */

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Palette, Plus, Trash2, Save, X, Pencil, Tag } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useReparto } from '../../contexts/RepartoContext'
import { useConfirm } from '../../hooks/useConfirm'
import { ConfirmModal } from '../../components/ConfirmModal'
import type { TipoTurno, ProprietaTurno } from '../../types'

type DraftTipo = Omit<TipoTurno, 'id' | 'reparto_id' | 'created_at'>
const EMPTY_TIPO: DraftTipo = {
  sigla: '', nome: '', ora_inizio: '', ora_fine: '', peso: 1,
  copre_mattina: false, copre_pomeriggio: false, is_reperibilita: false,
  colore_bg: '#dde8d5', colore_fg: '#2e4a28', ordine: 0,
}

export function TipiSection({ reparto, schemaNum, onChanged }: { reparto: string; schemaNum: number; onChanged?: () => void }) {
  const qc = useQueryClient()
  const { confirm, confirmState } = useConfirm()
  const [draft, setDraft]   = useState<DraftTipo>(EMPTY_TIPO)
  const [editId, setEditId] = useState<string | null>(null)
  const [err, setErr]       = useState('')

  const { data: tipi = [] } = useQuery<TipoTurno[]>({
    queryKey: ['tipi_turno', reparto, schemaNum],
    queryFn: async () => {
      const { data, error } = await supabase.from('tipi_turno').select('*')
        .eq('reparto_id', reparto).eq('schema_num', schemaNum).order('ordine')
      if (error) throw error
      return (data ?? []) as TipoTurno[]
    },
  })
  const reload = () => { qc.invalidateQueries({ queryKey: ['tipi_turno', reparto] }); onChanged?.() }

  function startNew() { setEditId(null); setDraft({ ...EMPTY_TIPO, ordine: tipi.length + 1 }) }
  function startEdit(t: TipoTurno) {
    setEditId(t.id)
    setDraft({ sigla: t.sigla, nome: t.nome, ora_inizio: t.ora_inizio ?? '', ora_fine: t.ora_fine ?? '',
      peso: t.peso, copre_mattina: t.copre_mattina, copre_pomeriggio: t.copre_pomeriggio,
      is_reperibilita: t.is_reperibilita, colore_bg: t.colore_bg, colore_fg: t.colore_fg, ordine: t.ordine })
  }
  async function salva() {
    const sigla = draft.sigla.trim().toUpperCase()
    if (!sigla) { setErr('Sigla obbligatoria.'); return }
    setErr('')
    const payload = { ...draft, sigla, reparto_id: reparto, schema_num: schemaNum,
      ora_inizio: draft.ora_inizio || null, ora_fine: draft.ora_fine || null }
    const res = editId
      ? await supabase.from('tipi_turno').update(payload).eq('id', editId)
      : await supabase.from('tipi_turno').insert(payload)
    if (res.error) { setErr(res.error.message); return }
    setDraft(EMPTY_TIPO); setEditId(null); reload()
  }
  async function elimina(t: TipoTurno) {
    setErr('')
    // Blocco se ci sono gia' turni con questo tipo (turno_clinico) nel reparto.
    const { count } = await supabase.from('turni').select('id', { count: 'exact', head: true })
      .eq('reparto_id', reparto).eq('turno_clinico', t.sigla)
    if ((count ?? 0) > 0) {
      setErr(`Impossibile eliminare "${t.sigla}": è usato in ${count} turni di questo reparto. Cambia/azzera quei turni prima.`)
      return
    }
    const ok = await confirm({
      title: `Elimina tipo "${t.sigla}"`, message: 'Il tipo di turno verrà eliminato. Procedere?',
      confirmLabel: 'Elimina', danger: true,
    })
    if (!ok) return
    const { error } = await supabase.from('tipi_turno').delete().eq('id', t.id)
    if (error) { setErr(error.message); return }
    reload()
  }

  return (
    <div className="card p-4 space-y-3">
      <ConfirmModal {...confirmState.opts} open={confirmState.open}
        onConfirm={confirmState.onConfirm} onCancel={confirmState.onCancel} />
      <h3 className="font-bold text-stone-800 flex items-center gap-2">
        <Tag size={16} style={{ color: '#476540' }} /> Tipi di turno
      </h3>
      {err && <div className="p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">{err}</div>}

      {/* Lista */}
      <div className="flex flex-wrap gap-2">
        {tipi.map(t => (
          <div key={t.id} className="inline-flex items-center gap-2 border rounded-lg pl-1 pr-2 py-1"
            style={{ borderColor: '#d5ccb8' }}>
            <span className="inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold"
              style={{ background: t.colore_bg, color: t.colore_fg }}>{t.sigla}</span>
            <span className="text-xs">
              <span className="font-semibold">{t.nome || t.sigla}</span>
              <span className="text-stone-400"> · peso {t.peso}{t.is_reperibilita ? ' · REP' : ''}</span>
            </span>
            <button onClick={() => startEdit(t)} className="text-stone-400 hover:text-blue-600"><Pencil size={12} /></button>
            <button onClick={() => elimina(t)} className="text-stone-400 hover:text-red-600"><Trash2 size={12} /></button>
          </div>
        ))}
        {tipi.length === 0 && <span className="text-xs text-stone-400 italic">Nessun tipo di turno.</span>}
      </div>

      {/* Form add/edit */}
      <div className="border-t border-stone-100 pt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 items-end">
        <label className="text-xs">Sigla*
          <input value={draft.sigla} onChange={e => setDraft({ ...draft, sigla: e.target.value.toUpperCase() })}
            className="input text-sm py-1 uppercase" placeholder="M / SWING" /></label>
        <label className="text-xs">Nome
          <input value={draft.nome} onChange={e => setDraft({ ...draft, nome: e.target.value })}
            className="input text-sm py-1" placeholder="Mattina" /></label>
        <label className="text-xs">Dalle
          <input type="time" value={draft.ora_inizio ?? ''} onChange={e => setDraft({ ...draft, ora_inizio: e.target.value })}
            className="input text-sm py-1" /></label>
        <label className="text-xs">Alle
          <input type="time" value={draft.ora_fine ?? ''} onChange={e => setDraft({ ...draft, ora_fine: e.target.value })}
            className="input text-sm py-1" /></label>
        <label className="text-xs">Peso (turni)
          <input type="number" min={0} max={3} value={draft.peso}
            onChange={e => setDraft({ ...draft, peso: parseInt(e.target.value || '0', 10) })}
            className="input text-sm py-1 w-16" /></label>
        <label className="text-xs flex items-center gap-1 mt-4">
          <input type="checkbox" checked={draft.copre_mattina} onChange={e => setDraft({ ...draft, copre_mattina: e.target.checked })} /> Mattina</label>
        <label className="text-xs flex items-center gap-1 mt-4">
          <input type="checkbox" checked={draft.copre_pomeriggio} onChange={e => setDraft({ ...draft, copre_pomeriggio: e.target.checked })} /> Pomeriggio</label>
        <label className="text-xs flex items-center gap-1 mt-4">
          <input type="checkbox" checked={draft.is_reperibilita} onChange={e => setDraft({ ...draft, is_reperibilita: e.target.checked })} /> Reperibilità</label>
        <label className="text-xs">Colore
          <input type="color" value={draft.colore_bg} onChange={e => setDraft({ ...draft, colore_bg: e.target.value })}
            className="w-full h-8 rounded border border-stone-300" /></label>
        <label className="text-xs">Testo
          <input type="color" value={draft.colore_fg} onChange={e => setDraft({ ...draft, colore_fg: e.target.value })}
            className="w-full h-8 rounded border border-stone-300" /></label>
        <div className="col-span-2 flex gap-2">
          <button onClick={salva} className="btn-primary py-1 px-3 text-xs gap-1">
            <Save size={12} /> {editId ? 'Salva modifica' : 'Aggiungi tipo'}
          </button>
          {editId && (
            <button onClick={() => { setEditId(null); setDraft(EMPTY_TIPO) }} className="btn-secondary py-1 px-2 text-xs">
              <X size={12} /> Annulla
            </button>
          )}
          {!editId && (
            <button onClick={startNew} className="btn-secondary py-1 px-2 text-xs">
              <Plus size={12} /> Pulisci
            </button>
          )}
        </div>
      </div>

      <p className="text-[11px] text-stone-500 leading-snug">
        <strong>Mattina / Pomeriggio</strong>: quali metà-giornata copre il turno (M→mattina,
        P→pomeriggio, L→entrambe). <strong>Reperibilità</strong>: il turno è di reperibilità e NON
        conta nella copertura. <strong>Peso</strong>: quanti turni vale (un L vale 2). Servono al
        controllo automatico "quanti turni ci sono / quanti ne mancano" per ogni giorno.
      </p>
    </div>
  )
}

export function ProprietaSection({ reparto, schemaNum, onChanged }: { reparto: string; schemaNum: number; onChanged?: () => void }) {
  const qc = useQueryClient()
  const { confirm, confirmState } = useConfirm()
  const [sigla, setSigla]   = useState('')
  const [nome, setNome]     = useState('')
  const [colore, setColore] = useState('#d4d4d4')
  const [esclusiva, setEsclusiva] = useState(false)
  const [err, setErr]       = useState('')

  const { data: props = [] } = useQuery<ProprietaTurno[]>({
    queryKey: ['proprieta_turno', reparto, schemaNum],
    queryFn: async () => {
      const { data, error } = await supabase.from('proprieta_turno').select('*')
        .eq('reparto_id', reparto).eq('schema_num', schemaNum).order('ordine')
      if (error) throw error
      return (data ?? []) as ProprietaTurno[]
    },
  })
  const reload = () => { qc.invalidateQueries({ queryKey: ['proprieta_turno', reparto] }); onChanged?.() }

  async function aggiungi() {
    const s = sigla.trim().toUpperCase()
    if (!s) return
    setErr('')
    const { error } = await supabase.from('proprieta_turno')
      .insert({ reparto_id: reparto, schema_num: schemaNum, sigla: s, nome: nome.trim(), colore_bg: colore, esclusiva, ordine: props.length + 1 })
    if (error) { setErr(error.message); return }
    setSigla(''); setNome(''); setEsclusiva(false); reload()
  }
  async function elimina(p: ProprietaTurno) {
    setErr('')
    // Blocco se la proprieta' (SUB/MED) e' usata negli slot dei turni.
    const { count } = await supabase.from('turni').select('id', { count: 'exact', head: true })
      .eq('reparto_id', reparto).or(`slot_mattina.eq.${p.sigla},slot_pomeriggio.eq.${p.sigla}`)
    if ((count ?? 0) > 0) {
      setErr(`Impossibile eliminare "${p.sigla}": è usata in ${count} turni di questo reparto.`)
      return
    }
    const ok = await confirm({
      title: `Elimina proprietà "${p.sigla}"`, message: 'Procedere?',
      confirmLabel: 'Elimina', danger: true,
    })
    if (!ok) return
    const { error } = await supabase.from('proprieta_turno').delete().eq('id', p.id)
    if (error) { setErr(error.message); return }
    reload()
  }

  return (
    <div className="card p-4 space-y-3">
      <ConfirmModal {...confirmState.opts} open={confirmState.open}
        onConfirm={confirmState.onConfirm} onCancel={confirmState.onCancel} />
      <h3 className="font-bold text-stone-800 flex items-center gap-2">
        <Palette size={16} style={{ color: '#476540' }} /> Proprietà (sub / med / supporto…)
      </h3>
      {err && <div className="p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">{err}</div>}
      <div className="flex flex-wrap gap-2">
        {props.map(p => (
          <span key={p.id} className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full"
            style={{ background: p.colore_bg, color: '#1f2937' }}>
            <strong>{p.sigla}</strong> {p.nome}
            {p.esclusiva && <span title="mutualmente esclusiva — non coesiste con altre proprietà">🔒</span>}
            <button onClick={() => elimina(p)} className="hover:text-red-700"><X size={12} /></button>
          </span>
        ))}
        {props.length === 0 && <span className="text-xs text-stone-400 italic">Nessuna proprietà.</span>}
      </div>
      <div className="flex items-end gap-2 border-t border-stone-100 pt-3">
        <label className="text-xs">Sigla
          <input value={sigla} onChange={e => setSigla(e.target.value.toUpperCase())}
            className="input text-sm py-1 w-20 uppercase" placeholder="SUB" /></label>
        <label className="text-xs flex-1">Nome
          <input value={nome} onChange={e => setNome(e.target.value)} className="input text-sm py-1" placeholder="Sub-intensiva" /></label>
        <label className="text-xs">Colore
          <input type="color" value={colore} onChange={e => setColore(e.target.value)}
            className="w-12 h-8 rounded border border-stone-300 block" /></label>
        <label className="text-xs flex items-center gap-1 pb-1.5 cursor-pointer"
          title="Se attivo, questa proprietà non può coesistere con altre sullo stesso slot (mutualmente esclusiva).">
          <input type="checkbox" checked={esclusiva} onChange={e => setEsclusiva(e.target.checked)} className="accent-[#476540] w-4 h-4" />
          esclusiva
        </label>
        <button onClick={aggiungi} disabled={!sigla.trim()} className="btn-primary py-1 px-3 text-xs gap-1">
          <Plus size={12} /> Aggiungi
        </button>
      </div>
    </div>
  )
}

export function TipiTurnoPage() {
  const { repartoAttivo, repartoCorrente } = useReparto()
  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h2 className="text-xl font-bold text-stone-800 flex items-center gap-2">
          <Tag size={20} style={{ color: '#476540' }} />
          Tipi di turno — {repartoCorrente?.nome ?? '…'}
        </h2>
        <p className="text-sm text-stone-600 mt-0.5">
          Definisci i turni del reparto (M, P, L, REP, o personalizzati come uno "swing" 10-16)
          e le proprietà (sub/med/supporto), con colori, orari e peso.
        </p>
      </div>
      <TipiSection reparto={repartoAttivo} schemaNum={1} />
      <ProprietaSection reparto={repartoAttivo} schemaNum={1} />
    </div>
  )
}
