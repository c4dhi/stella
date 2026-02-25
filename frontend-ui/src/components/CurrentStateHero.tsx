import { motion, AnimatePresence } from 'framer-motion'
import { StateType, StateStatus, TaskStatus } from '../lib/types'

interface CurrentStateHeroProps {
  currentState?: {
    id: string
    title: string
    type: StateType
    description: string
    status: StateStatus
    state_number: number
    is_complete: boolean
  } | null
  currentTask?: {
    id: string
    description: string
    instruction: string
    required: boolean
    status: TaskStatus
  } | null
  processingMode?: StateType | null
}

const ProcessingModeIndicator = ({ type }: { type: StateType }) => {
  if (type === StateType.STRICT) {
    return (
      <motion.div
        className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-100 border border-blue-200"
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.3 }}
      >
        <motion.span
          className="text-sm text-blue-600"
          animate={{ rotate: [0, 15, 0] }}
          transition={{ duration: 1.5, repeat: Infinity }}
        >
          ⚡
        </motion.span>
        <span className="text-xs font-medium text-blue-700 tracking-wider uppercase">
          Sequential Processing
        </span>
      </motion.div>
    )
  }

  return (
    <motion.div
      className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-green-100 border border-green-200"
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      <motion.span
        className="text-sm text-green-600"
        animate={{ rotate: [0, 360] }}
        transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
      >
        🔄
      </motion.span>
      <span className="text-xs font-medium text-green-700 tracking-wider uppercase">
        Flexible Processing
      </span>
    </motion.div>
  )
}

const TaskStatusIndicator = ({ status }: { status: TaskStatus }) => {
  switch (status) {
    case TaskStatus.IN_PROGRESS:
      return (
        <motion.div
          className="flex items-center gap-2 px-2 py-1 rounded-md bg-yellow-100 border border-yellow-200"
          animate={{ opacity: [0.7, 1, 0.7] }}
          transition={{ duration: 1.5, repeat: Infinity }}
        >
          <motion.div
            className="w-2 h-2 bg-yellow-500 rounded-full"
            animate={{ scale: [1, 1.3, 1] }}
            transition={{ duration: 1, repeat: Infinity }}
          />
          <span className="text-[10px] font-medium text-yellow-700 tracking-wider uppercase">
            Active
          </span>
        </motion.div>
      )
    case TaskStatus.COMPLETED:
      return (
        <div className="flex items-center gap-2 px-2 py-1 rounded-md bg-green-100 border border-green-200">
          <div className="w-2 h-2 bg-green-500 rounded-full" />
          <span className="text-[10px] font-medium text-green-700 tracking-wider uppercase">
            Completed
          </span>
        </div>
      )
    default:
      return (
        <div className="flex items-center gap-2 px-2 py-1 rounded-md bg-gray-100 border border-gray-200">
          <div className="w-2 h-2 bg-gray-400 rounded-full" />
          <span className="text-[10px] font-medium text-gray-600 tracking-wider uppercase">
            Pending
          </span>
        </div>
      )
  }
}

export default function CurrentStateHero({ currentState, currentTask, processingMode }: CurrentStateHeroProps) {
  if (!currentState) {
    return null
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.6,
        ease: [0.16, 1, 0.3, 1],
      }}
      className="relative"
    >
      {/* Background with subtle gradient */}
      <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-neutral-50 via-white to-neutral-100/50 border border-neutral-200/60 shadow-lg" />

      {/* Glass effect overlay */}
      <div className="absolute inset-0 rounded-2xl bg-white/40 backdrop-blur-sm" />

      {/* Content */}
      <div className="relative p-6 space-y-4">
        {/* Header with processing mode */}
        <div
          className="flex items-center justify-between"
        >
          <div className="flex items-center gap-3">
            <motion.div
              className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white font-bold text-sm shadow-md"
              animate={{
                boxShadow: currentState.status === StateStatus.IN_PROGRESS
                  ? ['0 4px 12px rgba(59, 130, 246, 0.4)', '0 8px 24px rgba(59, 130, 246, 0.6)', '0 4px 12px rgba(59, 130, 246, 0.4)']
                  : '0 4px 12px rgba(59, 130, 246, 0.3)'
              }}
              transition={{ duration: 2, repeat: Infinity }}
            >
              {String(currentState.state_number).padStart(2, '0')}
            </motion.div>
            <div>
              <div className="text-[10px] text-neutral-500 tracking-wider uppercase font-medium">
                Current State
              </div>
              <div className="text-sm text-neutral-400 -mt-0.5">
                {currentState.status.replace('_', ' ')}
              </div>
            </div>
          </div>

          {processingMode && <ProcessingModeIndicator type={processingMode} />}
        </div>

        {/* State title and description */}
        <div
          className="space-y-2"
        >
          <h2 className="text-xl font-light text-neutral-900 leading-tight">
            {currentState.title}
          </h2>
          <p className="text-sm text-neutral-600 leading-relaxed">
            {currentState.description}
          </p>
        </div>

        {/* Current task section */}
        <AnimatePresence>
          {currentTask && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.4, delay: 0.3 }}
              className="pt-4 border-t border-neutral-200/50"
            >
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] text-neutral-500 tracking-wider uppercase font-medium">
                      {processingMode === StateType.STRICT ? 'Current Task' : 'Active Task'}
                    </span>
                    {currentTask.required && (
                      <span className="text-[9px] text-red-500 font-medium">REQUIRED</span>
                    )}
                  </div>
                  <h3 className="text-sm font-medium text-neutral-800 leading-tight">
                    {currentTask.description}
                  </h3>
                </div>
                <TaskStatusIndicator status={currentTask.status} />
              </div>

              {/* Task instruction */}
              <div
                className="bg-neutral-50/80 border border-neutral-200/40 rounded-lg p-3"
              >
                <div className="text-[10px] text-neutral-500 tracking-wider uppercase font-medium mb-1">
                  Instruction
                </div>
                <p className="text-xs text-neutral-700 leading-relaxed italic">
                  {currentTask.instruction}
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Subtle progress indicator at bottom */}
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: '100%' }}
          transition={{ duration: 1, delay: 0.8 }}
          className="h-px bg-gradient-to-r from-transparent via-neutral-300 to-transparent"
        />
      </div>
    </motion.div>
  )
}