import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Settings, Clock, Power } from 'lucide-react'
import { useThemeStore } from '../../store/themeStore'
import { apiClient } from '../../services/ApiClient'
import type { Project } from '../../lib/api-types'

interface ProjectSettingsPanelProps {
  isOpen: boolean
  onClose: () => void
  project: Project
  onProjectUpdated: (project: Project) => void
}

// Predefined timeout options
const TIMEOUT_OPTIONS = [
  { value: null, label: 'Disabled', description: 'Agents run until manually stopped' },
  { value: 5, label: '5 minutes', description: 'Quick sessions' },
  { value: 15, label: '15 minutes', description: 'Short breaks' },
  { value: 30, label: '30 minutes', description: 'Standard timeout' },
  { value: 60, label: '1 hour', description: 'Extended sessions' },
] as const

export default function ProjectSettingsPanel({
  isOpen,
  onClose,
  project,
  onProjectUpdated,
}: ProjectSettingsPanelProps) {
  const { resolvedTheme } = useThemeStore()
  const isDark = resolvedTheme === 'dark'

  // Local state
  const [name, setName] = useState(project.name)
  const [agentInactivityTimeout, setAgentInactivityTimeout] = useState<number | null>(
    project.agentInactivityTimeoutMinutes ?? null
  )
  const [customTimeout, setCustomTimeout] = useState('')
  const [showCustomInput, setShowCustomInput] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset state when project changes or modal opens
  useEffect(() => {
    if (isOpen) {
      setName(project.name)
      const timeout = project.agentInactivityTimeoutMinutes ?? null
      setAgentInactivityTimeout(timeout)

      // Check if current timeout is a custom value
      const isPreset = TIMEOUT_OPTIONS.some(opt => opt.value === timeout)
      setShowCustomInput(!isPreset && timeout !== null)
      if (!isPreset && timeout !== null) {
        setCustomTimeout(timeout.toString())
      } else {
        setCustomTimeout('')
      }
      setError(null)
    }
  }, [isOpen, project])

  const handleTimeoutChange = (value: number | null) => {
    setAgentInactivityTimeout(value)
    setShowCustomInput(false)
    setCustomTimeout('')
  }

  const handleCustomTimeoutChange = (value: string) => {
    setCustomTimeout(value)
    const num = parseInt(value, 10)
    if (!isNaN(num) && num >= 1 && num <= 1440) {
      setAgentInactivityTimeout(num)
    }
  }

  const handleSubmit = async () => {
    // Validate name
    if (!name.trim()) {
      setError('Project name is required')
      return
    }

    // Validate custom timeout if shown
    if (showCustomInput) {
      const num = parseInt(customTimeout, 10)
      if (isNaN(num) || num < 1 || num > 1440) {
        setError('Custom timeout must be between 1 and 1440 minutes')
        return
      }
    }

    setIsSubmitting(true)
    setError(null)

    try {
      const updatedProject = await apiClient.updateProject(project.id, {
        name: name !== project.name ? name : undefined,
        agentInactivityTimeoutMinutes: agentInactivityTimeout,
      })
      onProjectUpdated(updatedProject)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update project settings')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleClose = () => {
    if (!isSubmitting) {
      onClose()
    }
  }

  const hasChanges =
    name !== project.name ||
    agentInactivityTimeout !== (project.agentInactivityTimeoutMinutes ?? null)

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
            className={`w-full max-w-lg rounded-2xl overflow-hidden ${
              isDark
                ? 'bg-zinc-800 border border-zinc-700 shadow-[0_8px_40px_rgba(0,0,0,0.5)]'
                : 'bg-white border border-neutral-200 shadow-[0_1px_40px_rgba(0,0,0,0.12)]'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className={`px-6 pt-6 pb-4 border-b ${isDark ? 'border-zinc-700' : 'border-neutral-200'}`}>
              <div className="relative">
                <button
                  onClick={handleClose}
                  disabled={isSubmitting}
                  className={`absolute -top-1 -right-1 p-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                    isDark
                      ? 'text-zinc-400 hover:text-zinc-200 hover:bg-white/10'
                      : 'text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100'
                  }`}
                  title="Close"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>

                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                    isDark ? 'bg-zinc-700' : 'bg-neutral-100'
                  }`}>
                    <Settings className={`w-5 h-5 ${isDark ? 'text-zinc-300' : 'text-neutral-600'}`} />
                  </div>
                  <div>
                    <h2 className={`text-lg font-medium ${isDark ? 'text-zinc-100' : 'text-neutral-900'}`}>
                      Project Settings
                    </h2>
                    <p className={`text-sm ${isDark ? 'text-zinc-400' : 'text-neutral-500'}`}>
                      Configure project behavior
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Content */}
            <div className="p-6 space-y-6">
              {/* Project Name */}
              <div>
                <label className={`block text-xs font-medium uppercase tracking-wider mb-2 ${
                  isDark ? 'text-zinc-400' : 'text-neutral-500'
                }`}>
                  Project Name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={255}
                  disabled={isSubmitting}
                  className={`
                    w-full px-4 py-3 rounded-xl text-sm
                    focus:outline-none transition-all duration-200
                    disabled:opacity-60 disabled:cursor-not-allowed
                    ${isDark
                      ? 'bg-zinc-700/50 border border-zinc-600 text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-500'
                      : 'bg-neutral-50/50 border border-neutral-200/60 text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-400/60 focus:bg-white'
                    }
                  `}
                  placeholder="Enter project name"
                />
              </div>

              {/* Agent Inactivity Timeout */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Clock className={`w-4 h-4 ${isDark ? 'text-zinc-400' : 'text-neutral-500'}`} />
                  <label className={`text-xs font-medium uppercase tracking-wider ${
                    isDark ? 'text-zinc-400' : 'text-neutral-500'
                  }`}>
                    Agent Auto-Stop
                  </label>
                </div>

                <p className={`text-sm mb-4 ${isDark ? 'text-zinc-400' : 'text-neutral-500'}`}>
                  Automatically stop agents when no users are present
                </p>

                <div className="grid grid-cols-2 gap-2">
                  {TIMEOUT_OPTIONS.map((option) => (
                    <button
                      key={option.value ?? 'disabled'}
                      onClick={() => handleTimeoutChange(option.value)}
                      disabled={isSubmitting}
                      className={`
                        p-3 rounded-xl text-left transition-all duration-200
                        disabled:opacity-60 disabled:cursor-not-allowed
                        ${agentInactivityTimeout === option.value && !showCustomInput
                          ? isDark
                            ? 'bg-violet-500/20 border-2 border-violet-500'
                            : 'bg-neutral-100 border-2 border-neutral-900'
                          : isDark
                            ? 'bg-zinc-700/50 border border-zinc-600 hover:border-zinc-500'
                            : 'bg-neutral-50 border border-neutral-200 hover:border-neutral-300'
                        }
                      `}
                    >
                      <div className="flex items-center gap-2">
                        {option.value === null ? (
                          <Power className={`w-4 h-4 ${
                            agentInactivityTimeout === null && !showCustomInput
                              ? isDark ? 'text-violet-400' : 'text-neutral-900'
                              : isDark ? 'text-zinc-400' : 'text-neutral-500'
                          }`} />
                        ) : (
                          <Clock className={`w-4 h-4 ${
                            agentInactivityTimeout === option.value && !showCustomInput
                              ? isDark ? 'text-violet-400' : 'text-neutral-900'
                              : isDark ? 'text-zinc-400' : 'text-neutral-500'
                          }`} />
                        )}
                        <span className={`text-sm font-medium ${
                          isDark ? 'text-zinc-100' : 'text-neutral-900'
                        }`}>
                          {option.label}
                        </span>
                      </div>
                      <p className={`text-xs mt-1 ${isDark ? 'text-zinc-500' : 'text-neutral-500'}`}>
                        {option.description}
                      </p>
                    </button>
                  ))}

                  {/* Custom option */}
                  <button
                    onClick={() => setShowCustomInput(true)}
                    disabled={isSubmitting}
                    className={`
                      p-3 rounded-xl text-left transition-all duration-200 col-span-2
                      disabled:opacity-60 disabled:cursor-not-allowed
                      ${showCustomInput
                        ? isDark
                          ? 'bg-violet-500/20 border-2 border-violet-500'
                          : 'bg-neutral-100 border-2 border-neutral-900'
                        : isDark
                          ? 'bg-zinc-700/50 border border-zinc-600 hover:border-zinc-500'
                          : 'bg-neutral-50 border border-neutral-200 hover:border-neutral-300'
                      }
                    `}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Clock className={`w-4 h-4 ${
                          showCustomInput
                            ? isDark ? 'text-violet-400' : 'text-neutral-900'
                            : isDark ? 'text-zinc-400' : 'text-neutral-500'
                        }`} />
                        <span className={`text-sm font-medium ${
                          isDark ? 'text-zinc-100' : 'text-neutral-900'
                        }`}>
                          Custom
                        </span>
                      </div>
                      {showCustomInput && (
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            value={customTimeout}
                            onChange={(e) => handleCustomTimeoutChange(e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            min={1}
                            max={1440}
                            disabled={isSubmitting}
                            className={`
                              w-20 px-2 py-1 rounded-lg text-sm text-center
                              focus:outline-none
                              ${isDark
                                ? 'bg-zinc-600 border border-zinc-500 text-zinc-100'
                                : 'bg-white border border-neutral-300 text-neutral-900'
                              }
                            `}
                            placeholder="min"
                          />
                          <span className={`text-sm ${isDark ? 'text-zinc-400' : 'text-neutral-500'}`}>
                            minutes
                          </span>
                        </div>
                      )}
                    </div>
                    {!showCustomInput && (
                      <p className={`text-xs mt-1 ${isDark ? 'text-zinc-500' : 'text-neutral-500'}`}>
                        Set a custom timeout (1-1440 min)
                      </p>
                    )}
                  </button>
                </div>

                {/* Info note */}
                <div className={`mt-4 p-3 rounded-xl ${
                  isDark ? 'bg-zinc-700/30' : 'bg-neutral-50'
                }`}>
                  <p className={`text-xs ${isDark ? 'text-zinc-400' : 'text-neutral-600'}`}>
                    When enabled, agents will automatically stop after the timeout period when all users leave the session.
                    Agents will automatically restart when a user rejoins.
                  </p>
                </div>
              </div>

              {/* Error message */}
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`p-3 rounded-lg text-sm ${
                    isDark
                      ? 'bg-red-500/10 border border-red-500/20 text-red-400'
                      : 'bg-red-50 border border-red-200 text-red-700'
                  }`}
                >
                  {error}
                </motion.div>
              )}
            </div>

            {/* Footer */}
            <div className={`px-6 py-4 flex gap-3 border-t ${isDark ? 'border-zinc-700' : 'border-neutral-200'}`}>
              <button
                type="button"
                onClick={handleClose}
                disabled={isSubmitting}
                className={`
                  px-4 py-2.5 rounded-xl text-sm font-medium transition-all
                  disabled:opacity-60 disabled:cursor-not-allowed
                  ${isDark
                    ? 'text-zinc-300 hover:bg-zinc-700'
                    : 'text-neutral-600 hover:bg-neutral-100'
                  }
                `}
              >
                Cancel
              </button>
              <div className="flex-1" />
              <button
                onClick={handleSubmit}
                disabled={isSubmitting || !hasChanges}
                className={`
                  px-6 py-2.5 rounded-xl text-sm font-medium transition-all
                  disabled:opacity-60 disabled:cursor-not-allowed
                  ${isDark
                    ? 'bg-violet-600 text-white hover:bg-violet-500'
                    : 'bg-neutral-900 text-white hover:bg-neutral-800'
                  }
                `}
              >
                {isSubmitting ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
