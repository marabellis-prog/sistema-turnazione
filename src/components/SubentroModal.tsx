import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { X, ArrowRightLeft, Plus, Search } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { emailValida } from '../lib/email'
import type { Medico, UtenteAutorizzato } from '../types'

// Modal di SUBENTRO: il turnista `uscente` lascia, un subentrante prende la sua
// posizione in rotazione. L'uscente viene ritirato (non cancellato) → i suoi
// turni/statistiche storici restano suoi; il subentrante eredita il numero
// d'ordine. Tutto atomico via RPC esegui_subentro.

interface Props {
  uscente:       Medico
  repartoId:     string
  utenti:        UtenteAutorizzato[]
  mediciAttuali: Medico[]
  onClose:       () => void
  onDone:        (msg: string) => void
}

export function SubentroModal({ uscente, repartoId, utenti, mediciAttuali, onClose, onDone }: Props) {
  const qc = useQueryClient()
  const [search,  setSearch]  = useState('')
  const [scelto,  setScelto]  = useState<UtenteAutorizzato | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [cognome, setCognome] = useState('')
  const [nome,    setNome]    = useState('')
  const [email,   setEmail]   = useState('')
  const [data,    setData]    = useState(() => new Date().toISOString().slice(0, 10))
  const [nota,    setNota]    = useState('')
  const [saving,  setSaving]  = useState(false)
  const [errore,  setErrore]  = useState('')

  // Utenti selezionabili come subentranti (esclude chi è già turnista attivo).
  const risultati = useMemo(() => {
    const raw = search.trim().toLowerCase()
    if (raw.length < 3) return []
    const tokens = raw.split(/\s+/).filter(Boolean)
    const idPresenti = new Set(mediciAttuali.map(m => m.utente_id).filter(Boolean))
    return utenti.filter(u => {
      if (!u.attivo) return false
      if (idPresenti.has(u.id)) return false
      const hay = ((u.nome ?? '') + ' ' + (u.email ?? '')).toLowerCase()
      return tokens.every(t => hay.includes(t))
    }).slice(0, 8)
  }, [search, utenti, mediciAttuali])

  async function conferma() {
    setErrore('')
    if (!data) { setErrore('Indica la data del subentro.'); return }

    let entranteUtenteId: string | null = null
    let vNome: string, vCognome: string | null, vNomeProprio: string | null

    if (showNew) {
      const cog  = cognome.trim().toUpperCase()
      const nom  = nome.trim()
      const mail = email.trim().toLowerCase()
      if (!cog || !nom) { setErrore('Inserisci cognome e nome del subentrante.'); return }
      if (!mail)        { setErrore('Serve l\'email del subentrante.'); return }
      if (!emailValida(mail)) { setErrore('Indirizzo email non valido.'); return }
      setSaving(true)
      const { error: uErr } = await supabase.rpc('insert_utente_autorizzato',
        { p_email: mail, p_nome: `${cog} ${nom}`, p_ruolo: 'user', p_cognome: cog, p_nome_proprio: nom })
      if (uErr) { setSaving(false); setErrore('Utente: ' + uErr.message); return }
      const { data: lista } = await supabase.rpc('get_all_utenti_autorizzati')
      const nuovo = ((lista ?? []) as UtenteAutorizzato[]).find(x => x.email === mail)
      entranteUtenteId = nuovo?.id ?? null
      vNome = `${cog} ${nom}`; vCognome = cog; vNomeProprio = nom
    } else {
      if (!scelto) { setErrore('Scegli il subentrante o creane uno nuovo.'); return }
      entranteUtenteId = scelto.id
      vNome = scelto.nome || scelto.email
      vCognome = scelto.cognome ?? null
      vNomeProprio = scelto.nome_proprio ?? null
      setSaving(true)
    }

    const { error } = await supabase.rpc('esegui_subentro', {
      p_reparto:            repartoId,
      p_uscente_id:         uscente.id,
      p_entrante_utente_id: entranteUtenteId,
      p_nome:               vNome,
      p_cognome:            vCognome,
      p_nome_proprio:       vNomeProprio,
      p_data:               data,
      p_nota:               nota.trim() || null,
    })
    setSaving(false)
    if (error) { setErrore(error.message); return }
    qc.invalidateQueries({ queryKey: ['medici'] })
    qc.invalidateQueries({ queryKey: ['medici-tutti', repartoId] })
    qc.invalidateQueries({ queryKey: ['subentri', repartoId] })
    onDone(`Subentro registrato: ${uscente.nome} → ${vNome} (dal ${data.split('-').reverse().join('/')}).`)
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: 'rgba(28,40,24,0.55)' }} onClick={onClose}>
      <div className="card w-full max-w-md p-5 max-h-[90vh] overflow-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-1">
          <ArrowRightLeft size={18} style={{ color: '#476540' }} />
          <h3 className="text-base font-bold" style={{ color: '#2b3c24' }}>Subentro</h3>
        </div>
        <p className="text-sm text-stone-600 mb-3">
          <strong className="uppercase">{uscente.nome}</strong> (posizione n° {uscente.numero_ordine ?? '—'})
          lascia. Il subentrante prende la sua posizione; <strong>{uscente.nome}</strong> viene ritirato ma
          i suoi turni e le sue statistiche storiche restano suoi.
        </p>

        {errore && (
          <div className="p-2 mb-3 bg-red-50 border border-red-200 rounded text-xs text-red-700">{errore}</div>
        )}

        {/* Scelta del subentrante */}
        {scelto && !showNew ? (
          <div className="flex items-center justify-between p-2 mb-3 rounded-lg border border-olive-200"
            style={{ background: 'rgba(232,240,224,0.5)' }}>
            <span className="text-sm"><strong className="uppercase">{scelto.nome || scelto.email}</strong>
              <span className="text-stone-400 text-xs ml-1">{scelto.email}</span></span>
            <button onClick={() => setScelto(null)} className="text-xs text-stone-500 hover:text-stone-700">cambia</button>
          </div>
        ) : !showNew ? (
          <div className="mb-3">
            <div className="flex items-center gap-2">
              <Search size={15} className="text-stone-400 shrink-0" />
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Cerca il subentrante (3+ lettere)…" className="input flex-1 text-sm" autoFocus />
            </div>
            {search.trim().length >= 3 && (
              <div className="mt-1 border border-stone-200 rounded-lg overflow-hidden divide-y divide-stone-100">
                {risultati.map(u => (
                  <button key={u.id} onClick={() => { setScelto(u); setSearch('') }}
                    className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-olive-50 text-left">
                    <span><strong className="uppercase">{u.nome || '—'}</strong>
                      <span className="text-stone-400 text-xs ml-1">{u.email}</span></span>
                    <Plus size={14} className="text-olive-600 shrink-0" />
                  </button>
                ))}
                {risultati.length === 0 && (
                  <div className="px-3 py-2 text-xs text-stone-500">Nessuno trovato — crealo come nuovo qui sotto.</div>
                )}
              </div>
            )}
            <button onClick={() => { setShowNew(true); setCognome(search.toUpperCase()); setScelto(null) }}
              className="mt-2 text-xs font-semibold inline-flex items-center gap-1" style={{ color: '#476540' }}>
              <Plus size={13} /> Subentrante nuovo (crea utente)
            </button>
          </div>
        ) : (
          <div className="rounded-lg border border-olive-200 p-3 mb-3 space-y-2" style={{ background: 'rgba(232,240,224,0.4)' }}>
            <p className="text-xs text-stone-600">Nuovo subentrante — verrà creato anche come utente (login con la sua email).</p>
            <div className="grid grid-cols-2 gap-2">
              <input value={cognome} onChange={e => setCognome(e.target.value.toUpperCase())}
                placeholder="COGNOME" className="input text-sm uppercase" />
              <input value={nome} onChange={e => setNome(e.target.value)}
                placeholder="Nome" className="input text-sm" />
            </div>
            <input value={email} onChange={e => setEmail(e.target.value)}
              placeholder="email@gmail.com" type="email" className="input text-sm w-full" />
            <button onClick={() => { setShowNew(false); setCognome(''); setNome(''); setEmail('') }}
              className="text-xs text-stone-500 hover:text-stone-700">← scegli un utente esistente</button>
          </div>
        )}

        {/* Data + nota */}
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div>
            <label className="label text-xs">Data subentro</label>
            <input type="date" value={data} onChange={e => setData(e.target.value)} className="input text-sm w-full" />
          </div>
          <div>
            <label className="label text-xs">Nota (opzionale)</label>
            <input value={nota} onChange={e => setNota(e.target.value)} placeholder="es. trasferimento" className="input text-sm w-full" />
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="btn-secondary text-sm py-1.5 px-3"><X size={13} /> Annulla</button>
          <button onClick={conferma} disabled={saving} className="btn-primary text-sm py-1.5 px-4">
            <ArrowRightLeft size={13} /> {saving ? 'Eseguo…' : 'Esegui subentro'}
          </button>
        </div>
      </div>
    </div>
  )
}
