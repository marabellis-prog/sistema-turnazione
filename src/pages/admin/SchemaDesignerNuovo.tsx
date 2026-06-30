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

import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Table2, Tag, Flag, Trash2, GripVertical, Info, Plus, Copy, ListChecks, Eraser, Save } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useReparto } from '../../contexts/RepartoContext'
import { useMediciReparto } from '../../hooks/useMediciReparto'
import { useConfirm } from '../../hooks/useConfirm'
import { usePendingActions } from '../../contexts/PendingActionsContext'
import { ConfirmModal } from '../../components/ConfirmModal'
import { TipiSection, ProprietaSection } from './TipiTurnoPage'
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
// Cella nel DRAFT locale (la tabella turni non fa autosave): senza id, si
// identifica per (giorno, slot, colonna). Persistita solo con "Salva schema".
interface CellaDraft { giorno_settimana: number; slot_idx: number; colonna_sigla: string; numero: number | null; attivo: boolean }
// DRAFT dell'INTERO schema (struttura + celle): nessun autosave, si persiste
// solo con "Salva schema". checks = solo le caselle spuntate.
interface SchemaDraft {
  giorni:  { giorno_settimana: number }[]
  colonne: { tipo: 'turno' | 'flag'; sigla: string }[]
  checks:  { giorno_settimana: number; colonna_sigla: string }[]
  celle:   CellaDraft[]
}

export function SchemaDesignerNuovo() {
  const qc = useQueryClient()
  const { repartoAttivo, repartoCorrente, setRepartoAttivo, registerRepartoGuard } = useReparto()
  const navigate = useNavigate()
  const { registerNavGuard } = usePendingActions()
  const [schemaNum, setSchemaNum] = useState(1)
  const [giornoSel, setGiornoSel] = useState<number | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [draft, setDraft] = useState<SchemaDraft | null>(null)  // null = nessuna modifica pendente (intero schema)
  const [saving, setSaving] = useState(false)
  const [navPending, setNavPending] = useState<string | null>(null)
  const [pendingReparto, setPendingReparto] = useState<string | null>(null)
  const dragCol = useRef<string | null>(null)
  const [dragOver, setDragOver] = useState<string | null>(null)
  const dragNum = useRef<number | null>(null)
  const dragSource = useRef<{ g: number; slot: number; sigla: string } | null>(null)
  const [overKey, setOverKey] = useState<string | null>(null)   // cella evidenziata durante il drag
  const tableRef = useRef<HTMLTableElement>(null)
  const [tableW, setTableW] = useState(0)   // larghezza reale della tabella turni (per la legenda)
  const { data: medici = [] } = useMediciReparto()
  const { confirm, confirmState } = useConfirm()

  const key = ['schema-matrice', repartoAttivo, schemaNum]
  const invalida = () => {
    qc.invalidateQueries({ queryKey: key })
    qc.invalidateQueries({ queryKey: ['schemi-esistenti', repartoAttivo] })
  }
  const invalidaSchemi = () => qc.invalidateQueries({ queryKey: ['schemi-esistenti', repartoAttivo] })

  // Schemi che "esistono" = hanno almeno un tipo di turno o un giorno. Il
  // selettore mostra sempre 1/2/3 + quelli esistenti + quello corrente, con "+".
  const { data: schemiEsistenti = [] } = useQuery<number[]>({
    queryKey: ['schemi-esistenti', repartoAttivo],
    queryFn: async () => {
      const [a, b] = await Promise.all([
        supabase.from('tipi_turno').select('schema_num').eq('reparto_id', repartoAttivo),
        supabase.from('schema_giorno').select('schema_num').eq('reparto_id', repartoAttivo),
      ])
      const s = new Set<number>()
      ;(a.data ?? []).forEach((r: { schema_num: number }) => s.add(r.schema_num))
      ;(b.data ?? []).forEach((r: { schema_num: number }) => s.add(r.schema_num))
      return [...s]
    },
  })
  // Titoli degli schemi (per riconoscerli). Una riga marca anche lo schema come "esistente".
  const { data: schemiMeta = [] } = useQuery<{ schema_num: number; titolo: string }[]>({
    queryKey: ['schema-meta', repartoAttivo],
    queryFn: async () => {
      const { data, error } = await supabase.from('schema_meta').select('schema_num, titolo').eq('reparto_id', repartoAttivo)
      if (error) throw error
      return data ?? []
    },
  })
  const titoloDi = (n: number) => schemiMeta.find(m => m.schema_num === n)?.titolo ?? ''
  const schemiList = [...new Set([1, 2, 3, ...schemiEsistenti, ...schemiMeta.map(m => m.schema_num), schemaNum])].sort((a, b) => a - b)
  const prossimoSchema = Math.max(...schemiList) + 1

  const { data: tipiTurno = [] } = useQuery<TipoTurno[]>({
    queryKey: ['tipi_turno', repartoAttivo, schemaNum],
    queryFn: async () => {
      const { data, error } = await supabase.from('tipi_turno').select('*')
        .eq('reparto_id', repartoAttivo).eq('schema_num', schemaNum).order('ordine')
      if (error) throw error; return (data ?? []) as TipoTurno[]
    },
  })
  const { data: proprieta = [] } = useQuery<ProprietaTurno[]>({
    queryKey: ['proprieta_turno', repartoAttivo, schemaNum],
    queryFn: async () => {
      const { data, error } = await supabase.from('proprieta_turno').select('*')
        .eq('reparto_id', repartoAttivo).eq('schema_num', schemaNum).order('ordine')
      if (error) throw error; return (data ?? []) as ProprietaTurno[]
    },
  })
  const { data: giorniDB = [] } = useQuery<GiornoRow[]>({
    queryKey: [...key, 'giorni'],
    queryFn: async () => {
      const { data, error } = await supabase.from('schema_giorno').select('id, giorno_settimana, ordine')
        .eq('reparto_id', repartoAttivo).eq('schema_num', schemaNum).order('giorno_settimana')
      if (error) throw error; return (data ?? []) as GiornoRow[]
    },
  })
  const { data: colonneDB = [] } = useQuery<ColonnaRow[]>({
    queryKey: [...key, 'colonne'],
    queryFn: async () => {
      const { data, error } = await supabase.from('schema_colonna').select('id, tipo, sigla, ordine')
        .eq('reparto_id', repartoAttivo).eq('schema_num', schemaNum).order('ordine')
      if (error) throw error; return (data ?? []) as ColonnaRow[]
    },
  })
  const { data: checksDB = [] } = useQuery<CheckRow[]>({
    queryKey: [...key, 'checks'],
    queryFn: async () => {
      const { data, error } = await supabase.from('schema_giorno_colonna').select('giorno_settimana, colonna_sigla, attivo')
        .eq('reparto_id', repartoAttivo).eq('schema_num', schemaNum)
      if (error) throw error; return (data ?? []) as CheckRow[]
    },
  })
  const { data: celleDB = [] } = useQuery<CellaRow[]>({
    queryKey: [...key, 'celle'],
    queryFn: async () => {
      const { data, error } = await supabase.from('schema_cella')
        .select('id, giorno_settimana, slot_idx, colonna_sigla, numero, attivo')
        .eq('reparto_id', repartoAttivo).eq('schema_num', schemaNum)
      if (error) throw error; return (data ?? []) as CellaRow[]
    },
  })

  // ── DRAFT unico dell'intero schema (niente autosave): tutte le modifiche
  //    (giorni, colonne, flag, slot, numeri) stanno in `draft` finché non si
  //    preme "Salva schema". `draftEff` = draft oppure baseline dal DB. ─────
  const baseline = (): SchemaDraft => ({
    giorni:  giorniDB.map(g => ({ giorno_settimana: g.giorno_settimana })),
    colonne: colonneDB.map(c => ({ tipo: c.tipo, sigla: c.sigla })),
    checks:  checksDB.filter(c => c.attivo).map(c => ({ giorno_settimana: c.giorno_settimana, colonna_sigla: c.colonna_sigla })),
    celle:   celleDB.map(c => ({ giorno_settimana: c.giorno_settimana, slot_idx: c.slot_idx, colonna_sigla: c.colonna_sigla, numero: c.numero, attivo: c.attivo })),
  })
  const draftEff = draft ?? baseline()
  const dirty = draft !== null
  function muta(fn: (d: SchemaDraft) => SchemaDraft) { setDraft(prev => fn(prev ?? baseline())) }
  function mutaCelle(fn: (list: CellaDraft[]) => CellaDraft[]) { muta(d => ({ ...d, celle: fn(d.celle) })) }

  // Viste con id sintetici (stessi nomi/shape usati dalla JSX).
  const giorni = [...draftEff.giorni].sort((a, b) => a.giorno_settimana - b.giorno_settimana)
    .map((g, i) => ({ id: `g${g.giorno_settimana}`, giorno_settimana: g.giorno_settimana, ordine: i }))
  const colonne = draftEff.colonne.map((c, i) => ({ id: `col-${c.sigla}`, tipo: c.tipo, sigla: c.sigla, ordine: i }))
  const checks = draftEff.checks
  const celle = draftEff.celle

  const isChecked = (g: number, sigla: string) =>
    checks.some(c => c.giorno_settimana === g && c.colonna_sigla === sigla)
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

  function aggiungiGiorno(g: number) {
    setErr(null)
    if (draftEff.giorni.some(x => x.giorno_settimana === g)) { setGiornoSel(g); return }
    muta(d => ({ ...d, giorni: [...d.giorni, { giorno_settimana: g }] }))
    setGiornoSel(g)
  }
  function rimuoviGiorno(g: number) {
    setErr(null)
    muta(d => ({
      ...d,
      giorni: d.giorni.filter(x => x.giorno_settimana !== g),
      checks: d.checks.filter(c => c.giorno_settimana !== g),
      celle:  d.celle.filter(c => c.giorno_settimana !== g),
    }))
    if (giornoSel === g) setGiornoSel(null)
  }
  function aggiungiColonna(tipo: 'turno' | 'flag', sigla: string) {
    if (giornoSel === null) { setErr('Seleziona prima un giorno (clicca sulla sua riga), poi aggiungi turni/flag.'); return }
    setErr(null)
    const g = giornoSel
    muta(d => ({
      ...d,
      colonne: d.colonne.some(c => c.sigla === sigla) ? d.colonne : [...d.colonne, { tipo, sigla }],
      checks:  d.checks.some(c => c.giorno_settimana === g && c.colonna_sigla === sigla)
        ? d.checks : [...d.checks, { giorno_settimana: g, colonna_sigla: sigla }],
    }))
  }
  function rimuoviColonna(sigla: string) {
    setErr(null)
    muta(d => ({
      ...d,
      colonne: d.colonne.filter(c => c.sigla !== sigla),
      checks:  d.checks.filter(c => c.colonna_sigla !== sigla),
      celle:   d.celle.filter(c => c.colonna_sigla !== sigla),
    }))
  }
  function toggleCheck(g: number, sigla: string) {
    setErr(null)
    muta(d => {
      const has = d.checks.some(c => c.giorno_settimana === g && c.colonna_sigla === sigla)
      return { ...d, checks: has
        ? d.checks.filter(c => !(c.giorno_settimana === g && c.colonna_sigla === sigla))
        : [...d.checks, { giorno_settimana: g, colonna_sigla: sigla }] }
    })
  }

  // ── Drag & drop colonne (riordino) — solo nel draft ──────────────
  function dropColonna(targetSigla: string) {
    const fromSigla = dragCol.current
    dragCol.current = null; setDragOver(null)
    if (!fromSigla || fromSigla === targetSigla) return
    muta(d => {
      const arr = [...d.colonne]
      const fromIdx = arr.findIndex(c => c.sigla === fromSigla)
      const toIdx   = arr.findIndex(c => c.sigla === targetSigla)
      if (fromIdx < 0 || toIdx < 0) return d
      const [moved] = arr.splice(fromIdx, 1)
      arr.splice(toIdx, 0, moved)
      return { ...d, colonne: arr }
    })
  }

  // ── Slot / numeri (tabella turni) — solo DRAFT locale, niente DB ───
  const primaTurnoDi = (g: number) => colonne.find(c => c.tipo === 'turno' && isChecked(g, c.sigla))
  function aggiungiSlot(g: number) {
    const pt = primaTurnoDi(g)
    if (!pt) { setErr('Aggiungi prima almeno una colonna-turno a questo giorno (nella matrice).'); return }
    setErr(null)
    const next = Math.max(-1, ...slotsDelGiorno(g)) + 1
    mutaCelle(list => [...list, { giorno_settimana: g, slot_idx: next, colonna_sigla: pt.sigla, numero: null, attivo: false }])
  }
  function dropNumero(g: number, slot: number, sigla: string) {
    const num = dragNum.current; const src = dragSource.current
    dragNum.current = null; dragSource.current = null
    if (num == null) return
    if (src && src.g === g && src.slot === slot && src.sigla === sigla) return   // stessa cella
    setErr(null)
    const fromStrip = src == null
    mutaCelle(list => {
      let next = list.map(c => ({ ...c }))
      // Spostamento: svuota la cella di partenza.
      if (src) next = next.map(c => (c.giorno_settimana === src.g && c.slot_idx === src.slot && c.colonna_sigla === src.sigla) ? { ...c, numero: null } : c)
      // "un solo numero per riga": svuota le altre colonne dello stesso slot.
      next = next.map(c => (c.giorno_settimana === g && c.slot_idx === slot && c.colonna_sigla !== sigla && c.numero != null) ? { ...c, numero: null } : c)
      // Imposta la cella target.
      if (next.some(c => c.giorno_settimana === g && c.slot_idx === slot && c.colonna_sigla === sigla))
        next = next.map(c => (c.giorno_settimana === g && c.slot_idx === slot && c.colonna_sigla === sigla) ? { ...c, numero: num } : c)
      else next.push({ giorno_settimana: g, slot_idx: slot, colonna_sigla: sigla, numero: num, attivo: false })
      // Riempiendo dalla strip l'ULTIMO slot, ne aggiunge uno vuoto.
      if (fromStrip) {
        const maxSlot = Math.max(0, ...next.filter(c => c.giorno_settimana === g).map(c => c.slot_idx))
        const pt = primaTurnoDi(g)
        if (pt && slot === maxSlot && !next.some(c => c.giorno_settimana === g && c.slot_idx === slot + 1))
          next.push({ giorno_settimana: g, slot_idx: slot + 1, colonna_sigla: pt.sigla, numero: null, attivo: false })
      }
      return next
    })
  }
  function rimuoviSlot(g: number, slot: number) {
    setErr(null)
    mutaCelle(list => list.filter(c => !(c.giorno_settimana === g && c.slot_idx === slot)))
  }
  function svuotaNumero(g: number, slot: number, sigla: string) {
    mutaCelle(list => list.map(c => (c.giorno_settimana === g && c.slot_idx === slot && c.colonna_sigla === sigla) ? { ...c, numero: null } : c))
  }
  function toggleCellaFlag(g: number, slot: number, sigla: string) {
    setErr(null)
    const nuovo = !(cella(g, slot, sigla)?.attivo)
    mutaCelle(list => {
      let next = list.map(c => ({ ...c }))
      if (nuovo) {
        // Esclusione mutua tra proprietà-flag sullo stesso slot.
        const flagAttivi = next.filter(x => x.giorno_settimana === g && x.slot_idx === slot && x.attivo && x.colonna_sigla !== sigla
          && colonne.some(col => col.sigla === x.colonna_sigla && col.tipo === 'flag'))
        const prop = proprieta.find(p => p.sigla === sigla)
        const daSpegnere = prop?.esclusiva
          ? flagAttivi
          : flagAttivi.filter(x => proprieta.find(p => p.sigla === x.colonna_sigla)?.esclusiva)
        const spegni = new Set(daSpegnere.map(x => x.colonna_sigla))
        next = next.map(x => (x.giorno_settimana === g && x.slot_idx === slot && spegni.has(x.colonna_sigla)) ? { ...x, attivo: false } : x)
      }
      if (next.some(x => x.giorno_settimana === g && x.slot_idx === slot && x.colonna_sigla === sigla))
        next = next.map(x => (x.giorno_settimana === g && x.slot_idx === slot && x.colonna_sigla === sigla) ? { ...x, attivo: nuovo } : x)
      else next.push({ giorno_settimana: g, slot_idx: slot, colonna_sigla: sigla, numero: null, attivo: nuovo })
      return next
    })
  }
  // ── Salva schema: invia l'INTERO draft (struttura + celle) alla RPC che
  //    sostituisce il contenuto dello schema in modo atomico. ─────────────
  async function salvaSchema() {
    if (!draft) return
    setErr(null); setSaving(true)
    try {
      const p_giorni  = [...draft.giorni].sort((a, b) => a.giorno_settimana - b.giorno_settimana)
        .map((g, i) => ({ giorno_settimana: g.giorno_settimana, ordine: i }))
      const p_colonne = draft.colonne.map((c, i) => ({ tipo: c.tipo, sigla: c.sigla, ordine: i }))
      const p_checks  = draft.checks.map(c => ({ giorno_settimana: c.giorno_settimana, colonna_sigla: c.colonna_sigla }))
      const p_celle   = draft.celle
      const { error } = await supabase.rpc('salva_schema_struttura', {
        p_reparto: repartoAttivo, p_num: schemaNum, p_giorni, p_colonne, p_checks, p_celle,
      })
      if (error) throw error
      setDraft(null)
      invalida(); invalidaSchemi()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Errore nel salvataggio')
    } finally {
      setSaving(false)
    }
  }
  // Scarta il draft (con conferma se ci sono modifiche). Ritorna true se si può procedere.
  async function scartaSeNecessario(): Promise<boolean> {
    if (!dirty) return true
    const ok = await confirm({
      title: 'Modifiche non salvate',
      message: 'Lo schema ha modifiche non salvate. Se procedi andranno perse. Continuare?',
      confirmLabel: 'Procedi senza salvare', danger: true,
    })
    if (!ok) return false
    setDraft(null)
    return true
  }

  // ── Schemi: aggiungi / copia / titolo / azzera / elimina ─────────
  function invalidaTutto() {
    qc.invalidateQueries({ queryKey: ['tipi_turno', repartoAttivo] })
    qc.invalidateQueries({ queryKey: ['proprieta_turno', repartoAttivo] })
    qc.invalidateQueries({ queryKey: ['schema-fabbisogno', repartoAttivo] })
    qc.invalidateQueries({ queryKey: ['schema-meta', repartoAttivo] })
    invalida()
  }
  async function aggiungiSchema() {
    if (!(await scartaSeNecessario())) return
    setErr(null)
    setSchemaNum(prossimoSchema)
    setGiornoSel(null)
  }
  async function vaiASchema(n: number) {
    if (n === schemaNum) return
    if (!(await scartaSeNecessario())) return
    setErr(null)
    setSchemaNum(n)
    setGiornoSel(null)
  }
  async function copiaDa(from: number) {
    if (from === schemaNum) return
    const ok = await confirm({
      title: `Copia da Schema ${from}`,
      message: `Sovrascrive lo Schema ${schemaNum} con una copia completa dello Schema ${from} ` +
               `(tipi di turno, proprietà, giorni, colonne, celle e fabbisogno). Procedere?`,
      confirmLabel: 'Copia', danger: true,
    })
    if (!ok) return
    setErr(null)
    const { error } = await supabase.rpc('copia_schema', { p_reparto: repartoAttivo, p_from: from, p_to: schemaNum })
    if (error) { setErr(error.message); return }
    setDraft(null); invalidaTutto()
  }
  async function salvaTitolo(t: string) {
    const { error } = await supabase.from('schema_meta').upsert(
      { reparto_id: repartoAttivo, schema_num: schemaNum, titolo: t },
      { onConflict: 'reparto_id,schema_num' })
    if (error) { setErr(error.message); return }
    invalidaSchemi()
    qc.invalidateQueries({ queryKey: ['schema-meta', repartoAttivo] })
  }
  async function azzeraSchema() {
    const nome = titoloDi(schemaNum) || `Schema ${schemaNum}`
    const ok = await confirm({
      title: `Azzera "${nome}"`,
      message: 'Svuota completamente lo schema (turni, proprietà, giorni, colonne, celle e fabbisogno), ' +
               'ma mantiene il titolo. Procedere?',
      confirmLabel: 'Azzera', danger: true,
    })
    if (!ok) return
    setErr(null)
    const { error } = await supabase.rpc('azzera_schema', { p_reparto: repartoAttivo, p_num: schemaNum })
    if (error) { setErr(error.message); return }
    setDraft(null); setGiornoSel(null); invalidaTutto()
  }
  async function eliminaSchema() {
    const nome = titoloDi(schemaNum) || `Schema ${schemaNum}`
    const ok = await confirm({
      title: `Elimina "${nome}"`,
      message: 'Elimina definitivamente lo schema e rinumera gli altri (chiude il buco). Procedere?',
      confirmLabel: 'Elimina', danger: true,
    })
    if (!ok) return
    setErr(null)
    const { error } = await supabase.rpc('elimina_schema', { p_reparto: repartoAttivo, p_num: schemaNum })
    if (error) { setErr(error.message); return }
    setDraft(null); setSchemaNum(1); setGiornoSel(null); invalidaTutto()
  }

  // Rete di sicurezza: se cambia reparto o schema (anche da percorsi non
  // guardati, es. selettore reparto in headbar) si scarta il draft, così non
  // si rischia di salvarlo sullo schema/reparto sbagliato.
  useEffect(() => { setDraft(null) }, [repartoAttivo, schemaNum])

  // Misura la larghezza reale della tabella turni → la legenda va a capo
  // entro quella larghezza (vedi maxWidth sotto).
  useEffect(() => {
    const el = tableRef.current
    if (!el) { setTableW(0); return }
    const ro = new ResizeObserver(() => setTableW(el.offsetWidth))
    ro.observe(el)
    setTableW(el.offsetWidth)
    return () => ro.disconnect()
  }, [giorni.length, colonne.length])

  // Guardia: modifiche non salvate bloccano la navigazione (menu admin), il
  // cambio reparto (selettore admin/headbar) e la chiusura/refresh della tab.
  useEffect(() => {
    if (!dirty) { registerNavGuard(null); registerRepartoGuard(null); return }
    registerNavGuard((to: string) => { setNavPending(to); return false })
    registerRepartoGuard((next: string) => { setPendingReparto(next); return false })
    const beforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', beforeUnload)
    return () => { registerNavGuard(null); registerRepartoGuard(null); window.removeEventListener('beforeunload', beforeUnload) }
  }, [dirty, registerNavGuard, registerRepartoGuard])

  const giorniAttivi = giorni.map(g => g.giorno_settimana)
  const colonneOrdinate = colonne   // già ordinate per 'ordine'
  const turniColonne = colonne.filter(c => c.tipo === 'turno')

  return (
    <div className="flex flex-col gap-4">
      <ConfirmModal {...confirmState.opts} open={confirmState.open}
        onConfirm={confirmState.onConfirm} onCancel={confirmState.onCancel} />
      <ConfirmModal open={navPending != null}
        title="Modifiche non salvate"
        message="Lo schema ha modifiche non salvate. Se esci ora andranno perse."
        confirmLabel="Esci senza salvare" cancelLabel="Rimani" danger
        onConfirm={() => { const to = navPending; setDraft(null); setNavPending(null); if (to) navigate(to) }}
        onCancel={() => setNavPending(null)} />
      <ConfirmModal open={pendingReparto != null}
        title="Modifiche non salvate"
        message="Lo schema ha modifiche non salvate. Cambiando reparto andranno perse."
        confirmLabel="Cambia senza salvare" cancelLabel="Rimani" danger
        onConfirm={() => { const n = pendingReparto; setDraft(null); setPendingReparto(null); registerRepartoGuard(null); if (n) setRepartoAttivo(n) }}
        onCancel={() => setPendingReparto(null)} />
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
          Questo schema è vuoto: definisci qui sotto i suoi <strong>Tipi di turno</strong> (i mattoni),
          oppure usa <strong>“Copia da schema…”</strong> per partire da un altro.
        </div>
      )}
      {err && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{err}</div>}

      {/* Selettore schema (dinamico) + aggiungi + copia da schema */}
      <div className="flex items-center gap-2 text-sm flex-wrap">
        <span className="text-stone-500">Schema:</span>
        {schemiList.map(n => (
          <button key={n} onClick={() => vaiASchema(n)} title={titoloDi(n) || `Schema ${n}`}
            className="px-3 py-1 rounded font-semibold text-sm border transition-colors"
            style={schemaNum === n ? { background: '#476540', color: '#fff', borderColor: '#2b3c24' } : { background: '#fff', color: '#476540', borderColor: '#cdd9c4' }}>
            {n}
          </button>
        ))}
        <button onClick={aggiungiSchema} title="Aggiungi un nuovo schema"
          className="px-2 py-1 rounded font-bold text-sm border border-dashed border-[#9ab488] text-[#476540] hover:bg-[#eef3e8]">
          <Plus size={14} className="inline -mt-0.5" />
        </button>
        {schemiList.length > 1 && (
          <div className="ml-auto flex items-center gap-1.5">
            <Copy size={13} className="text-stone-400" />
            <select value="" onChange={e => { if (e.target.value) { copiaDa(parseInt(e.target.value, 10)); e.target.value = '' } }}
              className="input text-xs py-1" title="Copia tutto (turni, struttura, fabbisogno) da un altro schema">
              <option value="" disabled>Copia da schema…</option>
              {schemiList.filter(n => n !== schemaNum).map(n => (
                <option key={n} value={n}>Schema {n}{titoloDi(n) ? ` · ${titoloDi(n)}` : ''}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Titolo dello schema (editabile inline) + azioni schema */}
      <div className="flex items-center gap-2 flex-wrap">
        <Tag size={16} className="shrink-0" style={{ color: '#476540' }} />
        <input
          key={`titolo-${schemaNum}-${titoloDi(schemaNum)}`}
          defaultValue={titoloDi(schemaNum)}
          onBlur={e => { const v = e.target.value.trim(); if (v !== titoloDi(schemaNum)) salvaTitolo(v) }}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
          placeholder={`Schema ${schemaNum} — dai un nome per riconoscerlo…`}
          className="flex-1 min-w-[140px] text-base font-bold bg-transparent border-b-2 border-stone-200 focus:border-[#476540] outline-none py-1 px-1 text-stone-800" />
        {dirty && (
          <span className="flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0"
            style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #fbbf24' }}>
            ● Non salvato
          </span>
        )}
        <button onClick={salvaSchema} disabled={!dirty || saving} title="Salva lo schema (struttura e turni)"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold text-white shadow transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
          style={{ background: dirty && !saving ? '#476540' : '#9ca3af' }}>
          <Save size={14} /> {saving ? 'Salvataggio…' : 'Salva schema'}
        </button>
        <button onClick={azzeraSchema} title="Svuota lo schema (mantiene il titolo)"
          className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-semibold border border-amber-300 text-amber-700 hover:bg-amber-50 shrink-0">
          <Eraser size={13} /> Azzera
        </button>
        <button onClick={eliminaSchema} title="Elimina lo schema e rinumera gli altri"
          className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-semibold border border-red-300 text-red-700 hover:bg-red-50">
          <Trash2 size={13} /> Elimina
        </button>
      </div>

      {/* ① TIPI DI TURNO + PROPRIETÀ dello schema, affiancati (i mattoni: si definiscono per primi) */}
      <div className="grid lg:grid-cols-5 gap-3 items-start">
        <div className="lg:col-span-3"><TipiSection reparto={repartoAttivo} schemaNum={schemaNum} onChanged={invalidaSchemi} /></div>
        <div className="lg:col-span-2"><ProprietaSection reparto={repartoAttivo} schemaNum={schemaNum} onChanged={invalidaSchemi} /></div>
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
      {/* ── TABELLA TURNI (slot) a sinistra · FABBISOGNO sticky a destra ──
          Sempre visibile (si aggiorna in tempo reale con la struttura).
          Il pulsante "Salva schema" è nella riga del titolo, accanto ad Azzera. */}
      {giorni.length > 0 && colonne.length > 0 && (
        <div className="flex gap-4 items-start">
        <div className="card p-3 space-y-2 min-w-0">
          <div className="text-xs font-semibold text-stone-600">Turnisti (legenda) — trascina il numero nei riquadri delle colonne-turno</div>
          <div className="overflow-x-auto">
            {/* La legenda va a capo entro la LARGHEZZA REALE della tabella (misurata):
                i chip restano sopra le celle → tragitto di trascinamento minimo. */}
            <div className="flex flex-wrap gap-1.5 mb-2" style={{ maxWidth: tableW || undefined }}>
              {medici.map(m => (
                <div key={m.id} draggable
                  onDragStart={() => { dragNum.current = m.numero_ordine ?? null; dragSource.current = null }}
                  onDragEnd={() => setOverKey(null)}
                  className="inline-flex items-center gap-1 pl-0.5 pr-2 py-0.5 rounded cursor-grab shadow-sm select-none text-xs text-white"
                  style={{ background: coloreMedico(m.numero_ordine ?? 0) }} title={`Trascina il ${m.numero_ordine}`}>
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded shrink-0 text-[11px] font-bold"
                    style={{ background: 'rgba(255,255,255,0.28)' }}>{m.numero_ordine}</span>
                  <span className="font-semibold">{m.nome}</span>
                </div>
              ))}
            </div>
            <table ref={tableRef} className="text-sm border-collapse">
              <thead>
                <tr style={{ background: '#2b3c24' }}>
                  <th className="px-2 py-1.5 text-white text-left" style={{ minWidth: 78 }}>Giorno</th>
                  <th className="px-1 py-1.5 text-white text-[10px]" style={{ width: 26 }}>#</th>
                  {colonneOrdinate.map(c => (
                    <th key={c.id} className="px-2 py-1.5 text-center font-semibold"
                      style={{ color: colHeader(c).fg, background: colHeader(c).bg, minWidth: 48, borderLeft: '1px solid #1e2a16' }}>
                      {c.sigla}
                    </th>
                  ))}
                  <th style={{ background: '#2b3c24', width: 30 }} />
                </tr>
              </thead>
              <tbody>
                {giorni.map((row, di) => {
                  const g = row.giorno_settimana
                  const slots = slotsDelGiorno(g)
                  const giornoPari = di % 2 === 0   // tinta alternata per GIORNO
                  return slots.map((slot, si) => (
                    <tr key={`${g}-${slot}`} style={{
                      background: giornoPari ? (si % 2 ? '#ffffff' : '#f6f9f3') : (si % 2 ? '#eef3e7' : '#e6efdd'),
                      // bordo verde marcato all'inizio di ogni nuovo giorno → confine evidente
                      ...(si === 0 && di > 0 ? { borderTop: '3px solid #5c7a4e' } : {}),
                    }}>
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
                        const cKey = `${g}|${slot}|${c.sigla}`
                        const over = overKey === cKey
                        return (
                          <td key={c.id} className="text-center border-l border-stone-100 px-1 py-1 transition-colors"
                            onDragOver={e => { e.preventDefault(); if (overKey !== cKey) setOverKey(cKey) }}
                            onDragLeave={() => setOverKey(k => k === cKey ? null : k)}
                            onDrop={() => { dropNumero(g, slot, c.sigla); setOverKey(null) }}
                            style={over ? { background: '#dbeccb', boxShadow: 'inset 0 0 0 2px #476540' } : undefined}>
                            {cel?.numero != null
                              ? <span draggable
                                  onDragStart={() => { dragNum.current = cel.numero; dragSource.current = { g, slot, sigla: c.sigla } }}
                                  onDragEnd={() => setOverKey(null)}
                                  onClick={() => svuotaNumero(g, slot, c.sigla)}
                                  title={`${cel.numero} · ${nomeBadge(cel.numero)} — trascina per spostare · clic per togliere`}
                                  className="inline-block w-7 h-7 leading-7 rounded text-xs font-bold text-white cursor-grab"
                                  style={{ background: coloreMedico(cel.numero) }}>{cel.numero}</span>
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
        <div className="shrink-0 sticky top-4 self-start">
          <FabbisognoPanel reparto={repartoAttivo} schemaNum={schemaNum}
            turni={turniColonne} proprieta={proprieta} />
        </div>
        </div>
      )}
    </div>
  )
}

// ── Pannello Fabbisogno (conteggio dichiarato per ambito × turno × proprietà) ──
interface FabRow { ambito: string; turno_sigla: string; totale: number; per_proprieta: Record<string, number> }
const AMBITI_SPECIALI: { key: string; label: string }[] = [
  { key: 'prefestivo', label: 'Prefestivo' },
  { key: 'sabato',     label: 'Sabato' },
  { key: 'festivi',    label: 'Domenica / Festivi' },
]
const labelAmbito = (k: string) => k === 'normale' ? 'Normale' : (AMBITI_SPECIALI.find(a => a.key === k)?.label ?? k)

// Una griglia di fabbisogno per un ambito (Normale o uno speciale). Componente
// a livello modulo (stabile): l'intestazione mostra SEMPRE il nome dell'ambito.
function GrigliaAmbito({ amb, turni, proprieta, fab, onSet, onRemove }: {
  amb: string; turni: ColonnaRow[]; proprieta: ProprietaTurno[]; fab: FabRow[]
  onSet: (amb: string, turno: string, prop: string, n: number) => void
  onRemove?: (amb: string) => void
}) {
  const valore = (turno: string, prop: string) =>
    fab.find(f => f.ambito === amb && f.turno_sigla === turno)?.per_proprieta?.[prop] ?? 0
  const totaleTurno = (turno: string) =>
    fab.find(f => f.ambito === amb && f.turno_sigla === turno)?.totale ?? 0
  const speciale = amb !== 'normale'
  return (
    <div className="border rounded-lg p-2" style={{ borderColor: speciale ? '#e3d4ad' : '#e7e5e4', background: speciale ? '#fbf7ee' : '#fff' }}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-bold" style={{ color: speciale ? '#7a5a2f' : '#476540' }}>
          {labelAmbito(amb)}{speciale && <span className="font-normal text-[10px] text-stone-400"> · override</span>}
        </span>
        {onRemove && (
          <button onClick={() => onRemove(amb)} className="text-stone-300 hover:text-red-500" title="Rimuovi questo fabbisogno speciale">
            <Trash2 size={12} />
          </button>
        )}
      </div>
      <table className="text-[11px] border-collapse w-full">
        <thead>
          <tr className="text-stone-500">
            <th className="text-left font-semibold pr-1"> </th>
            {proprieta.map(p => (
              <th key={p.sigla} className="px-0.5 font-semibold text-center" title={p.nome}>{p.sigla}</th>
            ))}
            <th className="px-0.5 font-semibold text-center text-stone-400">Tot</th>
          </tr>
        </thead>
        <tbody>
          {turni.map(t => (
            <tr key={t.sigla}>
              <td className="pr-1 font-bold" style={{ color: '#476540' }}>{t.sigla}</td>
              {proprieta.map(p => (
                <td key={p.sigla} className="px-0.5 py-0.5 text-center">
                  <input type="number" min={0} max={99}
                    key={`${amb}|${t.sigla}|${p.sigla}|${valore(t.sigla, p.sigla)}`}
                    defaultValue={valore(t.sigla, p.sigla) || ''}
                    onBlur={e => onSet(amb, t.sigla, p.sigla, parseInt(e.target.value || '0', 10))}
                    onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                    className="w-8 text-center rounded border border-stone-200 py-0.5" />
                </td>
              ))}
              <td className="px-0.5 text-center font-bold text-stone-500">{totaleTurno(t.sigla) || '·'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function FabbisognoPanel({ reparto, schemaNum, turni, proprieta }: {
  reparto: string; schemaNum: number; turni: ColonnaRow[]; proprieta: ProprietaTurno[]
}) {
  const qc = useQueryClient()
  const [extra, setExtra] = useState<string[]>([])   // ambiti speciali aperti localmente

  const fkey = ['schema-fabbisogno', reparto, schemaNum]
  const { data: fab = [] } = useQuery<FabRow[]>({
    queryKey: fkey,
    queryFn: async () => {
      const { data, error } = await supabase.from('schema_fabbisogno')
        .select('ambito, turno_sigla, totale, per_proprieta')
        .eq('reparto_id', reparto).eq('schema_num', schemaNum)
      if (error) throw error
      return (data ?? []) as FabRow[]
    },
  })
  const reload = () => qc.invalidateQueries({ queryKey: fkey })

  async function setVal(amb: string, turno: string, prop: string, n: number) {
    const row = fab.find(f => f.ambito === amb && f.turno_sigla === turno)
    const pp: Record<string, number> = { ...(row?.per_proprieta ?? {}) }
    if (n > 0) pp[prop] = n; else delete pp[prop]
    const totale = Object.values(pp).reduce((a, b) => a + (b || 0), 0)
    const { error } = await supabase.from('schema_fabbisogno').upsert(
      { reparto_id: reparto, schema_num: schemaNum, ambito: amb, turno_sigla: turno, totale, per_proprieta: pp },
      { onConflict: 'reparto_id,schema_num,ambito,turno_sigla' })
    if (!error) reload()
  }
  async function rimuoviAmbito(amb: string) {
    await supabase.from('schema_fabbisogno').delete()
      .eq('reparto_id', reparto).eq('schema_num', schemaNum).eq('ambito', amb)
    setExtra(x => x.filter(a => a !== amb)); reload()
  }

  // Ambiti mostrati: Normale sempre + quelli con dati + quelli aperti localmente.
  const conDati = [...new Set(fab.map(f => f.ambito))].filter(a => a !== 'normale')
  const specialiAperti = [...new Set([...conDati, ...extra])]
  const daAggiungere = AMBITI_SPECIALI.filter(a => !specialiAperti.includes(a.key))

  return (
    <div className="card p-3 w-64 space-y-2">
      <h3 className="text-sm font-bold text-stone-800 flex items-center gap-1.5">
        <ListChecks size={15} style={{ color: '#476540' }} /> Fabbisogno
      </h3>
      {turni.length === 0 || proprieta.length === 0 ? (
        <p className="text-[11px] text-stone-400 italic">
          Definisci almeno un turno e una proprietà per impostare il fabbisogno.
        </p>
      ) : (
        <>
          <GrigliaAmbito amb="normale" turni={turni} proprieta={proprieta} fab={fab} onSet={setVal} />
          {specialiAperti.map(amb => (
            <GrigliaAmbito key={amb} amb={amb} turni={turni} proprieta={proprieta} fab={fab} onSet={setVal} onRemove={rimuoviAmbito} />
          ))}
          {daAggiungere.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-0.5">
              <span className="w-full text-[10px] text-stone-400">+ Aggiungi fabbisogno speciale:</span>
              {daAggiungere.map(a => (
                <button key={a.key} onClick={() => setExtra(x => [...x, a.key])}
                  className="text-[10px] px-1.5 py-0.5 rounded border border-dashed hover:bg-[#f6efe0]"
                  style={{ borderColor: '#bfa46a', color: '#7a5a2f' }}>
                  + {a.label}
                </button>
              ))}
            </div>
          )}
          <p className="text-[10px] text-stone-400 leading-tight">
            Conteggio visivo: quanti turnisti servono per turno e proprietà. I fabbisogni speciali
            sovrascrivono il Normale. Non cambia la generazione.
          </p>
        </>
      )}
    </div>
  )
}
