import { motion, AnimatePresence } from 'framer-motion'
import { useState, useMemo, forwardRef } from 'react'

interface RecentUpdate {
  id: string
  type: 'deliverable' | 'state' | 'task' | 'progress'
  description: string
  timestamp: string
  data: any
}

interface ActivityFeedProps {
  recentUpdates: RecentUpdate[]
  maxItems?: number
  showTimestamps?: boolean
  className?: string
}

const UpdateTypeIcon = ({ type }: { type: RecentUpdate['type'] }) => {
  switch (type) {
    case 'deliverable':
      return (
        <div className="w-6 h-6 rounded-full bg-green-100 border border-green-200 flex items-center justify-center">
          <svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor" className="text-green-600">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
        </div>
      )
    case 'state':
      return (
        <div className="w-6 h-6 rounded-full bg-blue-100 border border-blue-200 flex items-center justify-center">
          <svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor" className="text-blue-600">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-8.293l-3-3a1 1 0 00-1.414-1.414L9 7.586 7.707 6.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4a1 1 0 00-1.414-1.414L10 9.586z" clipRule="evenodd" />
          </svg>
        </div>
      )
    case 'task':
      return (
        <div className="w-6 h-6 rounded-full bg-yellow-100 border border-yellow-200 flex items-center justify-center">
          <svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor" className="text-yellow-600">
            <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
      )
    case 'progress':
      return (
        <div className="w-6 h-6 rounded-full bg-purple-100 border border-purple-200 flex items-center justify-center">
          <svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor" className="text-purple-600">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-8.293l-3-3a1 1 0 00-1.414-1.414L9 7.586 7.707 6.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4a1 1 0 00-1.414-1.414L10 9.586z" clipRule="evenodd" />
          </svg>
        </div>
      )
    default:
      return (
        <div className="w-6 h-6 rounded-full bg-gray-100 border border-gray-200 flex items-center justify-center">
          <div className="w-2 h-2 bg-gray-400 rounded-full" />
        </div>
      )
  }
}

const formatRelativeTime = (timestamp: string): string => {
  const now = new Date()
  const updateTime = new Date(timestamp)
  const diffInMs = now.getTime() - updateTime.getTime()
  const diffInSeconds = Math.floor(diffInMs / 1000)
  const diffInMinutes = Math.floor(diffInSeconds / 60)
  const diffInHours = Math.floor(diffInMinutes / 60)

  if (diffInSeconds < 60) {
    return 'Just now'
  } else if (diffInMinutes < 60) {
    return `${diffInMinutes}m ago`
  } else if (diffInHours < 24) {
    return `${diffInHours}h ago`
  } else {
    return updateTime.toLocaleDateString()
  }
}

const ActivityItem = forwardRef<HTMLDivElement, {
  update: RecentUpdate;
  index: number;
  showTimestamp?: boolean;
}>(({ update, index, showTimestamp = true }, ref) => {
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, x: -20, scale: 0.95 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      transition={{
        duration: 0.4,
        delay: index * 0.08,
        ease: [0.25, 0.46, 0.45, 0.94]
      }}
      className="flex items-start gap-3 p-3 rounded-lg border border-neutral-200/50 bg-white/60 hover:bg-white/80 hover:border-neutral-300/60 transition-all duration-200"
    >
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ duration: 0.3, delay: index * 0.1 + 0.2 }}
      >
        <UpdateTypeIcon type={update.type} />
      </motion.div>

      <div className="flex-1 min-w-0 space-y-1 overflow-hidden">
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs text-neutral-800 leading-relaxed break-words flex-1 min-w-0">
            {update.description}
          </p>
          {showTimestamp && (
            <motion.time
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3, delay: index * 0.1 + 0.4 }}
              className="text-[10px] text-neutral-500 tracking-wide shrink-0 whitespace-nowrap"
            >
              {formatRelativeTime(update.timestamp)}
            </motion.time>
          )}
        </div>

        {/* Type indicator */}
        <div className="flex items-center gap-1">
          <span className={`text-[9px] tracking-wider uppercase font-medium px-1.5 py-0.5 rounded-md whitespace-nowrap ${update.type === 'deliverable' ? 'bg-green-100 text-green-700' :
            update.type === 'state' ? 'bg-blue-100 text-blue-700' :
              update.type === 'task' ? 'bg-yellow-100 text-yellow-700' :
                update.type === 'progress' ? 'bg-purple-100 text-purple-700' :
                  'bg-gray-100 text-gray-700'
            }`}>
            {update.type}
          </span>
        </div>
      </div>
    </motion.div>
  )
})

ActivityItem.displayName = 'ActivityItem'

const EmptyState = () => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.4 }}
    className="text-center py-8 px-4"
  >
    <motion.div
      animate={{
        opacity: [0.3, 0.6, 0.3],
        scale: [1, 1.05, 1]
      }}
      transition={{
        duration: 3,
        repeat: Infinity,
        ease: "easeInOut"
      }}
      className="w-12 h-12 mx-auto mb-3 rounded-full bg-neutral-100 border border-neutral-200/60 flex items-center justify-center"
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-neutral-400">
        <path
          d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </motion.div>
    <div className="text-xs text-neutral-500 tracking-wide">
      No recent activity
    </div>
    <div className="text-[10px] text-neutral-400 mt-1">
      Updates will appear here as tasks progress
    </div>
  </motion.div>
)

export default function ActivityFeed({
  recentUpdates,
  maxItems = 10,
  showTimestamps = true,
  className = ""
}: ActivityFeedProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  const displayUpdates = useMemo(() => {
    return recentUpdates.slice(0, isExpanded ? maxItems : Math.min(5, maxItems))
  }, [recentUpdates, maxItems, isExpanded])

  const hasMoreItems = recentUpdates.length > (isExpanded ? maxItems : 5)

  if (recentUpdates.length === 0) {
    return (
      <div className={`rounded-lg border border-neutral-200/60 bg-white/40 backdrop-blur-sm ${className}`}>
        <EmptyState />
      </div>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className={`rounded-lg border border-neutral-200/60 bg-white/40 backdrop-blur-sm flex flex-col h-full ${className}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-neutral-200/50 flex-shrink-0">
        <div className="flex items-center gap-2">
          <motion.div
            className="w-2 h-2 bg-green-500 rounded-full"
            animate={{
              opacity: [0.4, 1, 0.4],
              scale: [1, 1.3, 1]
            }}
            transition={{
              duration: 2,
              repeat: Infinity
            }}
          />
          <h3 className="text-xs font-medium text-neutral-700 tracking-wide">
            Recent Activity
          </h3>
          <span className="text-[10px] text-neutral-500 bg-neutral-100 px-1.5 py-0.5 rounded-full">
            {recentUpdates.length}
          </span>
        </div>

        {hasMoreItems && (
          <motion.button
            onClick={() => setIsExpanded(!isExpanded)}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="text-[10px] text-neutral-600 hover:text-neutral-800 font-medium tracking-wide transition-colors"
          >
            {isExpanded ? 'Show Less' : 'Show More'}
          </motion.button>
        )}
      </div>

      {/* Updates list */}
      <div className="p-3 space-y-2 overflow-y-auto overflow-x-hidden flex-1 min-h-0">
        <AnimatePresence mode="popLayout">
          {displayUpdates.map((update, index) => (
            <ActivityItem
              key={update.id}
              update={update}
              index={index}
              showTimestamp={showTimestamps}
            />
          ))}
        </AnimatePresence>
      </div>

      {/* Footer with expand indicator */}
      {!isExpanded && hasMoreItems && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="p-2 border-t border-neutral-200/50 text-center flex-shrink-0"
        >
          <motion.button
            onClick={() => setIsExpanded(true)}
            whileHover={{ scale: 1.02 }}
            className="text-[10px] text-neutral-500 hover:text-neutral-700 tracking-wide transition-colors"
          >
            + {recentUpdates.length - 5} more updates
          </motion.button>
        </motion.div>
      )}
    </motion.div>
  )
}