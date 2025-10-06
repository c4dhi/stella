import { motion, AnimatePresence } from 'framer-motion'
import { useEffect, useState } from 'react'

interface UpdateNotification {
  id: string
  type: 'deliverable_collected' | 'state_changed' | 'task_completed' | 'progress_updated'
  title: string
  message: string
  timestamp: string
  data?: any
  read: boolean
  importance: 'low' | 'medium' | 'high'
}

interface NotificationSystemProps {
  notifications: UpdateNotification[]
  onMarkAsRead: (id: string) => void
  onClearAll: () => void
  maxVisible?: number
  autoHideDuration?: number
}

const NotificationIcon = ({ type, importance }: { type: UpdateNotification['type']; importance: UpdateNotification['importance'] }) => {
  const iconClass = importance === 'high' ? 'w-5 h-5' : 'w-4 h-4'

  switch (type) {
    case 'deliverable_collected':
      return (
        <motion.div
          className={`rounded-full flex items-center justify-center ${
            importance === 'high' ? 'bg-green-500 text-white p-1' : 'bg-green-100 text-green-600'
          }`}
          initial={{ scale: 0, rotate: -180 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ duration: 0.5, type: "spring" }}
        >
          <svg className={iconClass} viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
        </motion.div>
      )
    case 'state_changed':
      return (
        <motion.div
          className={`rounded-full flex items-center justify-center ${
            importance === 'high' ? 'bg-blue-500 text-white p-1' : 'bg-blue-100 text-blue-600'
          }`}
          initial={{ scale: 0, rotate: -90 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ duration: 0.6, type: "spring" }}
        >
          <svg className={iconClass} viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
          </svg>
        </motion.div>
      )
    case 'task_completed':
      return (
        <motion.div
          className={`rounded-full flex items-center justify-center ${
            importance === 'high' ? 'bg-yellow-500 text-white p-1' : 'bg-yellow-100 text-yellow-600'
          }`}
          initial={{ scale: 0 }}
          animate={{ scale: [1, 1.2, 1] }}
          transition={{ duration: 0.8, times: [0, 0.5, 1] }}
        >
          <svg className={iconClass} viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
        </motion.div>
      )
    case 'progress_updated':
      return (
        <motion.div
          className={`rounded-full flex items-center justify-center ${
            importance === 'high' ? 'bg-purple-500 text-white p-1' : 'bg-purple-100 text-purple-600'
          }`}
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ duration: 0.4 }}
        >
          <svg className={iconClass} viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-6-3a2 2 0 11-4 0 2 2 0 014 0zm-2 4a5 5 0 00-4.546 2.916A5.986 5.986 0 0010 16a5.986 5.986 0 004.546-2.084A5 5 0 0010 11z" clipRule="evenodd" />
          </svg>
        </motion.div>
      )
    default:
      return (
        <div className={`rounded-full bg-gray-100 text-gray-600 flex items-center justify-center`}>
          <div className="w-2 h-2 bg-gray-400 rounded-full" />
        </div>
      )
  }
}

const NotificationToast = ({
  notification,
  index,
  onMarkAsRead,
  autoHideDuration = 5000
}: {
  notification: UpdateNotification;
  index: number;
  onMarkAsRead: (id: string) => void;
  autoHideDuration?: number;
}) => {
  const [isVisible, setIsVisible] = useState(true)

  useEffect(() => {
    if (notification.importance !== 'high') {
      const timer = setTimeout(() => {
        setIsVisible(false)
        setTimeout(() => onMarkAsRead(notification.id), 300)
      }, autoHideDuration)

      return () => clearTimeout(timer)
    }
  }, [notification, autoHideDuration, onMarkAsRead])

  const handleDismiss = () => {
    setIsVisible(false)
    setTimeout(() => onMarkAsRead(notification.id), 300)
  }

  if (!isVisible) return null

  return (
    <motion.div
      initial={{
        opacity: 0,
        x: 300,
        scale: 0.9
      }}
      animate={{
        opacity: 1,
        x: 0,
        scale: 1
      }}
      exit={{
        opacity: 0,
        x: 300,
        scale: 0.9
      }}
      transition={{
        duration: 0.4,
        delay: index * 0.1,
        ease: [0.25, 0.46, 0.45, 0.94]
      }}
      className={`
        relative p-4 rounded-xl border shadow-lg backdrop-blur-sm cursor-pointer group
        ${notification.importance === 'high'
          ? 'bg-white/95 border-blue-200 shadow-blue-100/50'
          : 'bg-white/90 border-neutral-200/60'
        }
      `}
      onClick={handleDismiss}
      whileHover={{ scale: 1.02, y: -2 }}
      whileTap={{ scale: 0.98 }}
    >
      {/* Importance indicator */}
      {notification.importance === 'high' && (
        <motion.div
          className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full border-2 border-white"
          animate={{
            scale: [1, 1.2, 1],
            opacity: [0.8, 1, 0.8]
          }}
          transition={{
            duration: 1.5,
            repeat: Infinity
          }}
        />
      )}

      <div className="flex items-start gap-3">
        <NotificationIcon type={notification.type} importance={notification.importance} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-1">
            <h4 className={`font-medium truncate ${
              notification.importance === 'high' ? 'text-sm text-neutral-900' : 'text-xs text-neutral-800'
            }`}>
              {notification.title}
            </h4>
            <time className="text-[9px] text-neutral-500 shrink-0">
              {new Date(notification.timestamp).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit'
              })}
            </time>
          </div>

          <p className={`leading-relaxed ${
            notification.importance === 'high' ? 'text-xs text-neutral-700' : 'text-[11px] text-neutral-600'
          }`}>
            {notification.message}
          </p>

          {/* Enhanced info for deliverable collections */}
          {notification.type === 'deliverable_collected' && notification.data?.reasoning && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              transition={{ duration: 0.3, delay: 0.5 }}
              className="mt-2 p-2 bg-green-50/80 rounded-md border border-green-200/40"
            >
              <div className="text-[9px] text-green-700 font-medium mb-1">
                AI Reasoning:
              </div>
              <div className="text-[10px] text-green-800 italic leading-relaxed">
                {notification.data.reasoning}
              </div>
              {notification.data.confidence && (
                <div className="text-[9px] text-green-600 mt-1">
                  Confidence: {Math.round(notification.data.confidence * 100)}%
                </div>
              )}
            </motion.div>
          )}
        </div>

        {/* Dismiss button */}
        <motion.button
          onClick={handleDismiss}
          className="opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center rounded-full hover:bg-neutral-100 transition-all duration-200"
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
        >
          <svg className="w-3 h-3 text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </motion.button>
      </div>

      {/* Auto-hide progress bar */}
      {notification.importance !== 'high' && (
        <motion.div
          className="absolute bottom-0 left-0 h-0.5 bg-gradient-to-r from-blue-400 to-blue-600 rounded-full"
          initial={{ width: '100%' }}
          animate={{ width: '0%' }}
          transition={{ duration: autoHideDuration / 1000, ease: "linear" }}
        />
      )}
    </motion.div>
  )
}

export default function NotificationSystem({
  notifications,
  onMarkAsRead,
  onClearAll,
  maxVisible = 3,
  autoHideDuration = 5000
}: NotificationSystemProps) {
  const unreadNotifications = notifications.filter(n => !n.read)
  const visibleNotifications = unreadNotifications.slice(0, maxVisible)

  return (
    <div className="fixed top-4 right-4 z-50 space-y-3 max-w-sm">
      <AnimatePresence mode="popLayout">
        {visibleNotifications.map((notification, index) => (
          <NotificationToast
            key={notification.id}
            notification={notification}
            index={index}
            onMarkAsRead={onMarkAsRead}
            autoHideDuration={autoHideDuration}
          />
        ))}
      </AnimatePresence>

      {/* Clear all button */}
      {unreadNotifications.length > maxVisible && (
        <motion.button
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.8 }}
          onClick={onClearAll}
          className="w-full p-2 rounded-lg bg-white/80 backdrop-blur-sm border border-neutral-200/60 text-xs text-neutral-600 hover:text-neutral-800 hover:bg-white/90 transition-all duration-200"
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          Clear all ({unreadNotifications.length} notifications)
        </motion.button>
      )}
    </div>
  )
}