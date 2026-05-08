/**
 * Loading screen elegante per il calendario.
 * Renderizzata sia durante l'auth check (in ProtectedRoute) che durante il
 * caricamento dei dati (in CalendarioPage). Tutti i prop sono opzionali:
 * con nessun prop mostra lo "scheletro vuoto" (placeholder iniziali) che
 * si riempie progressivamente man mano che i dati arrivano.
 */
import { AlertTriangle } from 'lucide-react'
import { MESI_IT } from '../lib/algorithm'
import type { Configurazione, Medico } from '../types'

interface ChunkMese { anno: number; mese: number; di: string; df: string }

interface Props {
  config?:       Configurazione | null
  medici?:       Medico[]
  mesi?:         ChunkMese[]
  stima?:        number
  meseCorrente?: number
  meseName?:     string
  loadedRows?:   number
  loadError?:    string | null
  lCfg?:         boolean
  lMed?:         boolean
}

function StepRow({ label, value, active }: {
  label: string; value?: string; active?: boolean
}) {
  const done = !!value
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold shrink-0 transition-all"
        style={{
          background: done ? '#d5e5d0' : active ? '#e8f0e0' : '#ede8e0',
          color:      done ? '#2b4a28' : active ? '#476540' : '#6b6b5a',
        }}>
        {done ? '✓' : active ? '⟳' : '○'}
      </span>
      <span className="flex-1" style={{ color: done ? '#3a3d30' : active ? '#3a3d30' : '#6b6b5a' }}>
        {label}
      </span>
      <span className="text-xs font-semibold transition-all"
        style={{ color: done ? '#476540' : '#7a7a6a', minWidth: 60, textAlign: 'right' }}>
        {value ?? '—'}
      </span>
    </div>
  )
}

export function CalendarLoadingScreen({
  config, medici = [], mesi = [], stima = 0,
  meseCorrente = 0, meseName = '', loadedRows = 0,
  loadError = null, lCfg = false, lMed = false,
}: Props) {
  const pct = stima > 0 && loadedRows > 0
    ? Math.min(Math.round((loadedRows / stima) * 100), 99)
    : meseCorrente > 0 && mesi.length > 0
      ? Math.min(Math.round((meseCorrente / mesi.length) * 85), 85)
      : lCfg ? 2 : lMed ? 6 : mesi.length > 0 ? 10 : 4

  const nBarre = mesi.length > 0 ? mesi.length : 6

  return (
    <div className="flex items-center justify-center h-[calc(100vh-48px)]"
      style={{ background: '#f4f1ea' }}>
      <div className="rounded-2xl p-7 shadow-lg"
        style={{ background: '#faf8f3', border: '1px solid #d5ccb8', width: 360 }}>

        {/* Titolo fisso — sempre visibile dal frame 1 */}
        <div className="flex items-center gap-3 mb-5">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 shrink-0"
            style={{ borderColor: '#476540' }} />
          <div>
            <h2 className="font-bold text-sm leading-tight" style={{ color: '#2b3c24' }}>
              Caricamento calendario
            </h2>
            <p className="text-xs mt-0.5" style={{ color: '#6b6b5a' }}>
              Il sistema sta recuperando i dati dal server
            </p>
          </div>
        </div>

        {/* 4 step SEMPRE visibili dal primo frame — valori arrivano man mano */}
        <div className="space-y-2.5 mb-5">
          <StepRow
            label="Configurazione periodo"
            value={config
              ? `${MESI_IT[config.mese_inizio]} → ${MESI_IT[config.mese_fine]} ${config.anno_fine}`
              : undefined}
            active={lCfg}
          />
          <StepRow
            label="Medici attivi"
            value={medici.length > 0 ? `${medici.length} turnisti` : undefined}
            active={lMed}
          />
          <StepRow
            label="Piano di caricamento"
            value={mesi.length > 0
              ? `${mesi.length} mesi · ~${stima.toLocaleString('it-IT')} turni`
              : undefined}
            active={!!config && !!medici.length && mesi.length === 0}
          />
          <StepRow
            label={meseCorrente > 0
              ? `${meseName}  (${meseCorrente} di ${mesi.length})`
              : 'Scaricamento turni'}
            value={loadedRows > 0
              ? `${loadedRows.toLocaleString('it-IT')} / ~${stima > 0 ? stima.toLocaleString('it-IT') : '…'}`
              : undefined}
            active={meseCorrente > 0}
          />
        </div>

        {/* Barra progresso — sempre visibile, parte da 2% */}
        <div className="space-y-2">
          <div className="flex justify-between text-xs" style={{ color: '#7a7a6a' }}>
            <span>
              {loadedRows > 0
                ? `${loadedRows.toLocaleString('it-IT')} turni caricati`
                : stima > 0
                  ? `~${stima.toLocaleString('it-IT')} turni da caricare`
                  : 'Connessione al server…'}
            </span>
            <span style={{ color: '#476540', fontWeight: 700 }}>{pct}%</span>
          </div>
          <div className="h-3 rounded-full overflow-hidden" style={{ background: '#e0e8d8' }}>
            <div className="h-full rounded-full transition-all duration-400"
              style={{
                width: `${Math.max(pct, 2)}%`,
                background: 'linear-gradient(90deg, #374f30 0%, #6b8254 100%)',
              }} />
          </div>

          {/* Barre mesi — 6 placeholder da subito, poi si riempiono */}
          <div className="flex gap-1 mt-1">
            {Array.from({ length: nBarre }).map((_, i) => {
              const m = mesi[i]
              const fatto   = i < meseCorrente - 1
              const inCorso = i === meseCorrente - 1
              const label   = m ? MESI_IT[m.mese].slice(0, 3) : '···'
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                  <div className="w-full h-1.5 rounded-full transition-all duration-300"
                    style={{
                      background: fatto ? '#476540' : inCorso ? '#9ab488' : '#d5ccb8',
                    }} />
                  <span style={{
                    fontSize: 8,
                    color: fatto ? '#476540' : inCorso ? '#476540' : '#6b6b5a',
                    fontWeight: inCorso ? 700 : 400,
                  }}>
                    {label}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        {loadError && (
          <div className="flex items-start gap-2 p-3 rounded-lg text-xs mt-4"
            style={{ background: '#fde8e8', color: '#7a2020', border: '1px solid #f0c0c0' }}>
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            <span>{loadError}</span>
          </div>
        )}
      </div>
    </div>
  )
}
