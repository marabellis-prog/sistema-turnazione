import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

/**
 * "Vai alla richiesta" (#33): legge `?richiesta=<id>` dall'URL e, quando i dati
 * sono pronti e l'elemento `#richiesta-<id>` è nel DOM, lo scrolla in vista e
 * ritorna l'id da EVIDENZIARE (flash) per ~2.5s. Poi ripulisce il parametro
 * così un refresh non ri-evidenzia.
 *
 * Uso:
 *   const highlightId = useEvidenziaRichiesta(!isLoading)
 *   <div id={`richiesta-${f.id}`} className={highlightId === f.id ? 'flash…' : ''} />
 */
export function useEvidenziaRichiesta(pronto: boolean): string | null {
  const [params, setParams] = useSearchParams()
  const richiesta = params.get('richiesta')
  const [highlight, setHighlight] = useState<string | null>(null)

  useEffect(() => {
    if (!richiesta || !pronto) return
    const el = document.getElementById(`richiesta-${richiesta}`)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setHighlight(richiesta)
    const t = window.setTimeout(() => {
      setHighlight(null)
      setParams(prev => {
        const p = new URLSearchParams(prev)
        p.delete('richiesta')
        return p
      }, { replace: true })
    }, 2500)
    return () => clearTimeout(t)
  }, [richiesta, pronto, setParams])

  return highlight
}
