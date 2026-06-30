/**
 * SchemaDesignerNuovo (sperimentale)
 *
 * Nuovo Disegna Schema con COLONNE DINAMICHE PER-GIORNO. Pagina separata dalla
 * vecchia "Disegna Schema" (che resta intatta per 11N) finché il nuovo modello
 * non è validato. Tappa 1: scelta schema + giorni + colonne (turni/flag) scelte
 * giorno per giorno, persistite in schema_colonna. La griglia slot e il
 * fabbisogno arrivano nelle tappe successive.
 */

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Table2, Plus, X, Tag, Flag, Info } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useReparto } from '../../contexts/RepartoContext'
import type { TipoTurno, ProprietaTurno } from '../../types'

const GIORNI = [
  { n: 1, label: 'Lun' }, { n: 2, label: 'Mar' }, { n: 3, label: 'Mer' },
  { n: 4, label: 'Gio' }, { n: 5, label: 'Ven' }, { n: 6, label: 'Sab' }, { n: 7, label: 'Dom' },
]

interface ColonnaRow {
  id: string
  giorno_settimana: number
  tipo: 'turno' | 'flag'
  sigla: string
  ordine: number
}

export function SchemaDesignerNuovo() {
  const qc = useQueryClient()
  const { repartoAttivo, repartoCorrente } = useReparto()
  const [schemaNum, setSchemaNum] = useState(1)
  const [giornoSel, setGiornoSel] = useState<number | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const { data: tipiTurno = [] } = useQuery<TipoTurno[]>({
    queryKey: ['tipi_turno', repartoAttivo],
    queryFn: async () => {
      const { data, error } = await supabase.from('tipi_turno').select('*')
        .eq('reparto_id', repartoAttivo).order('ordine')
      if (error) throw error
      return (data ?? []) as TipoTurno[]
    },
  })
  const { data: proprieta = [] } = useQuery<ProprietaTurno[]>({
    queryKey: ['proprieta_turno', repartoAttivo],
    queryFn: async () => {
      const { data, error } = await supabase.from('proprieta_turno').select('*')
        .eq('reparto_id', repartoAttivo).order('ordine')
      if (error) throw error
      return (data ?? []) as ProprietaTurno[]
    },
  })
  const { data: colonne = [] } = useQuery<ColonnaRow[]>({
    queryKey: ['schema-colonna', repartoAttivo, schemaNum],
    queryFn: async () => {
      const { data, error } = await supabase.from('schema_colonna')
        .select('id, giorno_settimana, tipo, sigla, ordine')
        .eq('reparto_id', repartoAttivo).eq('schema_num', schemaNum)
        .order('giorno_settimana').order('ordine')
      if (error) throw error
      return (data ?? []) as ColonnaRow[]
    },
  })

  const giorniAttivi = [...new Set(colonne.map(c => c.giorno_settimana))].sort((a, b) => a - b)
  const colonneDelGiorno = (g: number) => colonne.filter(c => c.giorno_settimana === g)

  async function aggiungiColonna(giorno: number, tipo: 'turno' | 'flag', sigla: string) {
    setErr(null)
    const esistenti = colonneDelGiorno(giorno)
    if (esistenti.some(c => c.sigla === sigla)) { setPickerOpen(false); return }
    const ordine = esistenti.length
    const { error } = await supabase.from('schema_colonna')
      .insert({ reparto_id: repartoAttivo, schema_num: schemaNum, giorno_settimana: giorno, tipo, sigla, ordine })
    if (error) { setErr(error.message); return }
    setPickerOpen(false)
    qc.invalidateQueries({ queryKey: ['schema-colonna', repartoAttivo, schemaNum] })
  }
  async function rimuoviColonna(id: string) {
    setErr(null)
    const { error } = await supabase.from('schema_colonna').delete().eq('id', id)
    if (error) { setErr(error.message); return }
    qc.invalidateQueries({ queryKey: ['schema-colonna', repartoAttivo, schemaNum] })
  }
  async function aggiungiGiorno(giorno: number) {
    setGiornoSel(giorno)
    setPickerOpen(true)
  }

  const turniColonna = (g: number) => colonneDelGiorno(g).filter(c => c.tipo === 'turno')
  const flagColonna  = (g: number) => colonneDelGiorno(g).filter(c => c.tipo === 'flag')

  return (
    <div className="flex flex-col gap-4 max-w-4xl">
      <div>
        <h2 className="text-xl font-bold text-stone-800 flex items-center gap-2">
          <Table2 size={20} style={{ color: '#476540' }} />
          Disegna Schema — nuovo (sperimentale) · {repartoCorrente?.nome ?? '…'}
        </h2>
        <p className="text-sm text-stone-600 mt-0.5">
          Colonne dinamiche scelte <strong>giorno per giorno</strong> dai tuoi Tipi di turno e
          proprietà. Tappa 1: giorni + colonne. (Griglia slot e Fabbisogno in arrivo.)
        </p>
      </div>

      {tipiTurno.length === 0 && (
        <div className="flex gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
          <Info size={16} className="shrink-0 mt-0.5" />
          Prima definisci almeno un <strong>Tipo di turno</strong> (menu Tipi di turno): sono i mattoni dello schema.
        </div>
      )}
      {err && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{err}</div>}

      {/* Selettore schema */}
      <div className="flex items-center gap-2 text-sm">
        <span className="text-stone-500">Schema:</span>
        {[1, 2, 3].map(n => (
          <button key={n} onClick={() => { setSchemaNum(n); setGiornoSel(null) }}
            className="px-3 py-1 rounded font-semibold text-sm border transition-colors"
            style={schemaNum === n
              ? { background: '#476540', color: '#fff', borderColor: '#2b3c24' }
              : { background: '#fff', color: '#476540', borderColor: '#cdd9c4' }}>
            {n}
          </button>
        ))}
      </div>

      {/* Giorni: chip per ogni giorno della settimana */}
      <div className="card p-3">
        <h3 className="text-sm font-semibold text-stone-700 mb-2">Giorni dello schema</h3>
        <div className="flex flex-wrap gap-2">
          {GIORNI.map(g => {
            const attivo = giorniAttivi.includes(g.n)
            return (
              <button key={g.n}
                onClick={() => attivo ? setGiornoSel(g.n) : aggiungiGiorno(g.n)}
                className="px-3 py-1.5 rounded-lg text-sm font-semibold border transition-colors"
                style={giornoSel === g.n
                  ? { background: '#456b3a', color: '#fff', borderColor: '#2b3c24' }
                  : attivo
                    ? { background: '#e0e8d8', color: '#2b3c24', borderColor: '#9ab488' }
                    : { background: '#fff', color: '#9ca3af', borderColor: '#e5e7eb', borderStyle: 'dashed' }}
                title={attivo ? 'Modifica colonne di questo giorno' : 'Aggiungi questo giorno allo schema'}>
                {g.label}{!attivo && <span className="ml-1 opacity-60">+</span>}
              </button>
            )
          })}
        </div>
        <p className="text-[11px] text-stone-400 mt-2">
          Tratteggiati = non nello schema (clicca per aggiungerli). Pieni = nello schema (clicca per modificarne le colonne).
        </p>
      </div>

      {/* Colonne del giorno selezionato */}
      {giornoSel !== null && (
        <div className="card p-3">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-stone-700">
              Colonne di <span style={{ color: '#476540' }}>{GIORNI.find(g => g.n === giornoSel)?.label}</span>
            </h3>
            <button onClick={() => setPickerOpen(o => !o)}
              className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold text-white"
              style={{ background: '#476540' }}>
              <Plus size={13} /> Aggiungi colonna
            </button>
          </div>

          {/* Picker turni + flag */}
          {pickerOpen && (
            <div className="rounded-lg border border-stone-200 p-2 mb-2 bg-stone-50 space-y-2">
              <div>
                <div className="text-[11px] font-semibold text-stone-500 flex items-center gap-1 mb-1"><Tag size={11} /> Turni</div>
                <div className="flex flex-wrap gap-1.5">
                  {tipiTurno.map(t => (
                    <button key={t.sigla} onClick={() => aggiungiColonna(giornoSel, 'turno', t.sigla)}
                      className="px-2 py-1 rounded text-xs font-semibold border hover:opacity-80"
                      style={{ background: t.colore_bg ?? '#e5e7eb', color: t.colore_fg ?? '#1f2937', borderColor: 'rgba(0,0,0,0.1)' }}
                      title={t.nome}>{t.sigla}</button>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-[11px] font-semibold text-stone-500 flex items-center gap-1 mb-1"><Flag size={11} /> Flag / proprietà</div>
                <div className="flex flex-wrap gap-1.5">
                  {proprieta.map(p => (
                    <button key={p.sigla} onClick={() => aggiungiColonna(giornoSel, 'flag', p.sigla)}
                      className="px-2 py-1 rounded text-xs font-semibold border border-stone-300 bg-white hover:bg-stone-100"
                      title={p.nome}>{p.sigla}</button>
                  ))}
                  {proprieta.length === 0 && <span className="text-[11px] text-stone-400 italic">Nessuna proprietà configurata.</span>}
                </div>
              </div>
            </div>
          )}

          {/* Colonne attuali */}
          {colonneDelGiorno(giornoSel).length === 0 ? (
            <p className="text-xs text-stone-400 italic">Nessuna colonna. Clicca "Aggiungi colonna".</p>
          ) : (
            <div className="space-y-2">
              <div>
                <div className="text-[11px] text-stone-400 mb-1">Turni</div>
                <div className="flex flex-wrap gap-1.5">
                  {turniColonna(giornoSel).map(c => (
                    <span key={c.id} className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold"
                      style={{ background: '#e0e8d8', color: '#2b3c24' }}>
                      {c.sigla}
                      <button onClick={() => rimuoviColonna(c.id)} className="hover:text-red-600"><X size={11} /></button>
                    </span>
                  ))}
                  {turniColonna(giornoSel).length === 0 && <span className="text-[11px] text-stone-400 italic">—</span>}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-stone-400 mb-1">Flag</div>
                <div className="flex flex-wrap gap-1.5">
                  {flagColonna(giornoSel).map(c => (
                    <span key={c.id} className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold border border-stone-300 bg-white text-stone-700">
                      {c.sigla}
                      <button onClick={() => rimuoviColonna(c.id)} className="hover:text-red-600"><X size={11} /></button>
                    </span>
                  ))}
                  {flagColonna(giornoSel).length === 0 && <span className="text-[11px] text-stone-400 italic">—</span>}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
