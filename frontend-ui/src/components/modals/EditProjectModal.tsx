import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

interface EditProjectModalProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (name: string) => Promise<void>
  currentName: string
  projectId: string
}

export default function EditProjectModal({
  isOpen,
  onClose,
  onSubmit,
  currentName,
}: EditProjectModalProps) {
  const [name, setName] = useState(currentName)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Update local state when currentName prop changes
  useEffect(() => {
    setName(currentName)
  }, [currentName])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!name.trim()) {
      setError('Project name is required')
      return
    }

    if (name === currentName) {
      setError('Please enter a different name')
      return
    }

    setLoading(true)
    setError(null)

    try {
      await onSubmit(name)
      onClose()
    } catch (err: any) {
      setError(err.message || 'Failed to update project')
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    if (!loading) {
      setName(currentName) // Reset to original name
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
                disabled={loading}
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
                Edit Project
              </h2>
              <p className="text-sm text-neutral-500 font-light mt-1">
                Update the name of your project
              </p>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-light text-neutral-600 tracking-wider uppercase mb-2">
                  Project Name
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
                  placeholder="Enter project name"
                  disabled={loading}
                />
                <div className="mt-1 text-xs text-neutral-400 font-light">
                  {name.length}/255 characters
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
                  disabled={loading}
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
                  disabled={loading || !name.trim()}
                  className="
                    flex-1 py-2.5 px-4 rounded-xl
                    bg-neutral-900 text-white text-sm font-light tracking-wider
                    hover:bg-neutral-800
                    disabled:opacity-60 disabled:cursor-not-allowed
                    shadow-[0_1px_20px_rgba(0,0,0,0.12)]
                    transition-all duration-200
                  "
                >
                  {loading ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
