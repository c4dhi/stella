import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

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
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/20 backdrop-blur-sm"
          onClick={handleClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="
              bg-white/95 backdrop-blur-xl border border-neutral-200/60
              rounded-[20px] shadow-[0_1px_40px_rgba(0,0,0,0.12)]
              w-full max-w-md p-6
            "
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="mb-6 relative">
              <button
                onClick={handleClose}
                disabled={isSubmitting}
                className="
                  absolute -top-1 -right-1
                  p-2 rounded-lg
                  text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100
                  transition-all duration-200
                  disabled:opacity-60 disabled:cursor-not-allowed
                "
                title="Close"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
              <h2 className="text-2xl font-light text-neutral-900 tracking-wide">
                Create Session
              </h2>
              <p className="text-sm text-neutral-500 font-light mt-1">
                Start a new conversation session
              </p>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-light text-neutral-600 tracking-wider uppercase mb-2">
                  Session Name <span className="text-neutral-400">(Optional)</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                  maxLength={255}
                  className="
                    w-full px-4 py-3 rounded-xl
                    bg-neutral-50/50 border border-neutral-200/60
                    text-neutral-900 text-sm font-light
                    focus:outline-none focus:border-neutral-400/60 focus:bg-white
                    transition-all duration-200
                    placeholder:text-neutral-400
                  "
                  placeholder="e.g., Morning Consultation"
                />
                <div className="mt-2 text-xs text-neutral-500 text-right">
                  {name.length}/255
                </div>
              </div>

              {/* Error message */}
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="p-3 rounded-lg bg-red-50/80 border border-red-200/60 text-red-600 text-xs font-light"
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
                  className="
                    flex-1 py-2.5 px-4 rounded-xl
                    bg-neutral-100/80 text-neutral-600 text-sm font-light tracking-wider
                    hover:bg-neutral-200/80 disabled:opacity-60 disabled:cursor-not-allowed
                    transition-all duration-200
                  "
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="
                    flex-1 py-2.5 px-4 rounded-xl
                    bg-neutral-900 text-white text-sm font-light tracking-wider
                    hover:bg-neutral-800
                    disabled:opacity-60 disabled:cursor-not-allowed
                    shadow-[0_1px_20px_rgba(0,0,0,0.12)]
                    transition-all duration-200
                  "
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
