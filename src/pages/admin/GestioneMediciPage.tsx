import { useState, useEffect, useRef, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Save, X, Trash2, AlertTriangle, RefreshCw, GripVertical, Users, Search, UserPlus, ArrowRightLeft, History, ChevronLeft, ChevronRight } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { emailValida } from '../../lib/email'
import { useConfirm } from '../../hooks/useConfirm'
import { ConfirmModal } from '../../components/ConfirmModal'
import { useReparto } from '../../contexts/RepartoContext'
import type { Medico, UtenteAutorizzato } from '../../types'
import { SubentroModal } from '../../components/SubentroModal'

interface SubentroRow {
  id: string
  numero_ordine: number | null
  data_subentro: string
  nota: string | null
  uscente: { nome: string } | null
  entrante: { nome: string } | null
}

/**
 * Griglia impaginata di nominativi selezionabili. Riempie la larghezza con
 * colonne da max 10 righe (misura il contenitore via ResizeObserver); se non
 * entrano tutti compare il navigatore pagine. I nomi si riempiono per colonna
 * (1-10 nella 1ª, 11-20 nella 2ª, …). Click = aggiungi (col ruolo attivo).
 */
function GrigliaNomiPaginata({ items, onPick }: { items: UtenteAutorizzato[]; onPick: (u: UtenteAutorizzato) => void }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [nCols, setNCols] = useState(1)
  const [page, setPage] = useState(0)
  const ITEM_W = 190
  const ROWS = 10

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      const w = entries[0].contentRect.width
      setNCols(Math.max(1, Math.floor((w + 8) / (ITEM_W + 8))))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const pageSize = ROWS * nCols
  const nPages = Math.max(1, Math.ceil(items.length / pageSize))
  const cur = Math.min(page, nPages - 1)
  useEffect(() => { setPage(0) }, [items])
  const slice = items.slice(cur * pageSize, cur * pageSize + pageSize)

  return (
    <div ref={wrapRef}>
      <div style={{
        display: 'grid',
        gridTemplateRows: `repeat(${ROWS}, minmax(0, auto))`,
        gridAutoFlow: 'column',
        gridAutoColumns: `minmax(${ITEM_W}px, 1fr)`,
        gap: '2px 8px',
      }}>
        {slice.map(u => (
          <button key={u.id} onClick={() => onPick(u)} title={u.email}
            className="flex items-center gap-1 px-2 py-1 text-sm text-left rounded hover:bg-olive-50 min-w-0">
            <Plus size={12} className="text-olive-600 shrink-0" />
            <span className="uppercase font-medium truncate">{u.nome || u.email || '—'}</span>
          </button>
        ))}
      </div>
      {nPages > 1 && (
        <div className="flex items-center justify-center gap-3 mt-2 text-xs text-stone-500">
          <button disabled={cur === 0} onClick={() => setPage(p => Math.max(0, p - 1))}
            className="p-1 rounded hover:bg-stone-100 disabled:opacity-30 disabled:cursor-not-allowed"><ChevronLeft size={16} /></button>
          <span>pagina <strong>{cur + 1}</strong> / {nPages} · {items.length} nomi</span>
          <button disabled={cur >= nPages - 1} onClick={() => setPage(p => Math.min(nPages - 1, p + 1))}
            className="p-1 rounded hover:bg-stone-100 disabled:opacity-30 disabled:cursor-not-allowed"><ChevronRight size={16} /></button>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// NOTA ARCHITETTURALE — dipendenze di un medico nel sistema:
//
//   medici (id, numero_ordine, nome)
//     ↓ ON DELETE CASCADE
//   turni (medico_id)          → eliminati automaticamente
//   ferie (medico_id)          → eliminati automaticamente
//
//   schemi_modello (numero_medico_mattina/pomeriggio/rm/rp)
//     → numeri interi, NON foreign key → azzerati manualmente
//
// Modifica numero_ordine → il calendario va rigenerato perché
// l'algoritmo di rotazione usa l'indice posizionale dei medici.
// ─────────────────────────────────────────────────────────────────

const CAMPI_SCHEMA = [
  'numero_medico_mattina',
  'numero_medico_pomeriggio',
  'numero_medico_rm',
  'numero_medico_rp',
] as const

export function GestioneMediciPage() {
  const qc = useQueryClient()
  const { confirm, confirmState } = useConfirm()
  const { repartoAttivo, repartoCorrente } = useReparto()

  // ── Stato editing identità (cognome + nome, via modal) ───────
  const [editId,          setEditId]          = useState<string | null>(null)
  const [editCognome,     setEditCognome]     = useState('')
  const [editNomeProprio, setEditNomeProprio] = useState('')

  // ── Ordine locale (drag & drop, non ancora salvato) ──────────
  const [localMedici,      setLocalMedici]      = useState<Medico[]>([])
  const [hasOrderChanges,  setHasOrderChanges]  = useState(false)
  const [savingOrder,      setSavingOrder]       = useState(false)

  // ── Drag state (mouse + touch) ───────────────────────────────
  const dragFromIdx     = useRef<number | null>(null)
  const touchActive     = useRef(false)          // touch drag in corso
  const tbodyRef        = useRef<HTMLTableSectionElement>(null)
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null)
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)

  // ── Stato aggiungi (ricerca utenti globali / crea nuovo) ─────
  const [searchTerm, setSearchTerm] = useState('')
  const [showNew,      setShowNew]      = useState(false)
  const [nuovoCognome, setNuovoCognome] = useState('')
  const [nuovoNome,    setNuovoNome]    = useState('')
  const [nuovoEmail,   setNuovoEmail]   = useState('')
  const [ruoloNuovo,   setRuoloNuovo]   = useState<'turnista' | 'ospite'>('turnista')

  // ── Feedback ─────────────────────────────────────────────────
  const [errore,  setErrore]  = useState('')
  const [avviso,  setAvviso]  = useState('')
  const [saving,  setSaving]  = useState(false)

  // ── Query (scoped al reparto attivo) ─────────────────────────
  const { data: medici = [], isLoading } = useQuery<Medico[]>({
    queryKey: ['medici-tutti', repartoAttivo],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('medici').select('*').eq('reparto_id', repartoAttivo).eq('attivo', true).order('numero_ordine')
      if (error) throw error
      return data
    },
  })

  // Utenti globali — per la ricerca "3 lettere" in fase di aggiunta turnista.
  const { data: utenti = [] } = useQuery<UtenteAutorizzato[]>({
    queryKey: ['utenti_autorizzati'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_all_utenti_autorizzati')
      if (error) throw error
      return (data ?? []) as UtenteAutorizzato[]
    },
    staleTime: 0,
  })

  // Storico subentri del reparto (per la sezione in fondo).
  const { data: subentri = [] } = useQuery<SubentroRow[]>({
    queryKey: ['subentri', repartoAttivo],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('subentri')
        .select('id, numero_ordine, data_subentro, nota, uscente:medici!medico_uscente_id(nome), entrante:medici!medico_entrante_id(nome)')
        .eq('reparto_id', repartoAttivo)
        .order('data_subentro', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as SubentroRow[]
    },
  })
  const [subentroPer, setSubentroPer] = useState<Medico | null>(null)

  // Utenti responsabili di QUESTO reparto → etichetta "Responsabile" in colonna Ruolo.
  const { data: responsabiliIds = [] } = useQuery<string[]>({
    queryKey: ['reparto-responsabili', repartoAttivo],
    queryFn: async () => {
      const { data, error } = await supabase.from('reparto_responsabili')
        .select('utente_id').eq('reparto_id', repartoAttivo)
      if (error) throw error
      return (data ?? []).map((r: { utente_id: string }) => r.utente_id)
    },
  })
  const responsabiliSet = useMemo(() => new Set(responsabiliIds), [responsabiliIds])

  // Sincronizza l'ordine locale con il DB — solo se non ci sono modifiche pendenti
  // Turnisti (in rotazione, trascinabili) vs Ospiti (fuori rotazione, pannello).
  const turnistiAttivi = useMemo(() => medici.filter(m => m.ruolo_reparto !== 'ospite'), [medici])
  const ospiti = useMemo(() => medici.filter(m => m.ruolo_reparto === 'ospite'), [medici])
  // Medico attualmente in modifica nel modal (turnista o ospite).
  const editMedico = useMemo(() => medici.find(m => m.id === editId) ?? null, [medici, editId])

  // Cambio reparto attivo → abbandona le modifiche d'ordine non salvate e
  // chiudi l'editing: l'avviso giallo e l'ordine pendente appartengono al
  // reparto PRECEDENTE, non al nuovo (altrimenti l'avviso "resta appiccicato").
  useEffect(() => {
    setHasOrderChanges(false)
    setEditId(null)
    setErrore('')
    setAvviso('')
  }, [repartoAttivo])

  useEffect(() => {
    if (!hasOrderChanges) setLocalMedici(turnistiAttivi)
  }, [turnistiAttivi, hasOrderChanges])

  // Listener touchmove NON-PASSIVE sul tbody: impedisce lo scroll della pagina
  // durante il drag su Safari/iOS (i listener React sono passivi di default)
  useEffect(() => {
    const el = tbodyRef.current
    if (!el) return
    const prevent = (e: TouchEvent) => { if (touchActive.current) e.preventDefault() }
    el.addEventListener('touchmove', prevent, { passive: false })
    return () => el.removeEventListener('touchmove', prevent)
  }, [])

  // ── Drag & Drop handlers ─────────────────────────────────────
  function handleDragStart(idx: number) {
    if (editId) return   // non avviare drag durante editing
    dragFromIdx.current = idx
    setDraggingIdx(idx)
  }

  function handleDragOver(e: React.DragEvent, idx: number) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverIdx(idx)
  }

  function handleDragLeave() {
    setDragOverIdx(null)
  }

  function handleDrop(toIdx: number) {
    const fromIdx = dragFromIdx.current
    setDragOverIdx(null)
    setDraggingIdx(null)
    dragFromIdx.current = null
    if (fromIdx === null || fromIdx === toIdx) return

    const next = [...localMedici]
    const [moved] = next.splice(fromIdx, 1)
    next.splice(toIdx, 0, moved)
    setLocalMedici(next)
    setHasOrderChanges(true)
  }

  function handleDragEnd() {
    setDragOverIdx(null)
    setDraggingIdx(null)
    dragFromIdx.current = null
  }

  // ── Touch handlers (Safari/iOS) ───────────────────────────────
  function handleTouchStart(idx: number) {
    if (editId) return
    dragFromIdx.current = idx
    setDraggingIdx(idx)
    touchActive.current = true
  }

  /** Trova l'indice di riga sotto il dito usando data-drag-index */
  function rowIdxFromPoint(clientX: number, clientY: number): number | null {
    const el = document.elementFromPoint(clientX, clientY)
    const tr = el?.closest('[data-drag-index]') as HTMLElement | null
    if (!tr) return null
    const n = parseInt(tr.dataset.dragIndex ?? '', 10)
    return isNaN(n) ? null : n
  }

  function handleTouchMove(e: React.TouchEvent) {
    if (!touchActive.current) return
    const t = e.touches[0]
    const toIdx = rowIdxFromPoint(t.clientX, t.clientY)
    setDragOverIdx(toIdx)
  }

  function handleTouchEnd(e: React.TouchEvent) {
    if (!touchActive.current) return
    touchActive.current = false
    const t = e.changedTouches[0]
    const toIdx = rowIdxFromPoint(t.clientX, t.clientY)
    if (toIdx !== null) handleDrop(toIdx)
    else handleDragEnd()
  }

  // ── Salva nuovo ordine nel DB ─────────────────────────────────
  async function salvaOrdine() {
    setSavingOrder(true); setErrore('')
    try {
      // Fase 0: gli OSPITI sono fuori rotazione → numero_ordine NULL. Ripulisce
      // eventuali residui numerici (vecchio bug) che altrimenti collidono col
      // rinumero dei turnisti sul vincolo UNIQUE(reparto_id, numero_ordine).
      const { error: e0 } = await supabase.from('medici')
        .update({ numero_ordine: null })
        .eq('reparto_id', repartoAttivo).eq('ruolo_reparto', 'ospite').not('numero_ordine', 'is', null)
      if (e0) throw e0
      // Fase 1: valori temporanei alti per evitare conflitti di unicità
      for (let i = 0; i < localMedici.length; i++) {
        const { error } = await supabase
          .from('medici').update({ numero_ordine: 1000 + i }).eq('id', localMedici[i].id)
        if (error) throw error
      }
      // Fase 2: valori finali sequenziali 1, 2, 3 …
      for (let i = 0; i < localMedici.length; i++) {
        const { error } = await supabase
          .from('medici').update({ numero_ordine: i + 1 }).eq('id', localMedici[i].id)
        if (error) throw error
      }
      setHasOrderChanges(false)
      const msg = 'Ordine turnisti modificato tramite drag & drop'
      setAvviso(msg + '.')
      qc.invalidateQueries({ queryKey: ['medici'] })
      qc.invalidateQueries({ queryKey: ['medici-tutti', repartoAttivo] })
    } catch (e: unknown) {
      setErrore((e as Error).message)
    } finally {
      setSavingOrder(false)
    }
  }

  // ── Annulla riordino ─────────────────────────────────────────
  function annullaOrdine() {
    setLocalMedici(turnistiAttivi)
    setHasOrderChanges(false)
  }

  // ── Avvia editing identità (apre il modal) ───────────────────
  function startEdit(m: Medico) {
    setEditId(m.id)
    // Prefilla da cognome/nome_proprio se presenti; altrimenti split del nome
    // legacy (primo token = cognome, resto = nome) come ripiego.
    if (m.cognome || m.nome_proprio) {
      setEditCognome(m.cognome ?? '')
      setEditNomeProprio(m.nome_proprio ?? '')
    } else {
      const parts = (m.nome ?? '').trim().split(/\s+/)
      setEditCognome(parts[0] ?? '')
      setEditNomeProprio(parts.slice(1).join(' '))
    }
    setErrore('')
  }

  // ── Salva modifica identità (cognome + nome) ──────────────────
  async function saveEdit() {
    if (!editMedico) return
    const cognome     = editCognome.trim().toUpperCase()
    const nomeProprio = editNomeProprio.trim()
    if (!cognome) { setErrore('Il cognome non può essere vuoto.'); return }
    const nome = `${cognome} ${nomeProprio}`.replace(/\s+/g, ' ').trim()
    setSaving(true); setErrore('')

    // Identità canonica: se il medico è legato a un utente, aggiorno l'UTENTE
    // (via RPC) e il trigger propaga cognome/nome/nome_proprio a TUTTI i medici
    // collegati → il nome cambia ovunque (calendari, altri reparti). Se l'utente
    // non è in lista (o medico senza account), update diretto del solo medico.
    const u = editMedico.utente_id ? utenti.find(x => x.id === editMedico.utente_id) : null
    if (u) {
      const { error } = await supabase.rpc('update_utente_autorizzato', {
        p_id: u.id, p_email: u.email, p_nome: nome, p_ruolo: u.ruolo,
        p_cognome: cognome, p_nome_proprio: nomeProprio,
      })
      if (error) { setSaving(false); setErrore(error.message); return }
    } else {
      const { error } = await supabase.from('medici')
        .update({ nome, cognome, nome_proprio: nomeProprio || null })
        .eq('id', editMedico.id)
      if (error) { setSaving(false); setErrore(error.message); return }
    }

    setSaving(false)
    setEditId(null)
    qc.invalidateQueries({ queryKey: ['medici'] })
    qc.invalidateQueries({ queryKey: ['medici-tutti', repartoAttivo] })
    qc.invalidateQueries({ queryKey: ['utenti_autorizzati'] })
  }

  // ── Elimina medico con cascade ───────────────────────────────
  async function eliminaMedico(m: Medico) {
    const ok = await confirm({
      title:        `Elimina ${m.nome}`,
      message:
        `Il medico verrà eliminato definitivamente insieme a:\n` +
        `• tutti i suoi turni nel calendario\n` +
        `• tutte le sue ferie\n` +
        `• le sue presenze nello schema (azzeramento slots)\n\n` +
        `Questa operazione NON può essere annullata.`,
      confirmLabel: 'Elimina definitivamente',
      danger:       true,
    })
    if (!ok) return

    setSaving(true)
    try {
      if (m.numero_ordine != null) {
        for (const campo of CAMPI_SCHEMA) {
          await supabase.from('schemi_modello')
            .update({ [campo]: null }).eq(campo, m.numero_ordine).eq('reparto_id', repartoAttivo)
        }
      }
      const { error } = await supabase.from('medici').delete().eq('id', m.id)
      if (error) throw error

      const msg = `${m.nome} eliminato — turni e schema aggiornati`
      setAvviso(msg + '.')
      setHasOrderChanges(false)   // il DB sarà riallineato
      qc.invalidateQueries({ queryKey: ['medici'] })
      qc.invalidateQueries({ queryKey: ['medici-tutti', repartoAttivo] })
      qc.invalidateQueries({ queryKey: ['schemi_modello'] })
      qc.invalidateQueries({ queryKey: ['turni'] })
    } catch (e: unknown) {
      setErrore((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  // ── Aggiungi turnista ────────────────────────────────────────
  // Prossimo numero_ordine LIBERO, letto FRESCO dal DB: conta TUTTE le righe
  // del reparto (anche inattive) perché il vincolo UNIQUE(reparto_id,
  // numero_ordine) vale su tutte; gli ospiti hanno numero_ordine NULL. Leggere
  // dallo stato locale (cache) causava collisioni tra un'aggiunta e l'altra.
  async function nextOrdineFresh(): Promise<number> {
    const { data, error } = await supabase.from('medici')
      .select('numero_ordine')
      .eq('reparto_id', repartoAttivo)
      .not('numero_ordine', 'is', null)
      .order('numero_ordine', { ascending: false })
      .limit(1)
    if (error) throw error
    const max = (data && data.length ? data[0].numero_ordine : 0) ?? 0
    return max + 1
  }
  // Stima sincrona solo per l'etichetta UI (il valore vero è nextOrdineFresh).
  function prossimoOrdineStimato(): number {
    const nums = localMedici.map(m => m.numero_ordine).filter((n): n is number => n != null)
    return nums.length ? Math.max(...nums) + 1 : 1
  }

  // Cambia al volo il ruolo nel reparto (Turnista ↔ Ospite) di un medico.
  async function cambiaRuoloReparto(m: Medico, nuovo: 'turnista' | 'ospite') {
    // Ospite = fuori rotazione (numero_ordine NULL). Turnista = rientra in coda
    // (ultimo numero_ordine del reparto + 1, letto fresco per evitare collisioni).
    let numero_ordine: number | null = null
    if (nuovo !== 'ospite') {
      try { numero_ordine = await nextOrdineFresh() }
      catch (e) { setErrore(e instanceof Error ? e.message : 'Errore nel calcolo ordine'); return }
    }
    const { error } = await supabase.from('medici').update({ ruolo_reparto: nuovo, numero_ordine }).eq('id', m.id)
    if (error) { setErrore(error.message); return }
    qc.invalidateQueries({ queryKey: ['medici-tutti', repartoAttivo] })
    qc.invalidateQueries({ queryKey: ['medici'] })
  }

  // Utenti globali che NON sono già turnisti di questo reparto (per id o nome),
  // in ordine alfabetico → base della griglia "Aggiungi al reparto".
  const eligibili = useMemo(() => {
    const nomiPresenti = new Set(localMedici.map(m => m.nome.toUpperCase().trim()))
    const idPresenti = new Set(localMedici.map(m => m.utente_id).filter(Boolean))
    return utenti
      .filter(u => u.attivo && !idPresenti.has(u.id) && !nomiPresenti.has((u.nome ?? '').toUpperCase().trim()))
      .sort((a, b) => (a.nome ?? a.email ?? '').localeCompare(b.nome ?? b.email ?? '', 'it'))
  }, [utenti, localMedici])

  // Filtro della griglia: sotto i 3 caratteri mostra TUTTI, da 3 in su filtra
  // LATO CLIENT per token (nessuna query per carattere). "mar stef" trova
  // comunque "Stefano Marabelli".
  const filtrati = useMemo(() => {
    const raw = searchTerm.trim().toLowerCase()
    if (raw.length < 3) return eligibili
    const tokens = raw.split(/\s+/).filter(Boolean)
    return eligibili.filter(u => {
      const hay = ((u.nome ?? '') + ' ' + (u.email ?? '')).toLowerCase()
      return tokens.every(t => hay.includes(t))
    })
  }, [eligibili, searchTerm])

  // Aggiunge un utente globale ESISTENTE come turnista del reparto.
  async function aggiungiDaUtente(u: UtenteAutorizzato) {
    setErrore('')
    let ordine: number | null
    try { ordine = ruoloNuovo === 'ospite' ? null : await nextOrdineFresh() }
    catch (e) { setErrore(e instanceof Error ? e.message : 'Errore nel calcolo ordine'); return }
    const { error } = await supabase.from('medici').insert({
      nome: u.nome || u.email, cognome: u.cognome ?? null, nome_proprio: u.nome_proprio ?? null,
      numero_ordine: ordine, ruolo_reparto: ruoloNuovo,
      is_reperibilita: false, attivo: true, reparto_id: repartoAttivo, utente_id: u.id,
    })
    if (error) { setErrore(error.message); return }
    setSearchTerm('')
    const msg = `${u.nome || u.email} aggiunto come turnista`
    setAvviso(msg + '.')
    qc.invalidateQueries({ queryKey: ['medici'] })
    qc.invalidateQueries({ queryKey: ['medici-tutti', repartoAttivo] })
  }

  // Crea un NUOVO turnista: nuovo utente globale (livello user) + medico linkato.
  async function aggiungiNuovo() {
    // Identità: Cognome MAIUSCOLO + Nome come inserito; display combinato "COGNOME Nome".
    const cognome = nuovoCognome.trim().toUpperCase()
    const nomeProprio = nuovoNome.trim()
    const nome = `${cognome} ${nomeProprio}`.replace(/\s+/g, ' ').trim()
    const email = nuovoEmail.trim().toLowerCase()
    if (!nuovoCognome.trim() || !nuovoNome.trim()) { setErrore('Inserisci cognome e nome.'); return }
    if (!email) { setErrore('Serve l\'email collegata a un account Gmail per il login.'); return }
    if (!emailValida(email)) { setErrore('Indirizzo email non valido (controlla la @ e il dominio).'); return }
    setSaving(true); setErrore('')
    const { error: uErr } = await supabase.rpc('insert_utente_autorizzato',
      { p_email: email, p_nome: nome, p_ruolo: 'user', p_cognome: cognome, p_nome_proprio: nomeProprio })
    if (uErr) { setSaving(false); setErrore('Utente: ' + uErr.message); return }
    const { data: lista } = await supabase.rpc('get_all_utenti_autorizzati')
    const nuovo = ((lista ?? []) as UtenteAutorizzato[]).find(x => x.email === email)
    let ordineNuovo: number | null
    try { ordineNuovo = ruoloNuovo === 'ospite' ? null : await nextOrdineFresh() }
    catch (e) { setSaving(false); setErrore(e instanceof Error ? e.message : 'Errore nel calcolo ordine'); return }
    const { error: mErr } = await supabase.from('medici').insert({
      nome, cognome, nome_proprio: nomeProprio,
      numero_ordine: ordineNuovo, ruolo_reparto: ruoloNuovo,
      is_reperibilita: false, attivo: true,
      reparto_id: repartoAttivo, utente_id: nuovo?.id ?? null,
    })
    setSaving(false)
    if (mErr) { setErrore(mErr.message); return }
    setNuovoCognome(''); setNuovoNome(''); setNuovoEmail(''); setShowNew(false)
    const msg = `${nome} creato come turnista e utente (login con ${email})`
    setAvviso(msg + '.')
    qc.invalidateQueries({ queryKey: ['utenti_autorizzati'] })
    qc.invalidateQueries({ queryKey: ['medici'] })
    qc.invalidateQueries({ queryKey: ['medici-tutti', repartoAttivo] })
  }

  // ─────────────────────────────────────────────────────────────
  return (
    <div className="w-full space-y-5">
      <ConfirmModal {...confirmState.opts} open={confirmState.open}
        onConfirm={confirmState.onConfirm} onCancel={confirmState.onCancel} />

      {subentroPer && (
        <SubentroModal
          uscente={subentroPer}
          repartoId={repartoAttivo}
          utenti={utenti}
          mediciAttuali={localMedici}
          onClose={() => setSubentroPer(null)}
          onDone={(msg) => { setSubentroPer(null); setAvviso(msg) }}
        />
      )}

      {/* Modal modifica nominativo (cognome + nome) — turnisti e ospiti */}
      {editMedico && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => { if (!saving) setEditId(null) }}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-5 space-y-4"
            onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-stone-800 flex items-center gap-2">
              <Pencil size={16} style={{ color: '#476540' }} /> Modifica nominativo
            </h3>
            <div className="space-y-2">
              <div>
                <label className="text-xs font-semibold text-stone-500">Cognome</label>
                <input value={editCognome} onChange={e => setEditCognome(e.target.value.toUpperCase())}
                  className="input w-full text-sm uppercase" autoFocus
                  onKeyDown={e => e.key === 'Enter' && saveEdit()} />
              </div>
              <div>
                <label className="text-xs font-semibold text-stone-500">Nome</label>
                <input value={editNomeProprio} onChange={e => setEditNomeProprio(e.target.value)}
                  className="input w-full text-sm"
                  onKeyDown={e => e.key === 'Enter' && saveEdit()} />
              </div>
            </div>
            <p className="text-[11px] text-stone-400">
              {editMedico.utente_id
                ? 'Aggiorna l’identità dell’utente: il nome cambia ovunque (calendari, altri reparti).'
                : 'Medico senza account: il nome viene aggiornato solo in questo reparto.'}
            </p>
            {errore && <p className="text-xs text-red-600">{errore}</p>}
            <div className="flex gap-2 justify-end">
              <button onClick={() => setEditId(null)} disabled={saving}
                className="btn-secondary py-1.5 px-3 text-sm">Annulla</button>
              <button onClick={saveEdit} disabled={saving || !editCognome.trim()}
                className="btn-primary py-1.5 px-3 text-sm gap-1.5">
                <Save size={13} /> {saving ? 'Salvataggio…' : 'Salva'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Titolo + pulsante salva ordine */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-stone-800 flex items-center gap-2">
            <Users size={20} style={{ color: '#476540' }} />
            Turnisti — {repartoCorrente?.nome ?? '…'}
          </h2>
          <p className="text-sm text-stone-600 mt-0.5">
            Turnisti di questo reparto. Trascina le righe per riordinare la rotazione.
          </p>
        </div>
        {hasOrderChanges && (
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={annullaOrdine}
              className="btn-secondary py-1.5 px-3 text-sm gap-1.5"
              title="Annulla riordino">
              <X size={13} /> Annulla
            </button>
            <button
              onClick={salvaOrdine}
              disabled={savingOrder}
              className="btn-primary py-1.5 px-3 text-sm gap-1.5"
              title="Salva il nuovo ordine nel DB">
              <Save size={13} />
              {savingOrder ? 'Salvataggio…' : 'Salva modifiche'}
            </button>
          </div>
        )}
      </div>

      {/* Errore */}
      {errore && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {errore}
        </div>
      )}

      {/* Avviso rigenera */}
      {avviso && (
        <div className="flex gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
          <div className="flex-1"><p>{avviso}</p></div>
          <button onClick={() => setAvviso('')}
            className="text-amber-500 hover:text-amber-700 shrink-0">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Indicatore ordine modificato non salvato */}
      {hasOrderChanges && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium"
          style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #fbbf24' }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#f59e0b', display: 'inline-block', flexShrink: 0 }} />
          Ordine modificato — clicca "Salva modifiche" per applicarlo al calendario
        </div>
      )}

      {/* Turnisti (rotazione) a sinistra · Ospiti a destra */}
      <div className="flex gap-4 items-start">
      <div className="card overflow-hidden flex-1">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 border-b border-stone-200">
            <tr>
              <th className="w-8" />          {/* drag handle */}
              <th className="px-3 py-2 text-left font-semibold text-stone-600 w-10">N°</th>
              <th className="px-3 py-2 text-left font-semibold text-stone-600">Nome</th>
              <th className="px-3 py-2 text-center font-semibold text-stone-600 w-28">Ruolo</th>
              <th className="px-3 py-2 w-20" />
            </tr>
          </thead>
          <tbody ref={tbodyRef} className="divide-y divide-gray-100">
            {isLoading && (
              <tr>
                <td colSpan={5} className="px-3 py-4 text-center text-stone-500">
                  Caricamento…
                </td>
              </tr>
            )}

            {localMedici.map((m, idx) => (

              /* ── Riga — draggable (mouse + touch); modifica nel modal ── */
              <tr
                key={m.id}
                data-drag-index={idx}
                draggable
                onDragStart={() => handleDragStart(idx)}
                onDragOver={e => handleDragOver(e, idx)}
                onDragLeave={handleDragLeave}
                onDrop={() => handleDrop(idx)}
                onDragEnd={handleDragEnd}
                onTouchStart={() => handleTouchStart(idx)}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                className="group transition-colors"
                style={{
                  background:    dragOverIdx === idx  ? '#e0ead8'
                               : draggingIdx === idx  ? '#f9fafb'
                               : undefined,
                  opacity:       draggingIdx === idx ? 0.45 : 1,
                  outline:       dragOverIdx === idx ? '2px solid #9ab488' : undefined,
                  outlineOffset: dragOverIdx === idx ? '-2px' : undefined,
                }}
              >
                {/* Drag handle */}
                <td className="pl-2 text-stone-400 group-hover:text-stone-600 transition-colors"
                  style={{ cursor: 'grab' }}
                  title="Trascina per riordinare">
                  <GripVertical size={14} />
                </td>

                {/* N° (mostra posizione corrente, anche se non ancora salvata) */}
                <td className="px-3 py-2 font-mono font-semibold"
                  style={{ color: hasOrderChanges ? '#92400e' : '#6b7280' }}>
                  {idx + 1}
                </td>

                <td className="px-3 py-2 font-semibold text-stone-800 uppercase">
                  {m.nome}
                </td>

                <td className="px-3 py-2 text-center">
                  {m.utente_id && responsabiliSet.has(m.utente_id) ? (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                      style={{ background: '#1c2818', color: '#e0e8d8' }}>Responsabile</span>
                  ) : (
                    <select value={m.ruolo_reparto ?? 'turnista'}
                      onChange={e => cambiaRuoloReparto(m, e.target.value as 'turnista' | 'ospite')}
                      className="text-xs rounded px-1 py-0.5 border border-stone-200 bg-white cursor-pointer">
                      <option value="turnista">Turnista</option>
                      <option value="ospite">Ospite</option>
                    </select>
                  )}
                </td>

                <td className="px-3 py-2">
                  <div className="flex gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => startEdit(m)}
                      className="p-1.5 rounded text-stone-500 hover:text-olive-700 hover:bg-olive-50 transition-colors"
                      title="Modifica nome">
                      <Pencil size={14} />
                    </button>
                    <button onClick={() => setSubentroPer(m)} disabled={saving}
                      className="p-1.5 rounded text-stone-500 hover:text-olive-700 hover:bg-olive-50 transition-colors"
                      title="Subentro — sostituisci questo turnista">
                      <ArrowRightLeft size={14} />
                    </button>
                    <button onClick={() => eliminaMedico(m)} disabled={saving}
                      className="p-1.5 rounded text-stone-500 hover:text-red-600 hover:bg-red-50 transition-colors"
                      title="Elimina">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pannello Ospiti — fuori rotazione, niente drag */}
      <div className="card p-3 w-72 shrink-0">
        <h3 className="font-semibold text-stone-700 text-sm mb-2 flex items-center gap-1.5">
          <Users size={15} style={{ color: '#9a7b4f' }} /> Ospiti
        </h3>
        {ospiti.length === 0 ? (
          <p className="text-xs text-stone-400">Nessun ospite.</p>
        ) : (
          <ul className="space-y-1">
            {ospiti.map(o => (
              <li key={o.id} className="flex items-center gap-1 text-sm">
                <span className="uppercase flex-1 truncate" title={o.nome}>{o.nome}</span>
                <button onClick={() => startEdit(o)}
                  className="p-1 rounded text-stone-400 hover:text-olive-700 hover:bg-olive-50 shrink-0 transition-colors"
                  title="Modifica nominativo">
                  <Pencil size={13} />
                </button>
                <button onClick={() => cambiaRuoloReparto(o, 'turnista')}
                  className="text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0 hover:opacity-90"
                  style={{ background: '#456b3a', color: '#fff' }}
                  title="Rendi turnista (in coda alla rotazione)">→ Turnista</button>
                <button onClick={() => eliminaMedico(o)} disabled={saving}
                  className="p-1 rounded text-stone-400 hover:text-red-600 hover:bg-red-50 shrink-0 transition-colors"
                  title="Elimina dall'elenco">
                  <Trash2 size={13} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-[10px] text-stone-400 mt-2 leading-snug">Vedono il reparto ma non sono in rotazione.</p>
      </div>

      </div>

      {/* Aggiungi turnista: ricerca utenti globali (3+ lettere) o crea nuovo */}
      <div className="card p-4 space-y-3">
        <h3 className="font-semibold text-stone-700 text-sm flex items-center gap-2">
          <UserPlus size={15} /> Aggiungi al reparto
        </h3>

        {/* Ruolo: SWITCH grande e mutuamente esclusivo. Il nome cliccato dalla
            griglia (o il nuovo creato) entra con QUESTO ruolo. */}
        <div>
          <div className="text-xs text-stone-500 mb-1">I nomi che clicchi entrano come:</div>
          <div className="inline-flex rounded-lg border border-stone-300 overflow-hidden shadow-sm">
            {(['turnista', 'ospite'] as const).map(r => (
              <button key={r} onClick={() => setRuoloNuovo(r)}
                className="px-5 py-2 text-sm font-bold transition-colors"
                style={ruoloNuovo === r
                  ? { background: '#476540', color: '#fff' }
                  : { background: '#fff', color: '#78716c' }}>
                {r === 'turnista' ? 'Turnista' : 'Ospite'}
              </button>
            ))}
          </div>
          <span className="text-[11px] text-stone-400 ml-2">
            {ruoloNuovo === 'turnista' ? 'in rotazione' : 'fuori rotazione (sola vista)'}
          </span>
        </div>

        {/* Ricerca: filtra la griglia sotto, da ≥3 caratteri (lato client) */}
        {!showNew && (
          <div className="flex items-center gap-2">
            <Search size={15} className="text-stone-400 shrink-0" />
            <input value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
              placeholder="Cerca un nome (min 3 lettere)…" className="input flex-1 text-sm" />
            {searchTerm && (
              <button onClick={() => setSearchTerm('')} className="text-stone-400 hover:text-stone-600 p-1"><X size={14} /></button>
            )}
          </div>
        )}

        {/* Griglia impaginata dei nomi (esclusi quelli già nel reparto) */}
        {!showNew && (
          filtrati.length > 0 ? (
            <GrigliaNomiPaginata items={filtrati} onPick={aggiungiDaUtente} />
          ) : (
            <div className="text-xs text-stone-500 py-2">
              {eligibili.length === 0
                ? 'Nessun turnista disponibile da aggiungere (sono già tutti nel reparto).'
                : `Nessun nome corrisponde a "${searchTerm.trim()}". Aggiungilo come nuovo qui sotto.`}
            </div>
          )
        )}

        {!showNew ? (
          <button onClick={() => { setShowNew(true); setNuovoCognome(searchTerm.toUpperCase()); setNuovoNome('') }}
            className="text-xs font-semibold inline-flex items-center gap-1" style={{ color: '#476540' }}>
            <Plus size={13} /> Non c'è? Aggiungi un nuovo turnista
          </button>
        ) : (
          <div className="rounded-lg border border-olive-200 p-3 space-y-2" style={{ background: 'rgba(232,240,224,0.4)' }}>
            <p className="text-xs text-stone-600">
              Verrà aggiunto come turnista <strong>e come utente</strong> (livello User). Serve la sua
              <strong> email Gmail</strong> per il login.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <input value={nuovoCognome} onChange={e => setNuovoCognome(e.target.value.toUpperCase())}
                placeholder="COGNOME" className="input text-sm uppercase" />
              <input value={nuovoNome} onChange={e => setNuovoNome(e.target.value.toUpperCase())}
                placeholder="NOME" className="input text-sm uppercase" />
            </div>
            <input value={nuovoEmail} onChange={e => setNuovoEmail(e.target.value)}
              placeholder="email@gmail.com" type="email" className="input text-sm w-full" />
            <div className="flex gap-2">
              <button onClick={aggiungiNuovo} disabled={saving || !nuovoCognome.trim() || !nuovoNome.trim() || !nuovoEmail.trim()}
                className="btn-primary py-1 px-3 text-xs gap-1"><Plus size={13} /> Crea turnista</button>
              <button onClick={() => { setShowNew(false); setNuovoCognome(''); setNuovoNome(''); setNuovoEmail('') }} className="btn-secondary py-1 px-2 text-xs">Annulla</button>
            </div>
          </div>
        )}
        <p className="text-[11px] text-stone-500">
          Aggiunto come ultimo in rotazione (n° {prossimoOrdineStimato()}). Trascina per riposizionarlo.
        </p>
      </div>

      {/* Storico subentri */}
      {subentri.length > 0 && (
        <div className="card p-4 space-y-2">
          <h3 className="font-semibold text-stone-700 text-sm flex items-center gap-2">
            <History size={15} /> Storico subentri
          </h3>
          <ul className="space-y-1">
            {subentri.map(s => (
              <li key={s.id} className="text-sm flex items-center gap-2 flex-wrap">
                <span className="font-mono text-xs text-stone-400">n°{s.numero_ordine ?? '—'}</span>
                <span className="uppercase font-semibold text-stone-700">{s.uscente?.nome ?? '—'}</span>
                <ArrowRightLeft size={12} className="text-olive-500 shrink-0" />
                <span className="uppercase font-semibold text-olive-700">{s.entrante?.nome ?? '—'}</span>
                <span className="text-xs text-stone-500">dal {s.data_subentro.split('-').reverse().join('/')}</span>
                {s.nota && <span className="text-xs text-stone-400 italic">— {s.nota}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Legenda */}
      <div className="text-xs text-stone-500 space-y-1 px-1">
        <p className="flex items-center gap-1.5">
          <GripVertical size={11} className="text-stone-400" />
          Trascina le righe per cambiare l'ordine, poi clicca <strong>Salva modifiche</strong>
        </p>
        <p className="flex items-center gap-1.5">
          <RefreshCw size={11} className="text-amber-500" />
          Dopo ogni modifica/eliminazione: <strong>Admin → Genera Calendario</strong>
        </p>
        <p className="flex items-center gap-1.5">
          <Trash2 size={11} className="text-red-400" />
          L'eliminazione rimuove il medico da turni, ferie e schema in modo permanente
        </p>
      </div>
    </div>
  )
}
