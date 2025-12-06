import { useState, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Check, Copy, Link2 } from 'lucide-react'
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

type Step = 'type' | 'message' | 'visualizer' | 'expiration' | 'complete'
type InvitationType = 'web' | 'mobile'

interface InvitationTypeConfig {
  id: InvitationType
  name: string
  description: string
  icon: React.ReactNode
  available: boolean
  comingSoon?: boolean
}

const INVITATION_TYPES: InvitationTypeConfig[] = [
  {
    id: 'web',
    name: 'Web Session',
    description: 'Participant joins via browser link',
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <path d="M8 21h8M12 17v4" />
      </svg>
    ),
    available: true,
  },
  {
    id: 'mobile',
    name: 'Mobile App',
    description: 'Participant joins via STELLA app',
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="5" y="2" width="14" height="20" rx="2" />
        <path d="M12 18h.01" />
      </svg>
    ),
    available: false,
    comingSoon: true,
  },
]

const EXPIRATION_OPTIONS = [
  { value: undefined, label: 'Never expires', description: 'Link remains valid indefinitely' },
  { value: 1, label: '1 hour', description: 'Expires in 1 hour' },
  { value: 24, label: '24 hours', description: 'Expires in 1 day' },
  { value: 72, label: '3 days', description: 'Expires in 3 days' },
  { value: 168, label: '1 week', description: 'Expires in 7 days' },
]

// Step configuration for easy extension
const STEPS: { id: Step; number: number; label: string }[] = [
  { id: 'type', number: 1, label: 'Invitation Type' },
  { id: 'message', number: 2, label: 'Welcome Message' },
  { id: 'visualizer', number: 3, label: 'Visualizer' },
  { id: 'expiration', number: 4, label: 'Expiration' },
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
  const [step, setStep] = useState<Step>('type')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // Form state
  const [invitationType, setInvitationType] = useState<InvitationType>('web')
  const [participantName, setParticipantName] = useState('')
  const [customMessage, setCustomMessage] = useState('')
  const [visualizerType, setVisualizerType] = useState<VisualizerType | undefined>(undefined)
  const [visualizerLocked, setVisualizerLocked] = useState(false)
  const [expiresInHours, setExpiresInHours] = useState<number | undefined>(undefined)

  // Result state
  const [result, setResult] = useState<CreateInvitationResponse | null>(null)

  const resetForm = () => {
    setStep('type')
    setInvitationType('web')
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

  const getStepNumber = (s: Step): number => {
    const stepConfig = STEPS.find(st => st.id === s)
    return stepConfig?.number ?? 0
  }

  const handleContinue = () => {
    const stepOrder: Step[] = ['type', 'message', 'visualizer', 'expiration']
    const currentIndex = stepOrder.indexOf(step)
    if (currentIndex < stepOrder.length - 1) {
      setStep(stepOrder[currentIndex + 1])
    }
  }

  const handleBack = () => {
    const stepOrder: Step[] = ['type', 'message', 'visualizer', 'expiration']
    const currentIndex = stepOrder.indexOf(step)
    if (currentIndex > 0) {
      setStep(stepOrder[currentIndex - 1])
    }
    setError(null)
  }

  const handleSubmit = async () => {
    try {
      setIsSubmitting(true)
      setError(null)

      const dto: CreateInvitationDto = {
        participantName: participantName.trim() || undefined,
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

  const canProceed = useMemo(() => {
    switch (step) {
      case 'type':
        return invitationType === 'web'
      case 'message':
        return true
      case 'visualizer':
        return true
      case 'expiration':
        return true
      default:
        return false
    }
  }, [step, invitationType])

  const getStepTitle = (): string => {
    switch (step) {
      case 'type': return 'Invite Participant'
      case 'message': return 'Welcome Message'
      case 'visualizer': return 'Choose Visualizer'
      case 'expiration': return 'Set Expiration'
      case 'complete': return 'Invitation Created'
    }
  }

  const getStepDescription = (): string => {
    switch (step) {
      case 'type': return 'Choose how the participant will join this session'
      case 'message': return 'Add a personal message shown when they join (optional)'
      case 'visualizer': return 'Set a default visualizer or let them choose'
      case 'expiration': return 'Set how long the invitation link remains valid'
      case 'complete': return 'Share this link with the participant'
    }
  }

  return createPortal(
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
                  {STEPS.map((s, idx) => (
                    <div key={s.id} className="flex items-center">
                      <div className={`
                        w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium
                        ${step === 'complete' || getStepNumber(step) >= s.number
                          ? 'bg-primary-500 text-white'
                          : isDark ? 'bg-zinc-600 text-zinc-300' : 'bg-neutral-200 text-neutral-600'
                        }
                      `}>
                        {step === 'complete' ? (
                          <Check className="w-3 h-3" />
                        ) : (
                          s.number
                        )}
                      </div>
                      {idx < STEPS.length - 1 && (
                        <div className={`w-8 h-0.5 ml-3 ${step === 'complete' ? 'bg-primary-500' : isDark ? 'bg-zinc-600' : 'bg-neutral-200'}`} />
                      )}
                    </div>
                  ))}
                </div>

                <h2 className={`text-2xl font-light tracking-wide ${isDark ? 'text-zinc-100' : 'text-neutral-900'}`}>
                  {getStepTitle()}
                </h2>
                <p className={`text-sm font-light mt-1 ${isDark ? 'text-zinc-400' : 'text-neutral-500'}`}>
                  {getStepDescription()}
                </p>
              </div>
            </div>

            {/* Content */}
            <AnimatePresence mode="wait">
              {/* Step 1: Invitation Type + Name */}
              {step === 'type' && (
                <motion.div
                  key="type"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.2 }}
                  className="p-6"
                >
                  {/* Invitation Type Gallery */}
                  <div className="grid grid-cols-2 gap-3 mb-6">
                    {INVITATION_TYPES.map((type) => (
                      <button
                        key={type.id}
                        onClick={() => type.available && setInvitationType(type.id)}
                        disabled={!type.available}
                        className={`
                          relative p-4 rounded-xl text-left transition-all duration-200
                          ${!type.available ? 'opacity-60 cursor-not-allowed' : ''}
                          ${invitationType === type.id && type.available
                            ? isDark
                              ? 'bg-primary-500/20 border-2 border-primary-500'
                              : 'bg-primary-50 border-2 border-primary-500'
                            : isDark
                              ? 'bg-zinc-700/50 border border-zinc-600 hover:border-zinc-500'
                              : 'bg-neutral-50 border border-neutral-200 hover:border-neutral-300'
                          }
                        `}
                      >
                        {type.comingSoon && (
                          <span className={`
                            absolute top-2 right-2 text-[10px] font-medium tracking-wider uppercase px-2 py-0.5 rounded
                            ${isDark ? 'bg-zinc-600 text-zinc-300' : 'bg-neutral-200 text-neutral-500'}
                          `}>
                            Coming Soon
                          </span>
                        )}
                        <div className="flex items-start gap-3">
                          <div className={`
                            w-12 h-12 rounded-xl flex items-center justify-center
                            ${invitationType === type.id && type.available
                              ? 'bg-primary-500 text-white'
                              : isDark ? 'bg-zinc-600 text-zinc-300' : 'bg-neutral-100 text-neutral-500'
                            }
                          `}>
                            {type.icon}
                          </div>
                          <div className="flex-1 min-w-0">
                            <h3 className={`text-sm font-medium ${isDark ? 'text-zinc-100' : 'text-neutral-900'}`}>
                              {type.name}
                            </h3>
                            <p className={`text-xs mt-0.5 ${isDark ? 'text-zinc-400' : 'text-neutral-500'}`}>
                              {type.description}
                            </p>
                          </div>
                        </div>
                        {invitationType === type.id && type.available && (
                          <div className="absolute top-4 right-4">
                            <div className="w-5 h-5 rounded-full bg-primary-500 flex items-center justify-center">
                              <Check className="w-3 h-3 text-white" />
                            </div>
                          </div>
                        )}
                      </button>
                    ))}
                  </div>

                  {/* Participant Name */}
                  <div>
                    <label
                      htmlFor="participant-name"
                      className={`block text-xs font-light tracking-wider uppercase mb-2 ${isDark ? 'text-zinc-400' : 'text-neutral-600'}`}
                    >
                      Participant Name <span className={isDark ? 'text-zinc-500' : 'text-neutral-400'}>(Optional)</span>
                    </label>
                    <input
                      id="participant-name"
                      type="text"
                      value={participantName}
                      onChange={(e) => setParticipantName(e.target.value)}
                      placeholder="Leave empty to auto-generate (e.g., user-84573)"
                      className={`
                        w-full px-4 py-3 rounded-xl text-sm font-light
                        focus:outline-none transition-all duration-200
                        ${isDark
                          ? 'bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-600'
                          : 'bg-neutral-50/50 border border-neutral-200/60 text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-400/60 focus:bg-white'
                        }
                      `}
                      autoFocus
                    />
                  </div>

                  {/* Error message */}
                  {error && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`mt-4 p-3 rounded-lg text-xs font-light ${isDark
                        ? 'bg-red-500/10 border border-red-500/20 text-red-400'
                        : 'bg-red-50/80 border border-red-200/60 text-red-600'
                      }`}
                    >
                      {error}
                    </motion.div>
                  )}
                </motion.div>
              )}

              {/* Step 2: Message */}
              {step === 'message' && (
                <motion.div
                  key="message"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ duration: 0.2 }}
                  className="p-6"
                >
                  {/* Participant summary */}
                  <div className={`
                    flex items-center gap-3 p-3 rounded-xl mb-4
                    ${isDark ? 'bg-zinc-700/50' : 'bg-neutral-50'}
                  `}>
                    <div className={`
                      w-10 h-10 rounded-lg flex items-center justify-center
                      ${isDark ? 'bg-zinc-600 text-zinc-300' : 'bg-white border border-neutral-200 text-neutral-500'}
                    `}>
                      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                        <circle cx="12" cy="7" r="4" />
                      </svg>
                    </div>
                    <div>
                      <div className={`text-sm font-medium ${isDark ? 'text-zinc-100' : 'text-neutral-900'}`}>
                        {participantName || <span className={isDark ? 'text-zinc-400 italic' : 'text-neutral-400 italic'}>Auto-generated name</span>}
                      </div>
                      <div className={`text-xs ${isDark ? 'text-zinc-400' : 'text-neutral-500'}`}>
                        Web Session Invitation
                      </div>
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="custom-message"
                      className={`block text-xs font-light tracking-wider uppercase mb-2 ${isDark ? 'text-zinc-400' : 'text-neutral-600'}`}
                    >
                      Welcome Message <span className={isDark ? 'text-zinc-500' : 'text-neutral-400'}>(Optional)</span>
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
                          ? 'bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-600'
                          : 'bg-neutral-50/50 border border-neutral-200/60 text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-400/60 focus:bg-white'
                        }
                      `}
                      autoFocus
                    />
                    <div className={`mt-2 text-xs font-light text-right ${isDark ? 'text-zinc-500' : 'text-neutral-500'}`}>
                      {customMessage.length}/500
                    </div>
                  </div>
                </motion.div>
              )}

              {/* Step 3: Visualizer */}
              {step === 'visualizer' && (
                <motion.div
                  key="visualizer"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ duration: 0.2 }}
                  className="p-6"
                >
                  <div className="grid grid-cols-4 gap-3">
                    {/* Let them choose option */}
                    <button
                      onClick={() => { setVisualizerType(undefined); setVisualizerLocked(false); }}
                      className={`
                        p-4 rounded-xl flex flex-col items-center gap-2 transition-all
                        ${!visualizerType
                          ? isDark
                            ? 'bg-primary-500/20 border-2 border-primary-500'
                            : 'bg-primary-50 border-2 border-primary-500'
                          : isDark
                            ? 'bg-zinc-700/50 border border-zinc-600 hover:border-zinc-500'
                            : 'bg-neutral-50 border border-neutral-200 hover:border-neutral-300'
                        }
                      `}
                    >
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center ${isDark ? 'bg-zinc-600' : 'bg-neutral-200'}`}>
                        <span className="text-xl">🎨</span>
                      </div>
                      <span className={`text-xs font-light ${isDark ? 'text-zinc-300' : 'text-neutral-600'}`}>
                        Their choice
                      </span>
                    </button>

                    {/* Visualizer options */}
                    {VISUALIZER_CONFIGS.map((config) => (
                      <button
                        key={config.id}
                        onClick={() => setVisualizerType(config.id)}
                        className={`
                          p-4 rounded-xl flex flex-col items-center gap-2 transition-all
                          ${visualizerType === config.id
                            ? isDark
                              ? 'bg-primary-500/20 border-2 border-primary-500'
                              : 'bg-primary-50 border-2 border-primary-500'
                            : isDark
                              ? 'bg-zinc-700/50 border border-zinc-600 hover:border-zinc-500'
                              : 'bg-neutral-50 border border-neutral-200 hover:border-neutral-300'
                          }
                        `}
                      >
                        <div className={`relative w-10 h-10 rounded-full flex items-center justify-center overflow-hidden ${config.previewBg}`}>
                          <VisualizerPreview type={config.id} size="sm" />
                        </div>
                        <span className={`text-xs font-light ${isDark ? 'text-zinc-300' : 'text-neutral-600'}`}>
                          {config.name}
                        </span>
                      </button>
                    ))}
                  </div>

                  {/* Lock option */}
                  {visualizerType && (
                    <label className={`flex items-center gap-3 p-4 rounded-xl cursor-pointer mt-4 ${isDark ? 'bg-zinc-700/50' : 'bg-neutral-50'}`}>
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
                          : isDark ? 'bg-zinc-600' : 'bg-neutral-300'
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
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ duration: 0.2 }}
                  className="p-6 space-y-3"
                >
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
                            ? 'bg-zinc-700/50 border border-zinc-600 hover:border-zinc-500'
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
                        <div className="w-5 h-5 rounded-full bg-primary-500 flex items-center justify-center">
                          <Check className="w-3 h-3 text-white" />
                        </div>
                      )}
                    </button>
                  ))}
                </motion.div>
              )}

              {/* Complete */}
              {step === 'complete' && result && (
                <motion.div
                  key="complete"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.2 }}
                  className="p-6 text-center space-y-4"
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

                  {/* Link display with inline copy button */}
                  <div className={`p-4 rounded-xl text-left ${isDark ? 'bg-zinc-700/50' : 'bg-neutral-50'}`}>
                    <div className="flex items-center gap-2 mb-3">
                      <Link2 className={`w-4 h-4 ${isDark ? 'text-zinc-400' : 'text-neutral-500'}`} />
                      <span className={`text-xs font-light tracking-wider uppercase ${isDark ? 'text-zinc-400' : 'text-neutral-500'}`}>
                        Invitation Link
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <div className={`
                        flex-1 p-3 rounded-lg text-sm font-mono break-all
                        ${isDark ? 'bg-zinc-800 text-zinc-300' : 'bg-white text-neutral-700 border border-neutral-200'}
                      `}>
                        {result.joinUrl}
                      </div>
                      <button
                        onClick={handleCopyLink}
                        className={`
                          shrink-0 px-4 rounded-lg text-sm font-medium
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
                          <Check className="w-4 h-4" />
                        ) : (
                          <Copy className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Footer */}
            <div className={`px-6 py-4 border-t ${isDark ? 'border-zinc-700' : 'border-neutral-200'}`}>
              <div className="flex gap-3">
                {step === 'type' ? (
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
                      disabled={!canProceed}
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
                ) : step === 'complete' ? (
                  <button
                    type="button"
                    onClick={handleClose}
                    className={`
                      w-full py-2.5 px-4 rounded-xl text-sm font-light tracking-wider
                      transition-all duration-200
                      ${isDark
                        ? 'bg-white/5 text-zinc-300 hover:bg-white/10 border border-white/10'
                        : 'bg-neutral-100/80 text-neutral-600 hover:bg-neutral-200/80'
                      }
                    `}
                  >
                    Done
                  </button>
                ) : step === 'expiration' ? (
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
                      disabled={isSubmitting}
                      className={`
                        flex-1 py-2.5 px-4 rounded-xl text-sm font-light tracking-wider
                        transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed
                        ${isDark
                          ? 'bg-primary-500 text-white hover:bg-primary-400 hover:shadow-primary border border-primary-400/30'
                          : 'bg-neutral-900 text-white hover:bg-neutral-800 shadow-[0_1px_20px_rgba(0,0,0,0.12)]'
                        }
                      `}
                    >
                      {isSubmitting ? 'Creating...' : 'Create Invitation'}
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
                      onClick={handleContinue}
                      disabled={!canProceed}
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
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )
}
