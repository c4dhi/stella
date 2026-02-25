import { motion, AnimatePresence } from 'framer-motion'
import { useState } from 'react'
import { DeliverableStatus as DeliverableStatusEnum } from '../lib/types'

interface DeliverableItem {
  key: string
  description: string
  type: string
  required: boolean
  status: DeliverableStatusEnum
  value: any
  collected_at?: string | null
  confidence?: number
  source_message?: string
  reasoning?: string
  acceptance_criteria?: string
}

interface DeliverablesViewProps {
  deliverables: Record<string, DeliverableItem>
  isVisible: boolean
}

const DeliverableStatus = ({
  status,
  required
}: {
  status: DeliverableItem['status']
  required: boolean
}) => {
  if (status === DeliverableStatusEnum.COMPLETED) {
    return (
      <motion.div
        className="flex items-center gap-1"
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3 }}
      >
        <div className="w-1.5 h-1.5 rounded-full bg-green-600" />
        <span className="text-[9px] text-green-700 font-medium tracking-wide">
          COLLECTED
        </span>
      </motion.div>
    )
  }

  if (status === DeliverableStatusEnum.PARTIAL) {
    return (
      <motion.div
        className="flex items-center gap-1"
        animate={{ opacity: [0.4, 1, 0.4] }}
        transition={{ duration: 1.5, repeat: Infinity }}
      >
        <div className="w-1.5 h-1.5 rounded-full bg-yellow-500" />
        <span className="text-[9px] text-yellow-600 font-medium tracking-wide">
          PARTIAL
        </span>
      </motion.div>
    )
  }

  if (status === DeliverableStatusEnum.SKIPPED) {
    return (
      <motion.div
        className="flex items-center gap-1"
      >
        <div className="w-1.5 h-1.5 rounded-full bg-neutral-400" />
        <span className="text-[9px] text-neutral-500 font-medium tracking-wide">
          SKIPPED
        </span>
      </motion.div>
    )
  }

  return (
    <motion.div
      className="flex items-center gap-1"
      animate={status === 'pending' ? {
        opacity: [0.3, 0.6, 0.3]
      } : {}}
      transition={{ duration: 2, repeat: Infinity }}
    >
      <div className="w-1.5 h-1.5 rounded-full bg-neutral-300" />
      <span className="text-[9px] text-neutral-500 font-medium tracking-wide">
        {required ? 'REQUIRED' : 'OPTIONAL'}
      </span>
    </motion.div>
  )
}

const renderDeliverableValue = (value: any): string => {
  if (value === null || value === undefined || value === '') {
    return ''
  }

  if (typeof value === 'string') {
    return value
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  if (Array.isArray(value)) {
    return value.join(', ')
  }

  if (typeof value === 'object') {
    try {
      return JSON.stringify(value, null, 2)
    } catch {
      return '[Complex Object]'
    }
  }

  return String(value)
}

const DeliverableCard = ({
  deliverable,
  index
}: {
  deliverable: DeliverableItem
  index: number
}) => {
  const [isExpanded, setIsExpanded] = useState(false)
  const hasValue = deliverable.value !== null && deliverable.value !== undefined && deliverable.value !== ''

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.4,
        delay: index * 0.08,
        ease: [0.25, 0.46, 0.45, 0.94]
      }}
      className="group relative"
    >
      <motion.div
        className={`
          p-4 rounded-[12px] border transition-[color,background-color,border-color,box-shadow] duration-300 cursor-pointer
          ${hasValue
            ? 'bg-neutral-50/80 border-neutral-300/60 shadow-sm'
            : 'bg-white/60 border-neutral-200/50'
          }
        `}
        whileHover={{
          scale: 1.01,
          boxShadow: '0 4px 20px rgba(0,0,0,0.08)'
        }}
        onClick={() => setIsExpanded(!isExpanded)}
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
            <div className="text-[10px] text-neutral-400 tracking-wider mt-0.5">
              {deliverable.type.toUpperCase()}
            </div>
          </div>
          <DeliverableStatus
            status={deliverable.status}
            required={deliverable.required}
          />
        </div>

        {/* Value Display */}
        <AnimatePresence>
          {hasValue && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.3 }}
              className="mt-2 pt-2 border-t border-neutral-200/50"
            >
              <div className="text-sm font-light text-neutral-800 leading-relaxed whitespace-pre-wrap">
                {renderDeliverableValue(deliverable.value)}
              </div>

              {/* Collection metadata */}
              {deliverable.collected_at && (
                <div className="flex items-center justify-between mt-2">
                  <div className="text-[9px] text-neutral-400 tracking-wide">
                    {new Date(deliverable.collected_at).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </div>
                </div>
              )}

              {/* Enhanced information - reasoning and acceptance criteria */}
              {(deliverable.reasoning || deliverable.acceptance_criteria) && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  transition={{ duration: 0.3, delay: 0.1 }}
                  className="mt-3 pt-3 border-t border-neutral-200/40 space-y-3"
                >
                  {/* Acceptance Criteria Section */}
                  {deliverable.acceptance_criteria && (
                    <div className="text-[10px] text-neutral-600 leading-relaxed">
                      <div className="flex items-center gap-1 mb-2">
                        <svg width="10" height="10" viewBox="0 0 20 20" fill="currentColor" className="text-blue-500">
                          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                        </svg>
                        <span className="font-medium tracking-wider uppercase text-blue-600">
                          Required Criteria:
                        </span>
                      </div>
                      <div className="text-neutral-700 bg-blue-50/50 p-3 rounded-md border border-blue-200/40 leading-relaxed">
                        {deliverable.acceptance_criteria}
                      </div>
                    </div>
                  )}

                  {/* AI Reasoning Section - Enhanced */}
                  {deliverable.reasoning && (
                    <div className="text-[10px] text-neutral-600 leading-relaxed">
                      <div className="flex items-center gap-1 mb-2">
                        <svg width="10" height="10" viewBox="0 0 20 20" fill="currentColor" className="text-green-500">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                        <span className="font-medium tracking-wider uppercase text-green-600">
                          AI Analysis:
                        </span>
                      </div>
                      <div className="text-neutral-800 bg-green-50/60 p-3 rounded-md border border-green-200/40 leading-relaxed">
                        <div className="flex items-start gap-2">
                          <span className="text-green-600 text-xs mt-0.5 flex-shrink-0">💡</span>
                          <div className="italic text-green-800">
                            {deliverable.reasoning}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Transparency Note */}
                  {deliverable.reasoning && (
                    <div className="text-[8px] text-neutral-400 italic text-center pt-2 border-t border-neutral-200/30">
                      This explanation was generated by AI to show why the information was collected
                    </div>
                  )}
                </motion.div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Expand indicator */}
        {!hasValue && (
          <div className="flex justify-center mt-2">
            <motion.div
              className="w-1 h-1 rounded-full bg-neutral-300"
              animate={{
                scale: [1, 1.5, 1],
                opacity: [0.3, 0.8, 0.3]
              }}
              transition={{
                duration: 2,
                repeat: Infinity,
                delay: index * 0.2
              }}
            />
          </div>
        )}
      </motion.div>

      {/* Subtle shadow for collected items */}
      {hasValue && (
        <motion.div
          className="absolute inset-0 rounded-[12px] bg-neutral-900/3 -z-10"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
        />
      )}
    </motion.div>
  )
}

export default function DeliverablesView({ deliverables, isVisible }: DeliverablesViewProps) {
  const deliverableItems = Object.entries(deliverables).map(([key, item]) => ({
    ...item,
    key
  }))

  if (!isVisible || deliverableItems.length === 0) {
    return null
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.2 }}
      className="space-y-4"
    >
      {/* Section Header */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.1 }}
        className="flex items-center justify-between"
      >
        <div className="text-xs font-light tracking-wider text-neutral-400 uppercase">
          Information
        </div>
        <div className="text-[10px] text-neutral-400 tracking-wide">
          {deliverableItems.filter(d => d.status === DeliverableStatusEnum.COMPLETED).length} / {deliverableItems.length}
        </div>
      </motion.div>

      {/* Deliverables Grid */}
      <div className="space-y-2">
        <AnimatePresence>
          {deliverableItems.map((deliverable, index) => (
            <DeliverableCard
              key={deliverable.key}
              deliverable={deliverable}
              index={index}
            />
          ))}
        </AnimatePresence>
      </div>

      {/* Progress indicator */}
      <motion.div
        initial={{ width: 0 }}
        animate={{
          width: `${(deliverableItems.filter(d => d.status === DeliverableStatusEnum.COMPLETED).length / deliverableItems.length) * 100}%`
        }}
        transition={{ duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }}
        className="h-px bg-green-600 rounded-full"
      />
    </motion.div>
  )
}