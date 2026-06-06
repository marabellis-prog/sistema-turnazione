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
import type { Medico, ColonnaCal, TurnoClinico, SlotPlacement } from '../types'

interface CellInfo {
  tc:              TurnoClinico
  slot_mattina:    SlotPlacement
  slot_pomeriggio: SlotPlacement
}

interface Props {
  medici:          Medico[]
  colonne:         ColonnaCal[]
  /** Restituisce TC + flag sub/med del medico in quella data */
  getCellInfo:     (medicoId: string, data: string) => CellInfo
  /** Se presente, filtra il riepilogo a quel solo medico */
  filtroMedicoId?: string
  /** Set ISO "YYYY-MM-DD" delle festività custom (santo patrono, ecc.).
   *  Sommate alle italiane nel conteggio "F" (festivi lavorati). */
  festivitaCustomSet?: Set<string>
}

interface RowStats {
  medico: Medico
  M:      number
  P:      number
  L:      number
  E:      number   // somma EM+EP+EL (turni ceduti a Esterno totali)
  EM:     number   // dettaglio: ceduti mattina
  EP:     number   //           : ceduti pomeriggio
  EL:     number   //           : ceduti lungo
  S:      number   // sabati lavorati (escludendo E*)
  D:      number   // domeniche lavorate (escludendo E*)
  F:      number   // festivi nazionali italiani lavorati (NON domeniche)
  SUB:    number   // turni svolti in sub-intensiva (qualsiasi TC con flag is_sub)
  MED:    number   // turni svolti in medicina       (qualsiasi TC con flag is_med)
  totale: number   // (M + P) + 2L — E* NON conta perche` il medico non l'ha lavorato
}

export function RiepilogoTurni({ medici, colonne, getCellInfo, filtroMedicoId, festivitaCustomSet }: Props) {
  const stats = useMemo<RowStats[]>(() => {
    // Pre-calcolo festività italiane + custom (admin-defined) per gli
    // anni coperti dal periodo.
    const annoSet = new Set<number>()
    colonne.forEach(c => annoSet.add(c.anno))
    const festivi = new Set<string>()
    for (const a of annoSet) for (const d of getItalianHolidays(a, festivitaCustomSet)) festivi.add(d)

    const list = filtroMedicoId
      ? medici.filter(m => m.id === filtroMedicoId)
      : medici
    return list.map(m => {
      let M = 0, P = 0, L = 0, EM = 0, EP = 0, EL = 0, S = 0, D = 0, F = 0, SUB = 0, MED = 0
      for (const col of colonne) {
        const { tc, slot_mattina, slot_pomeriggio } = getCellInfo(m.id, col.data)
        if      (tc === 'M')  M++
        else if (tc === 'P')  P++
        else if (tc === 'L')  L++
        else if (tc === 'EM') EM++  // ceduto a esterno (mattina)
        else if (tc === 'EP') EP++  // ceduto a esterno (pomeriggio)
        else if (tc === 'EL') EL++  // ceduto a esterno (lungo)
        // S/D/F: il medico aveva un TC qualsiasi (escluso ''=riposo e
        // qualsiasi 'E*'=ceduto, perche` non l'ha lavorato lui).
        // Priorità: domenica > festivo > sabato. Mai doppio conteggio.
        const isExt = tc === 'EM' || tc === 'EP' || tc === 'EL'
        if (tc && !isExt) {
          if (col.isDomenica) D++
          else if (festivi.has(col.data)) F++
          else if (new Date(col.data + 'T00:00:00').getDay() === 6) S++
        }
        // SUB/MED: contano la SOMMA delle metà giornate del MEDICO.
        // I turni ceduti a esterno non contano (li svolge l'esterno).
        if (!isExt) {
          if (slot_mattina    === 'SUB') SUB++
          if (slot_pomeriggio === 'SUB') SUB++
          if (slot_mattina    === 'MED') MED++
          if (slot_pomeriggio === 'MED') MED++
        }
      }
      const E = EM + EP + EL  // colonna "E" aggregata in tabella
      return { medico: m, M, P, L, E, EM, EP, EL, S, D, F, SUB, MED, totale: (M + P) + 2 * L }
    })
  }, [medici, colonne, getCellInfo, filtroMedicoId, festivitaCustomSet])

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
          <th style={thStyle} title="Turni ceduti a Esterno (non lavorati dal medico)">E</th>
          <th style={thStyle}>S</th>
          <th style={thStyle}>D</th>
          <th style={thStyle}>F</th>
          <th style={thStyle} title="Turni in sub-intensiva">
            <span style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 18, height: 18, borderRadius: '50%',
              background: '#fecaca', border: '1.5px solid #dc2626',
              fontSize: 10, fontWeight: 800, color: '#9f1239', lineHeight: 1,
            }}>S</span>
          </th>
          <th style={thStyle} title="Turni in medicina">
            <span style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 18, height: 18, borderRadius: '50%',
              background: '#bae6fd', border: '1.5px solid #0284c7',
              fontSize: 10, fontWeight: 800, color: '#0c4a6e', lineHeight: 1,
            }}>M</span>
          </th>
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
            <td style={{
              ...tdStyle,
              background: s.E > 0 ? '#f1f5f9' : undefined,
              color:      s.E > 0 ? '#36495a' : undefined,
              fontStyle:  s.E > 0 ? 'italic'  : undefined,
            }} title={s.E > 0
              ? `Ceduti a Esterno — Em: ${s.EM} · Ep: ${s.EP} · El: ${s.EL}`
              : 'Turni ceduti a Esterno'}>
              {s.E || ''}
            </td>
            <td style={tdStyle}>{s.S || ''}</td>
            <td style={tdStyle}>{s.D || ''}</td>
            <td style={tdStyle}>{s.F || ''}</td>
            {/* Conteggio SUB — sfondo rosa pastello quando >0 per richiamare il pallino */}
            <td style={{
              ...tdStyle,
              background: s.SUB > 0 ? '#fef2f2' : undefined,
              color: s.SUB > 0 ? '#9f1239' : undefined,
              fontWeight: s.SUB > 0 ? 700 : undefined,
            }}>
              {s.SUB || ''}
            </td>
            {/* Conteggio MED — sfondo azzurro pastello quando >0 */}
            <td style={{
              ...tdStyle,
              background: s.MED > 0 ? '#f0f9ff' : undefined,
              color: s.MED > 0 ? '#0c4a6e' : undefined,
              fontWeight: s.MED > 0 ? 700 : undefined,
            }}>
              {s.MED || ''}
            </td>
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
            <td colSpan={11} style={{ ...tdStyle, color: '#9ca3af', fontStyle: 'italic' }}>
              Nessun medico da riepilogare.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  )
}
