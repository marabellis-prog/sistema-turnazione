/**
 * ProvaSchemaPreview — anteprima lineare della rotazione di uno schema dinamico
 * (cicla la settimana per N turnisti, ruotando di una settimana ogni settimana).
 *
 * Estratto da SchemaDesignerNuovo ("Prova Schema") per essere riusato anche
 * nella pagina Genera Calendario (pannello destro). Mostra SOLO i turni (non le
 * proprietà). Va a capo per quante settimane intere entrano in larghezza, così
 * si adatta a qualsiasi contenitore senza scroll orizzontale.
 */

import { useEffect, useRef, useState, type ReactNode, type CSSProperties } from 'react'
import type { Medico, TipoTurno } from '../types'

// Costanti layout (come il vecchio designer).
export const PV_LABEL_W = 66   // px — colonna nome turnista
export const PV_CELL_W  = 22   // px — cella giorno

export interface PreviewCella { giorno_settimana: number; numero: number | null; colonna_sigla: string }

/**
 * Calcola la matrice [turnista][giorno] della rotazione su N settimane.
 * `turnisti` deve essere GIÀ ordinato per numero_ordine (l'ordine usato qui per
 * la rotazione è lo stesso usato dal pannello per le righe).
 */
export function computePreviewCells(params: {
  giorniSettimana: number[]                 // giorni (1..7) presenti nello schema
  celle: PreviewCella[]
  turniSiglas: string[]                      // sigle delle colonne di tipo 'turno'
  turnisti: Medico[]                         // ordinati per numero_ordine
}): (string | null)[][] {
  const { celle, turnisti } = params
  const N = turnisti.length
  if (N === 0) return []
  const giorniSet = new Set(params.giorniSettimana)
  const turniSet  = new Set(params.turniSiglas)
  return turnisti.map((_, mi) =>
    Array.from({ length: N * 7 }, (_, di) => {
      const dayOfWk = (di % 7) + 1
      const week    = Math.floor(di / 7)
      const calcNum = ((mi + week) % N) + 1
      if (!giorniSet.has(dayOfWk)) return null
      const cel = celle.find(c => c.giorno_settimana === dayOfWk && c.numero === calcNum && turniSet.has(c.colonna_sigla))
      return cel ? cel.colonna_sigla : ''
    })
  )
}

export function ProvaSchemaPreview({
  previewCells, turnisti, tipiTurno, header, onClose, className, style, width,
}: {
  previewCells: (string | null)[][]
  turnisti: Medico[]
  tipiTurno: TipoTurno[]
  header?: ReactNode
  onClose?: () => void
  className?: string
  style?: CSSProperties
  /** Larghezza fissa (px): se data, NON si usa il ResizeObserver. Serve quando
   *  il pannello vive in un contenitore scrollabile a larghezza nota (Genera),
   *  dove l'observer innescherebbe un loop con la scrollbar. */
  width?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [measuredW, setMeasuredW] = useState(560)
  useEffect(() => {
    if (width != null) return            // larghezza fissa → niente observer
    const el = ref.current; if (!el) return
    setMeasuredW(el.clientWidth)
    const ro = new ResizeObserver(([e]) => setMeasuredW(e.contentRect.width))
    ro.observe(el); return () => ro.disconnect()
  }, [width])
  const w = width ?? measuredW
  const colore = (sigla: string) => tipiTurno.find(t => t.sigla === sigla)
  const cognomeDi = (t: Medico) => t.cognome || t.nome.split(' ')[0] || t.nome
  const N = turnisti.length
  const totalDays = N * 7
  const weeksPerRow = Math.max(1, Math.floor((w - PV_LABEL_W - 8) / (7 * PV_CELL_W)))
  const daysPerRow = weeksPerRow * 7
  const numChunks = Math.max(1, Math.ceil(totalDays / daysPerRow))

  return (
    <div ref={ref} className={className ?? 'flex flex-col min-w-0'} style={style}>
      {(header || onClose) && (
        <div className="px-3 pt-2 pb-1.5 border-b border-stone-200 flex items-center justify-between shrink-0">
          <span className="text-sm font-bold text-stone-800 flex items-center gap-1.5">{header}</span>
          {onClose && (
            <button onClick={onClose} className="text-stone-400 hover:text-stone-700" title="Chiudi anteprima">✕</button>
          )}
        </div>
      )}
      {N === 0 ? (
        <p className="text-xs text-stone-400 italic p-3">Nessun turnista in rotazione.</p>
      ) : (
        <div className="p-2 flex flex-col gap-3 overflow-auto">
          {Array.from({ length: numChunks }, (_, ci) => {
            const startDay = ci * daysPerRow + 1
            const endDay = Math.min(startDay + daysPerRow - 1, totalDays)
            const days = Array.from({ length: endDay - startDay + 1 }, (_, i) => startDay + i)
            return (
              <div key={ci} style={{ border: '1px solid #e5e7eb', borderRadius: 6, overflow: 'hidden', width: 'fit-content' }}>
                <div className="flex" style={{ borderBottom: '1px solid #d1d5db' }}>
                  <div style={{ width: PV_LABEL_W, flexShrink: 0, background: '#2b3c24' }} />
                  {days.map(day => {
                    const we = ((day - 1) % 7) >= 5
                    return (
                      <div key={day} style={{ width: PV_CELL_W, flexShrink: 0, textAlign: 'center', fontSize: 9, fontWeight: 700, padding: '2px 0',
                        background: we ? '#fee2e2' : '#f0f4ee', color: we ? '#9f1239' : '#2b3c24', borderLeft: '1px solid #e5e7eb' }}>{day}</div>
                    )
                  })}
                </div>
                {turnisti.map((t, mi) => (
                  <div key={t.id} className="flex" style={{ borderBottom: '1px solid #f0f0f0' }}>
                    <div style={{ width: PV_LABEL_W, flexShrink: 0, padding: '1px 4px', fontSize: 9, fontWeight: 700, background: '#f4f6f1', color: '#2b3c24',
                      overflow: 'hidden', whiteSpace: 'nowrap', borderRight: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', gap: 3 }}>
                      <span style={{ display: 'inline-block', width: 14, height: 14, borderRadius: 3, background: 'rgba(0,0,0,0.12)', textAlign: 'center', lineHeight: '14px', fontSize: 8, fontWeight: 900, flexShrink: 0 }}>{t.numero_ordine}</span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{cognomeDi(t)}</span>
                    </div>
                    {days.map(day => {
                      const cell = previewCells[mi]?.[day - 1] ?? null
                      const we = ((day - 1) % 7) >= 5
                      const tc = cell ? colore(cell) : null
                      const bg = tc?.colore_bg ?? (cell === null ? (we ? '#f6f6f6' : '#fafafa') : (we ? '#fdf9f9' : '#fff'))
                      const fg = tc?.colore_fg ?? '#9ca3af'
                      return (
                        <div key={day} title={`Giorno ${day} · ${t.nome}: ${cell || '—'}`} style={{ width: PV_CELL_W, flexShrink: 0, height: 20,
                          display: 'flex', alignItems: 'center', justifyContent: 'center', background: bg, color: fg, fontSize: 9, fontWeight: 700, borderLeft: '1px solid #f0f0f0' }}>{cell || ''}</div>
                      )
                    })}
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
