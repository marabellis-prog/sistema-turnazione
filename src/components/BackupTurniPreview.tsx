/**
 * BackupTurniPreview
 *
 * Render read-only del calendario LINEARE dei turni contenuti in uno
 * snapshot di backup. Stesso layout/colori della vista lineare in
 * Modifica Turni e Calendario, ma senza editing/drag/select.
 *
 * Layout:
 *   - Tabella CLINICA (TC con cerchio mezzo/mezzo per SUB/MED)
 *   - Tabella RICERCA (RM/RP)
 *   - Sticky prima colonna (nome medico) e header date
 *   - Scroll orizzontale interno per i molti giorni
 *
 * Le colonne sono derivate dal range di date presenti nello snapshot
 * (min..max) cosi` la preview funziona anche se il periodo della
 * configurazione attuale non combacia con quello del backup.
 */

import { useMemo } from 'react'
import { isFestivo } from '../lib/holidays'
import type { Medico, Turno, ColonnaCal, SlotPlacement } from '../types'

const CELL_COLORS: Record<string, { bg: string; fg: string }> = {
  M:   { bg: '#dde8d5', fg: '#2e4a28' },
  P:   { bg: '#d5e0e8', fg: '#253a4a' },
  L:   { bg: '#ece5d5', fg: '#4a3a1a' },
  REP: { bg: '#e8d5d5', fg: '#5a2a2a' },
  RM:  { bg: '#ddd8ea', fg: '#3a2858' },
  RP:  { bg: '#ead8e2', fg: '#582840' },
}

const DAY_LETTERS = ['D', 'L', 'M', 'M', 'G', 'V', 'S']

function dayLetter(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return DAY_LETTERS[new Date(y, m - 1, d).getDay()]
}

const PLACEMENT_BG: Record<'SUB'|'MED'|'NONE', string> = {
  SUB:  '#fecaca',
  MED:  '#bae6fd',
  NONE: 'transparent',
}

/** Etichetta TC con cerchio mezzo/mezzo per SUB/MED. */
function LabelClinico({ tc, slot_mattina, slot_pomeriggio }: {
  tc: string
  slot_mattina?:    SlotPlacement
  slot_pomeriggio?: SlotPlacement
}) {
  if (!tc) return null
  const fontSize = tc === 'REP' ? 10 : 12
  const color    = tc === 'REP' ? '#b91c1c' : (CELL_COLORS[tc]?.fg ?? '#3a3d30')
  let bg: string | undefined
  if (tc === 'M' && slot_mattina) {
    bg = PLACEMENT_BG[slot_mattina]
  } else if (tc === 'P' && slot_pomeriggio) {
    bg = PLACEMENT_BG[slot_pomeriggio]
  } else if (tc === 'L' && (slot_mattina || slot_pomeriggio)) {
    const colSX = PLACEMENT_BG[slot_mattina    ?? 'NONE']
    const colDX = PLACEMENT_BG[slot_pomeriggio ?? 'NONE']
    if (colSX === colDX && colSX !== 'transparent') bg = colSX
    else bg = `linear-gradient(90deg, ${colSX} 0%, ${colSX} 50%, ${colDX} 50%, ${colDX} 100%)`
  }
  if (!bg) {
    return <span style={{ fontSize, fontWeight: 700, color, letterSpacing: tc === 'REP' ? '-0.3px' : undefined }}>{tc}</span>
  }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: 22, height: 22, borderRadius: '50%',
      background: bg, fontSize, fontWeight: 800, color,
      letterSpacing: tc === 'REP' ? '-0.3px' : undefined, lineHeight: 1,
    }}>{tc}</span>
  )
}

function LabelRicerca({ tr }: { tr: string }) {
  if (!tr) return null
  return (
    <div className="flex flex-col items-center leading-none gap-px">
      {tr.split('+').map(p => (
        <span key={p} style={{
          fontSize: 9, fontWeight: 700,
          color: CELL_COLORS[p]?.fg ?? '#3a2858',
        }}>{p}</span>
      ))}
    </div>
  )
}

/** Costruisce le colonne (giorni) dal range min..max di date negli turni. */
function buildColonneFromTurni(
  turni: Turno[],
  festivitaCustomSet?: Set<string>,
): ColonnaCal[] {
  if (turni.length === 0) return []
  const dates = [...new Set(turni.map(t => t.data))].sort()
  const first = new Date(dates[0] + 'T00:00:00')
  const last  = new Date(dates[dates.length - 1] + 'T00:00:00')
  const out: ColonnaCal[] = []
  const cur = new Date(first)
  const pad = (n: number) => String(n).padStart(2, '0')
  while (cur <= last) {
    const iso = `${cur.getFullYear()}-${pad(cur.getMonth() + 1)}-${pad(cur.getDate())}`
    out.push({
      data:       iso,
      giorno:     cur.getDate(),
      mese:       cur.getMonth() + 1,
      anno:       cur.getFullYear(),
      isDomenica: cur.getDay() === 0,
      isFestivo:  isFestivo(cur, festivitaCustomSet),
    })
    cur.setDate(cur.getDate() + 1)
  }
  return out
}

interface Props {
  turni:               Turno[]
  medici:              Medico[]
  festivitaCustomSet?: Set<string>
}

export function BackupTurniPreview({ turni, medici, festivitaCustomSet }: Props) {
  const turniByKey = useMemo(() => {
    const m = new Map<string, Turno>()
    for (const t of turni) m.set(`${t.medico_id}|${t.data}`, t)
    return m
  }, [turni])

  const colonne = useMemo(
    () => buildColonneFromTurni(turni, festivitaCustomSet),
    [turni, festivitaCustomSet]
  )

  const mediciOrd = useMemo(
    () => [...medici].filter(m => m.attivo).sort((a, b) => a.numero_ordine - b.numero_ordine),
    [medici]
  )

  if (colonne.length === 0 || mediciOrd.length === 0) {
    return (
      <div className="text-xs text-stone-500 italic p-4">
        Snapshot vuoto o nessun medico attivo.
      </div>
    )
  }

  /** Una tabella (clinica o ricerca) — read-only, no editing. */
  function Tabella({ tipo }: { tipo: 'clinica' | 'ricerca' }) {
    const headerBg     = tipo === 'clinica' ? '#456b3a' : '#7a2233'
    const headerBorder = tipo === 'clinica' ? '#2b3c24' : '#5a1a26'
    return (
      <table className="border-collapse" style={{ tableLayout: 'fixed', borderSpacing: 0 }}>
        <thead>
          <tr>
            <th style={{
              width: 140, minWidth: 140,
              position: 'sticky', left: 0, zIndex: 2,
              background: headerBg, color: '#fff',
              fontSize: 11, fontWeight: 700, padding: '6px 8px',
              border: `1px solid ${headerBorder}`, letterSpacing: '0.04em',
              textAlign: 'left',
            }}>
              Medico — {tipo === 'clinica' ? 'Clinica' : 'Ricerca'}
            </th>
            {colonne.map(c => {
              const isRedDay = c.isDomenica || c.isFestivo
              return (
                <th key={c.data} style={{
                  width: 32, minWidth: 32,
                  background: isRedDay ? '#fef3c7' : '#f0ece4',
                  color:      isRedDay ? '#854d0e' : '#3a3d30',
                  fontSize: 10, padding: '2px 0',
                  border: '1px solid #c0b8a8',
                  lineHeight: 1.1,
                }}>
                  <div style={{ fontWeight: 700 }}>{c.giorno}</div>
                  <div style={{ fontSize: 8, fontWeight: 400, opacity: 0.75 }}>
                    {dayLetter(c.data)}
                  </div>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {mediciOrd.map(m => (
            <tr key={m.id}>
              <td style={{
                width: 140, minWidth: 140,
                position: 'sticky', left: 0, zIndex: 1,
                background: '#fff',
                fontSize: 11, padding: '4px 8px',
                border: '1px solid #d5ccb8',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                fontWeight: 500, color: '#3a3d30',
              }}>{m.nome}</td>
              {colonne.map(c => {
                const t = turniByKey.get(`${m.id}|${c.data}`)
                const tc = t?.turno_clinico ?? ''
                const tr = t?.turno_ricerca ?? ''
                const isRedDay = c.isDomenica || c.isFestivo
                // Background: ferie verde (priorita`), poi colore TC/TR, poi festivo/feriale
                let bg: string
                if (tipo === 'clinica') {
                  if (t?.is_ferie) bg = '#d5e5d0'
                  else             bg = isRedDay ? '#fef3c7' : '#fefefe'
                } else {
                  const first = tr.split('+')[0]
                  bg = CELL_COLORS[first]?.bg ?? (isRedDay ? '#fef3c7' : '#fefefe')
                }
                return (
                  <td key={c.data} style={{
                    width: 32, minWidth: 32, height: 28,
                    background: bg,
                    border: '1px solid #c0b8a8',
                    textAlign: 'center', verticalAlign: 'middle',
                    padding: 0,
                  }}>
                    {tipo === 'clinica' && tc
                      ? <LabelClinico tc={tc} slot_mattina={t?.slot_mattina} slot_pomeriggio={t?.slot_pomeriggio} />
                      : tipo === 'ricerca' && tr
                        ? <LabelRicerca tr={tr} />
                        : null}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    )
  }

  return (
    <div className="space-y-2">
      <div className="overflow-auto rounded-lg border border-stone-300 bg-white">
        <Tabella tipo="clinica" />
      </div>
      <div className="overflow-auto rounded-lg border bg-white" style={{ borderColor: '#c98a96' }}>
        <Tabella tipo="ricerca" />
      </div>
    </div>
  )
}
