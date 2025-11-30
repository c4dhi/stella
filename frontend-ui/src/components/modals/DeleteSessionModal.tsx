import { motion, AnimatePresence } from 'framer-motion'
import { useState } from 'react'
import { useThemeStore } from '../../store/themeStore'

interface DeleteSessionModalProps {
  isOpen: boolean
  sessionName: string
  onConfirm: () => void
  onCancel: () => void
}

export default function DeleteSessionModal({
  isOpen,
  sessionName,
  onConfirm,
  onCancel,
}: DeleteSessionModalProps) {
  const [inputValue, setInputValue] = useState('')
  const isValid = inputValue === sessionName
  const { resolvedTheme } = useThemeStore()
  const isDark = resolvedTheme === 'dark'

  const handleConfirm = () => {
    if (isValid) {
      onConfirm()
      setInputValue('') // Reset for next time
    }
  }

  const handleCancel = () => {
    setInputValue('') // Reset input
    onCancel()
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
          onClick={handleCancel}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className={`card-elevated w-full max-w-md p-6 ${
              isDark
                ? 'bg-surface-dark-secondary border-red-500/30'
                : 'border-red-200'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <h2 className={`text-heading-lg mb-2 ${isDark ? 'text-content-inverse' : 'text-content'}`}>
              Delete Session
            </h2>

            {/* Warning Message */}
            <div className={`mb-4 p-3 rounded-lg text-body-sm ${
              isDark
                ? 'bg-red-500/10 border border-red-500/20 text-red-400'
                : 'bg-red-50 border border-red-200 text-red-700'
            }`}>
              <div className="flex items-start gap-2">
                <span className="text-base">Warning</span>
                <div className="flex-1">
                  <div className="font-medium mb-1">This will permanently delete:</div>
                  <ul className="mt-2 space-y-1 ml-4 list-disc">
                    <li>All messages and conversation history</li>
                    <li>All participants</li>
                    <li>All agents and their containers</li>
                  </ul>
                </div>
              </div>
            </div>

            {/* Confirmation Input */}
            <div className="mb-6">
              <label className={`block text-body mb-2 ${
                isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'
              }`}>
                Type <span className={`font-mono font-medium ${isDark ? 'text-content-inverse' : 'text-content'}`}>{sessionName}</span> to confirm:
              </label>
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder={sessionName}
                className={`input-field ${
                  isDark
                    ? 'focus:border-red-400 focus:ring-red-400/20'
                    : 'focus:border-red-400 focus:ring-red-400/20'
                }`}
                autoFocus
              />
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleCancel}
                className="btn-secondary flex-1"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={!isValid}
                className={`flex-1 px-4 py-2.5 rounded-lg text-ui font-medium transition-all duration-200 ${
                  isValid
                    ? 'bg-red-600 text-white hover:bg-red-700 shadow-sm'
                    : isDark
                      ? 'bg-red-900/30 text-red-400/50 cursor-not-allowed'
                      : 'bg-red-100 text-red-300 cursor-not-allowed'
                }`}
              >
                Delete Session
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
