import { motion, AnimatePresence } from 'framer-motion'
import { useState } from 'react'
import type { TodoListStep } from '../lib/types'

interface DeliverableItem {
  key: string
  description: string
  type: string
  required: boolean
  status: 'pending' | 'completed' | 'partial' | 'skipped'
  value: any
  collected_at?: string | null
  confidence?: number
  source_message?: string
  reasoning?: string
  acceptance_criteria?: string
}

interface TaskStepListProps {
  steps: TodoListStep[]
  currentStepId: string | null
  deliverables?: Record<string, DeliverableItem>
}

const StepIcon = ({
  status,
  isCurrent
}: {
  status: TodoListStep['status'],
  isCurrent: boolean
}) => {
  if (status === 'completed') {
    return (
      <motion.div
        className="w-2.5 h-2.5 rounded-full bg-neutral-900 flex items-center justify-center shadow-sm"
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ duration: 0.3, type: "spring", stiffness: 200 }}
      >
        <motion.svg
          width="7"
          height="5"
          viewBox="0 0 8 6"
          fill="none"
          className="text-white"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.4, delay: 0.1 }}
        >
          <motion.path
            d="M1 3L3 5L7 1"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </motion.svg>
      </motion.div>
    )
  }

  if (isCurrent) {
    return (
      <motion.div
        className="w-2.5 h-2.5 rounded-full bg-neutral-700 relative"
        animate={{
          scale: [1, 1.15, 1],
          boxShadow: [
            '0 0 0 0px rgba(0, 0, 0, 0.3)',
            '0 0 0 3px rgba(0, 0, 0, 0.08)',
            '0 0 0 0px rgba(0, 0, 0, 0.3)'
          ]
        }}
        transition={{
          duration: 2,
          repeat: Infinity,
          repeatType: "loop",
          ease: "easeInOut"
        }}
      />
    )
  }

  return (
    <motion.div
      className="w-2.5 h-2.5 rounded-full border border-neutral-300 bg-white"
      whileHover={{ scale: 1.1 }}
      transition={{ duration: 0.2 }}
    />
  )
}

const DeliverableCard = ({ deliverable }: { deliverable: DeliverableItem }) => {
  const hasValue = deliverable.value !== null && deliverable.value !== undefined && deliverable.value !== ''

  const renderValue = (value: any): string => {
    if (value === null || value === undefined || value === '') return ''
    if (typeof value === 'string') return value
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    if (Array.isArray(value)) return value.join(', ')
    if (typeof value === 'object') {
      try {
        return JSON.stringify(value, null, 2)
      } catch {
        return '[Complex Object]'
      }
    }
    return String(value)
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.3 }}
      className="p-3 rounded-lg bg-neutral-50/80 border border-neutral-200/60"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <div className="text-xs font-light text-neutral-700 leading-relaxed">
            {deliverable.description}
            {deliverable.required && (
              <span className="text-neutral-600 ml-1">*</span>
            )}
          </div>
          <div className="text-[9px] text-neutral-400 tracking-wider mt-0.5">
            {deliverable.type.toUpperCase()}
          </div>
        </div>
        {hasValue && (
          <div className="flex items-center gap-1">
            <div className="w-1.5 h-1.5 rounded-full bg-neutral-900" />
            <span className="text-[8px] text-neutral-700 font-medium tracking-wide">
              COLLECTED
            </span>
          </div>
        )}
      </div>

      {/* Value and reasoning */}
      {hasValue && (
        <div className="space-y-2">
          <div className="text-sm font-light text-neutral-800 leading-relaxed">
            {renderValue(deliverable.value)}
          </div>

          {/* Metadata */}
          {deliverable.collected_at && (
            <div className="flex items-center justify-between text-[8px] text-neutral-400">
              <span>
                {new Date(deliverable.collected_at).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit'
                })}
              </span>
            </div>
          )}

          {/* Reasoning Section */}
          {(deliverable.acceptance_criteria || deliverable.reasoning) && (
            <div className="mt-2 pt-2 border-t border-neutral-200/40 space-y-2">
              {deliverable.acceptance_criteria && (
                <div className="text-[9px] text-neutral-600">
                  <span className="font-medium tracking-wider uppercase text-neutral-500 block mb-1">
                    Acceptance Criteria:
                  </span>
                  <div className="text-neutral-700 bg-neutral-50/50 p-2 rounded border border-neutral-200/30 text-[10px]">
                    {deliverable.acceptance_criteria}
                  </div>
                </div>
              )}

              {deliverable.reasoning && (
                <div className="text-[9px] text-neutral-600">
                  <span className="font-medium tracking-wider uppercase text-green-600 block mb-1 flex items-center gap-1">
                    <svg width="8" height="8" viewBox="0 0 20 20" fill="currentColor" className="text-green-500">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    Why Criteria Was Met:
                  </span>
                  <div className="text-neutral-800 bg-green-50/60 p-2 rounded border border-green-200/40 italic leading-relaxed text-[10px]">
                    {deliverable.reasoning}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </motion.div>
  )
}

export default function TaskStepList({ steps, currentStepId, deliverables = {} }: TaskStepListProps) {
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set())

  const toggleStepExpansion = (stepId: string) => {
    setExpandedSteps(prev => {
      const newSet = new Set(prev)
      if (newSet.has(stepId)) {
        newSet.delete(stepId)
      } else {
        newSet.add(stepId)
      }
      return newSet
    })
  }

  // Get deliverables for a specific step
  const getStepDeliverables = (step: TodoListStep): DeliverableItem[] => {
    const stepDeliverables: DeliverableItem[] = []

    // From step.deliverables (basic info)
    step.deliverables?.forEach(stepDel => {
      const enrichedDeliverable = deliverables[stepDel.key]
      if (enrichedDeliverable) {
        stepDeliverables.push(enrichedDeliverable)
      } else {
        // Fallback to basic step deliverable info
        stepDeliverables.push({
          key: stepDel.key,
          description: stepDel.description,
          type: stepDel.type,
          required: stepDel.required,
          status: stepDel.status,
          value: stepDel.value,
          collected_at: stepDel.collected_at,
          confidence: stepDel.confidence
        })
      }
    })

    return stepDeliverables.filter(d => d.status === 'completed' && d.value !== null && d.value !== undefined)
  }

  return (
    <div className="space-y-4">
      {/* Section Header */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="text-xs font-light tracking-wider text-neutral-400 uppercase"
      >
        Steps
      </motion.div>

      {/* Steps List */}
      <div className="space-y-4 relative">
        {/* Connection Line */}
        <div className="absolute left-[4.5px] top-3 bottom-3 w-px bg-gradient-to-b from-neutral-200 via-neutral-200 to-transparent" />

        <AnimatePresence>
          {steps.map((step, index) => {
            const isCurrent = step.id === currentStepId
            const isCompleted = step.status === 'completed'
            const stepDeliverables = getStepDeliverables(step)
            const hasDeliverables = stepDeliverables.length > 0
            const isExpanded = expandedSteps.has(step.id)
            const isClickable = isCompleted && hasDeliverables

            return (
              <motion.div
                key={step.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{
                  duration: 0.4,
                  delay: index * 0.05,
                  ease: [0.25, 0.46, 0.45, 0.94]
                }}
                className="relative group"
              >
                {/* Step Indicator */}
                <div
                  className={`flex items-start gap-3 ${isClickable ? 'cursor-pointer' : ''}`}
                  onClick={() => isClickable && toggleStepExpansion(step.id)}
                >
                  <div className="relative z-10 mt-1">
                    <StepIcon status={step.status} isCurrent={isCurrent} />
                  </div>

                  {/* Step Content */}
                  <motion.div
                    className="flex-1 min-w-0"
                    animate={{
                      opacity: isCurrent ? 1 : 0.6,
                      scale: isCurrent ? 1.02 : 1
                    }}
                    transition={{ duration: 0.3 }}
                  >
                    {/* Step Title */}
                    <div className="flex items-center justify-between">
                      <motion.div
                        className={`text-sm font-light leading-relaxed ${
                          isCurrent
                            ? 'text-neutral-800'
                            : isCompleted
                              ? 'text-neutral-600'
                              : 'text-neutral-500'
                        }`}
                        animate={{
                          fontWeight: isCurrent ? 400 : 300
                        }}
                        transition={{ duration: 0.2 }}
                      >
                        {step.title}
                      </motion.div>

                      {/* Chevron for clickable completed steps */}
                      {isClickable && (
                        <motion.div
                          className="text-neutral-400 ml-2"
                          animate={{ rotate: isExpanded ? 90 : 0 }}
                          transition={{ duration: 0.2 }}
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="9,18 15,12 9,6" />
                          </svg>
                        </motion.div>
                      )}
                    </div>

                    {/* Step Number and deliverable count */}
                    <div className="flex items-center gap-2 mt-0.5">
                      <div className="text-[10px] text-neutral-400 tracking-wider">
                        {String(index + 1).padStart(2, '0')}
                      </div>
                      {hasDeliverables && (
                        <div className="text-[9px] text-neutral-500 font-medium">
                          {stepDeliverables.length} deliverable{stepDeliverables.length !== 1 ? 's' : ''}
                        </div>
                      )}
                    </div>

                    {/* Description on Hover/Current */}
                    <AnimatePresence>
                      {(isCurrent && step.description) && (
                        <motion.div
                          initial={{ opacity: 0, height: 0, marginTop: 0 }}
                          animate={{ opacity: 1, height: 'auto', marginTop: 8 }}
                          exit={{ opacity: 0, height: 0, marginTop: 0 }}
                          transition={{ duration: 0.3 }}
                          className="text-xs text-neutral-500 leading-relaxed font-light"
                        >
                          {step.description}
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* Expanded Deliverables Section */}
                    <AnimatePresence>
                      {isExpanded && hasDeliverables && (
                        <motion.div
                          initial={{ opacity: 0, height: 0, marginTop: 0 }}
                          animate={{ opacity: 1, height: 'auto', marginTop: 12 }}
                          exit={{ opacity: 0, height: 0, marginTop: 0 }}
                          transition={{ duration: 0.4 }}
                          className="space-y-2"
                        >
                          <div className="text-[10px] text-neutral-500 font-medium tracking-wider uppercase mb-2">
                            Collected Information:
                          </div>
                          {stepDeliverables.map((deliverable) => (
                            <DeliverableCard key={deliverable.key} deliverable={deliverable} />
                          ))}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                </div>

                {/* Enhanced hover effect for clickable steps */}
                <motion.div
                  className={`absolute inset-0 -mx-2 rounded-lg ${
                    isClickable ? 'bg-neutral-100' : 'bg-neutral-50'
                  }`}
                  initial={{ opacity: 0 }}
                  whileHover={{ opacity: isClickable ? 0.7 : 0.5 }}
                  transition={{ duration: 0.2 }}
                  style={{ zIndex: -1 }}
                />
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>
    </div>
  )
}