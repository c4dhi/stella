import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { HelpCircle, X, Copy, Check } from 'lucide-react'

interface SupportModalProps {
  isOpen: boolean
  onClose: () => void
  participantName: string
}

export default function SupportModal({ isOpen, onClose, participantName }: SupportModalProps) {
  const [codeCopied, setCodeCopied] = useState(false)

  const supportCode = `f-${participantName}`

  const handleCopy = () => {
    navigator.clipboard.writeText(supportCode)
    setCodeCopied(true)
    setTimeout(() => setCodeCopied(false), 2000)
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="w-full max-w-md mx-4 rounded-2xl bg-gray-900/95 border border-white/10 backdrop-blur-md shadow-2xl overflow-hidden"
            initial={{ scale: 0.9, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 pt-6 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-full bg-violet-500/20">
                  <HelpCircle className="w-5 h-5 text-violet-400" />
                </div>
                <h2 className="text-lg font-semibold text-white">Help & Support</h2>
              </div>
              <motion.button
                onClick={onClose}
                className="p-2 rounded-full bg-white/5 hover:bg-white/10 text-white/60 hover:text-white transition-colors"
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.95 }}
              >
                <X className="w-4 h-4" />
              </motion.button>
            </div>

            {/* Content */}
            <div className="px-6 pb-6 space-y-4">
              <div className="space-y-3">
                <div className="p-3 rounded-xl bg-white/5 border border-white/10">
                  <h3 className="text-sm font-medium text-white mb-1">No audio?</h3>
                  <p className="text-xs text-white/60">
                    Make sure your microphone is not muted (check the mic button at the top). Ensure your browser has permission to access your microphone.
                  </p>
                </div>

                <div className="p-3 rounded-xl bg-white/5 border border-white/10">
                  <h3 className="text-sm font-medium text-white mb-1">Can't hear the assistant?</h3>
                  <p className="text-xs text-white/60">
                    Check that your device volume is turned up and not on silent. Try clicking anywhere on the screen to enable audio playback.
                  </p>
                </div>

                <div className="p-3 rounded-xl bg-white/5 border border-white/10">
                  <h3 className="text-sm font-medium text-white mb-1">Connection issues?</h3>
                  <p className="text-xs text-white/60">
                    Ensure you have a stable internet connection. If the session freezes, try refreshing the page — you will be reconnected automatically.
                  </p>
                </div>
              </div>

              {/* Participant Support Code */}
              <div className="mt-4 p-4 rounded-xl bg-violet-500/10 border border-violet-400/20">
                <p className="text-xs text-white/60 mb-2">
                  If a technical issue prevented you from completing the session, please enter the following code in the Prolific study to report the problem:
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 px-3 py-2 rounded-lg bg-black/30 border border-white/10 text-violet-300 font-mono text-sm select-all">
                    {supportCode}
                  </code>
                  <motion.button
                    onClick={handleCopy}
                    className="p-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white/60 hover:text-white transition-colors"
                    title="Copy code"
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                  >
                    {codeCopied ? (
                      <Check className="w-4 h-4 text-green-400" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </motion.button>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
