/**
 * RiepilogoTurni
 *
 * Tabella di riepilogo per medico con il conteggio dei turni nel periodo.
 * Per ogni medico mostra: M, P, L, S (sabati lavorati), D (domeniche
 * lavorate) e Totale = (M + P) + 2L (REP esclusi dalla copertura).
 *
 * Usata in:
 * - ModificaTurniPage in fondo, mostra tutti i medici (filtroMedicoId omesso)
 * - CalendarioPage dentro un modal "Riepilogo turni" che il medico apre
 *   per vedere SOLO i propri totali (filtroMedicoId = mio_medico.id)
 *
 * Le statistiche si auto-aggiornano in tempo reale: il chiamante passa
 * `getTC(medicoId, data)` che può leggere dalle modifiche locali (in
 * ModificaTurniPage) o solo dal DB (in CalendarioPage).
 */

import { useMemo } from 'react'
import { getItalianHolidays } from './FerieModal'
import type { Medico, ColonnaCal, TurnoClinico } from '../types'

interface Props {
  medici:          Medico[]
  colonne:         ColonnaCal[]
  /** Restituisce il TC corrente del medico in quella data ('' se nessuno) */
  getTC:           (medicoId: string, data: string) => TurnoClinico
  /** Se presente, filtra il riepilogo a quel solo medico */
  filtroMedicoId?: string
}

interface RowStats {
  medico: Medico
  M:      number
  P:      number
  L:      number
  S:      number   // sabati lavorati (qualunque TC ≠ '')
  D:      number   // domeniche lavorate (qualunque TC ≠ '')
  F:      number   // festivi nazionali italiani lavorati (NON domeniche)
  totale: number   // (M + P) + 2L
}

export function RiepilogoTurni({ medici, colonne, getTC, filtroMedicoId }: Props) {
  const stats = useMemo<RowStats[]>(() => {
    // Pre-calcolo festività italiane per gli anni coperti dal periodo
    const annoSet = new Set<number>()
    colonne.forEach(c => annoSet.add(c.anno))
    const festivi = new Set<string>()
    for (const a of annoSet) for (const d of getItalianHolidays(a)) festivi.add(d)

    const list = filtroMedicoId
      ? medici.filter(m => m.id === filtroMedicoId)
      : medici
    return list.map(m => {
      let M = 0, P = 0, L = 0, S = 0, D = 0, F = 0
      for (const col of colonne) {
        const tc = getTC(m.id, col.data)
        if (tc === 'M') M++
        else if (tc === 'P') P++
        else if (tc === 'L') L++
        // S/D/F: il medico aveva un TC qualsiasi (incluso REP).
        // REP = "essere di turno" anche se non copre la giornata operativa.
        // Priorità: domenica > festivo > sabato. Mai doppio conteggio.
        if (tc) {
          if (col.isDomenica) D++
          else if (festivi.has(col.data)) F++
          else if (new Date(col.data + 'T00:00:00').getDay() === 6) S++
        }
      }
      return { medico: m, M, P, L, S, D, F, totale: (M + P) + 2 * L }
    })
  }, [medici, colonne, getTC, filtroMedicoId])

  // Stili condivisi per le celle
  const headBg = '#7eb6d4'   // azzurro pastello (stesso della riga TURNI TOTALI)
  const headBd = '#5d9bc1'

  const thStyle: React.CSSProperties = {
    background: headBg, color: '#fff',
    fontSize: 11, fontWeight: 800, padding: '6px 10px',
    border: `1px solid ${headBd}`, letterSpacing: '0.04em',
    textAlign: 'center', whiteSpace: 'nowrap',
  }

  const tdStyle: React.CSSProperties = {
    fontSize: 12, padding: '4px 10px',
    border: '1px solid #d5ccb8',
    textAlign: 'center', verticalAlign: 'middle',
  }

  return (
    <table className="border-collapse" style={{ borderSpacing: 0 }}>
      <thead>
        <tr>
          <th style={{ ...thStyle, textAlign: 'left', minWidth: 160 }}>Medico</th>
          <th style={thStyle}>M</th>
          <th style={thStyle}>P</th>
          <th style={thStyle}>L</th>
          <th style={thStyle}>S</th>
          <th style={thStyle}>D</th>
          <th style={thStyle}>F</th>
          <th style={thStyle}>Totale</th>
        </tr>
      </thead>
      <tbody>
        {stats.map(s => (
          <tr key={s.medico.id}>
            <td style={{ ...tdStyle, textAlign: 'left', fontWeight: 500, color: '#3a3d30' }}>
              {s.medico.nome}
            </td>
            <td style={tdStyle}>{s.M || ''}</td>
            <td style={tdStyle}>{s.P || ''}</td>
            <td style={tdStyle}>{s.L || ''}</td>
            <td style={tdStyle}>{s.S || ''}</td>
            <td style={tdStyle}>{s.D || ''}</td>
            <td style={tdStyle}>{s.F || ''}</td>
            <td style={{
              ...tdStyle, fontWeight: 800,
              background: '#f0f7fb', color: '#1f4a70',
            }}>
              {s.totale || ''}
            </td>
          </tr>
        ))}
        {stats.length === 0 && (
          <tr>
            <td colSpan={8} style={{ ...tdStyle, color: '#9ca3af', fontStyle: 'italic' }}>
              Nessun medico da riepilogare.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  )
}
