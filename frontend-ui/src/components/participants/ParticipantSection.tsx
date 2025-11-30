import { motion } from 'framer-motion'
import type { Participant } from '../../lib/api-types'
import { useThemeStore } from '../../store/themeStore'

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
  const { resolvedTheme } = useThemeStore()
  const isDark = resolvedTheme === 'dark'

  return (
      <motion.div
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.4, delay: 0.1 }}
        className="w-80 flex flex-col"
      >
        {/* Participants Panel */}
        <div
          className={`
            backdrop-blur-xl rounded-[16px] flex flex-col overflow-hidden
            ${isDark
              ? 'bg-white/5 border border-white/10'
              : 'bg-white border border-border shadow-sm'
            }
          `}
        >
          {/* Header */}
          <div className={`p-4 border-b ${isDark ? 'border-white/10' : 'border-border'}`}>
            <h2 className={`text-lg font-thin tracking-wider mb-1 ${isDark ? 'text-content-inverse' : 'text-content'}`}>
              Participants
            </h2>
            <p className={`text-[10px] font-light tracking-wider uppercase ${isDark ? 'text-content-inverse-secondary' : 'text-content-tertiary'}`}>
              {participants.filter(p => !p.leftAt).length} active
            </p>
          </div>

          {/* Register Button */}
          <div className={`p-4 border-b ${isDark ? 'border-white/10' : 'border-border'}`}>
            <button
              onClick={onRegisterClick}
              className={`
                w-full py-2.5 px-4 rounded-xl text-sm font-light tracking-wider
                transition-all duration-200 flex items-center justify-center gap-2
                ${isDark
                  ? 'bg-white/10 text-white hover:bg-white/20 border border-white/10'
                  : 'bg-content text-white hover:bg-content/90 shadow-sm'
                }
              `}
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
              <div className={`text-center py-8 text-sm font-light ${isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'}`}>
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
                    className={`
                      p-4 rounded-xl transition-all duration-200
                      ${isDark
                        ? 'bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20'
                        : 'bg-surface-secondary border border-border hover:bg-surface-tertiary hover:border-border-secondary'
                      }
                    `}
                  >
                    {/* Participant Name */}
                    <div className="flex items-start justify-between mb-2">
                      <div className={`text-sm font-light flex items-center gap-2 ${isDark ? 'text-content-inverse' : 'text-content'}`}>
                        <span>👤</span>
                        <span>{participant.name}</span>
                      </div>
                    </div>

                    {/* Joined Date */}
                    <div className={`text-[10px] font-light tracking-wider uppercase mb-3 ${isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'}`}>
                      Joined {new Date(participant.joinedAt).toLocaleTimeString()}
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2">
                      <button
                        onClick={() => onShowConnectionInfo(participant.id)}
                        className={`
                          flex-1 py-1.5 px-2 rounded-lg text-xs font-light
                          transition-all duration-200 flex items-center justify-center gap-1
                          ${isDark
                            ? 'bg-white/10 border border-white/10 text-content-inverse-secondary hover:text-content-inverse hover:border-white/20'
                            : 'bg-white border border-border text-content-secondary hover:text-content hover:border-border-secondary'
                          }
                        `}
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
                        className={`
                          py-1.5 px-2 rounded-lg text-xs font-light transition-all duration-200
                          ${isDark
                            ? 'text-red-400 hover:bg-red-500/20'
                            : 'text-red-500 hover:bg-red-50'
                          }
                        `}
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
