/**
 * SchemaFabbisognoBox
 *
 * Riquadro "Fabbisogno giornaliero" dentro Disegna Schema. Si auto-adatta alle
 * COLONNE/placement che lo schema usa: mostra gli input SUB/MED/Supporto solo
 * se lo schema li contiene. Per ogni placement: fascia (mattina/pomeriggio) ×
 * tipo-giorno (feriale/sabato/festivo). Salva in schema_fabbisogno per
 * (reparto, schema_num). Parte dello "schema = unità auto-contenuta".
 *
 * NB (v1): il fabbisogno è SALVATO ma non ancora cablato nel check/generazione
 * (passo successivo, da validare insieme).
 */

import { useState, useEffect, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Save, Loader2, CheckCircle2, ClipboardList } from 'lucide-react'
import { supabase } from '../lib/supabase'
import type { SchemaFabbisogno } from '../types'

const TIPI = [
  { key: 'feriale', label: 'Feriale', sub: 'Lun–Ven' },
  { key: 'sabato',  label: 'Sabato',  sub: 'solo sabato' },
  { key: 'festivo', label: 'Festivo', sub: 'Dom + festivi' },
] as const
const FASCE = [
  { key: 'mattina',    label: 'mattina' },
  { key: 'pomeriggio', label: 'pomeriggio' },
] as const

interface Placement { key: 'sub' | 'med' | 'sup'; label: string; show: boolean }

export function SchemaFabbisognoBox({ repartoId, schemaNum, usaSub, usaMed, usaSup }: {
  repartoId: string
  schemaNum: number
  usaSub: boolean
  usaMed: boolean
  usaSup: boolean
}) {
  const qc = useQueryClient()
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const placements: Placement[] = [
    { key: 'sub', label: 'SUB',      show: usaSub },
    { key: 'med', label: 'MED',      show: usaMed },
    { key: 'sup', label: 'Supporto', show: usaSup },
  ]
  const visibili = placements.filter(p => p.show)

  const { data: row } = useQuery<SchemaFabbisogno | null>({
    queryKey: ['schema-fabbisogno', repartoId, schemaNum],
    queryFn: async () => {
      const { data, error } = await supabase.from('schema_fabbisogno')
        .select('*').eq('reparto_id', repartoId).eq('schema_num', schemaNum).maybeSingle()
      if (error) throw error
      return data as SchemaFabbisogno | null
    },
    staleTime: 30_000,
  })

  // Tutte le 18 chiavi possibili (placement × fascia × tipo).
  const keys = useMemo(() => {
    const out: string[] = []
    for (const p of placements) for (const f of FASCE) for (const t of TIPI) out.push(`${p.key}_${f.key}_${t.key}`)
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const next: Record<string, string> = {}
    for (const k of keys) next[k] = String((row as unknown as Record<string, number> | null)?.[k] ?? 0)
    setDraft(next)
    setDirty(false)
  }, [row, keys])

  function setField(k: string, v: string) {
    setDraft(d => ({ ...d, [k]: v.replace(/[^0-9]/g, '').slice(0, 2) }))
    setDirty(true)
  }

  async function salva() {
    setSaving(true); setErr(null); setMsg(null)
    try {
      const payload: Record<string, number | string> = { reparto_id: repartoId, schema_num: schemaNum }
      for (const k of keys) payload[k] = parseInt(draft[k] || '0', 10) || 0
      const { error } = await supabase.from('schema_fabbisogno')
        .upsert(payload, { onConflict: 'reparto_id,schema_num' })
      if (error) throw error
      setMsg('Fabbisogno salvato.')
      setDirty(false)
      qc.invalidateQueries({ queryKey: ['schema-fabbisogno', repartoId, schemaNum] })
      setTimeout(() => setMsg(null), 3000)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-lg border border-stone-300 bg-white p-3">
      <h3 className="font-semibold text-stone-700 text-sm flex items-center gap-2">
        <ClipboardList size={16} style={{ color: '#476540' }} />
        Fabbisogno giornaliero — Schema {schemaNum}
      </h3>
      <p className="text-xs text-stone-500 mt-0.5">
        Rilevato dalle colonne usate nello schema: quanti ne servono per fascia e
        tipo di giorno. <strong>0</strong> = nessun controllo.
      </p>

      {visibili.length === 0 ? (
        <p className="text-xs text-stone-400 italic mt-2">
          Disegna lo schema (assegna SUB / MED / Supporto agli slot) per impostare il fabbisogno.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto mt-2">
            <table className="text-sm border-collapse">
              <thead>
                <tr>
                  <th className="px-2 py-1 text-left font-semibold text-stone-600"></th>
                  {TIPI.map(t => (
                    <th key={t.key} className="px-2 py-1 text-center font-semibold text-stone-600">
                      {t.label}<span className="block text-[10px] font-normal text-stone-400">{t.sub}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibili.map(p => (
                  FASCE.map((f, fi) => (
                    <tr key={`${p.key}_${f.key}`} className="border-t border-stone-100">
                      <td className="px-2 py-1 whitespace-nowrap text-stone-700">
                        {fi === 0 && <span className="font-semibold">{p.label}</span>} <span className="text-stone-500">{f.label}</span>
                      </td>
                      {TIPI.map(t => {
                        const k = `${p.key}_${f.key}_${t.key}`
                        return (
                          <td key={k} className="px-1.5 py-1 text-center">
                            <input value={draft[k] ?? '0'} onChange={e => setField(k, e.target.value)}
                              inputMode="numeric"
                              className="w-12 px-1 py-1 rounded border border-stone-300 text-sm text-center font-semibold" />
                          </td>
                        )
                      })}
                    </tr>
                  ))
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-2 flex items-center gap-3">
            <button onClick={salva} disabled={!dirty || saving}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold text-white shadow disabled:opacity-50 transition-colors"
              style={{ background: dirty && !saving ? '#476540' : '#9ca3af' }}>
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
              Salva fabbisogno
            </button>
            {msg && <span className="text-xs flex items-center gap-1" style={{ color: '#2e5a28' }}><CheckCircle2 size={13} /> {msg}</span>}
            {err && <span className="text-xs text-red-600">{err}</span>}
          </div>
        </>
      )}
    </div>
  )
}
