import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useThemeStore } from '../../../store/themeStore'
import type { PlanState, PlanTask, PlanDeliverable, ExecutionMode } from '../../../lib/api-types'
import PlanTaskEditor from './PlanTaskEditor'

interface PlanStateEditorProps {
  state: PlanState
  onChange: (state: PlanState) => void
  onDelete: () => void
  createEmptyTask: () => PlanTask
  createEmptyDeliverable: () => PlanDeliverable
}

export default function PlanStateEditor({
  state,
  onChange,
  onDelete,
  createEmptyTask,
  createEmptyDeliverable,
}: PlanStateEditorProps) {
  const { resolvedTheme } = useThemeStore()
  const isDark = resolvedTheme === 'dark'
  const [expandedTaskIndex, setExpandedTaskIndex] = useState<number | null>(null)

  const handleAddTask = () => {
    const newTask = createEmptyTask()
    onChange({
      ...state,
      tasks: [...state.tasks, newTask],
    })
    setExpandedTaskIndex(state.tasks.length)
  }

  const handleUpdateTask = (index: number, updated: PlanTask) => {
    onChange({
      ...state,
      tasks: state.tasks.map((t, i) => i === index ? updated : t),
    })
  }

  const handleDeleteTask = (index: number) => {
    onChange({
      ...state,
      tasks: state.tasks.filter((_, i) => i !== index),
    })
    if (expandedTaskIndex === index) {
      setExpandedTaskIndex(null)
    } else if (expandedTaskIndex !== null && expandedTaskIndex > index) {
      setExpandedTaskIndex(expandedTaskIndex - 1)
    }
  }

  const handleMoveTask = (index: number, direction: 'up' | 'down') => {
    const newIndex = direction === 'up' ? index - 1 : index + 1
    if (newIndex < 0 || newIndex >= state.tasks.length) return

    const newTasks = [...state.tasks]
    const [removed] = newTasks.splice(index, 1)
    newTasks.splice(newIndex, 0, removed)
    onChange({ ...state, tasks: newTasks })

    if (expandedTaskIndex === index) {
      setExpandedTaskIndex(newIndex)
    } else if (expandedTaskIndex === newIndex) {
      setExpandedTaskIndex(index)
    }
  }

  return (
    <div className="p-6">
      {/* State Header */}
      <div className="flex items-start justify-between mb-6">
        <div className="flex-1 space-y-4">
          <input
            type="text"
            value={state.label}
            onChange={(e) => onChange({ ...state, label: e.target.value })}
            placeholder="State name"
            className="input-field w-full text-heading font-semibold"
          />
          <textarea
            value={state.description || ''}
            onChange={(e) => onChange({ ...state, description: e.target.value || undefined })}
            placeholder="State description (optional)"
            rows={2}
            className="input-field w-full resize-none"
          />
          <div>
            <label className={`text-body-sm font-medium mb-2 block ${
              isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'
            }`}>
              Execution Mode
            </label>
            <select
              value={state.execution_mode}
              onChange={(e) => onChange({ ...state, execution_mode: e.target.value as ExecutionMode })}
              className="input-field w-full max-w-xs"
            >
              <option value="flexible">Flexible (agent decides order)</option>
              <option value="sequential">Sequential (tasks in order)</option>
            </select>
          </div>
        </div>
        <button
          onClick={onDelete}
          className={`p-2 rounded-lg transition-colors ml-4 ${
            isDark
              ? 'text-red-400 hover:bg-red-500/10'
              : 'text-red-600 hover:bg-red-50'
          }`}
          title="Delete state"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
        </button>
      </div>

      {/* Tasks Section */}
      <div className={`rounded-xl border ${
        isDark ? 'border-border-dark bg-surface-dark-secondary' : 'border-border bg-white'
      }`}>
        <div className={`p-4 border-b flex items-center justify-between ${
          isDark ? 'border-border-dark' : 'border-border'
        }`}>
          <h3 className={`text-heading-sm font-semibold ${
            isDark ? 'text-content-inverse' : 'text-content'
          }`}>
            Tasks
          </h3>
          <button
            onClick={handleAddTask}
            className={`text-body-sm flex items-center gap-1 transition-colors ${
              isDark
                ? 'text-primary hover:text-primary/80'
                : 'text-primary hover:text-primary/80'
            }`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Add Task
          </button>
        </div>

        {state.tasks.length === 0 ? (
          <div className={`p-8 text-center text-body-sm ${
            isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'
          }`}>
            No tasks yet. Click "Add Task" to create one.
          </div>
        ) : (
          <div className="divide-y divide-border dark:divide-border-dark">
            <AnimatePresence>
              {state.tasks.map((task, index) => (
                <motion.div
                  key={task.id}
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  {/* Task Header */}
                  <div
                    className={`flex items-center gap-3 p-4 cursor-pointer transition-colors ${
                      isDark ? 'hover:bg-surface-dark-tertiary' : 'hover:bg-surface-secondary'
                    }`}
                    onClick={() => setExpandedTaskIndex(expandedTaskIndex === index ? null : index)}
                  >
                    {/* Expand/Collapse Icon */}
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      className={`transform transition-transform ${
                        expandedTaskIndex === index ? 'rotate-90' : ''
                      } ${isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'}`}
                    >
                      <path d="M9 18l6-6-6-6" />
                    </svg>

                    {/* Task Info */}
                    <div className="flex-1 min-w-0">
                      <div className={`text-body-sm font-medium truncate ${
                        isDark ? 'text-content-inverse' : 'text-content'
                      }`}>
                        {task.label || `Task ${index + 1}`}
                      </div>
                      <div className={`text-caption ${
                        isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'
                      }`}>
                        {task.deliverables.length} {task.deliverables.length === 1 ? 'deliverable' : 'deliverables'}
                        {!task.required && ' (optional)'}
                      </div>
                    </div>

                    {/* Reorder/Delete */}
                    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => handleMoveTask(index, 'up')}
                        disabled={index === 0}
                        className={`p-1 rounded ${
                          index === 0
                            ? 'opacity-30 cursor-not-allowed'
                            : isDark
                              ? 'hover:bg-surface-dark-tertiary'
                              : 'hover:bg-surface-tertiary'
                        }`}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <path d="M18 15l-6-6-6 6" />
                        </svg>
                      </button>
                      <button
                        onClick={() => handleMoveTask(index, 'down')}
                        disabled={index === state.tasks.length - 1}
                        className={`p-1 rounded ${
                          index === state.tasks.length - 1
                            ? 'opacity-30 cursor-not-allowed'
                            : isDark
                              ? 'hover:bg-surface-dark-tertiary'
                              : 'hover:bg-surface-tertiary'
                        }`}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <path d="M6 9l6 6 6-6" />
                        </svg>
                      </button>
                      <button
                        onClick={() => handleDeleteTask(index)}
                        className={`p-1 rounded ${
                          isDark
                            ? 'text-red-400 hover:bg-red-500/10'
                            : 'text-red-600 hover:bg-red-50'
                        }`}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                      </button>
                    </div>
                  </div>

                  {/* Expanded Task Editor */}
                  <AnimatePresence>
                    {expandedTaskIndex === index && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className={`border-t ${isDark ? 'border-border-dark' : 'border-border'}`}
                      >
                        <PlanTaskEditor
                          task={task}
                          onChange={(updated) => handleUpdateTask(index, updated)}
                          createEmptyDeliverable={createEmptyDeliverable}
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  )
}
