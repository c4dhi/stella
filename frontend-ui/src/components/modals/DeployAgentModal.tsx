import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import EmojiPicker from '../EmojiPicker'
import { apiClient } from '../../services/ApiClient'
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
  const [agentType, setAgentType] = useState('grace-agent')
  const [agentTypes, setAgentTypes] = useState<AgentType[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isLoadingTypes, setIsLoadingTypes] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
            { id: 'grace-agent', name: 'Grace Agent', description: 'Full-featured conversational AI' }
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
                Deploy Agent
              </h2>
              <p className="text-sm text-neutral-500 font-light mt-1">
                Start an AI agent to join this session
              </p>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Agent Type Selection */}
              <div>
                <label className="block text-xs font-light text-neutral-600 tracking-wider uppercase mb-2">
                  Agent Type
                </label>
                {isLoadingTypes ? (
                  <div className="h-[72px] flex items-center justify-center text-neutral-400 text-sm">
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
                            ? 'bg-neutral-900 text-white ring-2 ring-neutral-900'
                            : 'bg-neutral-50/50 border border-neutral-200/60 hover:bg-neutral-100/80'
                          }
                        `}
                      >
                        <div className={`text-sm font-medium ${agentType === type.id ? 'text-white' : 'text-neutral-900'}`}>
                          {type.name}
                        </div>
                        <div className={`text-xs mt-0.5 ${agentType === type.id ? 'text-neutral-300' : 'text-neutral-500'}`}>
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
                  <label className="block text-xs font-light text-neutral-600 tracking-wider uppercase mb-2">
                    Icon
                  </label>
                  <EmojiPicker value={icon} onChange={setIcon} />
                </div>

                {/* Name */}
                <div className="flex-1">
                  <label className="block text-xs font-light text-neutral-600 tracking-wider uppercase mb-2">
                    Agent Name
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    maxLength={255}
                    className="
                      w-full px-4 py-3 rounded-xl
                      bg-neutral-50/50 border border-neutral-200/60
                      text-neutral-900 text-sm font-light
                      focus:outline-none focus:border-neutral-400/60 focus:bg-white
                      transition-all duration-200
                      placeholder:text-neutral-400
                    "
                    placeholder="e.g., Memory Coach"
                  />
                </div>
              </div>

              {/* Plan ID */}
              <div>
                <label className="block text-xs font-light text-neutral-600 tracking-wider uppercase mb-2">
                  Plan ID <span className="text-neutral-400">(Optional)</span>
                </label>
                <input
                  type="text"
                  value={planId}
                  onChange={(e) => setPlanId(e.target.value)}
                  maxLength={255}
                  className="
                    w-full px-4 py-3 rounded-xl
                    bg-neutral-50/50 border border-neutral-200/60
                    text-neutral-900 text-sm font-light
                    focus:outline-none focus:border-neutral-400/60 focus:bg-white
                    transition-all duration-200
                    placeholder:text-neutral-400
                  "
                  placeholder="e.g., grace_smalltalk"
                />
                <div className="mt-2 text-xs text-neutral-500 font-light">
                  Leave empty for default agent configuration
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
                  disabled={isSubmitting || !name.trim()}
                  className="
                    flex-1 py-2.5 px-4 rounded-xl
                    bg-neutral-900 text-white text-sm font-light tracking-wider
                    hover:bg-neutral-800
                    disabled:opacity-60 disabled:cursor-not-allowed
                    shadow-[0_1px_20px_rgba(0,0,0,0.12)]
                    transition-all duration-200
                  "
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
