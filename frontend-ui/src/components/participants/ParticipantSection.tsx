import { motion } from 'framer-motion'
import type { Participant } from '../../lib/api-types'

interface ParticipantSectionProps {
  sessionId: string
  participants: Participant[]
  onRegisterClick: () => void
  onShowConnectionInfo: (participantId: string) => void
  onRemoveParticipant: (participantId: string, participantName: string) => void
}

export default function ParticipantSection({
  sessionId,
  participants,
  onRegisterClick,
  onShowConnectionInfo,
  onRemoveParticipant
}: ParticipantSectionProps) {
  return (
      <motion.div
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.4, delay: 0.1 }}
        className="w-80 flex flex-col"
      >
        {/* Participants Panel */}
        <div
          className="
            bg-white/95 backdrop-blur-xl border border-neutral-200/60
            rounded-[16px] shadow-[0_1px_30px_rgba(0,0,0,0.04)]
            flex flex-col overflow-hidden
          "
        >
          {/* Header */}
          <div className="p-4 border-b border-neutral-200/60">
            <h2 className="text-lg font-thin text-neutral-900 tracking-wider mb-1">
              Participants
            </h2>
            <p className="text-[10px] text-neutral-500 font-light tracking-wider uppercase">
              {participants.filter(p => !p.leftAt).length} active
            </p>
          </div>

          {/* Register Button */}
          <div className="p-4 border-b border-neutral-200/60">
            <button
              onClick={onRegisterClick}
              className="
                w-full py-2.5 px-4 rounded-xl
                bg-neutral-900 text-white text-sm font-light tracking-wider
                hover:bg-neutral-800 shadow-[0_1px_20px_rgba(0,0,0,0.12)]
                transition-all duration-200
                flex items-center justify-center gap-2
              "
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
              Register Participant
            </button>
          </div>

          {/* Participants List */}
          <div className="p-4 space-y-3 max-h-64 overflow-y-auto">
            {participants.length === 0 ? (
              <div className="text-center py-8 text-sm text-neutral-400 font-light">
                No participants registered yet
              </div>
            ) : (
              participants
                .filter(p => !p.leftAt)
                .map(participant => (
                  <motion.div
                    key={participant.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="
                      p-4 rounded-xl
                      bg-neutral-50/50 border border-neutral-200/60
                      hover:bg-white hover:border-neutral-300/60
                      transition-all duration-200
                    "
                  >
                    {/* Participant Name */}
                    <div className="flex items-start justify-between mb-2">
                      <div className="text-sm font-light text-neutral-900 flex items-center gap-2">
                        <span>👤</span>
                        <span>{participant.name}</span>
                      </div>
                    </div>

                    {/* Joined Date */}
                    <div className="text-[10px] text-neutral-400 font-light tracking-wider uppercase mb-3">
                      Joined {new Date(participant.joinedAt).toLocaleTimeString()}
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2">
                      <button
                        onClick={() => onShowConnectionInfo(participant.id)}
                        className="
                          flex-1 py-1.5 px-2 rounded-lg text-xs font-light
                          bg-white border border-neutral-200/60
                          text-neutral-600 hover:text-neutral-900 hover:border-neutral-300/60
                          transition-all duration-200
                          flex items-center justify-center gap-1
                        "
                      >
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                        >
                          <circle cx="12" cy="12" r="10" />
                          <path d="M12 16v-4M12 8h.01" />
                        </svg>
                        Info
                      </button>
                      <button
                        onClick={() => onRemoveParticipant(participant.id, participant.name)}
                        className="
                          py-1.5 px-2 rounded-lg text-xs font-light
                          text-red-600 hover:bg-red-50/80
                          transition-all duration-200
                        "
                        title="Remove participant"
                      >
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                        >
                          <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6" />
                        </svg>
                      </button>
                    </div>
                  </motion.div>
                ))
            )}
          </div>
        </div>
      </motion.div>
  )
}
