import { useState, useEffect, useRef, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Save, X, Trash2, AlertTriangle, RefreshCw, GripVertical, Users, Search, UserPlus } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { emailValida } from '../../lib/email'
import { useConfirm } from '../../hooks/useConfirm'
import { ConfirmModal } from '../../components/ConfirmModal'
import { useReparto } from '../../contexts/RepartoContext'
import type { Medico, UtenteAutorizzato } from '../../types'

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

  // ── Stato editing inline (solo nome + REP, NON ordine) ───────
  const [editId,   setEditId]   = useState<string | null>(null)
  const [editNome, setEditNome] = useState('')
  const [editRep,  setEditRep]  = useState(false)

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

  // ── Feedback ─────────────────────────────────────────────────
  const [errore,  setErrore]  = useState('')
  const [avviso,  setAvviso]  = useState('')
  const [saving,  setSaving]  = useState(false)

  // ── Query (scoped al reparto attivo) ─────────────────────────
  const { data: medici = [], isLoading } = useQuery<Medico[]>({
    queryKey: ['medici-tutti', repartoAttivo],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('medici').select('*').eq('reparto_id', repartoAttivo).order('numero_ordine')
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

  // Sincronizza l'ordine locale con il DB — solo se non ci sono modifiche pendenti
  useEffect(() => {
    if (!hasOrderChanges) setLocalMedici(medici)
  }, [medici, hasOrderChanges])

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
    setLocalMedici(medici)
    setHasOrderChanges(false)
  }

  // ── Avvia editing (solo nome + REP) ──────────────────────────
  function startEdit(m: Medico) {
    setEditId(m.id)
    setEditNome(m.nome)
    setEditRep(m.is_reperibilita)
    setErrore('')
  }

  // ── Salva modifica nome/REP ───────────────────────────────────
  async function saveEdit() {
    const nome = editNome.trim().toUpperCase()
    if (!nome) { setErrore('Il nome non può essere vuoto.'); return }
    setSaving(true); setErrore('')

    const { error } = await supabase
      .from('medici')
      .update({ nome, is_reperibilita: editRep })
      .eq('id', editId!)

    setSaving(false)
    if (error) { setErrore(error.message); return }

    setEditId(null)
    // Aggiorna anche il nome in localMedici per coerenza visiva
    setLocalMedici(prev => prev.map(m =>
      m.id === editId ? { ...m, nome, is_reperibilita: editRep } : m
    ))
    qc.invalidateQueries({ queryKey: ['medici'] })
    qc.invalidateQueries({ queryKey: ['medici-tutti'] })
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
      for (const campo of CAMPI_SCHEMA) {
        await supabase.from('schemi_modello')
          .update({ [campo]: null }).eq(campo, m.numero_ordine).eq('reparto_id', repartoAttivo)
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
  function nextOrdine() {
    return localMedici.length > 0 ? Math.max(...localMedici.map(m => m.numero_ordine)) + 1 : 1
  }

  // Utenti globali che NON sono gia' turnisti di questo reparto (per id o nome).
  const risultati = useMemo(() => {
    const raw = searchTerm.trim().toLowerCase()
    if (raw.length < 3) return []
    // Ricerca per "parole": ogni token deve comparire in un punto qualsiasi di
    // nome+email. Cosi "stef" trova "Stefano Marabelli", "Maria Stefanelli" e
    // "Luigi Abbostefazzi"; "mar stef" trova comunque "Stefano Marabelli".
    const tokens = raw.split(/\s+/).filter(Boolean)
    const nomiPresenti = new Set(localMedici.map(m => m.nome.toUpperCase().trim()))
    const idPresenti = new Set(localMedici.map(m => m.utente_id).filter(Boolean))
    return utenti.filter(u => {
      if (!u.attivo) return false
      if (idPresenti.has(u.id)) return false
      if (nomiPresenti.has((u.nome ?? '').toUpperCase().trim())) return false
      const hay = ((u.nome ?? '') + ' ' + (u.email ?? '')).toLowerCase()
      return tokens.every(t => hay.includes(t))
    }).slice(0, 8)
  }, [searchTerm, utenti, localMedici])

  // Aggiunge un utente globale ESISTENTE come turnista del reparto.
  async function aggiungiDaUtente(u: UtenteAutorizzato) {
    setErrore('')
    const { error } = await supabase.from('medici').insert({
      nome: u.nome || u.email, cognome: u.cognome ?? null, nome_proprio: u.nome_proprio ?? null,
      numero_ordine: nextOrdine(),
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
    const { error: mErr } = await supabase.from('medici').insert({
      nome, cognome, nome_proprio: nomeProprio,
      numero_ordine: nextOrdine(), is_reperibilita: false, attivo: true,
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
    <div className="max-w-xl space-y-5">
      <ConfirmModal {...confirmState.opts} open={confirmState.open}
        onConfirm={confirmState.onConfirm} onCancel={confirmState.onCancel} />

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

      {/* Lista medici */}
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 border-b border-stone-200">
            <tr>
              <th className="w-8" />          {/* drag handle */}
              <th className="px-3 py-2 text-left font-semibold text-stone-600 w-10">N°</th>
              <th className="px-3 py-2 text-left font-semibold text-stone-600">Nome</th>
              <th className="px-3 py-2 text-center font-semibold text-stone-600 w-14">REP</th>
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

            {localMedici.map((m, idx) => editId === m.id ? (

              /* ── Riga in editing (solo nome + REP) ── */
              <tr key={m.id} className="bg-olive-50">
                {/* Handle disabilitato durante edit */}
                <td className="pl-2 text-stone-300">
                  <GripVertical size={14} />
                </td>
                {/* N° readonly */}
                <td className="px-3 py-1.5 text-stone-400 font-mono font-semibold text-sm">
                  {idx + 1}
                </td>
                <td className="px-2 py-1.5">
                  <input
                    value={editNome}
                    onChange={e => setEditNome(e.target.value.toUpperCase())}
                    className="input py-0.5 text-sm uppercase w-full"
                    autoFocus
                    onKeyDown={e => e.key === 'Enter' && saveEdit()}
                  />
                </td>
                <td className="px-2 py-1.5 text-center">
                  <input type="checkbox" checked={editRep}
                    onChange={e => setEditRep(e.target.checked)}
                    className="w-4 h-4 accent-red-500" title="Reperibilità" />
                </td>
                <td className="px-2 py-1.5">
                  <div className="flex gap-1 justify-end">
                    <button onClick={saveEdit} disabled={saving}
                      className="btn-primary py-0.5 px-2 text-xs gap-1">
                      <Save size={11} /> Salva
                    </button>
                    <button onClick={() => setEditId(null)}
                      className="btn-secondary py-0.5 px-1.5 text-xs">
                      <X size={11} />
                    </button>
                  </div>
                </td>
              </tr>

            ) : (

              /* ── Riga normale — draggable (mouse + touch) ── */
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
                  {m.is_reperibilita && (
                    <span className="badge-rep text-[10px]">REP</span>
                  )}
                </td>

                <td className="px-3 py-2">
                  <div className="flex gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => startEdit(m)}
                      className="p-1.5 rounded text-stone-500 hover:text-olive-700 hover:bg-olive-50 transition-colors"
                      title="Modifica nome / reperibilità">
                      <Pencil size={14} />
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

      {/* Aggiungi turnista: ricerca utenti globali (3+ lettere) o crea nuovo */}
      <div className="card p-4 space-y-3">
        <h3 className="font-semibold text-stone-700 text-sm flex items-center gap-2">
          <UserPlus size={15} /> Aggiungi turnista
        </h3>

        <div>
          <div className="flex items-center gap-2">
            <Search size={15} className="text-stone-400 shrink-0" />
            <input value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
              placeholder="Scrivi almeno 3 lettere del nome…" className="input flex-1 text-sm" />
          </div>
          {searchTerm.trim().length >= 3 && (
            <div className="mt-1 border border-stone-200 rounded-lg overflow-hidden divide-y divide-stone-100">
              {risultati.map(u => (
                <button key={u.id} onClick={() => aggiungiDaUtente(u)}
                  className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-olive-50 text-left">
                  <span><strong className="uppercase">{u.nome || '—'}</strong>
                    <span className="text-stone-400 text-xs ml-1">{u.email}</span></span>
                  <Plus size={14} className="text-olive-600 shrink-0" />
                </button>
              ))}
              {risultati.length === 0 && (
                <div className="px-3 py-2 text-xs text-stone-500">Nessun utente trovato — aggiungilo come nuovo qui sotto.</div>
              )}
            </div>
          )}
        </div>

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
          Aggiunto come ultimo in rotazione (n° {nextOrdine()}). Trascina per riposizionarlo.
        </p>
      </div>

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
