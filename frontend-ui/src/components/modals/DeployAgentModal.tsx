import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import EmojiPicker from '../EmojiPicker'
import { apiClient } from '../../services/ApiClient'
import { useThemeStore } from '../../store/themeStore'
import type { AgentType } from '../../lib/api-types'

interface DeployAgentModalProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (name: string, icon?: string, planId?: string, agentType?: string) => Promise<void>
}

export default function DeployAgentModal({
  isOpen,
  onClose,
  onSubmit,
}: DeployAgentModalProps) {
  const [name, setName] = useState('')
  const [icon, setIcon] = useState('🤖')
  const [planId, setPlanId] = useState('')
  const [agentType, setAgentType] = useState('stella-agent')
  const [agentTypes, setAgentTypes] = useState<AgentType[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isLoadingTypes, setIsLoadingTypes] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { resolvedTheme } = useThemeStore()
  const isDark = resolvedTheme === 'dark'

  // Fetch agent types when modal opens
  useEffect(() => {
    if (isOpen) {
      setIsLoadingTypes(true)
      apiClient.getAgentTypes()
        .then((types) => {
          setAgentTypes(types)
          if (types.length > 0 && !types.find(t => t.id === agentType)) {
            setAgentType(types[0].id)
          }
        })
        .catch((err) => {
          console.error('Failed to fetch agent types:', err)
          // Set default agent types if API fails
          setAgentTypes([
            { id: 'stella-agent', name: 'STELLA Agent', description: 'Full-featured conversational AI' }
          ])
        })
        .finally(() => setIsLoadingTypes(false))
    }
  }, [isOpen])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!name.trim()) {
      setError('Agent name is required')
      return
    }

    setIsSubmitting(true)
    setError(null)

    try {
      await onSubmit(name.trim(), icon, planId.trim() || undefined, agentType)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to deploy agent')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleClose = () => {
    if (!isSubmitting) {
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
            className={`
              backdrop-blur-xl rounded-[20px] w-full max-w-md p-6
              ${isDark
                ? 'bg-zinc-800 border border-zinc-700 shadow-[0_8px_40px_rgba(0,0,0,0.5)]'
                : 'bg-white border border-neutral-200 shadow-[0_1px_40px_rgba(0,0,0,0.12)]'
              }
            `}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="mb-6 relative">
              <button
                onClick={handleClose}
                disabled={isSubmitting}
                className={`
                  absolute -top-1 -right-1 p-2 rounded-lg transition-all duration-200
                  disabled:opacity-60 disabled:cursor-not-allowed
                  ${isDark
                    ? 'text-zinc-400 hover:text-zinc-200 hover:bg-white/10'
                    : 'text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100'
                  }
                `}
                title="Close"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
              <h2 className={`text-2xl font-light tracking-wide ${isDark ? 'text-zinc-100' : 'text-neutral-900'}`}>
                Deploy Agent
              </h2>
              <p className={`text-sm font-light mt-1 ${isDark ? 'text-zinc-400' : 'text-neutral-500'}`}>
                Start an AI agent to join this session
              </p>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Agent Type Selection */}
              <div>
                <label className={`block text-xs font-light tracking-wider uppercase mb-2 ${isDark ? 'text-zinc-400' : 'text-neutral-600'}`}>
                  Agent Type
                </label>
                {isLoadingTypes ? (
                  <div className={`h-[72px] flex items-center justify-center text-sm ${isDark ? 'text-zinc-500' : 'text-neutral-400'}`}>
                    Loading agent types...
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    {agentTypes.map((type) => (
                      <button
                        key={type.id}
                        type="button"
                        onClick={() => setAgentType(type.id)}
                        className={`
                          p-3 rounded-xl text-left transition-all duration-200
                          ${agentType === type.id
                            ? isDark
                              ? 'bg-white/10 text-white ring-2 ring-white/30'
                              : 'bg-neutral-900 text-white ring-2 ring-neutral-900'
                            : isDark
                              ? 'bg-zinc-800 border border-zinc-700 hover:bg-zinc-700'
                              : 'bg-neutral-50/50 border border-neutral-200/60 hover:bg-neutral-100/80'
                          }
                        `}
                      >
                        <div className={`text-sm font-medium ${
                          agentType === type.id
                            ? 'text-white'
                            : isDark ? 'text-zinc-100' : 'text-neutral-900'
                        }`}>
                          {type.name}
                        </div>
                        <div className={`text-xs mt-0.5 ${
                          agentType === type.id
                            ? isDark ? 'text-zinc-300' : 'text-neutral-300'
                            : isDark ? 'text-zinc-400' : 'text-neutral-500'
                        }`}>
                          {type.description}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Icon & Name Row */}
              <div className="flex gap-3">
                {/* Icon Picker */}
                <div>
                  <label className={`block text-xs font-light tracking-wider uppercase mb-2 ${isDark ? 'text-zinc-400' : 'text-neutral-600'}`}>
                    Icon
                  </label>
                  <EmojiPicker value={icon} onChange={setIcon} />
                </div>

                {/* Name */}
                <div className="flex-1">
                  <label className={`block text-xs font-light tracking-wider uppercase mb-2 ${isDark ? 'text-zinc-400' : 'text-neutral-600'}`}>
                    Agent Name
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    maxLength={255}
                    className={`
                      w-full px-4 py-3 rounded-xl text-sm font-light
                      focus:outline-none transition-all duration-200
                      ${isDark
                        ? 'bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-600'
                        : 'bg-neutral-50/50 border border-neutral-200/60 text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-400/60 focus:bg-white'
                      }
                    `}
                    placeholder="e.g., Memory Coach"
                  />
                </div>
              </div>

              {/* Plan ID */}
              <div>
                <label className={`block text-xs font-light tracking-wider uppercase mb-2 ${isDark ? 'text-zinc-400' : 'text-neutral-600'}`}>
                  Plan ID <span className={isDark ? 'text-zinc-500' : 'text-neutral-400'}>(Optional)</span>
                </label>
                <input
                  type="text"
                  value={planId}
                  onChange={(e) => setPlanId(e.target.value)}
                  maxLength={255}
                  className={`
                    w-full px-4 py-3 rounded-xl text-sm font-light
                    focus:outline-none transition-all duration-200
                    ${isDark
                      ? 'bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-600'
                      : 'bg-neutral-50/50 border border-neutral-200/60 text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-400/60 focus:bg-white'
                    }
                  `}
                  placeholder="e.g., stella_smalltalk"
                />
                <div className={`mt-2 text-xs font-light ${isDark ? 'text-zinc-500' : 'text-neutral-500'}`}>
                  Leave empty for default agent configuration
                </div>
              </div>

              {/* Error message */}
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`p-3 rounded-lg text-xs font-light ${
                    isDark
                      ? 'bg-red-500/10 border border-red-500/20 text-red-400'
                      : 'bg-red-50/80 border border-red-200/60 text-red-600'
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
                  className={`
                    flex-1 py-2.5 px-4 rounded-xl text-sm font-light tracking-wider
                    transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed
                    ${isDark
                      ? 'bg-white/5 text-zinc-300 hover:bg-white/10 border border-white/10'
                      : 'bg-neutral-100/80 text-neutral-600 hover:bg-neutral-200/80'
                    }
                  `}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || !name.trim()}
                  className={`
                    flex-1 py-2.5 px-4 rounded-xl text-sm font-light tracking-wider
                    transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed
                    ${isDark
                      ? 'bg-white/10 text-white hover:bg-white/20 border border-white/10'
                      : 'bg-neutral-900 text-white hover:bg-neutral-800 shadow-[0_1px_20px_rgba(0,0,0,0.12)]'
                    }
                  `}
                >
                  {isSubmitting ? 'Deploying...' : 'Deploy Agent'}
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
