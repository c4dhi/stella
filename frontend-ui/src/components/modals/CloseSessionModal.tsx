import { motion, AnimatePresence } from 'framer-motion'
import { useThemeStore } from '../../store/themeStore'

interface CloseSessionModalProps {
  isOpen: boolean
  sessionName: string
  onConfirm: () => void
  onCancel: () => void
}

export default function CloseSessionModal({
  isOpen,
  sessionName,
  onConfirm,
  onCancel,
}: CloseSessionModalProps) {
  const { resolvedTheme } = useThemeStore()
  const isDark = resolvedTheme === 'dark'

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
          onClick={onCancel}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className={`card-elevated w-full max-w-md p-6 ${
              isDark ? 'bg-surface-dark-secondary' : ''
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="mb-4">
              <h2 className={`text-heading-lg ${isDark ? 'text-content-inverse' : 'text-content'}`}>
                Close Session
              </h2>
            </div>

            {/* Message */}
            <div className={`mb-6 text-body leading-relaxed ${
              isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'
            }`}>
              <p className="mb-3">
                Are you sure you want to close <span className={`font-mono font-medium ${
                  isDark ? 'text-content-inverse' : 'text-content'
                }`}>{sessionName}</span>?
              </p>
              <p>
                This will stop all running agents and mark the session as closed.
                Conversation history will be preserved.
              </p>
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={onCancel}
                className="btn-secondary flex-1"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onConfirm}
                className="btn-primary flex-1"
              >
                Close Session
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
