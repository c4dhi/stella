import { motion, AnimatePresence } from 'framer-motion'
import React, { useState } from 'react'
import { StateType, StateStatus, TaskStatus, DeliverableStatus } from '../lib/types'

interface StateDeliverable {
  key: string
  description: string
  type: string
  required: boolean
  status: DeliverableStatus
  value?: any
  collected_at?: string | null
  confidence?: number
  reasoning?: string
  acceptance_criteria?: string
}

interface StateTask {
  id: string
  description: string
  instruction: string
  required: boolean
  status: TaskStatus
  deliverables: StateDeliverable[]
}

interface StateItem {
  id: string
  title: string
  type: StateType
  description: string
  status: StateStatus
  is_current: boolean
  completed_at?: string
  tasks: StateTask[]
}

interface StateListProps {
  states: StateItem[]
  currentStateId: string | null
  deliverables: Record<string, any>
}

const ProcessingModeIcon = ({ type }: { type: StateType }) => {
  if (type === StateType.STRICT) {
    return (
      <div className="flex items-center gap-1" title="Sequential Processing">
        <span className="text-[10px] text-neutral-600 dark:text-neutral-400">⚡</span>
        <span className="text-[8px] text-neutral-500 dark:text-neutral-400 tracking-wider uppercase">Sequential</span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1" title="Flexible Processing">
      <span className="text-[10px] text-neutral-600 dark:text-neutral-400">🔄</span>
      <span className="text-[8px] text-neutral-500 dark:text-neutral-400 tracking-wider uppercase">Flexible</span>
    </div>
  )
}

const StateStatusIcon = ({ status }: { status: StateStatus }) => {
  switch (status) {
    case StateStatus.COMPLETED:
      return (
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          className="w-3 h-3 rounded-full bg-neutral-900 dark:bg-neutral-100 flex items-center justify-center"
        >
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
            <path
              d="M1.5 4l1.5 1.5L6.5 2"
              stroke="currentColor"
              className="text-white dark:text-neutral-900"
              strokeWidth="1"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </motion.div>
      )
    case StateStatus.IN_PROGRESS:
      return (
        <div className="w-3 h-3 rounded-full bg-blue-500" />
      )
    default:
      return (
        <div className="w-3 h-3 rounded-full border border-neutral-300 dark:border-neutral-600" />
      )
  }
}

const TaskStatusIcon = ({ status }: { status: TaskStatus }) => {
  switch (status) {
    case TaskStatus.COMPLETED:
      return (
        <div className="w-4 h-4 rounded-full bg-green-500 flex items-center justify-center flex-shrink-0">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path
              d="M2 5l2 2 4-4"
              stroke="white"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      )
    case TaskStatus.IN_PROGRESS:
      return <div className="w-4 h-4 rounded-full bg-blue-500 flex-shrink-0" />
    case TaskStatus.SKIPPED:
      return (
        <div className="w-4 h-4 rounded-full bg-neutral-300 dark:bg-neutral-600 flex items-center justify-center flex-shrink-0">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path
              d="M3 3l4 4M7 3l-4 4"
              stroke="white"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      )
    default:
      return <div className="w-4 h-4 rounded-full border-2 border-neutral-300 dark:border-neutral-600 flex-shrink-0" />
  }
}

const DeliverableStatusIcon = ({ status }: { status: DeliverableStatus }) => {
  switch (status) {
    case DeliverableStatus.COMPLETED:
      return <span className="text-green-600 dark:text-green-400 text-[10px]">✓</span>
    case DeliverableStatus.PARTIAL:
      return <span className="text-yellow-600 dark:text-yellow-400 text-[10px]">◐</span>
    case DeliverableStatus.SKIPPED:
      return <span className="text-neutral-400 dark:text-neutral-500 text-[10px]">⊘</span>
    default:
      return <span className="text-neutral-400 dark:text-neutral-500 text-[10px]">○</span>
  }
}

const DeliverableRow = ({ deliverable, index }: { deliverable: StateDeliverable; index: number }) => {
  const [showDetails, setShowDetails] = useState(false)
  const hasValue = deliverable.value !== null && deliverable.value !== undefined && deliverable.value !== ''
  const isSkipped = deliverable.status === DeliverableStatus.SKIPPED

  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.2, delay: index * 0.05 }}
      className="pl-6 border-l border-neutral-200/40 dark:border-neutral-700/40"
    >
      <div
        className={`flex items-center justify-between p-2 rounded-md cursor-pointer transition-colors ${
          isSkipped ? 'bg-neutral-50/50 dark:bg-neutral-800/50 hover:bg-neutral-100/50 dark:hover:bg-neutral-700/50 opacity-60' :
          hasValue ? 'bg-green-50/50 dark:bg-green-900/20 hover:bg-green-50 dark:hover:bg-green-900/30' : 'hover:bg-neutral-50 dark:hover:bg-neutral-800/50'
        }`}
        onClick={() => setShowDetails(!showDetails)}
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <DeliverableStatusIcon status={deliverable.status} />
          <span className={`text-[10px] text-neutral-700 dark:text-neutral-300 truncate ${isSkipped ? 'line-through text-neutral-400 dark:text-neutral-500' : ''}`}>
            {deliverable.description}
            {deliverable.required && !isSkipped && <span className="text-red-500 dark:text-red-400 ml-1">*</span>}
            {isSkipped && <span className="text-[8px] text-neutral-400 dark:text-neutral-500 ml-1.5 bg-neutral-200 dark:bg-neutral-700 px-1 py-0.5 rounded uppercase font-medium">Skipped</span>}
          </span>
        </div>
      </div>

      <AnimatePresence>
        {showDetails && hasValue && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="mt-2 pl-4 space-y-2"
          >
            <div className="text-[10px] text-neutral-800 dark:text-neutral-200 bg-neutral-50 dark:bg-neutral-800 p-2 rounded border dark:border-neutral-700">
              <strong>Value:</strong> {String(deliverable.value)}
            </div>

            {deliverable.reasoning && (
              <div className="text-[9px] text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-900/30 p-2 rounded border border-green-200 dark:border-green-800">
                <strong>Why collected:</strong> {deliverable.reasoning}
              </div>
            )}

            {deliverable.acceptance_criteria && (
              <div className="text-[9px] text-neutral-600 dark:text-neutral-400 bg-neutral-50 dark:bg-neutral-800 p-2 rounded border dark:border-neutral-700">
                <strong>Criteria:</strong> {deliverable.acceptance_criteria}
              </div>
            )}

            {deliverable.collected_at && (
              <div className="text-[8px] text-neutral-500 dark:text-neutral-400">
                Collected: {new Date(deliverable.collected_at).toLocaleString()}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

const TaskRow = ({ task, index, isInCurrentState }: { task: StateTask; index: number; isInCurrentState: boolean }) => {
  const [isExpanded, setIsExpanded] = useState(false)
  const isSkipped = task.status === TaskStatus.SKIPPED

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.1 }}
      className="pl-4 border-l border-neutral-200/60 dark:border-neutral-700/60"
    >
      <div
        className={`flex items-center justify-between p-3 rounded-lg cursor-pointer transition-all border ${
          isSkipped
            ? 'bg-neutral-50/60 dark:bg-neutral-800/60 border-neutral-200/40 dark:border-neutral-700/40 hover:bg-neutral-100/50 dark:hover:bg-neutral-700/50 opacity-70'
            : task.status === TaskStatus.IN_PROGRESS
            ? 'bg-blue-50/50 dark:bg-blue-900/20 border-blue-200/60 dark:border-blue-800/60 hover:bg-blue-50/70 dark:hover:bg-blue-900/30'
            : task.status === TaskStatus.COMPLETED
            ? 'bg-white dark:bg-neutral-800 border-neutral-200/50 dark:border-neutral-700/50 hover:bg-neutral-50/50 dark:hover:bg-neutral-700/50'
            : 'bg-white dark:bg-neutral-800 border-neutral-200/50 dark:border-neutral-700/50 hover:bg-neutral-50/50 dark:hover:bg-neutral-700/50'
        }`}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <TaskStatusIcon status={task.status} />
          <div className="min-w-0 flex-1">
            <div className={`text-[11px] font-medium text-neutral-800 dark:text-neutral-200 truncate ${isSkipped ? 'line-through text-neutral-400 dark:text-neutral-500' : ''}`}>
              {task.description}
              {task.required && !isSkipped && <span className="text-red-500 dark:text-red-400 ml-1">*</span>}
              {isSkipped && <span className="text-[9px] text-neutral-500 dark:text-neutral-400 ml-2 bg-neutral-200 dark:bg-neutral-700 px-2 py-0.5 rounded-full uppercase font-medium">Skipped</span>}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {task.deliverables.length > 0 && (
            <span className="text-[8px] text-neutral-500 dark:text-neutral-400 bg-neutral-100 dark:bg-neutral-700 px-1.5 py-0.5 rounded">
              {task.deliverables.filter(d => d.status === DeliverableStatus.COMPLETED || d.status === DeliverableStatus.SKIPPED).length}/{task.deliverables.length}
            </span>
          )}
          {task.deliverables.length > 0 && (
            <motion.div
              animate={{ rotate: isExpanded ? 180 : 0 }}
              transition={{ duration: 0.2 }}
              className="text-neutral-400 dark:text-neutral-500"
            >
              <svg width="10" height="6" viewBox="0 0 10 6" fill="none">
                <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </motion.div>
          )}
        </div>
      </div>

      <AnimatePresence>
        {isExpanded && task.deliverables.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3 }}
            className="mt-2 space-y-1"
          >
            {task.deliverables.map((deliverable, idx) => (
              <DeliverableRow
                key={deliverable.key}
                deliverable={deliverable}
                index={idx}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

const StateCard = ({ state, index, isCurrentState }: { state: StateItem; index: number; isCurrentState: boolean }) => {
  const [isExpanded, setIsExpanded] = useState(isCurrentState || state.status === StateStatus.IN_PROGRESS)

  // Auto-expand when state becomes current
  React.useEffect(() => {
    if (isCurrentState) {
      setIsExpanded(true)
    }
  }, [isCurrentState])

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.1 }}
      className={`rounded-lg border transition-all ${
        isCurrentState
          ? 'border-blue-400/70 dark:border-blue-600/70 bg-gradient-to-br from-blue-50/80 to-blue-100/40 dark:from-blue-900/30 dark:to-blue-800/20 shadow-md ring-1 ring-blue-200/50 dark:ring-blue-700/50'
          : state.status === StateStatus.COMPLETED
          ? 'border-green-300/50 dark:border-green-700/50 bg-green-50/30 dark:bg-green-900/20'
          : state.status === StateStatus.IN_PROGRESS
          ? 'border-yellow-300/50 dark:border-yellow-700/50 bg-yellow-50/30 dark:bg-yellow-900/20'
          : 'border-neutral-200/60 dark:border-neutral-700/60 bg-white/80 dark:bg-neutral-800/80 hover:bg-neutral-50/50 dark:hover:bg-neutral-700/50'
      }`}
    >
      <div
        className="p-4 cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className="mt-1">
              <StateStatusIcon status={state.status} />
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="text-sm font-medium text-neutral-900 dark:text-neutral-100 truncate">
                  {state.title}
                </h3>
              </div>

              {state.tasks.length > 0 && (
                <span className="text-[10px] text-neutral-500 dark:text-neutral-400">
                  {state.tasks.filter(t => t.status === TaskStatus.COMPLETED || t.status === TaskStatus.SKIPPED).length}/{state.tasks.length} tasks done
                </span>
              )}
            </div>
          </div>

          <motion.div
            animate={{ rotate: isExpanded ? 180 : 0 }}
            transition={{ duration: 0.2 }}
            className="text-neutral-400 dark:text-neutral-500"
          >
            <svg width="12" height="8" viewBox="0 0 12 8" fill="none">
              <path d="M2 2l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </motion.div>
        </div>

        {/* Show details only when expanded */}
        <AnimatePresence>
          {isExpanded && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              className="mt-3 pt-3 border-t border-neutral-200/50 dark:border-neutral-700/50 space-y-2"
            >
              <p className="text-[10px] text-neutral-600 dark:text-neutral-400 leading-relaxed">
                {state.description}
              </p>

              <div className="flex items-center gap-4">
                <ProcessingModeIcon type={state.type} />
                <span className="text-[8px] text-neutral-500 dark:text-neutral-400 tracking-wider uppercase">
                  {state.status.replace('_', ' ')}
                </span>
                {state.completed_at && (
                  <span className="text-[8px] text-neutral-400 dark:text-neutral-500">
                    {new Date(state.completed_at).toLocaleTimeString()}
                  </span>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {isExpanded && state.tasks.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3 }}
            className="border-t border-neutral-200/50 dark:border-neutral-700/50 p-4 pt-3 space-y-3"
          >
            {state.tasks.map((task, idx) => (
              <TaskRow key={task.id} task={task} index={idx} isInCurrentState={isCurrentState} />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

export default function StateList({ states, currentStateId }: StateListProps) {
  if (!states || states.length === 0) {
    return (
      <div className="text-center py-8">
        <div className="text-[10px] text-neutral-400 dark:text-neutral-500 tracking-wider uppercase">
          No states available
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between mb-4">
        <div className="text-xs font-light tracking-wider text-neutral-400 dark:text-neutral-500 uppercase">
          States
        </div>
        <div className="text-[10px] text-neutral-400 dark:text-neutral-500 tracking-wide">
          {states.filter(s => s.status === StateStatus.COMPLETED).length} / {states.length}
        </div>
      </div>

      <div className="space-y-3">
        {states.map((state, index) => (
          <StateCard
            key={state.id}
            state={state}
            index={index}
            isCurrentState={currentStateId === state.id}
          />
        ))}
      </div>
    </div>
  )
}