/**
 * ConfigPage
 *
 * Pagina admin per le impostazioni globali del sistema. Attualmente contiene:
 *
 * - Numero atteso di medici per slot/mezza-giornata/tipo-giorno (8 campi):
 *   serve al check "inconsistenze nei turni" in ModificaTurniPage per
 *   confrontare il count effettivo coi valori attesi e produrre un report.
 *
 *   Convenzione: 0 = nessun controllo per quel slot (no warning).
 *   Solo valori > 0 attivano la verifica.
 *
 * Le impostazioni sono salvate sulla tabella `configurazione` (record
 * unico per il periodo corrente). Sono condivise fra tutti gli admin via
 * realtime (useConfigurazioneRealtime).
 */

import { useState, useEffect, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  Settings, Save, AlertTriangle, CheckCircle2, CalendarPlus, Trash2, Loader2,
  CalendarDays, Archive, CalendarClock, X,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useConfigReparto } from '../../hooks/useConfigReparto'
import { useReparto } from '../../contexts/RepartoContext'
import { useConfigurazioneRealtime } from '../../hooks/useConfigurazioneRealtime'
import { useFestivitaCustom, useFestivitaCustomRealtime } from '../../hooks/useFestivitaCustom'
import { useConfirm } from '../../hooks/useConfirm'
import { ConfirmModal } from '../../components/ConfirmModal'
import { holidaysForNation, NAZIONI, nazioneValida } from '../../lib/holidays'
import { MESI_IT } from '../../lib/algorithm'
import type { Configurazione, SoglieSlot, SogliaEpoca } from '../../types'


const MESI_ABBR = [
  'gen','feb','mar','apr','mag','giu','lug','ago','set','ott','nov','dic',
]
function fmtDataLunga(iso: string): string {
  const [y, m, d] = iso.split('-').map(s => parseInt(s, 10))
  if (!y || !m || !d) return iso
  return `${d} ${MESI_ABBR[m-1] ?? '?'} ${y}`
}

// Le 18 chiavi delle impostazioni (SUB, MED e SUPPORTO × mattina/pomeriggio
// × feriale/sabato/festivo) in ordine di rendering.
const KEYS = [
  'sub_mattina_feriale',    'sub_mattina_sabato',    'sub_mattina_festivo',
  'sub_pomeriggio_feriale', 'sub_pomeriggio_sabato', 'sub_pomeriggio_festivo',
  'med_mattina_feriale',    'med_mattina_sabato',    'med_mattina_festivo',
  'med_pomeriggio_feriale', 'med_pomeriggio_sabato', 'med_pomeriggio_festivo',
  'sup_mattina_feriale',    'sup_mattina_sabato',    'sup_mattina_festivo',
  'sup_pomeriggio_feriale', 'sup_pomeriggio_sabato', 'sup_pomeriggio_festivo',
] as const

type SettingKey = typeof KEYS[number]

// Input numerico STABILE (definito fuori dal componente pagina): se fosse
// dichiarato dentro ConfigPage verrebbe ricreato ad ogni render e l'input
// perderebbe il focus ad ogni carattere digitato.
function NumInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="text"
      inputMode="numeric"
      value={value ?? ''}
      onChange={e => onChange(e.target.value)}
      className="w-14 px-2 py-1 rounded border border-stone-300 text-center text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-green-300"
    />
  )
}

export function ConfigPage() {
  const qc = useQueryClient()
  useConfigurazioneRealtime()
  useFestivitaCustomRealtime()
  const { confirm, confirmState } = useConfirm()

  // Local form state — uso stringhe per evitare problemi con input "0"
  // e con eventuali valori non ancora sincronizzati dal DB.
  const [draft,   setDraft]   = useState<Record<SettingKey, string>>({} as any)
  const [dirty,   setDirty]   = useState(false)
  const [saving,  setSaving]  = useState(false)
  const [msg,     setMsg]     = useState<string | null>(null)
  const [err,     setErr]     = useState<string | null>(null)

  // Modal "Salva impostazioni con validità dal…" (impostazioni datate):
  // archivia le soglie correnti nello storico con valido_fino = data scelta
  // e imposta le nuove dal form a partire da quella data.
  const [validitaOpen,   setValiditaOpen]   = useState(false)
  const [validitaData,   setValiditaData]   = useState('')
  const [savingValidita, setSavingValidita] = useState(false)

  // Form festività custom
  const [festData,    setFestData]    = useState('')
  const [festDescr,   setFestDescr]   = useState('')
  const [festSaving,  setFestSaving]  = useState(false)
  const [festErr,     setFestErr]     = useState<string | null>(null)
  const [nazioneSaving, setNazioneSaving] = useState(false)
  const { repartoAttivo, repartoCorrente } = useReparto()
  const { festivita: festivitaList } = useFestivitaCustom(repartoAttivo)

  const { data: config } = useConfigReparto()

  // Nazione del reparto → festività nazionali. Selettore + salvataggio sotto.
  const nazione = nazioneValida(repartoCorrente?.nazione)

  // Festività NAZIONALI (della nazione del reparto) che cadono nel periodo
  // della configurazione attiva.
  const festivitaNazionali = useMemo(() => {
    if (!config) return []
    const pad = (n: number) => String(n).padStart(2, '0')
    const startISO = `${config.anno_inizio}-${pad(config.mese_inizio)}-01`
    const lastDay = new Date(config.anno_fine, config.mese_fine, 0).getDate()
    const endISO   = `${config.anno_fine}-${pad(config.mese_fine)}-${pad(lastDay)}`
    const out: Array<{ data: string; nome: string }> = []
    for (let y = config.anno_inizio; y <= config.anno_fine; y++) {
      for (const f of holidaysForNation(nazione, y)) {
        if (f.data >= startISO && f.data <= endISO) out.push(f)
      }
    }
    return out.sort((a, b) => a.data.localeCompare(b.data))
  }, [config, nazione])

  // Cambia la nazione del reparto (RPC: super-admin o responsabile del reparto).
  async function salvaNazione(nuova: string) {
    setNazioneSaving(true); setErr(null)
    try {
      const { error } = await supabase.rpc('set_reparto_nazione',
        { p_reparto_id: repartoAttivo, p_nazione: nuova })
      if (error) throw error
      qc.invalidateQueries({ queryKey: ['reparti'] })
      qc.invalidateQueries({ queryKey: ['reparto-nazione', repartoAttivo] })
    } catch (e) {
      setErr('Nazione: ' + (e as Error).message)
    } finally {
      setNazioneSaving(false)
    }
  }

  // Etichetta del periodo per l'header della sezione festività italiane:
  // - stesso anno → "Maggio - Ottobre 2026"
  // - anni diversi → "Maggio 2026 - Aprile 2027"
  const periodoLabel = useMemo(() => {
    if (!config) return ''
    const mIn  = MESI_IT[config.mese_inizio] ?? ''
    const mFi  = MESI_IT[config.mese_fine]   ?? ''
    if (config.anno_inizio === config.anno_fine) {
      return `${mIn} - ${mFi} ${config.anno_inizio}`
    }
    return `${mIn} ${config.anno_inizio} - ${mFi} ${config.anno_fine}`
  }, [config])

  // Sync iniziale del draft dal DB
  useEffect(() => {
    if (!config) return
    const next: Record<SettingKey, string> = {} as any
    for (const k of KEYS) next[k] = String(config[k] ?? 0)
    setDraft(next)
    setDirty(false)
  }, [config])

  function setField(k: SettingKey, value: string) {
    // Solo cifre, max 2 caratteri (0..99 sufficiente)
    const clean = value.replace(/[^0-9]/g, '').slice(0, 2)
    setDraft(prev => ({ ...prev, [k]: clean }))
    setDirty(true)
  }

  async function handleSave() {
    if (!config) return
    setSaving(true); setErr(null); setMsg(null)
    try {
      const update: Record<string, number> = {}
      for (const k of KEYS) {
        const n = parseInt(draft[k] || '0', 10)
        update[k] = Number.isFinite(n) && n >= 0 ? n : 0
      }
      const { error } = await supabase.from('configurazione')
        .update(update).eq('id', config.id)
      if (error) throw error
      setMsg('Impostazioni salvate.')
      setDirty(false)
      qc.invalidateQueries({ queryKey: ['configurazione'] })
      setTimeout(() => setMsg(null), 3000)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  // Apre il modal "Salva con validità dal…" con default = oggi.
  function openValiditaModal() {
    const d = new Date()
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    setValiditaData(iso)
    setErr(null)
    setValiditaOpen(true)
  }

  // ── Salva con validità temporale ──────────────────────────────────
  // Archivia le soglie ATTUALI (colonne DB) nello storico marcandole valide
  // fino a `validitaData` (esclusivo), poi scrive nelle colonne le NUOVE
  // soglie del form e imposta impostazioni_valido_dal = validitaData.
  // Risultato: prima di X valgono le vecchie soglie, da X le nuove — cosi`
  // un cambio composizione dopo un "Aggiorna turnazione" non genera errori
  // falsi sulla vecchia turnazione.
  async function handleSaveConValidita() {
    if (!config) return
    if (!validitaData) { setErr('Seleziona la data di inizio validità.'); return }
    setSavingValidita(true); setErr(null); setMsg(null)
    try {
      // Soglie ATTUALI dal DB = epoca che stiamo chiudendo
      const soglieAttuali = {} as SoglieSlot
      for (const k of KEYS) soglieAttuali[k] = config[k] ?? 0
      // Push dell'epoca corrente nello storico (valido_fino esclusivo)
      const storicoPrec = Array.isArray(config.impostazioni_storico)
        ? config.impostazioni_storico : []
      const epoca: SogliaEpoca = {
        valido_dal:  config.impostazioni_valido_dal ?? null,
        valido_fino: validitaData,
        soglie:      soglieAttuali,
      }
      // Payload: nuove soglie del form + valido_dal + storico aggiornato
      const payload: Record<string, unknown> = {}
      for (const k of KEYS) {
        const n = parseInt(draft[k] || '0', 10)
        payload[k] = Number.isFinite(n) && n >= 0 ? n : 0
      }
      payload.impostazioni_valido_dal = validitaData
      payload.impostazioni_storico    = [...storicoPrec, epoca]
      const { error } = await supabase.from('configurazione')
        .update(payload).eq('id', config.id)
      if (error) throw error
      setMsg('Impostazioni salvate con validità dal ' + fmtDataLunga(validitaData) +
        '. Prima di quella data restano valide le soglie precedenti.')
      setDirty(false)
      setValiditaOpen(false)
      qc.invalidateQueries({ queryKey: ['configurazione'] })
      setTimeout(() => setMsg(null), 6000)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setSavingValidita(false)
    }
  }


  // ── Aggiungi festività custom ─────────────────────────────────
  async function handleAggiungiFestivita() {
    setFestErr(null)
    if (!festData)  { setFestErr('Seleziona una data.'); return }
    if (!festDescr.trim()) { setFestErr('Inserisci una descrizione (es. "Santo Patrono").'); return }
    setFestSaving(true)
    try {
      const { error } = await supabase.from('festivita_custom').insert({
        reparto_id:  repartoAttivo,
        data:        festData,
        descrizione: festDescr.trim(),
      })
      if (error) throw error
      setFestData(''); setFestDescr('')
      qc.invalidateQueries({ queryKey: ['festivita-custom'] })
    } catch (e) {
      const msg = (e as Error).message
      // Vincolo UNIQUE su data → messaggio piu` chiaro
      setFestErr(msg.includes('duplicate') || msg.includes('unique')
        ? 'Esiste gia una festività su questa data.'
        : 'Errore: ' + msg)
    } finally {
      setFestSaving(false)
    }
  }

  // ── Elimina festività custom ──────────────────────────────────
  async function handleEliminaFestivita(id: string, descrizione: string, data: string) {
    const ok = await confirm({
      title:   'Eliminare la festività?',
      message: 'Eliminare "' + descrizione + '" del ' + fmtDataLunga(data) +
        '? Quel giorno tornera ad essere considerato feriale ' +
        '(se non e domenica o festivita nazionale).',
      confirmLabel: 'Elimina',
      danger: true,
    })
    if (!ok) return
    try {
      const { error } = await supabase.from('festivita_custom').delete().eq('id', id)
      if (error) throw error
      qc.invalidateQueries({ queryKey: ['festivita-custom'] })
    } catch (e) {
      setFestErr('Errore eliminazione: ' + (e as Error).message)
    }
  }

  // Cella <td> con input numerico per una soglia (NumInput e' stabile).
  const numCell = (k: SettingKey) => (
    <td className="text-center"><NumInput value={draft[k] ?? ''} onChange={v => setField(k, v)} /></td>
  )

  return (
    <div className="flex flex-col gap-4 max-w-3xl">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-stone-800 flex items-center gap-2">
          <CalendarDays size={20} style={{ color: '#476540' }} />
          Festività
        </h2>
        <p className="text-sm text-stone-600 mt-0.5">
          Nazione del reparto + festività nazionali e locali. Il <strong>fabbisogno</strong>
          giornaliero ora si configura in <strong>Disegna Schema</strong> (legato allo schema).
        </p>
      </div>

      {/* Messaggi */}
      {msg && (
        <div className="px-3 py-2 rounded-lg text-sm flex items-center gap-2"
          style={{ background: '#d5e5d0', color: '#2e5a28', border: '1px solid #a8c4a0' }}>
          <CheckCircle2 size={15} /> {msg}
        </div>
      )}
      {err && (
        <div className="px-3 py-2 rounded-lg text-sm flex items-center gap-2"
          style={{ background: '#fde0e0', color: '#7a2020', border: '1px solid #f0c0c0' }}>
          <AlertTriangle size={15} /> {err}
        </div>
      )}

      {/* ── NAZIONE del reparto (guida le festività nazionali) ──────── */}
      <div className="mt-4">
        <h3 className="text-lg font-bold text-stone-800 flex items-center gap-2">
          <CalendarDays size={18} style={{ color: '#476540' }} />
          Nazione del reparto
        </h3>
        <p className="text-sm text-stone-600 mt-0.5">
          Determina le <strong>festività nazionali</strong> applicate al calendario di
          questo reparto (due reparti possono stare in nazioni diverse). Le festività
          locali (santo patrono ecc.) si aggiungono qui sotto.
        </p>
        <div className="mt-2 flex items-center gap-2">
          <select value={nazione} onChange={e => salvaNazione(e.target.value)}
            disabled={nazioneSaving}
            className="px-2 py-1.5 rounded border border-stone-300 text-sm font-semibold">
            {Object.entries(NAZIONI).map(([code, def]) => (
              <option key={code} value={code}>{def.nome}</option>
            ))}
          </select>
          {nazioneSaving && <Loader2 size={14} className="animate-spin text-stone-400" />}
        </div>
      </div>

      {/* ── SEZIONE FESTIVITÀ LOCALI (custom) ───────────────────────── */}
      <div className="mt-4">
        <h3 className="text-lg font-bold text-stone-800 flex items-center gap-2">
          <CalendarPlus size={18} style={{ color: '#476540' }} />
          Festività Locali
        </h3>
        <p className="text-sm text-stone-600 mt-0.5">
          Aggiungi date trattate come festive oltre alle festività nazionali
          (es. <strong>santo patrono</strong>, eventi locali). Quel giorno appare come
          festivo nel calendario, nel conteggio "F" del riepilogo e nei check di consistenza
          (atteso "festivo" invece di "feriale"). Eliminando una festività, tutto torna come prima.
        </p>

        {/* Form aggiunta */}
        <div className="mt-3 rounded-lg border border-stone-300 bg-white p-3">
          <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr_auto] gap-2 items-end">
            <label className="text-xs">
              <span className="block text-stone-600 mb-0.5">Data</span>
              <input type="date"
                value={festData}
                onChange={e => setFestData(e.target.value)}
                className="px-2 py-1.5 rounded border border-stone-300 text-sm" />
            </label>
            <label className="text-xs">
              <span className="block text-stone-600 mb-0.5">Descrizione</span>
              <input type="text"
                value={festDescr}
                onChange={e => setFestDescr(e.target.value)}
                placeholder="Es. Santo Patrono, San Vito, …"
                className="w-full px-2 py-1.5 rounded border border-stone-300 text-sm" />
            </label>
            <button
              onClick={handleAggiungiFestivita}
              disabled={festSaving}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold text-white shadow disabled:opacity-50 transition-colors"
              style={{ background: '#476540' }}>
              {festSaving ? <Loader2 size={13} className="animate-spin" /> : <CalendarPlus size={13} />}
              Aggiungi
            </button>
          </div>
          {festErr && (
            <div className="mt-2 px-2 py-1 rounded text-xs"
              style={{ background: '#fde0e0', color: '#7a2020', border: '1px solid #f0c0c0' }}>
              {festErr}
            </div>
          )}
        </div>

        {/* Lista festività locali */}
        {festivitaList.length === 0 ? (
          <p className="mt-3 text-xs text-stone-500 italic">
            Nessuna festività locale configurata.
          </p>
        ) : (
          <div className="mt-3 rounded-lg border border-stone-300 bg-white overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: '#f4f1ea' }}>
                  <th className="px-3 py-2 text-left font-semibold text-stone-700" style={{ width: 180 }}>Data</th>
                  <th className="px-3 py-2 text-left font-semibold text-stone-700">Descrizione</th>
                  <th className="px-3 py-2" style={{ width: 60 }}></th>
                </tr>
              </thead>
              <tbody>
                {festivitaList.map(f => (
                  <tr key={f.id} className="border-t border-stone-200">
                    <td className="px-3 py-2 font-mono text-xs">
                      {fmtDataLunga(f.data)}
                    </td>
                    <td className="px-3 py-2 text-stone-700">{f.descrizione}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => handleEliminaFestivita(f.id, f.descrizione, f.data)}
                        className="text-red-600 hover:text-red-800 transition-colors p-1"
                        title="Elimina festività">
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── SEZIONE FESTIVITÀ ITALIANE NEL PERIODO ──────────────────── */}
      {/* Read-only: serve all'admin per ricordarsi quali festività nazionali
          ricadono nel periodo della configurazione attiva. Non si possono
          eliminare/modificare (sono hardcoded in src/lib/holidays.ts). */}
      {config && festivitaNazionali.length > 0 && (
        <div className="mt-2">
          <h3 className="text-lg font-bold text-stone-800 flex items-center gap-2">
            <CalendarDays size={18} style={{ color: '#7a2233' }} />
            Festività Nazionali ({NAZIONI[nazione]?.nome ?? nazione}) nel periodo
            <span className="text-xs font-normal text-stone-500">
              ({periodoLabel})
            </span>
          </h3>
          <p className="text-sm text-stone-600 mt-0.5">
            Riferimento delle festività nazionali (incluse Pasqua e Pasquetta dove
            previste) che cadono nel periodo. Sono <strong>sempre</strong> considerate
            festive nei calcoli e nei check.
          </p>
          <div className="mt-3 rounded-lg border border-stone-300 bg-white overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: '#f4f1ea' }}>
                  <th className="px-3 py-2 text-left font-semibold text-stone-700" style={{ width: 180 }}>Data</th>
                  <th className="px-3 py-2 text-left font-semibold text-stone-700">Festività</th>
                </tr>
              </thead>
              <tbody>
                {festivitaNazionali.map(f => (
                  <tr key={f.data} className="border-t border-stone-200">
                    <td className="px-3 py-2 font-mono text-xs">
                      {fmtDataLunga(f.data)}
                    </td>
                    <td className="px-3 py-2 text-stone-700">{f.nome}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}


      <ConfirmModal {...confirmState.opts} open={confirmState.open}
        onConfirm={confirmState.onConfirm} onCancel={confirmState.onCancel} />
    </div>
  )
}
