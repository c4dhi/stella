import { useState } from 'react'
import { motion } from 'framer-motion'
import { FileText, ExternalLink, ArrowRight } from 'lucide-react'

interface TermsModalProps {
  participantName: string
  onAccept: () => void
}

export default function TermsModal({ participantName, onAccept }: TermsModalProps) {
  const [termsChecked, setTermsChecked] = useState(false)
  const [privacyChecked, setPrivacyChecked] = useState(false)

  const canProceed = termsChecked && privacyChecked

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 flex items-center justify-center z-10 p-6"
    >
      <div className="max-w-lg w-full">
        {/* STELLA Branding */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="text-center mb-8"
        >
          <h1 className="font-serif text-4xl font-medium tracking-[0.15em] text-white mb-2">
            STELLA
          </h1>
          <p className="text-white/30 text-xs tracking-wide">
            System for Testing and Engineering LLM-based conversational Agents
          </p>
        </motion.div>

        {/* Terms Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="relative"
        >
          {/* Glow effect */}
          <div className="absolute -inset-1 bg-gradient-to-r from-violet-600/20 via-cyan-500/20 to-blue-500/20 rounded-[24px] blur-xl opacity-50 -z-10" />

          <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-8 relative">
            {/* Welcome Header */}
            <div className="text-center mb-8">
              <div className="w-12 h-12 rounded-full bg-violet-500/10 flex items-center justify-center mx-auto mb-4">
                <FileText className="w-6 h-6 text-violet-400" />
              </div>
              <h2 className="text-xl font-light text-white mb-2">
                Welcome, {participantName}
              </h2>
              <p className="text-white/50 text-sm">
                Before joining the session, please review and accept our terms.
              </p>
            </div>

            {/* Checkboxes */}
            <div className="space-y-4 mb-8">
              {/* Terms of Service */}
              <label className="flex items-start gap-3 cursor-pointer group">
                <div className="relative mt-0.5">
                  <input
                    type="checkbox"
                    checked={termsChecked}
                    onChange={(e) => setTermsChecked(e.target.checked)}
                    className="sr-only"
                  />
                  <div
                    className={`
                      w-5 h-5 rounded border-2 transition-all duration-200
                      ${termsChecked
                        ? 'bg-violet-500 border-violet-500'
                        : 'border-white/20 group-hover:border-white/40'
                      }
                    `}
                  >
                    {termsChecked && (
                      <svg
                        className="w-full h-full text-white"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                      >
                        <path d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                </div>
                <span className="text-sm text-white/70 group-hover:text-white/90 transition-colors">
                  I agree to the{' '}
                  <a
                    href="#"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-violet-400 hover:text-violet-300 inline-flex items-center gap-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    Terms of Service
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </span>
              </label>

              {/* Privacy Policy */}
              <label className="flex items-start gap-3 cursor-pointer group">
                <div className="relative mt-0.5">
                  <input
                    type="checkbox"
                    checked={privacyChecked}
                    onChange={(e) => setPrivacyChecked(e.target.checked)}
                    className="sr-only"
                  />
                  <div
                    className={`
                      w-5 h-5 rounded border-2 transition-all duration-200
                      ${privacyChecked
                        ? 'bg-violet-500 border-violet-500'
                        : 'border-white/20 group-hover:border-white/40'
                      }
                    `}
                  >
                    {privacyChecked && (
                      <svg
                        className="w-full h-full text-white"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                      >
                        <path d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                </div>
                <span className="text-sm text-white/70 group-hover:text-white/90 transition-colors">
                  I agree to the{' '}
                  <a
                    href="#"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-violet-400 hover:text-violet-300 inline-flex items-center gap-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    Privacy Policy
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </span>
              </label>
            </div>

            {/* Continue Button */}
            <button
              onClick={onAccept}
              disabled={!canProceed}
              className={`
                w-full relative overflow-hidden group py-3.5 rounded-xl font-medium text-sm
                transition-all duration-300
                ${canProceed
                  ? 'bg-gradient-to-r from-violet-600 to-violet-500 text-white hover:from-violet-500 hover:to-violet-400 hover:shadow-[0_0_30px_rgba(124,58,237,0.4)]'
                  : 'bg-white/5 text-white/30 cursor-not-allowed'
                }
              `}
            >
              <span className="relative z-10 flex items-center justify-center gap-2">
                Continue
                <ArrowRight className={`w-4 h-4 transition-transform ${canProceed ? 'group-hover:translate-x-1' : ''}`} />
              </span>
            </button>
          </div>
        </motion.div>
      </div>
    </motion.div>
  )
}
