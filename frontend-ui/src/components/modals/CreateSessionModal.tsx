import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useThemeStore } from '../../store/themeStore'

interface CreateSessionModalProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (name?: string) => Promise<void>
}

export default function CreateSessionModal({
  isOpen,
  onClose,
  onSubmit,
}: CreateSessionModalProps) {
  const [name, setName] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { resolvedTheme } = useThemeStore()
  const isDark = resolvedTheme === 'dark'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    setIsSubmitting(true)
    setError(null)

    try {
      await onSubmit(name.trim() || undefined)
      setName('')
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create session')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleClose = () => {
    if (!isSubmitting) {
      setName('')
      setError(null)
      onClose()
    }
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
          onClick={handleClose}
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
            <div className="mb-6 relative">
              <button
                onClick={handleClose}
                disabled={isSubmitting}
                className={`absolute -top-1 -right-1 p-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  isDark
                    ? 'text-content-inverse-tertiary hover:text-content-inverse hover:bg-surface-dark-tertiary'
                    : 'text-content-tertiary hover:text-content hover:bg-surface-secondary'
                }`}
                title="Close"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
              <h2 className={`text-heading-lg ${isDark ? 'text-content-inverse' : 'text-content'}`}>
                Create Session
              </h2>
              <p className={`text-body mt-1 ${isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'}`}>
                Start a new conversation session
              </p>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className={`block text-label uppercase mb-2 ${
                  isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'
                }`}>
                  Session Name <span className={isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'}>(Optional)</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                  maxLength={255}
                  className="input-field"
                  placeholder="e.g., Morning Consultation"
                />
                <div className={`mt-2 text-caption text-right ${
                  isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'
                }`}>
                  {name.length}/255
                </div>
              </div>

              {/* Error message */}
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`p-3 rounded-lg text-body-sm ${
                    isDark
                      ? 'bg-red-500/10 border border-red-500/20 text-red-400'
                      : 'bg-red-50 border border-red-200 text-red-700'
                  }`}
                >
                  {error}
                </motion.div>
              )}

              {/* Actions */}
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleClose}
                  disabled={isSubmitting}
                  className="btn-secondary flex-1"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="btn-primary flex-1"
                >
                  {isSubmitting ? 'Creating...' : 'Create Session'}
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
