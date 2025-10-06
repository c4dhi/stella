import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

interface RegisterParticipantModalProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (name: string) => Promise<void>
}

export default function RegisterParticipantModal({
  isOpen,
  onClose,
  onSubmit,
}: RegisterParticipantModalProps) {
  const [name, setName] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return

    try {
      setIsSubmitting(true)
      await onSubmit(name.trim())
      setName('')
      onClose()
    } catch (error) {
      console.error('Failed to register participant:', error)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleClose = () => {
    if (!isSubmitting) {
      setName('')
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
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/20 backdrop-blur-sm"
          onClick={handleClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="
              bg-white/95 backdrop-blur-xl border border-neutral-200/60
              rounded-[20px] shadow-[0_1px_40px_rgba(0,0,0,0.12)]
              w-full max-w-md p-6
            "
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-2xl font-light text-neutral-900 mb-2">
              Register Participant
            </h2>
            <p className="text-sm text-neutral-500 font-light mb-6">
              Enter a name for the new participant
            </p>

            <form onSubmit={handleSubmit}>
              <div className="mb-6">
                <label
                  htmlFor="participant-name"
                  className="block text-xs text-neutral-600 font-light tracking-wider uppercase mb-2"
                >
                  Participant Name
                </label>
                <input
                  id="participant-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Enter participant name..."
                  className="
                    w-full px-4 py-2.5 rounded-xl
                    bg-neutral-50/50 border border-neutral-200/60
                    text-neutral-900 text-sm font-light
                    placeholder:text-neutral-400
                    focus:outline-none focus:border-neutral-400/60 focus:bg-white
                    transition-all duration-200
                  "
                  autoFocus
                  disabled={isSubmitting}
                />
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={handleClose}
                  disabled={isSubmitting}
                  className="
                    flex-1 py-2.5 px-4 rounded-xl
                    bg-neutral-100 text-neutral-600 text-sm font-light tracking-wider
                    hover:bg-neutral-200
                    transition-all duration-200
                    disabled:opacity-50 disabled:cursor-not-allowed
                  "
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!name.trim() || isSubmitting}
                  className="
                    flex-1 py-2.5 px-4 rounded-xl
                    bg-neutral-900 text-white text-sm font-light tracking-wider
                    hover:bg-neutral-800 shadow-[0_1px_20px_rgba(0,0,0,0.12)]
                    transition-all duration-200
                    disabled:opacity-50 disabled:cursor-not-allowed
                  "
                >
                  {isSubmitting ? 'Registering...' : 'Register'}
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
