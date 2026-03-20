import { motion, AnimatePresence } from 'framer-motion'
import { useState } from 'react'
import { useThemeStore } from '../../store/themeStore'
import { AlertTriangle } from 'lucide-react'

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
  const isValid = inputValue === 'DELETE'
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
            <p className={`text-body-sm mb-4 ${isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'}`}>
              You are deleting <span className="font-semibold">{sessionName}</span>
            </p>

            <div
              className={`mb-4 rounded-xl border p-4 ${
                isDark
                  ? 'border-red-500/20 bg-red-500/5'
                  : 'border-red-200 bg-red-50/70'
              }`}
            >
              <div className="flex items-start gap-3">
                <AlertTriangle
                  className={`mt-0.5 h-5 w-5 shrink-0 ${
                    isDark ? 'text-red-400' : 'text-red-600'
                  }`}
                />

                <div>
                  <p
                    className={`text-sm font-semibold ${
                      isDark ? 'text-red-400' : 'text-red-700'
                    }`}
                  >
                    Permanent deletion
                  </p>

                  <p
                    className={`mt-1 text-sm ${
                      isDark ? 'text-red-300/90' : 'text-red-700/90'
                    }`}
                  >
                    Deleting this session will permanently remove:
                  </p>

                  <ul
                    className={`mt-3 space-y-1 text-sm ${
                      isDark ? 'text-red-300/85' : 'text-red-700/85'
                    }`}
                  >
                    <li>• All messages and conversation history</li>
                    <li>• All participants</li>
                    <li>• All agents and their containers</li>
                  </ul>
                </div>
              </div>
            </div>

            {/* Confirmation Input */}
            <div className="mb-6">
              <label className={`block text-body mb-2 ${
                isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'
              }`}>
                Type <span className={`font-mono font-medium ${isDark ? 'text-content-inverse' : 'text-content'}`}>"DELETE"</span> to confirm:
              </label>
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="DELETE"
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
