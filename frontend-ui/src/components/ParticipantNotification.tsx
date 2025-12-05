import { motion } from 'framer-motion'
import type { ParticipantEvent } from '../lib/types'
import { useThemeStore } from '../store/themeStore'

interface ParticipantNotificationProps {
  event: ParticipantEvent
}

export default function ParticipantNotification({ event }: ParticipantNotificationProps) {
  const displayName = event.participantName || event.participantId || 'Unknown'
  const actionText = event.type === 'joined' ? 'joined the session' : 'left the session'
  const { resolvedTheme } = useThemeStore()
  const isDark = resolvedTheme === 'dark'

  return (
    <motion.div
      className="flex justify-center w-full"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ duration: 0.3 }}
    >
      <motion.div
        className={`
          inline-flex items-center gap-2 px-4 py-2 rounded-full
          text-caption font-light tracking-wide backdrop-blur-sm
          ${isDark
            ? 'bg-zinc-800 text-zinc-300 border border-zinc-700'
            : 'bg-neutral-100 text-neutral-500 border border-neutral-200'
          }
        `}
        initial={{ y: 10 }}
        animate={{ y: 0 }}
        transition={{ delay: 0.1, duration: 0.3 }}
      >
        {/* Join/Leave Icon */}
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.2, duration: 0.3 }}
          className="flex items-center"
        >
          {event.type === 'joined' ? (
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className={isDark ? 'text-zinc-500' : 'text-neutral-400'}
            >
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <line x1="19" y1="8" x2="19" y2="14" />
              <line x1="22" y1="11" x2="16" y2="11" />
            </svg>
          ) : (
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className={isDark ? 'text-zinc-500' : 'text-neutral-400'}
            >
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <line x1="22" y1="11" x2="16" y2="11" />
            </svg>
          )}
        </motion.div>

        {/* Text */}
        <motion.span
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3, duration: 0.3 }}
          className="whitespace-nowrap"
        >
          <span className={isDark ? 'text-zinc-300 font-medium' : 'text-neutral-600 font-medium'}>{displayName}</span>
          <span className="ml-1">{actionText}</span>
        </motion.span>
      </motion.div>
    </motion.div>
  )
}