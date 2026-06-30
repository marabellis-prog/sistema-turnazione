/**
 * SchemaDesignerNuovo (sperimentale)
 *
 * Nuovo Disegna Schema = MATRICE: righe = giorni dello schema (aggiunti in
 * ordine), colonne = turni+flag GLOBALI (scelti dai Tipi di turno/Proprietà,
 * draggabili per riordinare), celle = checkbox (il giorno usa quel turno/flag).
 *
 * Interazione:
 *  - clic su un giorno → aggiunge la riga (o la seleziona);
 *  - selezionato un giorno, clic su un turno/flag → aggiunge la colonna (se
 *    nuova) e spunta la checkbox per quel giorno; gli altri restano deselezionati;
 *  - le checkbox si attivano/disattivano cliccandole;
 *  - le colonne si trascinano per riordinarle.
 *
 * Pagina separata: la vecchia "Disegna Schema" resta intatta finché validato.
 * Tappe successive: slot/numeri + fabbisogno.
 */

import { useState, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Table2, Tag, Flag, Trash2, GripVertical, Info, Zap, Plus, ArrowLeft } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useReparto } from '../../contexts/RepartoContext'
import { useMediciReparto } from '../../hooks/useMediciReparto'
import type { TipoTurno, ProprietaTurno } from '../../types'

// Colore stabile per numero turnista (come il vecchio designer).
const COLORI_MEDICO = ['#e57373','#64b5f6','#81c784','#ffb74d','#ba68c8','#4db6ac','#f06292','#7986cb','#a1887f','#90a4ae','#dce775','#4fc3f7','#ff8a65','#9575cd']
const coloreMedico = (n: number) => COLORI_MEDICO[(n - 1) % COLORI_MEDICO.length]

const GIORNI = [
  { n: 1, label: 'LUN' }, { n: 2, label: 'MAR' }, { n: 3, label: 'MER' },
  { n: 4, label: 'GIO' }, { n: 5, label: 'VEN' }, { n: 6, label: 'SAB' }, { n: 7, label: 'DOM' },
]
const labelGiorno = (n: number) => GIORNI.find(g => g.n === n)?.label ?? '?'

interface GiornoRow { id: string; giorno_settimana: number; ordine: number }
interface ColonnaRow { id: string; tipo: 'turno' | 'flag'; sigla: string; ordine: number }
interface CheckRow { giorno_settimana: number; colonna_sigla: string; attivo: boolean }
interface CellaRow { id: string; giorno_settimana: number; slot_idx: number; colonna_sigla: string; numero: number | null; attivo: boolean }

export function SchemaDesignerNuovo() {
  const qc = useQueryClient()
  const { repartoAttivo, repartoCorrente } = useReparto()
  const [schemaNum, setSchemaNum] = useState(1)
  const [giornoSel, setGiornoSel] = useState<number | null>(null)
  const [mode, setMode] = useState<'matrice' | 'tabella'>('matrice')
  const [err, setErr] = useState<string | null>(null)
  const dragCol = useRef<string | null>(null)
  const [dragOver, setDragOver] = useState<string | null>(null)
  const dragNum = useRef<number | null>(null)
  const dragSource = useRef<{ g: number; slot: number; sigla: string } | null>(null)
  const { data: medici = [] } = useMediciReparto()

  const key = ['schema-matrice', repartoAttivo, schemaNum]
  const invalida = () => qc.invalidateQueries({ queryKey: key })

  const { data: tipiTurno = [] } = useQuery<TipoTurno[]>({
    queryKey: ['tipi_turno', repartoAttivo],
    queryFn: async () => {
      const { data, error } = await supabase.from('tipi_turno').select('*').eq('reparto_id', repartoAttivo).order('ordine')
      if (error) throw error; return (data ?? []) as TipoTurno[]
    },
  })
  const { data: proprieta = [] } = useQuery<ProprietaTurno[]>({
    queryKey: ['proprieta_turno', repartoAttivo],
    queryFn: async () => {
      const { data, error } = await supabase.from('proprieta_turno').select('*').eq('reparto_id', repartoAttivo).order('ordine')
      if (error) throw error; return (data ?? []) as ProprietaTurno[]
    },
  })
  const { data: giorni = [] } = useQuery<GiornoRow[]>({
    queryKey: [...key, 'giorni'],
    queryFn: async () => {
      const { data, error } = await supabase.from('schema_giorno').select('id, giorno_settimana, ordine')
        .eq('reparto_id', repartoAttivo).eq('schema_num', schemaNum).order('giorno_settimana')
      if (error) throw error; return (data ?? []) as GiornoRow[]
    },
  })
  const { data: colonne = [] } = useQuery<ColonnaRow[]>({
    queryKey: [...key, 'colonne'],
    queryFn: async () => {
      const { data, error } = await supabase.from('schema_colonna').select('id, tipo, sigla, ordine')
        .eq('reparto_id', repartoAttivo).eq('schema_num', schemaNum).order('ordine')
      if (error) throw error; return (data ?? []) as ColonnaRow[]
    },
  })
  const { data: checks = [] } = useQuery<CheckRow[]>({
    queryKey: [...key, 'checks'],
    queryFn: async () => {
      const { data, error } = await supabase.from('schema_giorno_colonna').select('giorno_settimana, colonna_sigla, attivo')
        .eq('reparto_id', repartoAttivo).eq('schema_num', schemaNum)
      if (error) throw error; return (data ?? []) as CheckRow[]
    },
  })

  const { data: celle = [] } = useQuery<CellaRow[]>({
    queryKey: [...key, 'celle'],
    queryFn: async () => {
      const { data, error } = await supabase.from('schema_cella')
        .select('id, giorno_settimana, slot_idx, colonna_sigla, numero, attivo')
        .eq('reparto_id', repartoAttivo).eq('schema_num', schemaNum)
      if (error) throw error; return (data ?? []) as CellaRow[]
    },
  })

  const isChecked = (g: number, sigla: string) =>
    checks.some(c => c.giorno_settimana === g && c.colonna_sigla === sigla && c.attivo)
  const colColor = (sigla: string) => tipiTurno.find(t => t.sigla === sigla)
  // Colore intestazione colonna: turno → colori del tipo; flag → colore proprietà.
  const colHeader = (c: { tipo: 'turno' | 'flag'; sigla: string }) => {
    if (c.tipo === 'turno') {
      const t = tipiTurno.find(x => x.sigla === c.sigla)
      return { bg: t?.colore_bg ?? '#3a4f30', fg: t?.colore_fg ?? '#fff' }
    }
    const p = proprieta.find(x => x.sigla === c.sigla)
    return { bg: p?.colore_bg ?? '#3a4f30', fg: '#fff' }
  }
  // slot_idx presenti per un giorno (almeno 0)
  const slotsDelGiorno = (g: number) => {
    const idxs = new Set<number>(celle.filter(c => c.giorno_settimana === g).map(c => c.slot_idx))
    idxs.add(0)
    return [...idxs].sort((a, b) => a - b)
  }
  const cella = (g: number, slot: number, sigla: string) =>
    celle.find(c => c.giorno_settimana === g && c.slot_idx === slot && c.colonna_sigla === sigla)
  // Nome breve da mostrare nel badge accanto al numero (cognome, o 1ª parola).
  const nomeBadge = (n: number | null) => {
    if (n == null) return ''
    const m = medici.find(x => (x.numero_ordine ?? -1) === n)
    return (m?.cognome || m?.nome?.split(' ')[0] || '') as string
  }

  async function aggiungiGiorno(g: number) {
    setErr(null)
    if (giorni.some(x => x.giorno_settimana === g)) { setGiornoSel(g); return }
    const ordine = giorni.length
    const { error } = await supabase.from('schema_giorno')
      .insert({ reparto_id: repartoAttivo, schema_num: schemaNum, giorno_settimana: g, ordine })
    if (error) { setErr(error.message); return }
    setGiornoSel(g); invalida()
  }
  async function rimuoviGiorno(g: number) {
    setErr(null)
    await supabase.from('schema_giorno_colonna').delete()
      .eq('reparto_id', repartoAttivo).eq('schema_num', schemaNum).eq('giorno_settimana', g)
    const { error } = await supabase.from('schema_giorno').delete()
      .eq('reparto_id', repartoAttivo).eq('schema_num', schemaNum).eq('giorno_settimana', g)
    if (error) { setErr(error.message); return }
    if (giornoSel === g) setGiornoSel(null)
    invalida()
  }
  async function aggiungiColonna(tipo: 'turno' | 'flag', sigla: string) {
    setErr(null)
    if (giornoSel === null) { setErr('Seleziona prima un giorno (clicca sulla sua riga), poi aggiungi turni/flag.'); return }
    if (!colonne.some(c => c.sigla === sigla)) {
      const ordine = colonne.length
      const { error } = await supabase.from('schema_colonna')
        .insert({ reparto_id: repartoAttivo, schema_num: schemaNum, tipo, sigla, ordine })
      if (error) { setErr(error.message); return }
    }
    // spunta la checkbox per il giorno selezionato
    const { error: e2 } = await supabase.from('schema_giorno_colonna')
      .upsert({ reparto_id: repartoAttivo, schema_num: schemaNum, giorno_settimana: giornoSel, colonna_sigla: sigla, attivo: true },
        { onConflict: 'reparto_id,schema_num,giorno_settimana,colonna_sigla' })
    if (e2) { setErr(e2.message); return }
    invalida()
  }
  async function rimuoviColonna(sigla: string) {
    setErr(null)
    await supabase.from('schema_giorno_colonna').delete()
      .eq('reparto_id', repartoAttivo).eq('schema_num', schemaNum).eq('colonna_sigla', sigla)
    const { error } = await supabase.from('schema_colonna').delete()
      .eq('reparto_id', repartoAttivo).eq('schema_num', schemaNum).eq('sigla', sigla)
    if (error) { setErr(error.message); return }
    invalida()
  }
  async function toggleCheck(g: number, sigla: string) {
    setErr(null)
    const nuovo = !isChecked(g, sigla)
    const { error } = await supabase.from('schema_giorno_colonna')
      .upsert({ reparto_id: repartoAttivo, schema_num: schemaNum, giorno_settimana: g, colonna_sigla: sigla, attivo: nuovo },
        { onConflict: 'reparto_id,schema_num,giorno_settimana,colonna_sigla' })
    if (error) { setErr(error.message); return }
    invalida()
  }

  // ── Drag & drop colonne (riordino) ───────────────────────────────
  async function dropColonna(targetSigla: string) {
    const fromSigla = dragCol.current
    dragCol.current = null; setDragOver(null)
    if (!fromSigla || fromSigla === targetSigla) return
    const ordered = [...colonne]
    const fromIdx = ordered.findIndex(c => c.sigla === fromSigla)
    const toIdx   = ordered.findIndex(c => c.sigla === targetSigla)
    if (fromIdx < 0 || toIdx < 0) return
    const [moved] = ordered.splice(fromIdx, 1)
    ordered.splice(toIdx, 0, moved)
    // riscrive ordine 0..n
    for (let i = 0; i < ordered.length; i++) {
      if (ordered[i].ordine !== i) {
        await supabase.from('schema_colonna').update({ ordine: i }).eq('id', ordered[i].id)
      }
    }
    invalida()
  }

  // ── Slot / numeri (tabella turni) ────────────────────────────────
  async function aggiungiSlot(g: number) {
    const next = Math.max(-1, ...slotsDelGiorno(g)) + 1
    // crea una cella "segnaposto" sulla prima colonna-turno del giorno così lo slot esiste
    const primaTurno = colonne.find(c => c.tipo === 'turno' && isChecked(g, c.sigla))
    if (!primaTurno) { setErr('Aggiungi prima almeno una colonna-turno a questo giorno (nella matrice).'); return }
    const { error } = await supabase.from('schema_cella')
      .upsert({ reparto_id: repartoAttivo, schema_num: schemaNum, giorno_settimana: g, slot_idx: next, colonna_sigla: primaTurno.sigla, numero: null, attivo: false },
        { onConflict: 'reparto_id,schema_num,giorno_settimana,slot_idx,colonna_sigla' })
    if (error) { setErr(error.message); return }
    invalida()
  }
  async function dropNumero(g: number, slot: number, sigla: string) {
    const num = dragNum.current; const src = dragSource.current
    dragNum.current = null; dragSource.current = null
    if (num == null) return
    setErr(null)
    // Stessa cella → no-op.
    if (src && src.g === g && src.slot === slot && src.sigla === sigla) return
    // Spostamento: svuota la cella di partenza.
    if (src) {
      const sc = cella(src.g, src.slot, src.sigla)
      if (sc) await supabase.from('schema_cella').update({ numero: null }).eq('id', sc.id)
    }
    // "un solo numero per riga": svuota le altre colonne-turno dello stesso slot.
    const altre = celle.filter(c => c.giorno_settimana === g && c.slot_idx === slot && c.colonna_sigla !== sigla && c.numero != null)
    for (const c of altre) await supabase.from('schema_cella').update({ numero: null }).eq('id', c.id)
    const { error } = await supabase.from('schema_cella')
      .upsert({ reparto_id: repartoAttivo, schema_num: schemaNum, giorno_settimana: g, slot_idx: slot, colonna_sigla: sigla, numero: num },
        { onConflict: 'reparto_id,schema_num,giorno_settimana,slot_idx,colonna_sigla' })
    if (error) { setErr(error.message); return }
    // Comodità: riempiendo dalla strip l'ULTIMO slot, ne aggiunge uno vuoto.
    if (src == null && slot === Math.max(0, ...slotsDelGiorno(g))) {
      const primaTurno = colonne.find(c => c.tipo === 'turno' && isChecked(g, c.sigla))
      if (primaTurno) await supabase.from('schema_cella')
        .upsert({ reparto_id: repartoAttivo, schema_num: schemaNum, giorno_settimana: g, slot_idx: slot + 1, colonna_sigla: primaTurno.sigla, numero: null, attivo: false },
          { onConflict: 'reparto_id,schema_num,giorno_settimana,slot_idx,colonna_sigla' })
    }
    invalida()
  }
  async function rimuoviSlot(g: number, slot: number) {
    setErr(null)
    await supabase.from('schema_cella').delete()
      .eq('reparto_id', repartoAttivo).eq('schema_num', schemaNum).eq('giorno_settimana', g).eq('slot_idx', slot)
    invalida()
  }
  async function svuotaNumero(g: number, slot: number, sigla: string) {
    const c = cella(g, slot, sigla); if (!c) return
    await supabase.from('schema_cella').update({ numero: null }).eq('id', c.id)
    invalida()
  }
  async function toggleCellaFlag(g: number, slot: number, sigla: string) {
    const c = cella(g, slot, sigla)
    const nuovo = !(c?.attivo)
    setErr(null)
    if (nuovo) {
      // Esclusione mutua: proprietà attive (flag) sullo stesso slot, escluso questo.
      const flagAttivi = celle.filter(x => x.giorno_settimana === g && x.slot_idx === slot && x.attivo && x.colonna_sigla !== sigla
        && colonne.some(col => col.sigla === x.colonna_sigla && col.tipo === 'flag'))
      const prop = proprieta.find(p => p.sigla === sigla)
      const daSpegnere = prop?.esclusiva
        ? flagAttivi                                                                       // questa è esclusiva → spegni tutte le altre
        : flagAttivi.filter(x => proprieta.find(p => p.sigla === x.colonna_sigla)?.esclusiva) // coesiste → spegni solo le esclusive
      for (const x of daSpegnere) await supabase.from('schema_cella').update({ attivo: false }).eq('id', x.id)
    }
    const { error } = await supabase.from('schema_cella')
      .upsert({ reparto_id: repartoAttivo, schema_num: schemaNum, giorno_settimana: g, slot_idx: slot, colonna_sigla: sigla, attivo: nuovo },
        { onConflict: 'reparto_id,schema_num,giorno_settimana,slot_idx,colonna_sigla' })
    if (error) { setErr(error.message); return }
    invalida()
  }

  const giorniAttivi = giorni.map(g => g.giorno_settimana)
  const colonneOrdinate = colonne   // già ordinate per 'ordine'

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-xl font-bold text-stone-800 flex items-center gap-2">
          <Table2 size={20} style={{ color: '#476540' }} />
          Disegna Schema — nuovo ⚗️ · {repartoCorrente?.nome ?? '…'}
        </h2>
        <p className="text-sm text-stone-600 mt-0.5">
          Aggiungi i <strong>giorni</strong> (righe) e seleziona un giorno, poi aggiungi
          <strong> turni/flag</strong> (colonne) → si spuntano per quel giorno. Le colonne si trascinano.
        </p>
      </div>

      {tipiTurno.length === 0 && (
        <div className="flex gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
          <Info size={16} className="shrink-0 mt-0.5" />
          Prima definisci almeno un <strong>Tipo di turno</strong>: sono i mattoni dello schema.
        </div>
      )}
      {err && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{err}</div>}

      {/* Selettore schema */}
      <div className="flex items-center gap-2 text-sm">
        <span className="text-stone-500">Schema:</span>
        {[1, 2, 3].map(n => (
          <button key={n} onClick={() => { setSchemaNum(n); setGiornoSel(null) }}
            className="px-3 py-1 rounded font-semibold text-sm border transition-colors"
            style={schemaNum === n ? { background: '#476540', color: '#fff', borderColor: '#2b3c24' } : { background: '#fff', color: '#476540', borderColor: '#cdd9c4' }}>
            {n}
          </button>
        ))}
      </div>

      {/* Picker: Giorni + Turni/Proprietà */}
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="card p-3">
          <h3 className="text-xs font-semibold text-stone-600 mb-2">Giorni dello schema</h3>
          <div className="flex flex-wrap gap-1.5">
            {GIORNI.map(g => (
              <button key={g.n} onClick={() => aggiungiGiorno(g.n)}
                className="px-2.5 py-1 rounded text-xs font-semibold border transition-colors"
                style={giorniAttivi.includes(g.n)
                  ? { background: '#e0e8d8', color: '#2b3c24', borderColor: '#9ab488' }
                  : { background: '#fff', color: '#9ca3af', borderColor: '#e5e7eb', borderStyle: 'dashed' }}>
                {g.label}{!giorniAttivi.includes(g.n) && ' +'}
              </button>
            ))}
          </div>
        </div>
        <div className="card p-3">
          <h3 className="text-xs font-semibold text-stone-600 mb-2 flex items-center gap-1.5">
            <Tag size={12} /> Turni <span className="text-stone-300">·</span> <Flag size={12} /> Proprietà
            {giornoSel === null && <span className="text-[10px] font-normal text-amber-600 ml-1">(seleziona prima un giorno)</span>}
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {tipiTurno.map(t => (
              <button key={t.sigla} onClick={() => aggiungiColonna('turno', t.sigla)} disabled={giornoSel === null}
                className="px-2 py-1 rounded text-xs font-semibold border disabled:opacity-40 hover:opacity-80"
                style={{ background: t.colore_bg ?? '#e5e7eb', color: t.colore_fg ?? '#1f2937', borderColor: 'rgba(0,0,0,0.1)' }} title={t.nome}>
                {t.sigla}
              </button>
            ))}
            {proprieta.map(p => (
              <button key={p.sigla} onClick={() => aggiungiColonna('flag', p.sigla)} disabled={giornoSel === null}
                className="px-2 py-1 rounded text-xs font-semibold border border-stone-300 bg-white disabled:opacity-40 hover:bg-stone-100" title={p.nome}>
                {p.sigla}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* MATRICE */}
      {giorni.length === 0 ? (
        <p className="text-sm text-stone-400 italic">Aggiungi un giorno per iniziare.</p>
      ) : (
        <div className="card overflow-x-auto">
          <table className="text-sm border-collapse">
            <thead>
              <tr style={{ background: '#2b3c24' }}>
                <th className="px-3 py-2 text-left text-white font-semibold sticky left-0" style={{ background: '#2b3c24', minWidth: 90 }}>Giorno</th>
                {colonne.map(c => (
                  <th key={c.id} draggable
                    onDragStart={() => { dragCol.current = c.sigla }}
                    onDragOver={e => { e.preventDefault(); setDragOver(c.sigla) }}
                    onDragLeave={() => setDragOver(null)}
                    onDrop={() => dropColonna(c.sigla)}
                    className="px-2 py-1.5 text-center font-semibold cursor-grab select-none"
                    style={{
                      color: colHeader(c).fg,
                      background: dragOver === c.sigla ? '#577a45' : colHeader(c).bg,
                      minWidth: 52, borderLeft: '1px solid #1e2a16',
                    }}>
                    <div className="flex items-center justify-center gap-1">
                      <GripVertical size={11} className="opacity-50" />{c.sigla}
                    </div>
                    <button onClick={() => rimuoviColonna(c.sigla)} className="opacity-60 hover:opacity-100 hover:text-red-300" title="Rimuovi colonna">
                      <Trash2 size={10} />
                    </button>
                  </th>
                ))}
                <th style={{ background: '#2b3c24', width: 28 }} />
              </tr>
            </thead>
            <tbody>
              {giorni.map(row => {
                const g = row.giorno_settimana
                const sel = giornoSel === g
                return (
                  <tr key={row.id} style={{ background: sel ? '#eef3e8' : '#fff' }}>
                    <td onClick={() => setGiornoSel(g)}
                      className="px-3 py-2 font-bold cursor-pointer sticky left-0"
                      style={{ background: sel ? '#456b3a' : '#5c7a4e', color: '#fff', borderTop: '1px solid #2b3c24' }}
                      title="Seleziona il giorno per aggiungere colonne">
                      {labelGiorno(g)}
                    </td>
                    {colonne.map(c => (
                      <td key={c.id} className="px-2 py-2 text-center border-l border-stone-100">
                        <input type="checkbox" checked={isChecked(g, c.sigla)}
                          onChange={() => toggleCheck(g, c.sigla)}
                          className="w-4 h-4 cursor-pointer accent-[#476540]" />
                      </td>
                    ))}
                    <td className="px-1 text-center border-l border-stone-100">
                      <button onClick={() => rimuoviGiorno(g)} className="text-stone-300 hover:text-red-500" title="Rimuovi giorno">
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {/* Bottone Genera Tabella turni (solo con ≥1 giorno e ≥1 colonna) */}
      {giorni.length > 0 && colonne.length > 0 && (
        <button onClick={() => setMode(m => m === 'tabella' ? 'matrice' : 'tabella')}
          className="self-start flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold text-white shadow"
          style={{ background: mode === 'tabella' ? '#7a5a2f' : '#476540' }}>
          {mode === 'tabella' ? <><ArrowLeft size={15} /> Torna alla struttura</> : <><Zap size={15} /> Genera Tabella turni</>}
        </button>
      )}

      {/* ── TABELLA TURNI (slot): trascina i turnisti nei riquadri ── */}
      {mode === 'tabella' && (
        <div className="card p-3 space-y-3">
          <div>
            <div className="text-xs font-semibold text-stone-600 mb-1">Turnisti — trascina nei riquadri delle colonne-turno</div>
            <div className="flex flex-wrap gap-1">
              {medici.map(m => (
                <div key={m.id} draggable onDragStart={() => { dragNum.current = m.numero_ordine ?? null; dragSource.current = null }}
                  className="px-2 py-1 rounded text-xs font-bold text-white cursor-grab shadow-sm select-none"
                  style={{ background: coloreMedico(m.numero_ordine ?? 0) }} title={m.nome}>
                  {m.numero_ordine}
                </div>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="text-sm border-collapse">
              <thead>
                <tr style={{ background: '#2b3c24' }}>
                  <th className="px-2 py-1.5 text-white text-left" style={{ minWidth: 78 }}>Giorno</th>
                  <th className="px-1 py-1.5 text-white text-[10px]" style={{ width: 26 }}>#</th>
                  {colonneOrdinate.map(c => (
                    <th key={c.id} className="px-2 py-1.5 text-center font-semibold"
                      style={{ color: colHeader(c).fg, background: colHeader(c).bg, minWidth: c.tipo === 'turno' ? 104 : 46, borderLeft: '1px solid #1e2a16' }}>
                      {c.sigla}
                    </th>
                  ))}
                  <th style={{ background: '#2b3c24', width: 30 }} />
                </tr>
              </thead>
              <tbody>
                {giorni.map(row => {
                  const g = row.giorno_settimana
                  const slots = slotsDelGiorno(g)
                  return slots.map((slot, si) => (
                    <tr key={`${g}-${slot}`} style={{ background: si % 2 ? '#fff' : '#f7f9f4' }}>
                      {si === 0 && (
                        <td rowSpan={slots.length} className="px-2 py-1.5 align-top" style={{ background: '#5c7a4e' }}>
                          <div className="font-bold text-white leading-tight">{labelGiorno(g)}</div>
                          <button onClick={() => aggiungiSlot(g)}
                            className="mt-1 inline-flex items-center gap-0.5 text-[10px] font-bold rounded px-1 py-0.5"
                            style={{ background: 'rgba(255,255,255,0.18)', color: '#fff' }} title="Aggiungi uno slot a questo giorno">
                            <Plus size={10} /> slot
                          </button>
                        </td>
                      )}
                      <td className="px-1 text-center text-[10px] text-stone-400">{slot + 1}</td>
                      {colonneOrdinate.map(c => {
                        if (!isChecked(g, c.sigla)) return <td key={c.id} className="border-l border-stone-100" style={{ background: '#f0f0f0' }} />
                        if (c.tipo === 'flag') {
                          const attivo = !!cella(g, slot, c.sigla)?.attivo
                          const col = proprieta.find(p => p.sigla === c.sigla)?.colore_bg ?? '#476540'
                          return (
                            <td key={c.id} className="text-center border-l border-stone-100 px-1 py-1">
                              <button onClick={() => toggleCellaFlag(g, slot, c.sigla)} title={c.sigla}
                                className="inline-block w-7 h-7 leading-7 rounded text-[10px] font-bold transition-all"
                                style={attivo
                                  ? { background: col, color: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,0.25)' }
                                  : { background: '#fff', color: col, border: `1.5px dashed ${col}` }}>
                                {attivo ? c.sigla : ''}
                              </button>
                            </td>
                          )
                        }
                        const cel = cella(g, slot, c.sigla)
                        return (
                          <td key={c.id} className="text-center border-l border-stone-100 px-1 py-1"
                            onDragOver={e => e.preventDefault()} onDrop={() => dropNumero(g, slot, c.sigla)}>
                            {cel?.numero != null
                              ? <span draggable
                                  onDragStart={() => { dragNum.current = cel.numero; dragSource.current = { g, slot, sigla: c.sigla } }}
                                  onClick={() => svuotaNumero(g, slot, c.sigla)}
                                  title={`${cel.numero} · ${nomeBadge(cel.numero)} — trascina per spostare · clic per togliere`}
                                  className="inline-flex items-center gap-1 rounded text-xs font-bold text-white cursor-grab pl-0.5 pr-1.5 py-0.5 max-w-full align-middle"
                                  style={{ background: coloreMedico(cel.numero) }}>
                                  <span className="inline-flex items-center justify-center w-5 h-5 rounded shrink-0 text-[11px]"
                                    style={{ background: 'rgba(255,255,255,0.28)' }}>{cel.numero}</span>
                                  <span className="truncate max-w-[78px]">{nomeBadge(cel.numero)}</span>
                                </span>
                              : <span className="text-stone-300">–</span>}
                          </td>
                        )
                      })}
                      <td className="px-1 text-center border-l border-stone-100">
                        <button onClick={() => rimuoviSlot(g, slot)} className="text-stone-300 hover:text-red-500" title="Elimina questo slot">
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  ))
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-stone-400">
            Un numero per riga (drag = sposta · clic = togli). Riempiendo l'ultimo slot ne compare un altro;
            il <Trash2 size={11} className="inline -mt-0.5" /> elimina lo slot. Le proprietà <strong>esclusive</strong> 🔒 escludono le altre sullo stesso slot.
          </p>
        </div>
      )}
    </div>
  )
}
