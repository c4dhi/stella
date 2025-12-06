import { motion } from 'framer-motion'
import { MessageSquare, ArrowRight } from 'lucide-react'

interface OrganizerMessageModalProps {
  message: string
  participantName: string
  onContinue: () => void
}

export default function OrganizerMessageModal({
  message,
  participantName,
  onContinue,
}: OrganizerMessageModalProps) {
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
            Intelligent Voice Agents
          </p>
        </motion.div>

        {/* Message Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="relative"
        >
          {/* Glow effect */}
          <div className="absolute -inset-1 bg-gradient-to-r from-violet-600/20 via-cyan-500/20 to-blue-500/20 rounded-[24px] blur-xl opacity-50 -z-10" />

          <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-8 relative">
            {/* Header */}
            <div className="text-center mb-6">
              <div className="w-12 h-12 rounded-full bg-cyan-500/10 flex items-center justify-center mx-auto mb-4">
                <MessageSquare className="w-6 h-6 text-cyan-400" />
              </div>
              <h2 className="text-xl font-light text-white mb-2">
                Message from the Organizer
              </h2>
              <p className="text-white/50 text-sm">
                Hi {participantName}, the session organizer has a message for you.
              </p>
            </div>

            {/* Message Box */}
            <div className="mb-8">
              <div className="bg-white/5 border border-white/10 rounded-xl p-5">
                <p className="text-white/80 text-sm leading-relaxed whitespace-pre-wrap">
                  {message}
                </p>
              </div>
            </div>

            {/* Continue Button */}
            <button
              onClick={onContinue}
              className="
                w-full relative overflow-hidden group py-3.5 rounded-xl font-medium text-sm
                bg-gradient-to-r from-violet-600 to-violet-500 text-white
                transition-all duration-300
                hover:from-violet-500 hover:to-violet-400
                hover:shadow-[0_0_30px_rgba(124,58,237,0.4)]
              "
            >
              <span className="relative z-10 flex items-center justify-center gap-2">
                Join Session
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </span>
            </button>
          </div>
        </motion.div>
      </div>
    </motion.div>
  )
}
