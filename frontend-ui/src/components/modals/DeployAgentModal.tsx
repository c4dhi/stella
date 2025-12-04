import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import EmojiPicker from '../EmojiPicker'
import AgentGalleryCard from '../agents/AgentGalleryCard'
import { AgentUploadCard, MyAgentsSection } from '../agents'
import { apiClient } from '../../services/ApiClient'
import { useThemeStore } from '../../store/themeStore'
import type { AgentType, CustomAgentType, AgentUploadResponse } from '../../lib/api-types'

interface DeployAgentModalProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (name: string, icon?: string, config?: Record<string, unknown>, agentType?: string) => Promise<void>
}

type Step = 'gallery' | 'upload' | 'configure' | 'advanced'
type GalleryTab = 'builtin' | 'myagents'

export default function DeployAgentModal({
  isOpen,
  onClose,
  onSubmit,
}: DeployAgentModalProps) {
  const [step, setStep] = useState<Step>('gallery')
  const [galleryTab, setGalleryTab] = useState<GalleryTab>('builtin')
  const [selectedType, setSelectedType] = useState<AgentType | null>(null)
  const [name, setName] = useState('')
  const [icon, setIcon] = useState('🤖')
  const [configJson, setConfigJson] = useState('{}')
  const [configError, setConfigError] = useState<string | null>(null)
  const [agentTypes, setAgentTypes] = useState<AgentType[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isLoadingTypes, setIsLoadingTypes] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [uploadRefreshTrigger, setUploadRefreshTrigger] = useState(0)
  const { resolvedTheme } = useThemeStore()
  const isDark = resolvedTheme === 'dark'

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setStep('gallery')
      setGalleryTab('builtin')
      setSelectedType(null)
      setName('')
      setIcon('🤖')
      setConfigJson('{}')
      setConfigError(null)
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
              capabilities: ['voice', 'text'],
              defaultConfig: {}
            }
          ])
        })
        .finally(() => setIsLoadingTypes(false))
    }
  }, [isOpen])

  // Update icon and config when agent type is selected
  useEffect(() => {
    if (selectedType) {
      if (selectedType.icon) {
        setIcon(selectedType.icon)
      }
      // Pre-fill config with agent type's defaultConfig
      const defaultConfig = selectedType.defaultConfig || {}
      setConfigJson(JSON.stringify(defaultConfig, null, 2))
      setConfigError(null)
    }
  }, [selectedType])

  const handleSelectType = (type: AgentType) => {
    setSelectedType(type)
  }

  const handleSelectCustomAgent = (agent: CustomAgentType) => {
    // Convert CustomAgentType to AgentType for selection
    setSelectedType(agent as AgentType)
  }

  const handleUploadComplete = (result: AgentUploadResponse) => {
    // Refresh the my-agents list and switch to that tab
    setUploadRefreshTrigger(prev => prev + 1)
    setGalleryTab('myagents')
    setStep('gallery')
  }

  const handleContinue = () => {
    if (step === 'gallery' && selectedType) {
      setStep('configure')
    } else if (step === 'configure') {
      setStep('advanced')
    }
  }

  const handleBack = () => {
    if (step === 'advanced') {
      setStep('configure')
    } else if (step === 'configure') {
      setStep('gallery')
    } else if (step === 'upload') {
      setStep('gallery')
    }
    setError(null)
  }

  const validateJson = (json: string): Record<string, unknown> | null => {
    try {
      const parsed = JSON.parse(json)
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        setConfigError('Config must be a JSON object')
        return null
      }
      setConfigError(null)
      return parsed
    } catch {
      setConfigError('Invalid JSON syntax')
      return null
    }
  }

  const handleConfigChange = (value: string) => {
    setConfigJson(value)
    if (value.trim()) {
      validateJson(value)
    } else {
      setConfigError(null)
    }
  }

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault()

    if (!name.trim()) {
      setError('Agent name is required')
      return
    }

    if (!selectedType) {
      setError('Please select an agent type')
      return
    }

    // Parse and validate config
    const config = configJson.trim() ? validateJson(configJson) : {}
    if (configJson.trim() && config === null) {
      setError('Please fix the JSON configuration errors')
      return
    }

    setIsSubmitting(true)
    setError(null)

    try {
      await onSubmit(name.trim(), icon, config || undefined, selectedType.slug)
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

  const getStepNumber = (s: Step): number => {
    switch (s) {
      case 'gallery': return 1
      case 'upload': return 1  // Upload is part of step 1
      case 'configure': return 2
      case 'advanced': return 3
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

                {/* Step indicator - 3 steps now */}
                <div className="flex items-center gap-3 mb-2">
                  {[1, 2, 3].map((num, idx) => (
                    <div key={num} className="flex items-center">
                      <div className={`
                        w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium
                        ${getStepNumber(step) >= num
                          ? isDark ? 'bg-primary-500 text-white' : 'bg-primary-500 text-white'
                          : isDark ? 'bg-zinc-600 text-zinc-300' : 'bg-neutral-200 text-neutral-600'
                        }
                      `}>
                        {num}
                      </div>
                      {idx < 2 && (
                        <div className={`w-8 h-0.5 ml-3 ${isDark ? 'bg-zinc-600' : 'bg-neutral-200'}`} />
                      )}
                    </div>
                  ))}
                </div>

                <h2 className={`text-2xl font-light tracking-wide ${isDark ? 'text-zinc-100' : 'text-neutral-900'}`}>
                  {step === 'gallery' ? 'Choose an Agent' : step === 'upload' ? 'Upload Agent' : step === 'configure' ? 'Configure Agent' : 'Advanced Config'}
                </h2>
                <p className={`text-sm font-light mt-1 ${isDark ? 'text-zinc-400' : 'text-neutral-500'}`}>
                  {step === 'gallery'
                    ? 'Select an agent type to deploy to this session'
                    : step === 'upload'
                    ? 'Upload a custom agent package (.zip)'
                    : step === 'configure'
                    ? `Set a name and icon for your ${selectedType?.name || 'agent'}`
                    : 'Customize agent-specific configuration (JSON)'
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
                  {/* Tab bar */}
                  <div className={`flex gap-1 p-1 rounded-lg mb-4 ${isDark ? 'bg-zinc-700/50' : 'bg-neutral-100'}`}>
                    <button
                      onClick={() => setGalleryTab('builtin')}
                      className={`
                        flex-1 py-2 px-3 rounded-md text-sm font-medium transition-all
                        ${galleryTab === 'builtin'
                          ? isDark ? 'bg-zinc-600 text-white' : 'bg-white text-neutral-900 shadow-sm'
                          : isDark ? 'text-zinc-400 hover:text-zinc-200' : 'text-neutral-500 hover:text-neutral-700'
                        }
                      `}
                    >
                      Built-in Agents
                    </button>
                    <button
                      onClick={() => setGalleryTab('myagents')}
                      className={`
                        flex-1 py-2 px-3 rounded-md text-sm font-medium transition-all
                        ${galleryTab === 'myagents'
                          ? isDark ? 'bg-zinc-600 text-white' : 'bg-white text-neutral-900 shadow-sm'
                          : isDark ? 'text-zinc-400 hover:text-zinc-200' : 'text-neutral-500 hover:text-neutral-700'
                        }
                      `}
                    >
                      My Agents
                    </button>
                  </div>

                  {galleryTab === 'builtin' ? (
                    <>
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
                        <div className="grid grid-cols-2 gap-3 max-h-[350px] overflow-y-auto pr-2">
                          {agentTypes.map((type) => (
                            <AgentGalleryCard
                              key={type.id}
                              agentType={type}
                              isSelected={selectedType?.id === type.id}
                              onClick={() => handleSelectType(type)}
                            />
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="space-y-4">
                      {/* Upload button */}
                      <button
                        type="button"
                        onClick={() => setStep('upload')}
                        className={`
                          w-full p-4 rounded-xl text-left transition-all duration-200
                          border-2 border-dashed hover:border-solid
                          ${isDark
                            ? 'border-zinc-600 hover:border-primary-500 bg-zinc-800/30 hover:bg-zinc-700/50'
                            : 'border-neutral-300 hover:border-primary-500 bg-neutral-50/50 hover:bg-primary-50'
                          }
                        `}
                      >
                        <div className="flex items-center gap-3">
                          <div className={`
                            w-10 h-10 rounded-lg flex items-center justify-center
                            ${isDark ? 'bg-zinc-700' : 'bg-neutral-100'}
                          `}>
                            <svg
                              className={`w-5 h-5 ${isDark ? 'text-zinc-400' : 'text-neutral-500'}`}
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.5"
                            >
                              <path d="M12 16V4m0 0l-4 4m4-4l4 4" strokeLinecap="round" strokeLinejoin="round" />
                              <path d="M3 20h18" strokeLinecap="round" />
                            </svg>
                          </div>
                          <div>
                            <h3 className={`text-sm font-medium ${isDark ? 'text-zinc-200' : 'text-neutral-700'}`}>
                              Upload New Agent
                            </h3>
                            <p className={`text-xs ${isDark ? 'text-zinc-400' : 'text-neutral-500'}`}>
                              Upload a custom agent package (.zip)
                            </p>
                          </div>
                        </div>
                      </button>

                      {/* My agents list */}
                      <MyAgentsSection
                        onSelectAgent={handleSelectCustomAgent}
                        refreshTrigger={uploadRefreshTrigger}
                      />
                    </div>
                  )}
                </motion.div>
              ) : step === 'upload' ? (
                <motion.div
                  key="upload"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ duration: 0.2 }}
                  className="p-6"
                >
                  <AgentUploadCard
                    onUploadComplete={handleUploadComplete}
                    onError={(err) => setError(err)}
                  />
                </motion.div>
              ) : step === 'configure' ? (
                <motion.div
                  key="configure"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ duration: 0.2 }}
                  className="p-6"
                >
                  <form onSubmit={(e) => { e.preventDefault(); handleContinue(); }} className="space-y-4">
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
              ) : (
                <motion.div
                  key="advanced"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ duration: 0.2 }}
                  className="p-6"
                >
                  <form onSubmit={handleSubmit} className="space-y-4">
                    {/* Agent summary bar */}
                    <div className={`
                      flex items-center gap-3 p-3 rounded-xl
                      ${isDark ? 'bg-zinc-700/50' : 'bg-neutral-50'}
                    `}>
                      <div className={`
                        w-8 h-8 rounded-lg flex items-center justify-center text-lg
                        ${isDark ? 'bg-zinc-600' : 'bg-white border border-neutral-200'}
                      `}>
                        {icon}
                      </div>
                      <div className="flex-1">
                        <div className={`text-sm font-medium ${isDark ? 'text-zinc-100' : 'text-neutral-900'}`}>
                          {name || 'Unnamed Agent'}
                        </div>
                        <div className={`text-xs ${isDark ? 'text-zinc-400' : 'text-neutral-500'}`}>
                          {selectedType?.name}
                        </div>
                      </div>
                    </div>

                    {/* JSON Config Editor */}
                    <div>
                      <label className={`block text-xs font-light tracking-wider uppercase mb-2 ${isDark ? 'text-zinc-400' : 'text-neutral-600'}`}>
                        Agent Configuration <span className={isDark ? 'text-zinc-500' : 'text-neutral-400'}>(JSON)</span>
                      </label>
                      <textarea
                        value={configJson}
                        onChange={(e) => handleConfigChange(e.target.value)}
                        rows={8}
                        spellCheck={false}
                        className={`
                          w-full px-4 py-3 rounded-xl text-sm font-mono
                          focus:outline-none transition-all duration-200 resize-none
                          ${configError
                            ? isDark
                              ? 'bg-zinc-800 border-2 border-red-500/50 text-zinc-100 focus:border-red-500'
                              : 'bg-neutral-50/50 border-2 border-red-300 text-neutral-900 focus:border-red-400'
                            : isDark
                              ? 'bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-600'
                              : 'bg-neutral-50/50 border border-neutral-200/60 text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-400/60 focus:bg-white'
                          }
                        `}
                        placeholder="{}"
                      />
                      {configError ? (
                        <div className={`mt-2 text-xs font-light ${isDark ? 'text-red-400' : 'text-red-500'}`}>
                          {configError}
                        </div>
                      ) : (
                        <div className={`mt-2 text-xs font-light ${isDark ? 'text-zinc-500' : 'text-neutral-500'}`}>
                          Agent-specific configuration passed to the agent at startup
                        </div>
                      )}
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
                ) : step === 'upload' ? (
                  <button
                    type="button"
                    onClick={handleBack}
                    className={`
                      w-full py-2.5 px-4 rounded-xl text-sm font-light tracking-wider
                      transition-all duration-200
                      ${isDark
                        ? 'bg-white/5 text-zinc-300 hover:bg-white/10 border border-white/10'
                        : 'bg-neutral-100/80 text-neutral-600 hover:bg-neutral-200/80'
                      }
                    `}
                  >
                    <span className="flex items-center justify-center gap-2">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M19 12H5M12 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      Back to Gallery
                    </span>
                  </button>
                ) : step === 'configure' ? (
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
                      onClick={handleContinue}
                      disabled={!name.trim()}
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
                ) : step === 'advanced' ? (
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
                      disabled={isSubmitting || !name.trim() || !!configError}
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
                ) : null}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
