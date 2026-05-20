/**
 * ForceLandscapeOverlay
 *
 * Overlay full-screen mostrato sui dispositivi mobile (max-width 1024px)
 * quando sono in orientamento PORTRAIT. Invita l'utente a ruotare il
 * dispositivo in orizzontale tramite un'animazione del telefono che
 * ruota di 90 gradi e torna su.
 *
 * Usato solo sulle pagine pubbliche (CalendarioPage, SettimanalePage,
 * SettimanaleAltPage) dove la tabella e` molto larga e portrait non e`
 * utilizzabile. L'admin invece usa desktop.
 *
 * Detection via `matchMedia('(orientation: portrait) and (max-width: 1024px)')`.
 * Cosi` desktop (sempre landscape) e tablet grandi non lo vedono mai.
 */

import { useEffect, useState } from 'react'

const MEDIA_QUERY = '(orientation: portrait) and (max-width: 1024px)'

export function ForceLandscapeOverlay() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    const mql = window.matchMedia(MEDIA_QUERY)
    const update = () => setShow(mql.matches)
    update()
    mql.addEventListener('change', update)
    return () => mql.removeEventListener('change', update)
  }, [])

  if (!show) return null

  return (
    <>
      {/* Keyframes inline per non doverle aggiungere in index.css. Sono
          isolate al componente e si registrano solo quando l'overlay e`
          montato (cioe` raramente). */}
      <style>{`
        @keyframes phoneRotate {
          0%, 15%   { transform: rotate(0deg); }
          40%, 60%  { transform: rotate(-90deg); }
          85%, 100% { transform: rotate(0deg); }
        }
        .phone-rotate-anim {
          animation: phoneRotate 3s ease-in-out infinite;
          transform-origin: center center;
        }
        @keyframes pulseArrow {
          0%, 100% { opacity: 0.3; transform: translateX(0); }
          50%      { opacity: 1;   transform: translateX(4px); }
        }
        .arrow-pulse-anim {
          animation: pulseArrow 1.5s ease-in-out infinite;
        }
      `}</style>

      <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center p-6"
        style={{
          background: 'linear-gradient(135deg, #1c2818 0%, #2b3c24 60%, #456b3a 100%)',
          color: '#e0e8d8',
        }}>
        {/* Icona telefono che ruota */}
        <div className="phone-rotate-anim mb-6">
          <svg viewBox="0 0 64 64" width="120" height="120" fill="none">
            {/* Corpo del telefono */}
            <rect x="22" y="6" width="20" height="52" rx="4"
              stroke="#9ab488" strokeWidth="2.5" fill="#1c2818" />
            {/* Schermo */}
            <rect x="25" y="12" width="14" height="36" rx="1.5" fill="#456b3a" opacity="0.55" />
            {/* Speaker top */}
            <rect x="28" y="9" width="8" height="1.4" rx="0.7" fill="#9ab488" />
            {/* Home button */}
            <circle cx="32" cy="54" r="2" stroke="#9ab488" strokeWidth="1.5" fill="none" />
          </svg>
        </div>

        {/* Freccia + testo */}
        <div className="flex items-center gap-2 mb-2">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
            className="arrow-pulse-anim">
            <path d="M5 12h14m0 0l-6-6m6 6l-6 6" stroke="#9ab488" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <h2 className="text-xl font-bold" style={{ color: '#e0e8d8' }}>
            Ruota il telefono
          </h2>
        </div>

        <p className="text-sm text-center max-w-xs opacity-85 leading-relaxed"
          style={{ color: '#c0d0b0' }}>
          Per visualizzare correttamente il calendario serve l'orientamento
          <strong> orizzontale</strong>. Ruota il dispositivo per continuare.
        </p>
      </div>
    </>
  )
}
