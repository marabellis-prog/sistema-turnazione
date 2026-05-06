import { useState, useCallback } from 'react'
import type { ConfirmOptions } from '../components/ConfirmModal'

interface ConfirmState {
  open:    boolean
  opts:    ConfirmOptions
  resolve: ((v: boolean) => void) | null
}

const DEFAULT_OPTS: ConfirmOptions = { title: '', message: '' }

/**
 * Hook per mostrare una ConfirmModal elegante invece di window.confirm().
 *
 * Usage:
 *   const { confirm, modal } = useConfirm()
 *   // Nel JSX: {modal}
 *   // Per chiedere conferma:
 *   const ok = await confirm({ title: 'Elimina?', message: 'Questa operazione...', danger: true })
 *   if (ok) { ... }
 */
export function useConfirm() {
  const [state, setState] = useState<ConfirmState>({
    open: false, opts: DEFAULT_OPTS, resolve: null,
  })

  const confirm = useCallback((opts: ConfirmOptions): Promise<boolean> => {
    return new Promise(resolve => {
      setState({ open: true, opts, resolve })
    })
  }, [])

  const handleConfirm = useCallback(() => {
    state.resolve?.(true)
    setState(prev => ({ ...prev, open: false, resolve: null }))
  }, [state.resolve])

  const handleCancel = useCallback(() => {
    state.resolve?.(false)
    setState(prev => ({ ...prev, open: false, resolve: null }))
  }, [state.resolve])

  return {
    confirm,
    confirmState: {
      open:      state.open,
      opts:      state.opts,
      onConfirm: handleConfirm,
      onCancel:  handleCancel,
    },
  }
}
