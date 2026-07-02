/**
 * AggiornaTurnazioneModal
 *
 * Procedura guidata per "Aggiorna turnazione": continua la rotazione attuale
 * con un nuovo schema dal primo lunedì del mese di inizio, preservando fase,
 * cambi e ferie. NON va in produzione: crea una BOZZA (anteprima) da
 * approvare nella pagina "Anteprima turnazione".
 *
 * Controlli prima di creare la bozza: buco di continuità + numero turnisti
 * (vedi validateAggiorna in src/lib/aggiornaTurnazione.ts).
 */

import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { RefreshCw, X, AlertTriangle, CheckCircle, Loader2, ArrowRight } from 'lucide-react'
import { primoLunediDelPeriodo, MESI_IT } from '../lib/algorithm'
import {
  validateAggiorna, creaBozzaAggiornamento, creaBozzaAggiornamentoDinamico,
  type ParametriAggiorna, type SchemaDinamicoData,
} from '../lib/aggiornaTurnazione'
import type { Configurazione, Medico, SchemaModello } from '../types'

interface Props {
  config:  Configurazione
  schemi:  SchemaModello[]
  medici:  Medico[]
  params:  ParametriAggiorna
  onClose: () => void
  /** Reparto dinamico → usa il motore schema (con turno_sigla/proprieta). */
  repartoDinamico?: boolean
  /** Dati dello schema NUOVO (obbligatori se repartoDinamico). */
  schemaDinamico?:  SchemaDinamicoData
}

type Step = 'intro' | 'working' | 'done' | 'error'

export function AggiornaTurnazioneModal({ config, schemi, medici, params, onClose, repartoDinamico, schemaDinamico }: Props) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [step, setStep]   = useState<Step>('intro')
  const [error, setError] = useState<string | null>(null)

  const nAttivi = useMemo(() => medici.filter(m => m.attivo).length, [medici])

  // Data di stacco (primo lunedì del mese di inizio scelto)
  const cutover = useMemo(
    () => primoLunediDelPeriodo(new Date(params.annoInizio, params.meseInizio - 1, 1)),
    [params.annoInizio, params.meseInizio],
  )
  const cutoverLabel = `${cutover.getDate()} ${MESI_IT[cutover.getMonth() + 1]} ${cutover.getFullYear()}`

  // Validazione (buco + numero turnisti)
  const valid = useMemo(
    () => validateAggiorna(config, params, config.n_medici_base ?? null, nAttivi),
    [config, params, nAttivi],
  )

  async function handleConferma() {
    setStep('working'); setError(null)
    try {
      if (repartoDinamico && schemaDinamico) {
        await creaBozzaAggiornamentoDinamico(config, medici, params, schemaDinamico)
      } else {
        await creaBozzaAggiornamento(config, schemi, medici, params)
      }
      qc.invalidateQueries({ queryKey: ['turnazione-anteprima'] })
      setStep('done')
    } catch (e) {
      setError((e as Error).message)
      setStep('error')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3"
      style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(2px)' }}
      onClick={step === 'working' ? undefined : onClose}>
      <div className="bg-white rounded-2xl shadow-2xl flex flex-col w-full"
        style={{ maxWidth: 'min(94vw, 560px)', maxHeight: 'min(90dvh, 680px)' }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-stone-200 shrink-0">
          <h3 className="font-bold text-stone-800 text-base flex items-center gap-2">
            <RefreshCw size={18} style={{ color: '#0284c7' }} />
            Aggiorna turnazione
          </h3>
          {step !== 'working' && (
            <button onClick={onClose} className="text-stone-400 hover:text-stone-600 transition-colors p-1">
              <X size={20} />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="overflow-auto p-5 flex-1">
          {step === 'intro' && (
            <>
              <p className="text-sm text-stone-700 leading-relaxed">
                Continui la turnazione <strong>attuale</strong> applicando lo{' '}
                <strong>Schema {params.schemaNuovo}</strong> dal{' '}
                <strong>{cutoverLabel}</strong> (primo lunedì) fino a{' '}
                <strong>{MESI_IT[params.meseFine]} {params.annoFine}</strong>.
              </p>
              <ul className="text-xs text-stone-600 mt-3 space-y-1.5 leading-relaxed">
                <li>• I giorni del mese di inizio <strong>prima</strong> del primo lunedì restano sulla vecchia turnazione.</li>
                <li>• La rotazione <strong>prosegue</strong> (i turnisti riprendono dal numero giusto, non si riparte da 1).</li>
                <li>• I <strong>cambi turno</strong> dal primo lunedì in poi <strong>non</strong> vengono mantenuti: il calendario nuovo li riscrive (vanno rifatti dopo).</li>
                <li>• Verrà creata una <strong>anteprima</strong> da far vedere ai turnisti: la produzione non cambia finché non approvi.</li>
              </ul>
              <div className="mt-3 rounded-lg p-3 text-xs flex items-start gap-2"
                style={{ background: '#fef3c7', border: '1px solid #fcd34d', color: '#92400e' }}>
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span>
                  La turnazione attuale verrà <strong>troncata</strong>: dal primo lunedì viene rigenerata col nuovo schema
                  fino a <strong>{MESI_IT[params.meseFine]} {params.annoFine}</strong>; eventuali turni <strong>oltre</strong> quella
                  data vengono <strong>eliminati</strong> (all'approvazione viene comunque salvato un backup).
                </span>
              </div>

              {!valid.ok && (
                <div className="mt-4 rounded-lg p-3 text-xs flex items-start gap-2"
                  style={{ background: '#fee2e2', border: '1px solid #fca5a5', color: '#991b1b' }}>
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  <span>{valid.error}</span>
                </div>
              )}
            </>
          )}

          {step === 'working' && (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <Loader2 size={36} className="animate-spin mb-4" style={{ color: '#0284c7' }} />
              <div className="text-sm font-semibold text-stone-700">Creazione anteprima…</div>
              <div className="text-xs text-stone-500 mt-1">Calcolo della nuova rotazione e preservazione dei cambi.</div>
            </div>
          )}

          {step === 'done' && (
            <div className="flex flex-col items-center text-center py-6">
              <div className="rounded-full p-2 mb-3" style={{ background: '#dcfce7' }}>
                <CheckCircle size={28} style={{ color: '#166534' }} />
              </div>
              <div className="text-base font-bold text-stone-800">Anteprima creata</div>
              <p className="text-xs text-stone-600 mt-2 max-w-sm">
                Rivedila e mostrala ai turnisti. Quando sono d'accordo, premi <strong>Approva</strong> per mandarla in produzione.
              </p>
              <button
                onClick={() => { onClose(); navigate('/admin/anteprima-turnazione') }}
                className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white shadow-sm"
                style={{ background: '#0284c7' }}>
                Vai all'anteprima <ArrowRight size={15} />
              </button>
            </div>
          )}

          {step === 'error' && (
            <div className="flex flex-col items-center text-center py-6">
              <div className="rounded-full p-2 mb-3" style={{ background: '#fee2e2' }}>
                <AlertTriangle size={28} style={{ color: '#991b1b' }} />
              </div>
              <div className="text-base font-bold text-stone-800">Errore</div>
              <p className="text-xs text-stone-600 mt-2 max-w-sm break-words">{error}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-stone-200 shrink-0">
          {step === 'intro' && (
            <>
              <button onClick={onClose} className="btn-secondary py-2 px-4 text-sm">Annulla</button>
              <button onClick={handleConferma} disabled={!valid.ok}
                className="py-2 px-4 text-sm rounded-lg font-semibold text-white shadow-sm disabled:opacity-50"
                style={{ background: '#0284c7' }}>
                Crea anteprima
              </button>
            </>
          )}
          {step === 'done' && (
            <button onClick={onClose} className="btn-secondary py-2 px-4 text-sm">Chiudi</button>
          )}
          {step === 'error' && (
            <>
              <button onClick={onClose} className="btn-secondary py-2 px-4 text-sm">Chiudi</button>
              <button onClick={handleConferma} className="py-2 px-4 text-sm rounded-lg font-semibold text-white shadow-sm"
                style={{ background: '#0284c7' }}>Riprova</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
