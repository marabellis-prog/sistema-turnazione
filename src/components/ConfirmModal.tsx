import { useEffect } from 'react'
import { AlertTriangle, Trash2, X } from 'lucide-react'

export interface ConfirmOptions {
  title:         string
  message:       string
  confirmLabel?: string
  danger?:       boolean  // true = pulsante rosso
}

interface Props extends ConfirmOptions {
  open:      boolean
  onConfirm: () => void
  onCancel:  () => void
}

export function ConfirmModal({
  open, title, message,
  confirmLabel = 'Conferma',
  danger = false,
  onConfirm, onCancel,
}: Props) {
  // Chiudi con Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onCancel])

  if (!open) return null

  return (
    // Overlay
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(2px)' }}
      onClick={onCancel}
    >
      {/* Card modale */}
      <div
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm
                   animate-[fadeSlideIn_0.15s_ease-out]"
        onClick={e => e.stopPropagation()}   // non chiudere cliccando dentro
      >
        {/* Header */}
        <div className={`flex items-center gap-3 px-5 pt-5 pb-3
          ${danger ? 'text-red-600' : 'text-amber-600'}`}>
          {danger
            ? <Trash2  size={20} className="shrink-0" />
            : <AlertTriangle size={20} className="shrink-0" />
          }
          <h3 className="font-bold text-base text-stone-800 flex-1">{title}</h3>
          <button onClick={onCancel}
            className="text-gray-300 hover:text-stone-600 transition-colors -mt-1">
            <X size={18} />
          </button>
        </div>

        {/* Corpo */}
        <p className="px-5 pb-5 text-sm text-gray-600 leading-relaxed">{message}</p>

        {/* Azioni */}
        <div className="flex gap-2 justify-end px-5 pb-5">
          <button
            onClick={onCancel}
            className="btn-secondary py-1.5 px-4 text-sm"
          >
            Annulla
          </button>
          <button
            onClick={onConfirm}
            className={`py-1.5 px-4 text-sm rounded-lg font-medium text-white
              shadow transition-colors focus:outline-none focus:ring-2
              ${danger
                ? 'bg-red-600 hover:bg-red-700 focus:ring-red-400'
                : 'focus:ring-olive-300'
              }`}
            style={!danger ? { background: '#476540' } : undefined}
            onMouseEnter={e => { if (!danger) (e.currentTarget as HTMLElement).style.background = '#374f30' }}
            onMouseLeave={e => { if (!danger) (e.currentTarget as HTMLElement).style.background = '#476540' }}
            autoFocus
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
