import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Clock, Copy, Check } from 'lucide-react'

interface SessionTimeoutOverlayProps {
  isVisible: boolean
  failureCode: string
}

export default function SessionTimeoutOverlay({ isVisible, failureCode }: SessionTimeoutOverlayProps) {
  const [copied, setCopied] = useState(false)

  const copyToClipboard = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(failureCode)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      const textarea = document.createElement('textarea')
      textarea.value = failureCode
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }, [failureCode])

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6 }}
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-md"
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.2, duration: 0.5, ease: 'easeOut' }}
            className="text-center max-w-md mx-4"
          >
            <motion.div
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.4, duration: 0.4, type: 'spring', stiffness: 200 }}
              className="w-20 h-20 mx-auto mb-6 rounded-full bg-amber-500/20 flex items-center justify-center"
            >
              <Clock className="w-10 h-10 text-amber-400" />
            </motion.div>

            <motion.h2
              initial={{ y: 10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.6, duration: 0.4 }}
              className="text-2xl font-light text-white mb-3"
            >
              Session Timed Out
            </motion.h2>

            <motion.p
              initial={{ y: 10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.8, duration: 0.4 }}
              className="text-white/60 text-sm leading-relaxed mb-6"
            >
              Your session has exceeded the maximum duration. Please return to your survey and enter the failure code below.
            </motion.p>

            <motion.div
              initial={{ y: 10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 1.0, duration: 0.4 }}
            >
              <button
                onClick={copyToClipboard}
                className="w-full bg-white/10 backdrop-blur-sm border border-white/20 rounded-xl px-6 py-4 cursor-pointer hover:bg-white/15 transition-colors group"
              >
                <p className="text-white/40 text-xs uppercase tracking-wider mb-2">
                  Your Failure Code
                </p>
                <div className="flex items-center justify-center gap-3">
                  <p className="text-white text-xl font-mono font-medium">
                    {failureCode}
                  </p>
                  {copied ? (
                    <Check className="w-5 h-5 text-green-400 flex-shrink-0" />
                  ) : (
                    <Copy className="w-5 h-5 text-white/40 group-hover:text-white/70 transition-colors flex-shrink-0" />
                  )}
                </div>
                <p className="text-white/40 text-xs mt-2">
                  {copied ? 'Copied!' : 'Click to copy'}
                </p>
              </button>
            </motion.div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
