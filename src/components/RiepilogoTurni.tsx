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
  /** Flag del turno — servono per le proprietà senza placement (dinamico). */
  proprieta?:      string[]
}

/** Turno configurato (reparto dinamico). */
export interface TipoTurnoRiepilogo { sigla: string; nome: string; colore_bg: string; peso: number; is_reperibilita: boolean }
/** Proprietà configurata (reparto dinamico). */
export interface ProprietaRiepilogo { sigla: string; nome: string; colore_bg: string }

/** Delta da sommare ai conteggi di un medico nel riepilogo. */
export type AggiustamentoConteggi = {
  M?: number; P?: number; L?: number; SUB?: number; MED?: number
  S?: number; D?: number; F?: number
}

/**
 * Aggiustamento MANUALE dei conteggi del riepilogo — UNICA fonte di verità,
 * da usare IDENTICA sia nella vista pubblica (CalendarioPage) sia in admin
 * (ModificaTurniPage). I due riepiloghi DEVONO combaciare: passare questa
 * stessa funzione a `aggiustaConteggi` in ENTRAMBE le viste.
 *
 * Marabelli: +1 M, +1 P, +1 L (→ Totale +4), +2 SUB, +2 MED, +1 F (festivo),
 * per i turni svolti fuori sistema. Cambiando i numeri qui cambiano in
 * automatico in tutte e due le viste (niente più copie inline da allineare).
 */
export function aggiustaConteggiRiepilogo(med: Medico): AggiustamentoConteggi {
  return med.nome.toUpperCase().trim().startsWith('MARABELLI')
    ? { M: 1, P: 1, L: 1, SUB: 2, MED: 2, F: 1 }
    : {}
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
  /** Aggiustamento manuale dei conteggi per medico (delta da sommare a
   *  M/P/L/SUB/MED). Il Totale (M+P+2L) si ricalcola di conseguenza, cosi`
   *  i conti tornano. Usato nella vista pubblica per turni svolti fuori
   *  sistema. Default: nessun aggiustamento. */
  aggiustaConteggi?: (medico: Medico) => AggiustamentoConteggi
  /** Se passati (reparto dinamico) → colonne DINAMICHE: una per turno
   *  configurato + S/D/Festivi + una per proprietà + Totale (pesato). Senza
   *  → tabella classica (11N / vista pubblica). */
  tipiTurno?: TipoTurnoRiepilogo[]
  proprieta?: ProprietaRiepilogo[]
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

export function RiepilogoTurni({ medici, colonne, getCellInfo, filtroMedicoId, festivitaCustomSet, aggiustaConteggi, tipiTurno, proprieta }: Props) {
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
      // Aggiustamento manuale dei conteggi (vista pubblica): somma i delta
      // a M/P/L/SUB/MED → il Totale (M+P+2L) torna coerente da solo.
      const adj = aggiustaConteggi?.(m) ?? {}
      M   += adj.M   ?? 0
      P   += adj.P   ?? 0
      L   += adj.L   ?? 0
      SUB += adj.SUB ?? 0
      MED += adj.MED ?? 0
      S   += adj.S   ?? 0
      D   += adj.D   ?? 0
      F   += adj.F   ?? 0

      const E = EM + EP + EL  // colonna "E" aggregata in tabella
      const totale = (M + P) + 2 * L
      return { medico: m, M, P, L, E, EM, EP, EL, S, D, F, SUB, MED, totale }
    })
  }, [medici, colonne, getCellInfo, filtroMedicoId, festivitaCustomSet, aggiustaConteggi])

  // ── Stats DINAMICHE (reparto dinamico): conteggio per turno configurato +
  //    per proprietà (SUB/MED dallo slot LIVE, le altre dai flag del turno) +
  //    S/D/Festivi. Totale = Σ conteggio × peso (reperibilità pesa 0). ──
  const statsDin = useMemo(() => {
    if (!tipiTurno) return [] as { medico: Medico; turni: Record<string, number>; props: Record<string, number>; S: number; D: number; F: number; totale: number }[]
    const annoSet = new Set<number>(); colonne.forEach(c => annoSet.add(c.anno))
    const festivi = new Set<string>()
    for (const a of annoSet) for (const d of getItalianHolidays(a, festivitaCustomSet)) festivi.add(d)
    const COPRE_M = new Set(['M', 'L', 'EM', 'EL']), COPRE_P = new Set(['P', 'L', 'EP', 'EL'])
    const isExt = (tc: string) => tc === 'EM' || tc === 'EP' || tc === 'EL'
    const list = filtroMedicoId ? medici.filter(m => m.id === filtroMedicoId) : medici
    return list.map(m => {
      const turni: Record<string, number> = {}
      const props: Record<string, number> = {}
      let S = 0, D = 0, F = 0
      for (const col of colonne) {
        const { tc, slot_mattina, slot_pomeriggio, proprieta: cp } = getCellInfo(m.id, col.data)
        if (!tc) continue
        turni[tc] = (turni[tc] ?? 0) + 1
        if (isExt(tc)) continue
        if (col.isDomenica) D++
        else if (festivi.has(col.data)) F++
        else if (new Date(col.data + 'T00:00:00').getDay() === 6) S++
        const conta = (slot: SlotPlacement) => {
          if (slot === 'SUB') props.SUB = (props.SUB ?? 0) + 1
          else if (slot === 'MED') props.MED = (props.MED ?? 0) + 1
          else for (const p of cp ?? []) if (p !== 'SUB' && p !== 'MED') props[p] = (props[p] ?? 0) + 1
        }
        if (COPRE_M.has(tc)) conta(slot_mattina)
        if (COPRE_P.has(tc)) conta(slot_pomeriggio)
      }
      const adj = aggiustaConteggi?.(m) ?? {}
      if (adj.M) turni.M = (turni.M ?? 0) + adj.M
      if (adj.P) turni.P = (turni.P ?? 0) + adj.P
      if (adj.L) turni.L = (turni.L ?? 0) + adj.L
      if (adj.SUB) props.SUB = (props.SUB ?? 0) + adj.SUB
      if (adj.MED) props.MED = (props.MED ?? 0) + adj.MED
      if (adj.S) S += adj.S
      if (adj.D) D += adj.D
      if (adj.F) F += adj.F
      const totale = tipiTurno.reduce((s, t) => s + (t.is_reperibilita ? 0 : (turni[t.sigla] ?? 0) * (t.peso ?? 1)), 0)
      return { medico: m, turni, props, S, D, F, totale }
    })
  }, [tipiTurno, medici, colonne, getCellInfo, filtroMedicoId, festivitaCustomSet, aggiustaConteggi])

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

  // ══ Render DINAMICO: colonne = turni configurati + S/D/Festivi + proprietà ══
  if (tipiTurno) {
    const propCols = proprieta ?? []
    const fgSu = (bg: string) => {
      const h = (bg || '#cccccc').replace('#', '')
      if (h.length < 6) return '#1f2937'
      const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16)
      return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#1f2937' : '#fff'
    }
    const redTh: React.CSSProperties = { ...thStyle, background: '#fee2e2', color: '#b91c1c', borderColor: '#f0a8a8' }
    const redTd: React.CSSProperties = { ...tdStyle, color: '#dc2626', fontWeight: 700 }
    return (
      <table className="border-collapse" style={{ borderSpacing: 0 }}>
        <thead>
          <tr>
            <th style={{ ...thStyle, textAlign: 'left', minWidth: 160 }}>Medico</th>
            {tipiTurno.map(t => <th key={t.sigla} style={thStyle} title={t.nome}>{t.sigla}</th>)}
            <th style={thStyle} title="Sabati lavorati">S</th>
            <th style={redTh} title="Domeniche lavorate">D</th>
            <th style={redTh} title="Festivi non-domenica lavorati">Fe</th>
            {propCols.map(p => (
              <th key={p.sigla} style={thStyle} title={p.nome}>
                <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 20, height: 20, borderRadius: '50%', background: p.colore_bg, color: fgSu(p.colore_bg), fontSize: 8, fontWeight: 800, lineHeight: 1 }}>{p.sigla}</span>
              </th>
            ))}
            <th style={thStyle}>Totale</th>
          </tr>
        </thead>
        <tbody>
          {statsDin.map(s => (
            <tr key={s.medico.id}>
              <td style={{ ...tdStyle, textAlign: 'left', fontWeight: 500, color: s.medico.attivo === false ? '#a16207' : '#3a3d30' }}>
                {s.medico.nome}
                {s.medico.attivo === false && <span style={{ fontSize: 9, fontWeight: 700, marginLeft: 4 }}>(rit.)</span>}
              </td>
              {tipiTurno.map(t => <td key={t.sigla} style={tdStyle}>{s.turni[t.sigla] || ''}</td>)}
              <td style={tdStyle}>{s.S || ''}</td>
              <td style={redTd}>{s.D || ''}</td>
              <td style={redTd}>{s.F || ''}</td>
              {propCols.map(p => (
                <td key={p.sigla} style={{ ...tdStyle, ...(s.props[p.sigla] ? { background: p.colore_bg + '22', fontWeight: 700 } : {}) }}>{s.props[p.sigla] || ''}</td>
              ))}
              <td style={{ ...tdStyle, fontWeight: 800, background: '#f0f7fb', color: '#1f4a70' }}>{s.totale || ''}</td>
            </tr>
          ))}
          {statsDin.length === 0 && (
            <tr>
              <td colSpan={1 + tipiTurno.length + 3 + propCols.length + 1} style={{ ...tdStyle, color: '#9ca3af', fontStyle: 'italic' }}>
                Nessun medico da riepilogare.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    )
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
            <td style={{ ...tdStyle, textAlign: 'left', fontWeight: 500, color: s.medico.attivo === false ? '#a16207' : '#3a3d30' }}>
              {s.medico.nome}
              {s.medico.attivo === false && <span style={{ fontSize: 9, fontWeight: 700, marginLeft: 4 }}>(rit.)</span>}
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
