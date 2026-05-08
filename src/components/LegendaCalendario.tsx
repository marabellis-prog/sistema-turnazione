/**
 * LegendaCalendario
 *
 * Legenda dei colori e simboli usati nelle tabelle clinica/ricerca,
 * sia nel calendario pubblico che in Modifica Turni. Visibile sempre,
 * ai piedi delle tabelle.
 *
 * Variant 'pubblica' include "Riga selezionata" (sulla pubblica si può
 * cliccare una riga per evidenziarla); 'admin' la omette.
 */

const CELL_FG: Record<string, string> = {
  M: '#2e4a28', P: '#253a4a', L: '#4a3a1a',
  REP: '#5a2a2a', RM: '#3a2858', RP: '#582840',
}

interface Props {
  variant?: 'pubblica' | 'admin'
  className?: string
  style?: React.CSSProperties
}

export function LegendaCalendario({ variant = 'pubblica', className, style }: Props) {
  return (
    <div
      className={`flex flex-wrap gap-x-4 gap-y-1.5 px-3 py-2 text-xs items-center rounded ${className ?? ''}`}
      style={{ background: '#f0ece4', border: '1px solid #d5ccb8', ...style }}>

      {/* Tipi di turno — sfondo crema, testo colorato per tipo */}
      {([ ['M','Mattina'], ['P','Pomeriggio'], ['L','Lungo (M+P)'], ['REP','Reperibilità'],
           ['RM','Ric. mat.'], ['RP','Ric. pom.'] ] as [string,string][]).map(([t, label]) => {
        const isRep = t === 'REP'
        return (
          <span key={t} className="flex items-center gap-1">
            <span className="inline-flex items-center justify-center rounded border"
              style={{
                width: 26, height: 18,
                background: '#e8e3d8',
                borderColor: '#8a9882',
                color:      isRep ? '#b91c1c' : (CELL_FG[t] ?? '#3a3d30'),
                fontSize:   isRep ? 8 : (t.length > 1 ? 8 : 10),
                fontWeight: isRep ? 800 : 700,
                letterSpacing: isRep ? '-0.3px' : undefined,
              }}>
              {t}
            </span>
            <span style={{ color: '#5a5a4a' }}>{label}</span>
          </span>
        )
      })}

      {/* Separatore */}
      <span style={{ width: 1, height: 14, background: '#c0b8a8', display: 'inline-block', margin: '0 2px' }} />

      {/* SUB — cerchietto rosso pastello con S dentro */}
      <span className="flex items-center gap-1">
        <span style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 22, height: 22, borderRadius: '50%',
          background: '#fecaca', border: '1.5px solid #dc2626',
          fontSize: 12, fontWeight: 800, color: '#9f1239', lineHeight: 1,
        }}>S</span>
        <span style={{ color: '#5a5a4a' }}>Sub-intensiva</span>
      </span>

      {/* MED — cerchietto azzurro pastello con M dentro */}
      <span className="flex items-center gap-1">
        <span style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 22, height: 22, borderRadius: '50%',
          background: '#bae6fd', border: '1.5px solid #0284c7',
          fontSize: 12, fontWeight: 800, color: '#0c4a6e', lineHeight: 1,
        }}>M</span>
        <span style={{ color: '#5a5a4a' }}>Medicina</span>
      </span>

      {/* Separatore */}
      <span style={{ width: 1, height: 14, background: '#c0b8a8', display: 'inline-block', margin: '0 2px' }} />

      {/* Dom/Festivo */}
      <span className="flex items-center gap-1">
        <span className="inline-flex items-center justify-center rounded border"
          style={{ width: 26, height: 18, background: '#fef3c7', borderColor: '#8a9882' }} />
        <span style={{ color: '#5a5a4a' }}>Dom / Festivo</span>
      </span>

      {/* Ferie approvate */}
      <span className="flex items-center gap-1">
        <span className="inline-flex items-center justify-center rounded border"
          style={{ width: 26, height: 18, background: '#d5e5d0', borderColor: '#8a9882', fontSize: 9, color: '#2e5a28', fontWeight: 700 }}>
          F
        </span>
        <span style={{ color: '#5a5a4a' }}>Ferie approvate</span>
      </span>

      {/* Ferie in approvazione */}
      <span className="flex items-center gap-1">
        <span className="inline-flex items-center justify-center rounded border"
          style={{
            width: 26, height: 18,
            background: 'repeating-linear-gradient(-45deg, #d5e5d0 0, #d5e5d0 3px, #a8c4a0 3px, #a8c4a0 6px)',
            borderColor: '#8a9882',
          }} />
        <span style={{ color: '#5a5a4a' }}>In approvazione</span>
      </span>

      {/* Riga selezionata — solo nella variant pubblica */}
      {variant === 'pubblica' && (
        <span className="flex items-center gap-1">
          <span className="inline-flex items-center justify-center rounded border"
            style={{ width: 26, height: 18, background: 'rgba(190,140,90,0.35)', borderColor: '#8a9882', fontSize: 9, color: '#5a3d1a', fontWeight: 700 }}>
            ★
          </span>
          <span style={{ color: '#5a5a4a' }}>Riga selezionata</span>
        </span>
      )}

      {/* Modificato manualmente */}
      <span className="flex items-center gap-1">
        <span className="inline-flex items-center justify-center rounded"
          style={{ width: 26, height: 18, background: '#e8e3d8', boxShadow: 'inset 0 0 0 2px #38bdf8, 0 0 6px 1px rgba(56,189,248,0.45)' }} />
        <span style={{ color: '#5a5a4a' }}>Modificato</span>
      </span>
    </div>
  )
}
