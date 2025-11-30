import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import EmojiPicker from '../EmojiPicker'
import AgentGalleryCard from '../agents/AgentGalleryCard'
import { apiClient } from '../../services/ApiClient'
import { useThemeStore } from '../../store/themeStore'
import type { AgentType } from '../../lib/api-types'

interface DeployAgentModalProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (name: string, icon?: string, planId?: string, agentType?: string) => Promise<void>
}

type Step = 'gallery' | 'configure'

export default function DeployAgentModal({
  isOpen,
  onClose,
  onSubmit,
}: DeployAgentModalProps) {
  const [step, setStep] = useState<Step>('gallery')
  const [selectedType, setSelectedType] = useState<AgentType | null>(null)
  const [name, setName] = useState('')
  const [icon, setIcon] = useState('🤖')
  const [planId, setPlanId] = useState('')
  const [agentTypes, setAgentTypes] = useState<AgentType[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isLoadingTypes, setIsLoadingTypes] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { resolvedTheme } = useThemeStore()
  const isDark = resolvedTheme === 'dark'

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setStep('gallery')
      setSelectedType(null)
      setName('')
      setIcon('🤖')
      setPlanId('')
      setError(null)

      // Fetch agent types
      setIsLoadingTypes(true)
      apiClient.getAgentTypes()
        .then((types) => {
          setAgentTypes(types)
        })
        .catch((err) => {
          console.error('Failed to fetch agent types:', err)
          // Set default agent types if API fails
          setAgentTypes([
            {
              id: 'echo-agent',
              slug: 'echo-agent',
              name: 'Echo Agent',
              description: 'Simple test agent that echoes user input',
              icon: '🔊',
              version: '1.0.0',
              isBuiltIn: true,
              capabilities: ['voice', 'text']
            }
          ])
        })
        .finally(() => setIsLoadingTypes(false))
    }
  }, [isOpen])

  // Update icon when agent type is selected
  useEffect(() => {
    if (selectedType?.icon) {
      setIcon(selectedType.icon)
    }
  }, [selectedType])

  const handleSelectType = (type: AgentType) => {
    setSelectedType(type)
  }

  const handleContinue = () => {
    if (selectedType) {
      setStep('configure')
    }
  }

  const handleBack = () => {
    setStep('gallery')
    setError(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!name.trim()) {
      setError('Agent name is required')
      return
    }

    if (!selectedType) {
      setError('Please select an agent type')
      return
    }

    setIsSubmitting(true)
    setError(null)

    try {
      await onSubmit(name.trim(), icon, planId.trim() || undefined, selectedType.slug)
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
              backdrop-blur-xl rounded-[20px] w-full max-w-2xl overflow-hidden
              ${isDark
                ? 'bg-zinc-800 border border-zinc-700 shadow-[0_8px_40px_rgba(0,0,0,0.5)]'
                : 'bg-white border border-neutral-200 shadow-[0_1px_40px_rgba(0,0,0,0.12)]'
              }
            `}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className={`px-6 pt-6 pb-4 border-b ${isDark ? 'border-zinc-700' : 'border-neutral-200'}`}>
              <div className="relative">
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

                {/* Step indicator */}
                <div className="flex items-center gap-3 mb-2">
                  <div className={`
                    w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium
                    ${step === 'gallery'
                      ? isDark ? 'bg-primary-500 text-white' : 'bg-primary-500 text-white'
                      : isDark ? 'bg-zinc-600 text-zinc-300' : 'bg-neutral-200 text-neutral-600'
                    }
                  `}>
                    1
                  </div>
                  <div className={`w-8 h-0.5 ${isDark ? 'bg-zinc-600' : 'bg-neutral-200'}`} />
                  <div className={`
                    w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium
                    ${step === 'configure'
                      ? isDark ? 'bg-primary-500 text-white' : 'bg-primary-500 text-white'
                      : isDark ? 'bg-zinc-600 text-zinc-300' : 'bg-neutral-200 text-neutral-600'
                    }
                  `}>
                    2
                  </div>
                </div>

                <h2 className={`text-2xl font-light tracking-wide ${isDark ? 'text-zinc-100' : 'text-neutral-900'}`}>
                  {step === 'gallery' ? 'Choose an Agent' : 'Configure Agent'}
                </h2>
                <p className={`text-sm font-light mt-1 ${isDark ? 'text-zinc-400' : 'text-neutral-500'}`}>
                  {step === 'gallery'
                    ? 'Select an agent type to deploy to this session'
                    : `Configure your ${selectedType?.name || 'agent'}`
                  }
                </p>
              </div>
            </div>

            {/* Content */}
            <AnimatePresence mode="wait">
              {step === 'gallery' ? (
                <motion.div
                  key="gallery"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.2 }}
                  className="p-6"
                >
                  {isLoadingTypes ? (
                    <div className={`h-48 flex items-center justify-center text-sm ${isDark ? 'text-zinc-500' : 'text-neutral-400'}`}>
                      <div className="flex items-center gap-3">
                        <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                        Loading agent types...
                      </div>
                    </div>
                  ) : agentTypes.length === 0 ? (
                    <div className={`h-48 flex items-center justify-center text-sm ${isDark ? 'text-zinc-500' : 'text-neutral-400'}`}>
                      No agent types available
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-3 max-h-[400px] overflow-y-auto pr-2">
                      {agentTypes.map((type) => (
                        <AgentGalleryCard
                          key={type.id}
                          agentType={type}
                          isSelected={selectedType?.id === type.id}
                          onClick={() => handleSelectType(type)}
                        />
                      ))}
                      {/* Upload custom agent placeholder */}
                      <button
                        type="button"
                        disabled
                        className={`
                          relative w-full h-[160px] p-3 rounded-xl text-left transition-all duration-200
                          border-2 border-dashed cursor-not-allowed opacity-60
                          ${isDark
                            ? 'border-zinc-600 bg-zinc-800/30'
                            : 'border-neutral-300 bg-neutral-50/50'
                          }
                        `}
                      >
                        {/* Coming soon badge */}
                        <div className={`
                          absolute top-2 right-2 px-1.5 py-0.5 rounded text-[9px] font-medium uppercase tracking-wide
                          ${isDark ? 'bg-zinc-700 text-zinc-400' : 'bg-neutral-200 text-neutral-500'}
                        `}>
                          Coming Soon
                        </div>

                        {/* Upload icon */}
                        <div
                          className={`
                            w-10 h-10 rounded-lg flex items-center justify-center mb-2
                            ${isDark ? 'bg-zinc-700/50' : 'bg-neutral-100'}
                          `}
                        >
                          <svg
                            className={`w-5 h-5 ${isDark ? 'text-zinc-500' : 'text-neutral-400'}`}
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.5"
                          >
                            <path d="M12 16V4m0 0l-4 4m4-4l4 4" strokeLinecap="round" strokeLinejoin="round" />
                            <path d="M3 20h18" strokeLinecap="round" />
                          </svg>
                        </div>

                        {/* Title */}
                        <h3 className={`text-sm font-medium mb-0.5 ${isDark ? 'text-zinc-400' : 'text-neutral-500'}`}>
                          Upload Your Agent
                        </h3>

                        {/* Description */}
                        <p className={`text-xs font-light leading-relaxed ${isDark ? 'text-zinc-500' : 'text-neutral-400'}`}>
                          Deploy custom agents using the STELLA Agent SDK
                        </p>
                      </button>
                    </div>
                  )}
                </motion.div>
              ) : (
                <motion.div
                  key="configure"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ duration: 0.2 }}
                  className="p-6"
                >
                  <form onSubmit={handleSubmit} className="space-y-4">
                    {/* Selected agent summary */}
                    {selectedType && (
                      <div className={`
                        flex items-center gap-3 p-3 rounded-xl
                        ${isDark ? 'bg-zinc-700/50' : 'bg-neutral-50'}
                      `}>
                        <div className={`
                          w-10 h-10 rounded-lg flex items-center justify-center text-xl
                          ${isDark ? 'bg-zinc-600' : 'bg-white border border-neutral-200'}
                        `}>
                          {selectedType.icon || '🤖'}
                        </div>
                        <div>
                          <div className={`text-sm font-medium ${isDark ? 'text-zinc-100' : 'text-neutral-900'}`}>
                            {selectedType.name}
                          </div>
                          <div className={`text-xs ${isDark ? 'text-zinc-400' : 'text-neutral-500'}`}>
                            {selectedType.description}
                          </div>
                        </div>
                      </div>
                    )}

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
                          autoFocus
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
                        placeholder="e.g., grace_smalltalk"
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
                        className={`p-3 rounded-lg text-xs font-light ${isDark
                            ? 'bg-red-500/10 border border-red-500/20 text-red-400'
                            : 'bg-red-50/80 border border-red-200/60 text-red-600'
                          }`}
                      >
                        {error}
                      </motion.div>
                    )}
                  </form>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Footer */}
            <div className={`px-6 py-4 border-t ${isDark ? 'border-zinc-700' : 'border-neutral-200'}`}>
              <div className="flex gap-3">
                {step === 'gallery' ? (
                  <>
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
                      type="button"
                      onClick={handleContinue}
                      disabled={!selectedType}
                      className={`
                        flex-1 py-2.5 px-4 rounded-xl text-sm font-light tracking-wider
                        transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed
                        ${isDark
                          ? 'bg-primary-500 text-white hover:bg-primary-400 hover:shadow-primary border border-primary-400/30'
                          : 'bg-neutral-900 text-white hover:bg-neutral-800 shadow-[0_1px_20px_rgba(0,0,0,0.12)]'
                        }
                      `}
                    >
                      Continue
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={handleBack}
                      disabled={isSubmitting}
                      className={`
                        py-2.5 px-4 rounded-xl text-sm font-light tracking-wider
                        transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed
                        ${isDark
                          ? 'bg-white/5 text-zinc-300 hover:bg-white/10 border border-white/10'
                          : 'bg-neutral-100/80 text-neutral-600 hover:bg-neutral-200/80'
                        }
                      `}
                    >
                      <span className="flex items-center gap-2">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <path d="M19 12H5M12 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        Back
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={handleSubmit}
                      disabled={isSubmitting || !name.trim()}
                      className={`
                        flex-1 py-2.5 px-4 rounded-xl text-sm font-light tracking-wider
                        transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed
                        ${isDark
                          ? 'bg-primary-500 text-white hover:bg-primary-400 hover:shadow-primary border border-primary-400/30'
                          : 'bg-neutral-900 text-white hover:bg-neutral-800 shadow-[0_1px_20px_rgba(0,0,0,0.12)]'
                        }
                      `}
                    >
                      {isSubmitting ? 'Deploying...' : 'Deploy Agent'}
                    </button>
                  </>
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
