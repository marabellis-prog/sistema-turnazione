/**
 * AnteprimaTurnazioneView
 *
 * Vista read-only di una bozza di turnazione (snapshot): tabella completa
 * (riuso BackupTurniPreview, con i cambi bordati di rosso) + intestazione
 * coi metadati + elenco "cambi" (Originario → Cambiato → Attuale).
 * Usata sia dalla pagina admin (con Approva/Scarta) che da quella pubblica.
 */

import { useMemo } from 'react'
import { BackupTurniPreview } from './BackupTurniPreview'
import { MESI_IT } from '../lib/algorithm'
import type { Medico, TurnazioneAnteprima, TurnoClinico } from '../types'

interface Props {
  anteprima:           TurnazioneAnteprima
  medici:              Medico[]
  festivitaCustomSet?: Set<string>
}

const fmtDataBreve = (iso: string) => {
  const [, m, d] = iso.split('-')
  return d && m ? `${d}/${m}` : iso
}
const codice = (tc: TurnoClinico | null | undefined) => (tc ? tc : '—')

export function AnteprimaTurnazioneView({ anteprima, medici, festivitaCustomSet }: Props) {
  const turni = anteprima.snapshot?.turni ?? []
  const meta  = anteprima.meta

  const nomeById = useMemo(() => {
    const map = new Map<string, string>()
    for (const m of medici) map.set(m.id, m.nome)
    return map
  }, [medici])

  // Celle "cambio" (originario != null), ordinate per medico poi data.
  const cambi = useMemo(() => {
    const list = turni.filter(t => t.turno_clinico_originario != null)
    return list.sort((a, b) => {
      const na = nomeById.get(a.medico_id) ?? ''
      const nb = nomeById.get(b.medico_id) ?? ''
      return na.localeCompare(nb, 'it', { sensitivity: 'base' }) || a.data.localeCompare(b.data)
    })
  }, [turni, nomeById])

  const cutoverLabel = (() => {
    const [y, m, d] = meta.cutover.split('-').map(Number)
    return `${d} ${MESI_IT[m]} ${y}`
  })()

  return (
    <div className="space-y-4">
      {/* Metadati */}
      <div className="rounded-lg border p-3 text-xs flex flex-wrap gap-x-5 gap-y-1"
        style={{ background: '#f0f7fb', borderColor: '#bfdde8', color: '#1f4a70' }}>
        <span><strong>Schema nuovo:</strong> {meta.schema_nuovo}</span>
        <span><strong>Stacco:</strong> {cutoverLabel} (primo lunedì)</span>
        <span><strong>Fino a:</strong> {MESI_IT[meta.mese_fine]} {meta.anno_fine}</span>
        <span><strong>Cambi mantenuti:</strong> {meta.n_cambi}</span>
      </div>

      {/* Elenco cambi (Originario → Cambiato → Attuale) */}
      {cambi.length > 0 && (
        <div className="rounded-lg border-2 p-3"
          style={{ background: '#fee2e2', borderColor: '#dc2626' }}>
          <div className="text-sm font-bold mb-1" style={{ color: '#991b1b' }}>
            {cambi.length} cambi turno mantenuti rispetto alla nuova rotazione
          </div>
          <div className="text-[11px] text-stone-600 mb-2">
            Originario (vecchia turnazione) → Cambiato (tuo scambio) → Attuale (nuova rotazione).
            Dove "Attuale" differisce molto, lo scambio potrebbe essere diventato inutile.
          </div>
          <div className="overflow-auto" style={{ maxHeight: 200 }}>
            <div className="flex flex-col gap-1">
              {cambi.map((t, i) => (
                <div key={i} className="flex items-center gap-1.5 text-[11px] flex-wrap rounded px-2 py-1 bg-white border"
                  style={{ borderColor: '#f3c0c0' }}>
                  <span className="font-semibold text-stone-700 min-w-[110px]">{nomeById.get(t.medico_id) ?? '?'}</span>
                  <span className="font-mono text-stone-500 min-w-[42px]">{fmtDataBreve(t.data)}</span>
                  <span className="font-mono px-1 rounded bg-stone-100 border border-stone-200" title="Originario">{codice(t.turno_clinico_originario)}</span>
                  <span className="text-stone-400">→</span>
                  <span className="font-mono px-1 rounded font-semibold" style={{ background: '#fee2e2', color: '#991b1b' }} title="Cambiato (attuale applicato)">{codice(t.turno_clinico)}</span>
                  <span className="text-stone-400">→</span>
                  <span className="font-mono px-1 rounded bg-white border border-stone-300" title="Nuova rotazione">{codice(t.turno_clinico_base)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Tabella completa (read-only) */}
      <div className="rounded-lg border border-stone-200 overflow-auto" style={{ maxHeight: '60vh' }}>
        <div className="p-2">
          <div className="text-[11px] text-stone-500 mb-2">
            Bordo <span style={{ color: '#dc2626', fontWeight: 700 }}>rosso</span> = cambio turno mantenuto.
          </div>
          <BackupTurniPreview turni={turni} medici={medici} festivitaCustomSet={festivitaCustomSet} />
        </div>
      </div>
    </div>
  )
}
