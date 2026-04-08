import React, { useState, memo, useCallback, useMemo } from 'react'
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
  discovered?: boolean
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
  transitions?: StateTransition[]
  tasks: StateTask[]
}

interface StateListProps {
  states: StateItem[]
  currentStateId: string | null
  deliverables: Record<string, any>
  lastTransition?: {
    from_state_id?: string
    to_state_id?: string
    condition_type?: string
    condition_config?: Record<string, any>
    priority?: number
  } | null
}

interface StateTransition {
  target_state_id: string
  condition_type: string
  priority?: number
  condition_config?: Record<string, any>
}

interface ProjectedState {
  state: StateItem
  transition: StateTransition
}

const normalizeTransitions = (state: StateItem | undefined | null): StateTransition[] => {
  if (!state || !Array.isArray(state.transitions)) return []
  return state.transitions.filter(transition => Boolean(transition?.target_state_id))
}

const getTransitionPriority = (priority: unknown): number => {
  if (typeof priority === 'number' && Number.isFinite(priority)) return priority
  if (typeof priority === 'string' && priority.trim() !== '') {
    const parsed = Number(priority)
    if (Number.isFinite(parsed)) return parsed
  }
  return 100
}

const formatConditionLabel = (transition: StateTransition): string => {
  const key = transition.condition_config?.key
  const value = transition.condition_config?.value

  switch (transition.condition_type) {
    case 'all_tasks_complete':
      return 'all tasks complete'
    case 'deliverable_exists':
      return typeof key === 'string' ? `${key} exists` : 'deliverable exists'
    case 'deliverable_value':
      if (typeof key === 'string' && value !== undefined) {
        return `${key} = ${String(value)}`
      }
      return 'deliverable value matched'
    default:
      return transition.condition_type.replace(/_/g, ' ')
  }
}

const ProcessingModeIcon = memo(({ type }: { type: StateType }) => {
  // Migration: renamed enum from StateType.STRICT -> StateType.SEQUENTIAL
  if (type === StateType.SEQUENTIAL) {
    return (
      <div className="flex items-center gap-1" title="Sequential Processing">
        <span className="text-[10px] text-neutral-600 dark:text-neutral-400">⚡</span>
        <span className="text-[8px] text-neutral-500 dark:text-neutral-400 tracking-wider uppercase">Sequential</span>
      </div>
    )
  }

  if (type === StateType.GOAL) {
    return (
      <div className="flex items-center gap-1" title="Goal-Oriented">
        <span className="text-[10px] text-neutral-600 dark:text-neutral-400">🎯</span>
        <span className="text-[8px] text-neutral-500 dark:text-neutral-400 tracking-wider uppercase">Goal</span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1" title="Flexible Processing">
      <span className="text-[10px] text-neutral-600 dark:text-neutral-400">🔄</span>
      <span className="text-[8px] text-neutral-500 dark:text-neutral-400 tracking-wider uppercase">Flexible</span>
    </div>
  )
})

const StateStatusIcon = memo(({ status }: { status: StateStatus }) => {
  switch (status) {
    case StateStatus.COMPLETED:
      return (
        <div className="w-3 h-3 rounded-full bg-neutral-900 dark:bg-neutral-100 flex items-center justify-center">
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
        </div>
      )
    case StateStatus.IN_PROGRESS:
      return (
        <div className="w-3 h-3 rounded-full bg-blue-500 dark:bg-violet-500" />
      )
    default:
      return (
        <div className="w-3 h-3 rounded-full border border-neutral-300 dark:border-neutral-600" />
      )
  }
})

const TaskStatusIcon = memo(({ status }: { status: TaskStatus }) => {
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
      return <div className="w-4 h-4 rounded-full bg-blue-500 dark:bg-violet-500 flex-shrink-0" />
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
})

const DeliverableStatusIcon = memo(({ status }: { status: DeliverableStatus }) => {
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
})

// CSS-based collapsible wrapper - much more performant than Framer Motion height animations
// Uses CSS Grid with 0fr/1fr for smooth GPU-accelerated height transitions
const Collapsible = memo(({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) => (
  <div
    className="grid transition-[grid-template-rows] duration-200 ease-out"
    style={{ gridTemplateRows: isOpen ? '1fr' : '0fr' }}
  >
    <div className="overflow-hidden min-h-0">
      {children}
    </div>
  </div>
))

const DeliverableRow = memo(({ deliverable }: { deliverable: StateDeliverable }) => {
  const [showDetails, setShowDetails] = useState(false)
  const hasValue = deliverable.value !== null && deliverable.value !== undefined && deliverable.value !== ''
  const isSkipped = deliverable.status === DeliverableStatus.SKIPPED

  const handleClick = useCallback(() => setShowDetails(prev => !prev), [])

  return (
    <div className="pl-6 border-l border-neutral-200/40 dark:border-neutral-700/40">
      <div
        className={`flex items-center justify-between p-2 rounded-md cursor-pointer transition-colors ${
          isSkipped ? 'bg-neutral-50/50 dark:bg-neutral-800/50 hover:bg-neutral-100/50 dark:hover:bg-neutral-700/50 opacity-60' :
          hasValue ? 'bg-green-50/50 dark:bg-green-900/20 hover:bg-green-50 dark:hover:bg-green-900/30' : 'hover:bg-neutral-50 dark:hover:bg-neutral-800/50'
        }`}
        onClick={handleClick}
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <DeliverableStatusIcon status={deliverable.status} />
          <span className={`text-[10px] text-neutral-700 dark:text-neutral-300 truncate ${isSkipped ? 'line-through text-neutral-400 dark:text-neutral-500' : ''}`}>
            {deliverable.description}
            {deliverable.required && !isSkipped && !deliverable.discovered && <span className="text-red-500 dark:text-red-400 ml-1">*</span>}
            {deliverable.discovered && <span className="text-[8px] text-violet-500 dark:text-violet-400 ml-1.5 bg-violet-100 dark:bg-violet-900/30 px-1 py-0.5 rounded uppercase font-medium">Discovered</span>}
            {isSkipped && <span className="text-[8px] text-neutral-400 dark:text-neutral-500 ml-1.5 bg-neutral-200 dark:bg-neutral-700 px-1 py-0.5 rounded uppercase font-medium">Skipped</span>}
          </span>
        </div>
      </div>

      <Collapsible isOpen={showDetails && hasValue}>
        <div className="mt-2 pl-4 space-y-2 pb-1">
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
        </div>
      </Collapsible>
    </div>
  )
})

const TaskRow = memo(({ task }: { task: StateTask }) => {
  const [isExpanded, setIsExpanded] = useState(false)
  const isSkipped = task.status === TaskStatus.SKIPPED

  const handleClick = useCallback(() => setIsExpanded(prev => !prev), [])

  return (
    <div className="pl-4 border-l border-neutral-200/60 dark:border-neutral-700/60">
      <div
        className={`flex items-center justify-between p-3 rounded-lg cursor-pointer transition-colors border ${
          isSkipped
            ? 'bg-neutral-50/60 dark:bg-neutral-800/60 border-neutral-200/40 dark:border-neutral-700/40 hover:bg-neutral-100/50 dark:hover:bg-neutral-700/50 opacity-70'
            : task.status === TaskStatus.IN_PROGRESS
            ? 'bg-blue-50/50 dark:bg-violet-900/20 border-blue-200/60 dark:border-violet-700/60 hover:bg-blue-50/70 dark:hover:bg-violet-900/30'
            : task.status === TaskStatus.COMPLETED
            ? 'bg-white dark:bg-neutral-800 border-neutral-200/50 dark:border-neutral-700/50 hover:bg-neutral-50/50 dark:hover:bg-neutral-700/50'
            : 'bg-white dark:bg-neutral-800 border-neutral-200/50 dark:border-neutral-700/50 hover:bg-neutral-50/50 dark:hover:bg-neutral-700/50'
        }`}
        onClick={handleClick}
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
            <div
              className="text-neutral-400 dark:text-neutral-500 transition-transform duration-200"
              style={{ transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
            >
              <svg width="10" height="6" viewBox="0 0 10 6" fill="none">
                <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          )}
        </div>
      </div>

      <Collapsible isOpen={isExpanded && task.deliverables.length > 0}>
        <div className="mt-2 space-y-1 pb-1">
          {task.deliverables.map((deliverable) => (
            <DeliverableRow
              key={deliverable.key}
              deliverable={deliverable}
            />
          ))}
        </div>
      </Collapsible>
    </div>
  )
})

const StateCard = memo(({ state, index, isCurrentState }: { state: StateItem; index: number; isCurrentState: boolean }) => {
  const [isExpanded, setIsExpanded] = useState(isCurrentState || state.status === StateStatus.IN_PROGRESS)

  // Auto-expand when state becomes current
  React.useEffect(() => {
    if (isCurrentState) {
      setIsExpanded(true)
    }
  }, [isCurrentState])

  const handleClick = useCallback(() => setIsExpanded(prev => !prev), [])

  return (
    <div
      className={`rounded-lg border transition-colors ${
        isCurrentState
          ? 'border-blue-400/70 dark:border-violet-500/70 bg-gradient-to-br from-blue-50/80 to-blue-100/40 dark:from-violet-900/30 dark:to-violet-800/20 shadow-md ring-1 ring-blue-200/50 dark:ring-violet-600/50'
          : state.status === StateStatus.COMPLETED
          ? 'border-green-300/50 dark:border-green-700/50 bg-green-50/30 dark:bg-green-900/20'
          : state.status === StateStatus.IN_PROGRESS
          ? 'border-yellow-300/50 dark:border-yellow-700/50 bg-yellow-50/30 dark:bg-yellow-900/20'
          : 'border-neutral-200/60 dark:border-neutral-700/60 bg-white/80 dark:bg-neutral-800/80 hover:bg-neutral-50/50 dark:hover:bg-neutral-700/50'
      }`}
    >
      <div
        className="p-4 cursor-pointer"
        onClick={handleClick}
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

          <div
            className="text-neutral-400 dark:text-neutral-500 transition-transform duration-200"
            style={{ transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
          >
            <svg width="12" height="8" viewBox="0 0 12 8" fill="none">
              <path d="M2 2l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </div>

        {/* Show details only when expanded */}
        <Collapsible isOpen={isExpanded}>
          <div className="mt-3 pt-3 border-t border-neutral-200/50 dark:border-neutral-700/50 space-y-2">
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
          </div>
        </Collapsible>
      </div>

      <Collapsible isOpen={isExpanded && state.tasks.length > 0}>
        <div className="border-t border-neutral-200/50 dark:border-neutral-700/50 p-4 pt-3 space-y-3">
          {state.type === StateType.GOAL ? (
            // Goal states: render goal deliverables flat (no task wrapper)
            <>
              {state.tasks.filter(t => t.id === '__goal_deliverables__').flatMap(t => {
                const defined = t.deliverables.filter(d => !d.discovered)
                const discovered = t.deliverables.filter(d => d.discovered)
                return (
                  <div key="goal-deliverables" className="space-y-1">
                    {defined.map(d => <DeliverableRow key={d.key} deliverable={d} />)}
                    {discovered.length > 0 && (
                      <div className="mt-3 pt-2 border-t border-violet-200/50 dark:border-violet-700/50">
                        <div className="text-[9px] text-violet-500 dark:text-violet-400 tracking-wider uppercase font-medium mb-1 pl-6">
                          Additional Findings
                        </div>
                        {discovered.map(d => <DeliverableRow key={d.key} deliverable={d} />)}
                      </div>
                    )}
                  </div>
                )
              })}
              {/* Backward compat: render non-synthetic tasks normally */}
              {state.tasks.filter(t => t.id !== '__goal_deliverables__').map(task => (
                <TaskRow key={task.id} task={task} />
              ))}
            </>
          ) : (
            // Migration note: "loose" mode was renamed to "flexible"
            // Strict/flexible: render tasks normally
            state.tasks.map((task) => (
              <TaskRow key={task.id} task={task} />
            ))
          )}
        </div>
      </Collapsible>
    </div>
  )
})

const ProjectedStateRow = memo(({
  projected
}: {
  projected: ProjectedState
}) => {
  const conditionLabel = formatConditionLabel(projected.transition)

  return (
    <div className="rounded-lg border p-3 border-neutral-200/60 dark:border-neutral-700/60 bg-neutral-50/70 dark:bg-neutral-800/60 opacity-85">
      <div className="flex items-start gap-3">
        <div className="mt-1">
          <div className="w-3 h-3 rounded-full border border-neutral-300 dark:border-neutral-600" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h4 className="text-[12px] font-medium truncate text-neutral-700 dark:text-neutral-300">
              {projected.state.title}
            </h4>
            <span className="text-[8px] px-1.5 py-0.5 rounded uppercase tracking-wider bg-neutral-200 text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300">
              Possible
            </span>
          </div>
          <div className="text-[9px] text-neutral-500 dark:text-neutral-400 mt-1">
            via {conditionLabel}
          </div>
        </div>
      </div>
    </div>
  )
})

export default function StateList({ states, currentStateId, lastTransition }: StateListProps) {
  const stateById = useMemo(
    () => new Map(states.map(state => [state.id, state])),
    [states]
  )

  const routeView = useMemo(() => {
    const currentState = states.find(state => state.id === currentStateId) || states.find(state => state.is_current) || null
    const visitedStates = states.filter(state =>
      state.status === StateStatus.COMPLETED || state.id === currentState?.id || state.status === StateStatus.IN_PROGRESS
    )

    if (!currentState) {
      return {
        visitedStates,
        possibleStates: [] as ProjectedState[],
      }
    }

    const sortedTransitions = normalizeTransitions(currentState).sort(
      (a, b) => getTransitionPriority(a.priority) - getTransitionPriority(b.priority)
    )

    const candidates = sortedTransitions
      .map((transition): ProjectedState | null => {
        const targetState = stateById.get(transition.target_state_id)
        if (!targetState || targetState.id === currentState.id) return null
        return {
          state: targetState,
          transition,
        }
      })
      .filter((candidate): candidate is ProjectedState => Boolean(candidate))

    const dedupedByTarget = new Map<string, ProjectedState>()
    candidates.forEach(candidate => {
      if (!dedupedByTarget.has(candidate.state.id)) {
        dedupedByTarget.set(candidate.state.id, candidate)
      }
    })

    const possibleStates = Array.from(dedupedByTarget.values()).sort(
      (a, b) => getTransitionPriority(a.transition.priority) - getTransitionPriority(b.transition.priority)
    )

    return {
      visitedStates,
      possibleStates,
    }
  }, [states, currentStateId])

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
          {routeView.visitedStates.filter(s => s.status === StateStatus.COMPLETED).length} completed
        </div>
      </div>

      <div className="space-y-3">
        {lastTransition?.from_state_id && lastTransition?.to_state_id && (
          <div className="rounded-lg border border-emerald-200/70 dark:border-emerald-700/50 bg-emerald-50/50 dark:bg-emerald-900/20 p-3">
            <div className="text-[9px] font-medium tracking-wider text-emerald-600 dark:text-emerald-400 uppercase">
              Branch Chosen
            </div>
            <div className="text-[11px] text-emerald-800 dark:text-emerald-200 mt-1">
              {(stateById.get(lastTransition.from_state_id || '')?.title || lastTransition.from_state_id)}
              {' → '}
              {(stateById.get(lastTransition.to_state_id || '')?.title || lastTransition.to_state_id)}
            </div>
            {lastTransition.condition_type && (
              <div className="text-[9px] text-emerald-700/80 dark:text-emerald-300/80 mt-1">
                Condition met: {formatConditionLabel({
                  target_state_id: lastTransition.to_state_id,
                  condition_type: lastTransition.condition_type,
                  priority: lastTransition.priority,
                  condition_config: lastTransition.condition_config,
                })}
              </div>
            )}
          </div>
        )}

        {routeView.visitedStates.map((state, index) => (
          <StateCard
            key={state.id}
            state={state}
            index={index}
            isCurrentState={currentStateId === state.id}
          />
        ))}

        {routeView.possibleStates.length > 0 && (
          <div className="space-y-2 pt-1">
            <div className="text-[9px] font-medium tracking-wider text-neutral-400 dark:text-neutral-500 uppercase">
              Possible Next States
            </div>
            {routeView.possibleStates.map(candidate => (
              <ProjectedStateRow
                key={`${candidate.state.id}-${candidate.transition.condition_type}`}
                projected={candidate}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
