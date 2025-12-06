import { motion } from 'framer-motion'

interface PresenceIndicatorProps {
  isOnline: boolean
  size?: 'sm' | 'md' | 'lg'
  showPulse?: boolean
  className?: string
}

const sizeClasses = {
  sm: 'w-2 h-2',
  md: 'w-2.5 h-2.5',
  lg: 'w-3 h-3',
}

export default function PresenceIndicator({
  isOnline,
  size = 'md',
  showPulse = true,
  className = '',
}: PresenceIndicatorProps) {
  return (
    <div className={`relative flex items-center justify-center ${className}`}>
      {/* Pulse animation for online status */}
      {isOnline && showPulse && (
        <motion.div
          className={`absolute ${sizeClasses[size]} rounded-full bg-green-500`}
          initial={{ scale: 1, opacity: 0.5 }}
          animate={{
            scale: [1, 1.5, 1],
            opacity: [0.5, 0, 0.5],
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />
      )}

      {/* Main indicator dot */}
      <div
        className={`
          ${sizeClasses[size]} rounded-full
          ${isOnline ? 'bg-green-500' : 'bg-gray-400 dark:bg-zinc-600'}
          transition-colors duration-300
        `}
      />
    </div>
  )
}

// Helper component that combines presence indicator with text
interface PresenceStatusProps {
  isOnline: boolean
  onlineText?: string
  offlineText?: string
  className?: string
}

export function PresenceStatus({
  isOnline,
  onlineText = 'Online',
  offlineText = 'Offline',
  className = '',
}: PresenceStatusProps) {
  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      <PresenceIndicator isOnline={isOnline} size="sm" showPulse={false} />
      <span
        className={`text-xs font-light ${
          isOnline ? 'text-green-500' : 'text-gray-400 dark:text-zinc-500'
        }`}
      >
        {isOnline ? onlineText : offlineText}
      </span>
    </div>
  )
}
