import { motion, AnimatePresence } from 'framer-motion'
import { useStore } from '../store'
import AgentTaskCard from './AgentTaskCard'
import { useEffect, useState } from 'react'

export default function TaskPanel() {
  const agentTaskLists = useStore(s => s.agentTaskLists)
  const showTaskPanel = useStore(s => s.showTaskPanel)
  const isTaskPanelInHistoryMode = useStore(s => s.isTaskPanelInHistoryMode)
  const currentHistoricalTimestamp = useStore(s => s.currentHistoricalTimestamp)

  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    if (showTaskPanel && agentTaskLists.size > 0) {
      const timer = setTimeout(() => setIsVisible(true), 100)
      return () => clearTimeout(timer)
    } else {
      setIsVisible(false)
    }
  }, [showTaskPanel, agentTaskLists])

  if (!showTaskPanel || agentTaskLists.size === 0) {
    return null
  }

  // Format historical timestamp for display
  const historyTimeString = currentHistoricalTimestamp
    ? new Date(currentHistoricalTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : ''

  return (
    <AnimatePresence>
      {isVisible && (
        <div className="flex flex-col gap-3 h-full overflow-hidden">
          {/* History Mode Indicator */}
          {isTaskPanelInHistoryMode && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="px-3 py-2 bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg flex items-center gap-2 text-xs text-neutral-600 dark:text-neutral-300"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>Viewing state from {historyTimeString}</span>
            </motion.div>
          )}

          {/* Agent Task Cards */}
          <div className="flex gap-3 flex-1 overflow-x-auto">
            {Array.from(agentTaskLists.entries()).map(([agentId, todoList], index) => (
              <motion.div
                key={agentId}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                transition={{
                  duration: 0.4,
                  delay: index * 0.1,
                  ease: [0.16, 1, 0.3, 1]
                }}
              >
                <AgentTaskCard
                  agentId={agentId}
                  agentName={todoList.agentName}
                  todoList={todoList}
                  isHistoryMode={isTaskPanelInHistoryMode}
                />
              </motion.div>
            ))}
          </div>
        </div>
      )}
    </AnimatePresence>
  )
}