import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useThemeStore } from '../../store/themeStore'

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
  const { resolvedTheme } = useThemeStore()
  const isDark = resolvedTheme === 'dark'

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
            className={`
              backdrop-blur-xl rounded-[20px] w-full max-w-md p-6
              ${isDark
                ? 'bg-zinc-800 border border-zinc-700 shadow-[0_8px_40px_rgba(0,0,0,0.5)]'
                : 'bg-white border border-neutral-200 shadow-[0_1px_40px_rgba(0,0,0,0.12)]'
              }
            `}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className={`text-2xl font-light mb-2 ${isDark ? 'text-zinc-100' : 'text-neutral-900'}`}>
              Register Participant
            </h2>
            <p className={`text-sm font-light mb-6 ${isDark ? 'text-zinc-400' : 'text-neutral-500'}`}>
              Enter a name for the new participant
            </p>

            <form onSubmit={handleSubmit}>
              <div className="mb-4">
                <label
                  htmlFor="participant-name"
                  className={`block text-xs font-light tracking-wider uppercase mb-2 ${isDark ? 'text-zinc-400' : 'text-neutral-600'}`}
                >
                  Participant Name
                </label>
                <input
                  id="participant-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Enter participant name..."
                  className={`
                    w-full px-4 py-2.5 rounded-xl text-sm font-light
                    focus:outline-none transition-all duration-200
                    ${isDark
                      ? 'bg-zinc-900 border border-zinc-600 text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-500 focus:bg-zinc-900'
                      : 'bg-neutral-50/50 border border-neutral-200/60 text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-400/60 focus:bg-white'
                    }
                  `}
                  autoFocus
                  disabled={isSubmitting}
                />
              </div>

              {/* Share via link toggle - Coming Soon */}
              <div className="mb-6">
                <label className={`flex items-center justify-between cursor-not-allowed opacity-50`}>
                  <div className="flex items-center gap-2">
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      className={isDark ? 'text-zinc-400' : 'text-neutral-500'}
                    >
                      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                    </svg>
                    <span className={`text-sm font-light ${isDark ? 'text-zinc-300' : 'text-neutral-700'}`}>
                      Share via link
                    </span>
                    <span className={`text-[10px] font-medium tracking-wider uppercase px-1.5 py-0.5 rounded ${isDark ? 'bg-zinc-700 text-zinc-400' : 'bg-neutral-200 text-neutral-500'}`}>
                      Coming Soon
                    </span>
                  </div>
                  <div className={`
                    w-10 h-6 rounded-full p-0.5 transition-colors
                    ${isDark ? 'bg-zinc-700' : 'bg-neutral-300'}
                  `}>
                    <div className={`
                      w-5 h-5 rounded-full transition-transform
                      ${isDark ? 'bg-zinc-500' : 'bg-neutral-400'}
                    `} />
                  </div>
                </label>
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={handleClose}
                  disabled={isSubmitting}
                  className={`
                    flex-1 py-2.5 px-4 rounded-xl text-sm font-light tracking-wider
                    transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed
                    ${isDark
                      ? 'bg-white/5 text-zinc-300 hover:bg-white/10 border border-white/10'
                      : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                    }
                  `}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!name.trim() || isSubmitting}
                  className={`
                    flex-1 py-2.5 px-4 rounded-xl text-sm font-light tracking-wider
                    transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed
                    ${isDark
                      ? 'bg-primary-500 text-white hover:bg-primary-400 hover:shadow-primary border border-primary-400/30'
                      : 'bg-neutral-900 text-white hover:bg-neutral-800 shadow-[0_1px_20px_rgba(0,0,0,0.12)]'
                    }
                  `}
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
