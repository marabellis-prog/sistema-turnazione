/**
 * LegendaCalendario
 *
 * Legenda ai piedi delle tabelle turni. **DINAMICA** per i reparti col nuovo
 * schema: se il chiamante passa `tipiTurno`/`proprieta`, i chip di TURNI
 * (incluso il "Vuoto") e PROPRIETÀ vengono dallo schema attivo. Senza props
 * (11N/legacy) usa la legenda classica hardcoded. La parte FISSA (Dom/Festivo,
 * Ferie, In approvazione, Modificato…) è sempre uguale.
 */

const CELL_FG: Record<string, string> = {
  M: '#2e4a28', P: '#253a4a', L: '#4a3a1a',
  REP: '#5a2a2a',
  EM: '#36495a', EP: '#36495a', EL: '#36495a',
  RM: '#3a2858', RP: '#582840',
}

/** Payload drag&drop dalla legenda (dataTransfer text/plain):
 *  TC:<sigla> cambia turno · FLAG:SUB|MED toggle placement · TC: cancella. */
export const DRAG_MIME = 'application/x-turno-drag'

interface TipoTurnoLegenda { sigla: string; nome: string; colore_bg: string; colore_fg: string; is_reperibilita: boolean }
interface ProprietaLegenda { sigla: string; nome: string; colore_bg: string }

interface Props {
  variant?: 'pubblica' | 'admin'
  className?: string
  style?: React.CSSProperties
  /** Reparto dinamico → turni dallo schema (se assente = legenda classica 11N). */
  tipiTurno?: TipoTurnoLegenda[]
  /** Reparto dinamico → proprietà dallo schema. */
  proprieta?: ProprietaLegenda[]
}

function dragHandlers(payload: string): React.HTMLAttributes<HTMLElement> {
  return {
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.setData(DRAG_MIME, payload)
      e.dataTransfer.setData('text/plain', payload)
      e.dataTransfer.effectAllowed = 'copy'
    },
    style: { cursor: 'grab' as React.CSSProperties['cursor'] },
  }
}

/** Colore testo leggibile su uno sfondo dato (per i pallini proprietà). */
function fgSu(bg: string): string {
  const h = (bg || '#cccccc').replace('#', '')
  if (h.length < 6) return '#1f2937'
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16)
  return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#1f2937' : '#fff'
}

const Separatore = () => (
  <span style={{ width: 1, height: 14, background: '#c0b8a8', display: 'inline-block', margin: '0 2px' }} />
)

interface ChipInfo { sigla: string; label: string; payload: string; bg: string; fg: string; isRep: boolean; isVuoto: boolean }

/** Chip turno (draggable). */
function ChipTurno({ c }: { c: ChipInfo }) {
  const dh = dragHandlers(c.payload)
  const isTwoChar = c.sigla.length > 1
  return (
    <span className="flex items-center gap-1">
      <span
        draggable={dh.draggable}
        onDragStart={dh.onDragStart}
        className="inline-flex items-center justify-center rounded border select-none"
        title={c.isVuoto ? 'Trascina su una cella per CANCELLARE il turno' : `Trascina su una cella per applicare ${c.sigla}`}
        style={{
          width: 26, height: 18, background: c.bg,
          borderColor: c.isVuoto ? '#a8a8a0' : '#8a9882', color: c.fg,
          fontSize: c.isVuoto ? 14 : (isTwoChar ? 8 : 10),
          fontWeight: c.isRep ? 800 : 700,
          cursor: 'grab', lineHeight: 1,
        }}>
        {c.sigla}
      </span>
      <span style={{ color: '#5a5a4a' }}>{c.label}</span>
    </span>
  )
}

/** Pallino proprietà. SUB/MED sono draggabili (placement); le altre no. */
function ChipProprieta({ sigla, nome, bg }: { sigla: string; nome: string; bg: string }) {
  const draggabile = sigla === 'SUB' || sigla === 'MED'
  const dh = draggabile ? dragHandlers(`FLAG:${sigla}`) : {}
  return (
    <span className="flex items-center gap-1">
      <span
        {...dh}
        className="select-none"
        title={draggabile ? `Trascina su una cella per attivare/disattivare ${nome}` : nome}
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 22, height: 22, borderRadius: '50%',
          background: bg, border: `1.5px solid ${fgSu(bg)}22`,
          fontSize: 8, fontWeight: 800, color: fgSu(bg), lineHeight: 1,
          cursor: draggabile ? 'grab' : 'default',
        }}>{sigla}</span>
      <span style={{ color: '#5a5a4a' }}>{nome}</span>
    </span>
  )
}

/** Chip "L con placement misto" (aiuto: applica SUB/MED alle due metà di una L). */
function ChipLSplit({ payload, sx, dx, label }: { payload: string; sx: string; dx: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span
        {...dragHandlers(payload)}
        className="select-none"
        title={`Trascina su una cella L per ${label}`}
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 22, height: 22, borderRadius: '50%',
          background: `linear-gradient(90deg,${sx} 0%,${sx} 50%,${dx} 50%,${dx} 100%)`,
          border: '1.5px solid #6b7280', position: 'relative',
          color: '#1f2937', fontSize: 8, fontWeight: 800, lineHeight: 1, cursor: 'grab',
        }}>
        <span style={{ position: 'absolute', left: 4, top: '50%', transform: 'translateY(-50%)', color: sx === '#fecaca' ? '#9f1239' : '#0c4a6e' }}>{sx === '#fecaca' ? 'S' : 'M'}</span>
        <span style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)', color: dx === '#fecaca' ? '#9f1239' : '#0c4a6e' }}>{dx === '#fecaca' ? 'S' : 'M'}</span>
      </span>
      <span style={{ color: '#5a5a4a' }}>{label}</span>
    </span>
  )
}

export function LegendaCalendario({ variant = 'pubblica', className, style, tipiTurno, proprieta }: Props) {
  const dinamica = !!tipiTurno

  // ── TURNI (+ Vuoto) ──
  const turniChips: ChipInfo[] = dinamica
    ? [
        ...tipiTurno!.map(t => ({ sigla: t.sigla, label: t.nome, payload: `TC:${t.sigla}`, bg: t.colore_bg || '#e8e3d8', fg: t.colore_fg || '#3a3d30', isRep: t.is_reperibilita, isVuoto: false })),
        { sigla: '—', label: 'Vuoto', payload: 'TC:', bg: '#fafaf7', fg: '#7a7a70', isRep: false, isVuoto: true },
      ]
    : ([
        ['M', 'Mattina', 'TC:M'], ['P', 'Pomeriggio', 'TC:P'], ['L', 'Lungo (M+P)', 'TC:L'],
        ['REP', 'Reperibilità', 'TC:REP'], ['EM', 'Esterno Mat.', 'TC:EM'], ['EP', 'Esterno Pom.', 'TC:EP'],
        ['EL', 'Esterno Lungo', 'TC:EL'], ['—', 'Vuoto', 'TC:'], ['RM', 'Ric. mat.', 'TR:RM'], ['RP', 'Ric. pom.', 'TR:RP'],
      ] as [string, string, string][]).map(([sigla, label, payload]) => ({
        sigla, label, payload,
        bg: label === 'Vuoto' ? '#fafaf7' : '#e8e3d8',
        fg: label === 'Vuoto' ? '#7a7a70' : (sigla === 'REP' ? '#b91c1c' : (CELL_FG[sigla] ?? '#3a3d30')),
        isRep: sigla === 'REP', isVuoto: label === 'Vuoto',
      }))

  return (
    <div
      className={`flex flex-wrap gap-x-4 gap-y-1.5 px-3 py-2 text-xs items-center rounded ${className ?? ''}`}
      style={{ background: '#f0ece4', border: '1px solid #d5ccb8', ...style }}>

      {turniChips.map(c => <ChipTurno key={`${c.sigla}|${c.label}`} c={c} />)}

      <Separatore />

      {/* PROPRIETÀ */}
      {dinamica
        ? (proprieta ?? []).map(p => <ChipProprieta key={p.sigla} sigla={p.sigla} nome={p.nome} bg={p.colore_bg} />)
        : (
          <>
            <ChipProprieta sigla="SUB" nome="Sub-intensiva" bg="#fecaca" />
            <ChipProprieta sigla="MED" nome="Medicina" bg="#bae6fd" />
            <span className="flex items-center gap-1">
              <span className="select-none" title="Cella che lavora senza SUB/MED (jolly)"
                style={{ display: 'inline-flex', width: 22, height: 22, borderRadius: '50%', background: '#d4d4d4', border: '1.5px solid #6b7280' }} />
              <span style={{ color: '#5a5a4a' }}>Supporto (jolly)</span>
            </span>
          </>
        )}
      {/* Aiuti L con placement misto (validi ovunque ci siano SUB/MED su una L) */}
      <ChipLSplit payload="FLAG:L_SUB_MED" sx="#fecaca" dx="#bae6fd" label="L: sub matt. + med pom." />
      <ChipLSplit payload="FLAG:L_MED_SUB" sx="#bae6fd" dx="#fecaca" label="L: med matt. + sub pom." />

      <Separatore />

      {/* ── Parte FISSA ── */}
      <span className="flex items-center gap-1">
        <span className="inline-flex items-center justify-center rounded border"
          style={{ width: 26, height: 18, background: '#fef3c7', borderColor: '#8a9882' }} />
        <span style={{ color: '#5a5a4a' }}>Dom / Festivo</span>
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-flex items-center justify-center rounded border"
          style={{ width: 26, height: 18, background: '#d5e5d0', borderColor: '#8a9882', fontSize: 9, color: '#2e5a28', fontWeight: 700 }}>F</span>
        <span style={{ color: '#5a5a4a' }}>Ferie approvate</span>
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-flex items-center justify-center rounded border"
          style={{ width: 26, height: 18, background: 'repeating-linear-gradient(-45deg, #d5e5d0 0, #d5e5d0 3px, #a8c4a0 3px, #a8c4a0 6px)', borderColor: '#8a9882' }} />
        <span style={{ color: '#5a5a4a' }}>In approvazione</span>
      </span>
      {variant === 'pubblica' && (
        <span className="flex items-center gap-1">
          <span className="inline-flex items-center justify-center rounded border"
            style={{ width: 26, height: 18, background: 'rgba(190,140,90,0.35)', borderColor: '#8a9882', fontSize: 9, color: '#5a3d1a', fontWeight: 700 }}>★</span>
          <span style={{ color: '#5a5a4a' }}>Riga selezionata</span>
        </span>
      )}
      <span className="flex items-center gap-1">
        <span className="inline-flex items-center justify-center rounded"
          style={{ width: 26, height: 18, background: '#e8e3d8', boxShadow: 'inset 0 0 0 2px #38bdf8, 0 0 6px 1px rgba(56,189,248,0.45)' }} />
        <span style={{ color: '#5a5a4a' }}>Modificato</span>
      </span>
    </div>
  )
}
