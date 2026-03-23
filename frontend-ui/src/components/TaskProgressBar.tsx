import { motion } from 'framer-motion'
import { StateType, TaskStatus } from '../lib/types'

interface TaskProgressBarProps {
  progress: number
  currentState: number
  totalStates: number
  isVisible: boolean
  currentTask?: {
    id: string
    description: string
    instruction: string
    required: boolean
    status: TaskStatus
  } | null
  processingMode?: StateType | null

  // Legacy support
  currentStep?: number
  totalSteps?: number
}

const ProcessingModeIndicator = ({ mode }: { mode: StateType }) => {
  if (mode === StateType.STRICT) {
    return (
      <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700/50" title="Sequential Processing Mode">
        <span className="text-xs text-blue-600 dark:text-blue-400">⚡</span>
        <span className="text-[10px] text-blue-700 dark:text-blue-300 tracking-wide uppercase font-medium">Sequential</span>
      </div>
    )
  }

  if (mode === StateType.GOAL) {
    return (
      <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-violet-50 dark:bg-violet-900/30 border border-violet-200 dark:border-violet-700/50" title="Goal-Oriented Mode">
        <span className="text-xs text-violet-600 dark:text-violet-400">🎯</span>
        <span className="text-[10px] text-violet-700 dark:text-violet-300 tracking-wide uppercase font-medium">Goal</span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-700/50" title="Flexible Processing Mode">
      <span className="text-xs text-green-600 dark:text-green-400">🔄</span>
      <span className="text-[10px] text-green-700 dark:text-green-300 tracking-wide uppercase font-medium">Flexible</span>
    </div>
  )
}

export default function TaskProgressBar({
  progress,
  currentState,
  totalStates,
  isVisible,
  currentTask,
  processingMode,
  // Legacy support
  currentStep,
  totalSteps
}: TaskProgressBarProps) {
  // Use legacy values if new state machine values aren't provided
  const displayCurrentStep = currentState ?? currentStep ?? 0
  const displayTotalSteps = totalStates ?? totalSteps ?? 0
  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{
        opacity: isVisible ? 1 : 0,
        y: isVisible ? 0 : -10
      }}
      transition={{
        duration: 0.4,
        ease: [0.25, 0.46, 0.45, 0.94] // Custom easing for smoothness
      }}
      className="relative space-y-3"
    >
      {/* Progress Track */}
      <div className="h-px bg-neutral-200 dark:bg-neutral-700 rounded-full overflow-hidden">
        {/* Progress Fill */}
        <motion.div
          className={`h-full rounded-full ${
            processingMode === StateType.STRICT
              ? 'bg-blue-600'
              : processingMode === StateType.GOAL
              ? 'bg-violet-600'
              // Migration: renamed enum from StateType.LOOSE -> StateType.FLEXIBLE
              : processingMode === StateType.FLEXIBLE
              ? 'bg-green-600'
              : 'bg-neutral-600'
          }`}
          initial={{ width: 0 }}
          animate={{ width: `${Math.max(progress, 2)}%` }} // Minimum 2% for visibility
          transition={{
            duration: 0.6,
            ease: [0.16, 1, 0.3, 1] // Smooth bezier for progress animation
          }}
        />
      </div>

      {/* State Counter and Progress Info */}
      <motion.div
        className="flex items-center justify-between"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2, duration: 0.3 }}
      >
        {/* Progress Percentage */}
        <div className="text-[10px] font-normal text-neutral-400 dark:text-neutral-500 tracking-wide">
          {Math.round(progress)}%
        </div>

        {/* Deliverables Counter */}
        <div className="text-[10px] font-normal text-neutral-500 dark:text-neutral-400 tracking-wide">
          <span className="text-[9px] text-neutral-400 dark:text-neutral-500 tracking-wide uppercase mr-1">Deliverables</span>
          <span className="font-medium">{displayCurrentStep}</span>
          <span className="mx-0.5 opacity-40">/</span>
          <span>{displayTotalSteps}</span>
        </div>
      </motion.div>
    </motion.div>
  )
}
