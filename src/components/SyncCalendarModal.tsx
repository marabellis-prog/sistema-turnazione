/**
 * SyncCalendarModal
 *
 * Modal "Sincronizza Calendario" per i medici turnisti. Sincronizza i
 * turni Clinica del medico loggato con un calendario "TURNAZIONE" sul suo
 * Google Calendar (account Google usato per il login).
 *
 * Flusso:
 *   1. intro  → spiegazione + scelta colore + "Continua"
 *   2. syncing→ popup consenso Google + creazione calendario + diff eventi
 *   3. done   → riepilogo (creati/aggiornati/eliminati/invariati) + link
 *   error     → messaggio + "Riprova"
 *
 * Vedi src/lib/googleCalendarSync.ts per la logica (diff intelligente:
 * tocca solo i turni effettivamente cambiati).
 */

import { useState } from 'react'
import { CalendarCheck, X, Loader2, Check, AlertTriangle, ExternalLink } from 'lucide-react'
import type { Medico, Turno } from '../types'
import {
  syncToGoogleCalendar, GOOGLE_OAUTH_CLIENT_ID, CAL_COLORS, getSavedCalendarColor,
  type SyncProgress, type SyncResult,
} from '../lib/googleCalendarSync'

interface Props {
  medico: Medico
  turni:  Turno[]
  onClose: () => void
}

type Step = 'intro' | 'syncing' | 'done' | 'error'

const PHASE_LABEL: Record<SyncProgress['phase'], string> = {
  auth:     'Autorizzazione Google…',
  calendar: 'Preparazione calendario TURNAZIONE…',
  reading:  'Lettura turni già presenti…',
  writing:  'Aggiornamento turni…',
  done:     'Completato',
}

export function SyncCalendarModal({ medico, turni, onClose }: Props) {
  const [step, setStep]         = useState<Step>('intro')
  // Pre-seleziona il colore già scelto per il calendario TURNAZIONE
  // (memorizzato all'ultima sincronizzazione). Fallback al primo colore
  // se non noto o non più presente nella palette.
  const [colorId, setColorId]   = useState<string>(() => {
    const saved = getSavedCalendarColor()
    return saved && CAL_COLORS.some(c => c.colorId === saved)
      ? saved
      : CAL_COLORS[0].colorId
  })
  const [progress, setProgress] = useState<SyncProgress | null>(null)
  const [result, setResult]     = useState<SyncResult | null>(null)
  const [error, setError]       = useState<string | null>(null)

  const configured = !!GOOGLE_OAUTH_CLIENT_ID

  async function handleSync() {
    setStep('syncing')
    setError(null)
    setProgress({ phase: 'auth' })
    try {
      const res = await syncToGoogleCalendar({
        clientId: GOOGLE_OAUTH_CLIENT_ID,
        medicoId: medico.id,
        turni,
        colorId,
        onProgress: setProgress,
      })
      setResult(res)
      setStep('done')
    } catch (e) {
      setError((e as Error).message)
      setStep('error')
    }
  }

  const nTurni = turni.filter(t =>
    t.medico_id === medico.id &&
    ['M', 'P', 'L', 'REP'].includes(t.turno_clinico)
  ).length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3"
      style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(2px)' }}
      onClick={step === 'syncing' ? undefined : onClose}>
      <div className="bg-white rounded-2xl shadow-2xl flex flex-col w-full"
        style={{ maxWidth: 'min(94vw, 520px)', maxHeight: 'min(90dvh, 680px)' }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-stone-200 shrink-0">
          <div className="flex items-center gap-3">
            <CalendarCheck size={20} style={{ color: '#476540' }} />
            <h3 className="font-bold text-stone-800 text-base">Sincronizza Calendario</h3>
          </div>
          {step !== 'syncing' && (
            <button onClick={onClose} className="text-stone-400 hover:text-stone-600 transition-colors p-1">
              <X size={20} />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="overflow-auto p-5 flex-1">

          {/* ── INTRO ──────────────────────────────────────────────── */}
          {step === 'intro' && (
            <>
              <p className="text-sm text-stone-700 leading-relaxed">
                Continuando verrà creato il calendario <strong>TURNAZIONE</strong> (se non
                esiste già) e saranno sincronizzati tutti i tuoi turni.
              </p>

              {/* Scelta colore */}
              <div className="mt-4">
                <div className="text-xs font-semibold text-stone-600 mb-2">
                  Scegli il colore del calendario o conferma quello esistente
                </div>
                <div className="flex flex-wrap gap-2">
                  {CAL_COLORS.map(c => {
                    const sel = c.colorId === colorId
                    return (
                      <button key={c.colorId}
                        onClick={() => setColorId(c.colorId)}
                        title={c.nome}
                        className="rounded-full transition-transform"
                        style={{
                          width: 26, height: 26, background: c.hex,
                          border: sel ? '3px solid #2b3c24' : '2px solid #fff',
                          boxShadow: sel ? '0 0 0 1px #2b3c24' : '0 0 0 1px #d5ccb8',
                          transform: sel ? 'scale(1.12)' : 'scale(1)',
                        }} />
                    )
                  })}
                </div>
              </div>

              {nTurni === 0 && (
                <p className="text-xs text-stone-500 mt-4">Nessun turno da sincronizzare nel periodo.</p>
              )}

              {!configured && (
                <div className="mt-4 rounded-lg p-3 text-xs flex items-start gap-2"
                  style={{ background: '#fef3c7', border: '1px solid #fbbf24', color: '#92400e' }}>
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  <span>
                    Funzione non ancora attiva: manca la configurazione Google
                    (<code>VITE_GOOGLE_OAUTH_CLIENT_ID</code>). Contatta l'amministratore.
                  </span>
                </div>
              )}
            </>
          )}

          {/* ── SYNCING ────────────────────────────────────────────── */}
          {step === 'syncing' && (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Loader2 size={36} className="animate-spin mb-4" style={{ color: '#476540' }} />
              <div className="text-sm font-semibold text-stone-700">
                {progress ? PHASE_LABEL[progress.phase] : 'Sincronizzazione…'}
              </div>
              {progress?.phase === 'writing' && progress.total !== undefined && (
                <>
                  <div className="text-xs text-stone-500 mt-1">
                    {progress.done ?? 0} / {progress.total}
                  </div>
                  <div className="w-full max-w-xs h-2 rounded-full mt-3 overflow-hidden" style={{ background: '#e7e5e4' }}>
                    <div className="h-full rounded-full transition-all"
                      style={{
                        width: `${progress.total ? Math.round(((progress.done ?? 0) / progress.total) * 100) : 0}%`,
                        background: '#476540',
                      }} />
                  </div>
                </>
              )}
              {progress?.phase === 'auth' && (
                <div className="text-xs text-stone-500 mt-2 max-w-xs">
                  Se appare un popup di Google, autorizza l'accesso al calendario.
                </div>
              )}
            </div>
          )}

          {/* ── DONE ───────────────────────────────────────────────── */}
          {step === 'done' && result && (
            <div className="flex flex-col items-center text-center py-4">
              <div className="rounded-full p-2 mb-3" style={{ background: '#dcfce7' }}>
                <Check size={28} style={{ color: '#166534' }} />
              </div>
              <div className="text-base font-bold text-stone-800">Sincronizzazione completata</div>
              <div className="grid grid-cols-2 gap-2 mt-4 w-full max-w-xs text-sm">
                <Stat label="Creati"     value={result.created}   color="#166534" bg="#dcfce7" />
                <Stat label="Aggiornati" value={result.updated}   color="#1d4ed8" bg="#dbeafe" />
                <Stat label="Eliminati"  value={result.deleted}   color="#991b1b" bg="#fee2e2" />
                <Stat label="Invariati"  value={result.unchanged} color="#57534e" bg="#f5f5f4" />
              </div>
              <a
                href="https://calendar.google.com/"
                target="_blank" rel="noopener noreferrer"
                className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold transition-colors"
                style={{ color: '#476540' }}>
                <ExternalLink size={14} />
                Apri Google Calendar
              </a>
            </div>
          )}

          {/* ── ERROR ──────────────────────────────────────────────── */}
          {step === 'error' && (
            <div className="flex flex-col items-center text-center py-4">
              <div className="rounded-full p-2 mb-3" style={{ background: '#fee2e2' }}>
                <AlertTriangle size={28} style={{ color: '#991b1b' }} />
              </div>
              <div className="text-base font-bold text-stone-800">Sincronizzazione non riuscita</div>
              <p className="text-xs text-stone-600 mt-2 max-w-sm break-words">{error}</p>
            </div>
          )}
        </div>

        {/* Footer azioni */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-stone-200 shrink-0">
          {step === 'intro' && (
            <>
              <button onClick={onClose} className="btn-secondary py-2 px-4 text-sm">Annulla</button>
              <button onClick={handleSync} disabled={!configured || nTurni === 0}
                className="btn-primary py-2 px-4 text-sm">
                <CalendarCheck size={16} />
                Sincronizza
              </button>
            </>
          )}
          {step === 'done' && (
            <button onClick={onClose} className="btn-primary py-2 px-4 text-sm">Chiudi</button>
          )}
          {step === 'error' && (
            <>
              <button onClick={onClose} className="btn-secondary py-2 px-4 text-sm">Chiudi</button>
              <button onClick={handleSync} className="btn-primary py-2 px-4 text-sm">Riprova</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, color, bg }: { label: string; value: number; color: string; bg: string }) {
  return (
    <div className="rounded-lg py-2 px-3 flex flex-col items-center" style={{ background: bg }}>
      <span className="text-lg font-bold" style={{ color }}>{value}</span>
      <span className="text-[11px] font-medium" style={{ color }}>{label}</span>
    </div>
  )
}
