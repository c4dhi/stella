import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Check, Copy, Link2, ArrowRight, ArrowLeft, X } from 'lucide-react'
import { useThemeStore } from '../../store/themeStore'
import { apiClient } from '../../services/ApiClient'
import type { CreateInvitationDto, CreateInvitationResponse } from '../../lib/api-types'
import { VISUALIZER_CONFIGS, type VisualizerType } from '../face/types'
import VisualizerPreview from '../face/VisualizerPreview'

interface InviteParticipantModalProps {
  isOpen: boolean
  onClose: () => void
  sessionId: string
  onSuccess?: (response: CreateInvitationResponse) => void
}

type WizardStep = 'name' | 'message' | 'visualizer' | 'expiration' | 'complete'

const EXPIRATION_OPTIONS = [
  { value: undefined, label: 'Never expires', description: 'Link remains valid indefinitely' },
  { value: 1, label: '1 hour', description: 'Expires in 1 hour' },
  { value: 24, label: '24 hours', description: 'Expires in 1 day' },
  { value: 72, label: '3 days', description: 'Expires in 3 days' },
  { value: 168, label: '1 week', description: 'Expires in 7 days' },
]

export default function InviteParticipantModal({
  isOpen,
  onClose,
  sessionId,
  onSuccess,
}: InviteParticipantModalProps) {
  const { resolvedTheme } = useThemeStore()
  const isDark = resolvedTheme === 'dark'

  // Wizard state
  const [step, setStep] = useState<WizardStep>('name')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // Form state
  const [participantName, setParticipantName] = useState('')
  const [customMessage, setCustomMessage] = useState('')
  const [visualizerType, setVisualizerType] = useState<VisualizerType | undefined>(undefined)
  const [visualizerLocked, setVisualizerLocked] = useState(false)
  const [expiresInHours, setExpiresInHours] = useState<number | undefined>(undefined)

  // Result state
  const [result, setResult] = useState<CreateInvitationResponse | null>(null)

  const resetForm = () => {
    setStep('name')
    setParticipantName('')
    setCustomMessage('')
    setVisualizerType(undefined)
    setVisualizerLocked(false)
    setExpiresInHours(undefined)
    setResult(null)
    setError(null)
    setCopied(false)
  }

  const handleClose = () => {
    if (!isSubmitting) {
      resetForm()
      onClose()
    }
  }

  const handleNext = () => {
    const steps: WizardStep[] = ['name', 'message', 'visualizer', 'expiration', 'complete']
    const currentIndex = steps.indexOf(step)
    if (currentIndex < steps.length - 1) {
      setStep(steps[currentIndex + 1])
    }
  }

  const handleBack = () => {
    const steps: WizardStep[] = ['name', 'message', 'visualizer', 'expiration', 'complete']
    const currentIndex = steps.indexOf(step)
    if (currentIndex > 0) {
      setStep(steps[currentIndex - 1])
    }
  }

  const handleSubmit = async () => {
    if (!participantName.trim()) return

    try {
      setIsSubmitting(true)
      setError(null)

      const dto: CreateInvitationDto = {
        participantName: participantName.trim(),
        customMessage: customMessage.trim() || undefined,
        visualizerType: visualizerType || undefined,
        visualizerLocked,
        expiresInHours,
      }

      const response = await apiClient.createInvitation(sessionId, dto)
      setResult(response)
      setStep('complete')
      onSuccess?.(response)
    } catch (err: any) {
      setError(err.message || 'Failed to create invitation')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleCopyLink = async () => {
    if (!result?.joinUrl) return
    try {
      await navigator.clipboard.writeText(result.joinUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement('textarea')
      textarea.value = result.joinUrl
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  // Progress indicator
  const steps: WizardStep[] = ['name', 'message', 'visualizer', 'expiration', 'complete']
  const currentStepIndex = steps.indexOf(step)
  const progress = ((currentStepIndex) / (steps.length - 1)) * 100

  const canProceed = useMemo(() => {
    switch (step) {
      case 'name':
        return participantName.trim().length > 0
      case 'message':
        return true // Optional step
      case 'visualizer':
        return true // Optional step
      case 'expiration':
        return true // Always can proceed
      default:
        return false
    }
  }, [step, participantName])

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
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className={`
              backdrop-blur-xl rounded-[20px] w-full max-w-lg overflow-hidden
              ${isDark
                ? 'bg-zinc-800 border border-zinc-700 shadow-[0_8px_40px_rgba(0,0,0,0.5)]'
                : 'bg-white border border-neutral-200 shadow-[0_1px_40px_rgba(0,0,0,0.12)]'
              }
            `}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Progress Bar */}
            <div className={`h-1 ${isDark ? 'bg-zinc-700' : 'bg-neutral-200'}`}>
              <motion.div
                className="h-full bg-primary-500"
                initial={{ width: 0 }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.3 }}
              />
            </div>

            {/* Header */}
            <div className={`px-6 pt-5 pb-4 border-b ${isDark ? 'border-zinc-700' : 'border-neutral-200'}`}>
              <div className="flex items-center justify-between">
                <div>
                  <h2 className={`text-xl font-light ${isDark ? 'text-zinc-100' : 'text-neutral-900'}`}>
                    Invite Participant
                  </h2>
                  <p className={`text-xs font-light mt-1 ${isDark ? 'text-zinc-400' : 'text-neutral-500'}`}>
                    {step === 'name' && 'Step 1: Enter participant details'}
                    {step === 'message' && 'Step 2: Add a welcome message (optional)'}
                    {step === 'visualizer' && 'Step 3: Choose a visualizer (optional)'}
                    {step === 'expiration' && 'Step 4: Set link expiration'}
                    {step === 'complete' && 'Invitation created!'}
                  </p>
                </div>
                <button
                  onClick={handleClose}
                  className={`p-2 rounded-lg transition-colors ${isDark ? 'hover:bg-zinc-700' : 'hover:bg-neutral-100'}`}
                >
                  <X className={`w-5 h-5 ${isDark ? 'text-zinc-400' : 'text-neutral-500'}`} />
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="p-6 min-h-[280px]">
              <AnimatePresence mode="wait">
                {/* Step 1: Name */}
                {step === 'name' && (
                  <motion.div
                    key="name"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    className="space-y-4"
                  >
                    <div>
                      <label
                        htmlFor="participant-name"
                        className={`block text-xs font-light tracking-wider uppercase mb-2 ${isDark ? 'text-zinc-400' : 'text-neutral-600'}`}
                      >
                        Participant Name *
                      </label>
                      <input
                        id="participant-name"
                        type="text"
                        value={participantName}
                        onChange={(e) => setParticipantName(e.target.value)}
                        placeholder="Enter participant name..."
                        className={`
                          w-full px-4 py-3 rounded-xl text-sm font-light
                          focus:outline-none transition-all duration-200
                          ${isDark
                            ? 'bg-zinc-900 border border-zinc-600 text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-500'
                            : 'bg-neutral-50 border border-neutral-200 text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-400'
                          }
                        `}
                        autoFocus
                      />
                    </div>

                    <div className={`p-4 rounded-xl ${isDark ? 'bg-zinc-900/50' : 'bg-neutral-50'}`}>
                      <div className="flex items-center gap-3 mb-2">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${isDark ? 'bg-primary-500/20' : 'bg-primary-50'}`}>
                          <svg className="w-4 h-4 text-primary-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="2" y="3" width="20" height="14" rx="2" />
                            <path d="M8 21h8M12 17v4" />
                          </svg>
                        </div>
                        <div>
                          <p className={`text-sm font-medium ${isDark ? 'text-zinc-200' : 'text-neutral-800'}`}>Web Session</p>
                          <p className={`text-xs ${isDark ? 'text-zinc-400' : 'text-neutral-500'}`}>Participant joins via browser</p>
                        </div>
                      </div>
                      <p className={`text-xs ${isDark ? 'text-zinc-500' : 'text-neutral-400'}`}>
                        Mobile app support coming soon
                      </p>
                    </div>
                  </motion.div>
                )}

                {/* Step 2: Message */}
                {step === 'message' && (
                  <motion.div
                    key="message"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    className="space-y-4"
                  >
                    <div>
                      <label
                        htmlFor="custom-message"
                        className={`block text-xs font-light tracking-wider uppercase mb-2 ${isDark ? 'text-zinc-400' : 'text-neutral-600'}`}
                      >
                        Welcome Message (Optional)
                      </label>
                      <textarea
                        id="custom-message"
                        value={customMessage}
                        onChange={(e) => setCustomMessage(e.target.value)}
                        placeholder="Add a personal message that will be shown to the participant when they join..."
                        rows={4}
                        maxLength={500}
                        className={`
                          w-full px-4 py-3 rounded-xl text-sm font-light resize-none
                          focus:outline-none transition-all duration-200
                          ${isDark
                            ? 'bg-zinc-900 border border-zinc-600 text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-500'
                            : 'bg-neutral-50 border border-neutral-200 text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-400'
                          }
                        `}
                        autoFocus
                      />
                      <p className={`text-xs mt-2 text-right ${isDark ? 'text-zinc-500' : 'text-neutral-400'}`}>
                        {customMessage.length}/500
                      </p>
                    </div>
                  </motion.div>
                )}

                {/* Step 3: Visualizer */}
                {step === 'visualizer' && (
                  <motion.div
                    key="visualizer"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    className="space-y-4"
                  >
                    <p className={`text-sm ${isDark ? 'text-zinc-300' : 'text-neutral-600'}`}>
                      Choose a default visualizer for the participant, or let them pick their own.
                    </p>

                    <div className="grid grid-cols-4 gap-2">
                      {/* Let them choose option */}
                      <button
                        onClick={() => { setVisualizerType(undefined); setVisualizerLocked(false); }}
                        className={`
                          p-3 rounded-xl flex flex-col items-center gap-2 transition-all
                          ${!visualizerType
                            ? isDark
                              ? 'bg-primary-500/20 border-2 border-primary-500'
                              : 'bg-primary-50 border-2 border-primary-500'
                            : isDark
                              ? 'bg-zinc-900 border border-zinc-700 hover:border-zinc-600'
                              : 'bg-neutral-50 border border-neutral-200 hover:border-neutral-300'
                          }
                        `}
                      >
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${isDark ? 'bg-zinc-700' : 'bg-neutral-200'}`}>
                          <span className="text-lg">🎨</span>
                        </div>
                        <span className={`text-[10px] font-light ${isDark ? 'text-zinc-300' : 'text-neutral-600'}`}>
                          Their choice
                        </span>
                      </button>

                      {/* Visualizer options */}
                      {VISUALIZER_CONFIGS.slice(0, 7).map((config) => (
                        <button
                          key={config.id}
                          onClick={() => setVisualizerType(config.id)}
                          className={`
                            p-3 rounded-xl flex flex-col items-center gap-2 transition-all
                            ${visualizerType === config.id
                              ? isDark
                                ? 'bg-primary-500/20 border-2 border-primary-500'
                                : 'bg-primary-50 border-2 border-primary-500'
                              : isDark
                                ? 'bg-zinc-900 border border-zinc-700 hover:border-zinc-600'
                                : 'bg-neutral-50 border border-neutral-200 hover:border-neutral-300'
                            }
                          `}
                        >
                          <div className={`relative w-8 h-8 rounded-full flex items-center justify-center overflow-hidden ${config.previewBg}`}>
                            <VisualizerPreview type={config.id} size="sm" />
                          </div>
                          <span className={`text-[10px] font-light ${isDark ? 'text-zinc-300' : 'text-neutral-600'}`}>
                            {config.name}
                          </span>
                        </button>
                      ))}
                    </div>

                    {/* Lock option */}
                    {visualizerType && (
                      <label className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer ${isDark ? 'bg-zinc-900' : 'bg-neutral-50'}`}>
                        <input
                          type="checkbox"
                          checked={visualizerLocked}
                          onChange={(e) => setVisualizerLocked(e.target.checked)}
                          className="sr-only"
                        />
                        <div className={`
                          w-10 h-6 rounded-full p-0.5 transition-colors
                          ${visualizerLocked
                            ? 'bg-primary-500'
                            : isDark ? 'bg-zinc-700' : 'bg-neutral-300'
                          }
                        `}>
                          <motion.div
                            className="w-5 h-5 rounded-full bg-white shadow"
                            animate={{ x: visualizerLocked ? 16 : 0 }}
                            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                          />
                        </div>
                        <div>
                          <p className={`text-sm ${isDark ? 'text-zinc-200' : 'text-neutral-700'}`}>Lock visualizer</p>
                          <p className={`text-xs ${isDark ? 'text-zinc-400' : 'text-neutral-500'}`}>
                            Participant won't be able to change it
                          </p>
                        </div>
                      </label>
                    )}
                  </motion.div>
                )}

                {/* Step 4: Expiration */}
                {step === 'expiration' && (
                  <motion.div
                    key="expiration"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    className="space-y-3"
                  >
                    <p className={`text-sm mb-4 ${isDark ? 'text-zinc-300' : 'text-neutral-600'}`}>
                      Set how long the invitation link should remain valid.
                    </p>

                    {EXPIRATION_OPTIONS.map((option) => (
                      <button
                        key={option.value ?? 'never'}
                        onClick={() => setExpiresInHours(option.value)}
                        className={`
                          w-full p-4 rounded-xl flex items-center justify-between transition-all
                          ${expiresInHours === option.value
                            ? isDark
                              ? 'bg-primary-500/20 border-2 border-primary-500'
                              : 'bg-primary-50 border-2 border-primary-500'
                            : isDark
                              ? 'bg-zinc-900 border border-zinc-700 hover:border-zinc-600'
                              : 'bg-neutral-50 border border-neutral-200 hover:border-neutral-300'
                          }
                        `}
                      >
                        <div className="text-left">
                          <p className={`text-sm font-medium ${isDark ? 'text-zinc-200' : 'text-neutral-800'}`}>
                            {option.label}
                          </p>
                          <p className={`text-xs ${isDark ? 'text-zinc-400' : 'text-neutral-500'}`}>
                            {option.description}
                          </p>
                        </div>
                        {expiresInHours === option.value && (
                          <Check className="w-5 h-5 text-primary-500" />
                        )}
                      </button>
                    ))}
                  </motion.div>
                )}

                {/* Step 5: Complete */}
                {step === 'complete' && result && (
                  <motion.div
                    key="complete"
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="text-center space-y-4"
                  >
                    <div className={`w-16 h-16 rounded-full mx-auto flex items-center justify-center ${isDark ? 'bg-green-500/20' : 'bg-green-50'}`}>
                      <Check className="w-8 h-8 text-green-500" />
                    </div>

                    <div>
                      <h3 className={`text-lg font-medium ${isDark ? 'text-zinc-100' : 'text-neutral-900'}`}>
                        Invitation Created!
                      </h3>
                      <p className={`text-sm mt-1 ${isDark ? 'text-zinc-400' : 'text-neutral-500'}`}>
                        Share this link with {result.invitation.participantName}
                      </p>
                    </div>

                    {/* Link display */}
                    <div className={`p-4 rounded-xl ${isDark ? 'bg-zinc-900' : 'bg-neutral-50'}`}>
                      <div className="flex items-center gap-2 mb-3">
                        <Link2 className={`w-4 h-4 ${isDark ? 'text-zinc-400' : 'text-neutral-500'}`} />
                        <span className={`text-xs font-light tracking-wider uppercase ${isDark ? 'text-zinc-400' : 'text-neutral-500'}`}>
                          Invitation Link
                        </span>
                      </div>
                      <div className={`
                        p-3 rounded-lg text-sm font-mono break-all
                        ${isDark ? 'bg-zinc-800 text-zinc-300' : 'bg-white text-neutral-700 border border-neutral-200'}
                      `}>
                        {result.joinUrl}
                      </div>
                    </div>

                    <button
                      onClick={handleCopyLink}
                      className={`
                        w-full py-3 px-4 rounded-xl text-sm font-medium
                        flex items-center justify-center gap-2 transition-all
                        ${copied
                          ? 'bg-green-500 text-white'
                          : isDark
                            ? 'bg-primary-500 text-white hover:bg-primary-400'
                            : 'bg-neutral-900 text-white hover:bg-neutral-800'
                        }
                      `}
                    >
                      {copied ? (
                        <>
                          <Check className="w-4 h-4" />
                          Copied!
                        </>
                      ) : (
                        <>
                          <Copy className="w-4 h-4" />
                          Copy Link
                        </>
                      )}
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Error display */}
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`mt-4 p-3 rounded-xl text-sm ${isDark ? 'bg-red-500/20 text-red-300' : 'bg-red-50 text-red-600'}`}
                >
                  {error}
                </motion.div>
              )}
            </div>

            {/* Footer */}
            {step !== 'complete' && (
              <div className={`px-6 py-4 border-t ${isDark ? 'border-zinc-700' : 'border-neutral-200'}`}>
                <div className="flex gap-3">
                  {step !== 'name' && (
                    <button
                      onClick={handleBack}
                      disabled={isSubmitting}
                      className={`
                        flex-1 py-2.5 px-4 rounded-xl text-sm font-light
                        flex items-center justify-center gap-2 transition-all
                        disabled:opacity-50 disabled:cursor-not-allowed
                        ${isDark
                          ? 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
                          : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                        }
                      `}
                    >
                      <ArrowLeft className="w-4 h-4" />
                      Back
                    </button>
                  )}

                  {step === 'expiration' ? (
                    <button
                      onClick={handleSubmit}
                      disabled={!canProceed || isSubmitting}
                      className={`
                        flex-1 py-2.5 px-4 rounded-xl text-sm font-medium
                        flex items-center justify-center gap-2 transition-all
                        disabled:opacity-50 disabled:cursor-not-allowed
                        ${isDark
                          ? 'bg-primary-500 text-white hover:bg-primary-400'
                          : 'bg-neutral-900 text-white hover:bg-neutral-800'
                        }
                      `}
                    >
                      {isSubmitting ? 'Creating...' : 'Create Invitation'}
                    </button>
                  ) : (
                    <button
                      onClick={handleNext}
                      disabled={!canProceed}
                      className={`
                        flex-1 py-2.5 px-4 rounded-xl text-sm font-medium
                        flex items-center justify-center gap-2 transition-all
                        disabled:opacity-50 disabled:cursor-not-allowed
                        ${isDark
                          ? 'bg-primary-500 text-white hover:bg-primary-400'
                          : 'bg-neutral-900 text-white hover:bg-neutral-800'
                        }
                      `}
                    >
                      {step === 'name' ? 'Continue' : 'Next'}
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Close button for complete step */}
            {step === 'complete' && (
              <div className={`px-6 py-4 border-t ${isDark ? 'border-zinc-700' : 'border-neutral-200'}`}>
                <button
                  onClick={handleClose}
                  className={`
                    w-full py-2.5 px-4 rounded-xl text-sm font-light
                    transition-all
                    ${isDark
                      ? 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
                      : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                    }
                  `}
                >
                  Done
                </button>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
