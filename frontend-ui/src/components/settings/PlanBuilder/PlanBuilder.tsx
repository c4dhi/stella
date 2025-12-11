import { useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useThemeStore } from '../../../store/themeStore'
import { useToastStore } from '../../../store/toastStore'
import { apiClient } from '../../../services/ApiClient'
import type { PlanTemplate, PlanContent, PlanState, PlanTask, PlanDeliverable } from '../../../lib/api-types'
import PlanStateEditor from './PlanStateEditor'
import PlanJsonViewer from './PlanJsonViewer'

interface PlanBuilderProps {
  template?: PlanTemplate
  onSave: (template: PlanTemplate) => void
  onCancel: () => void
  onBack?: () => void
  isFromGenerator?: boolean
  onContentChange?: () => void  // Called when content is modified
}

const createEmptyState = (): PlanState => ({
  id: crypto.randomUUID(),
  title: '',
  type: 'loose',
  tasks: [],
})

const createEmptyTask = (): PlanTask => ({
  id: crypto.randomUUID(),
  description: '',
  required: true,
  deliverables: [],
})

const createEmptyDeliverable = (): PlanDeliverable => ({
  key: `deliverable_${crypto.randomUUID().slice(0, 8)}`, // Keep short for readability
  description: '',
  type: 'string',
  required: true,
})

export default function PlanBuilder({ template, onSave, onCancel, onBack, isFromGenerator, onContentChange }: PlanBuilderProps) {
  const { resolvedTheme } = useThemeStore()
  const { addToast } = useToastStore()
  const isDark = resolvedTheme === 'dark'
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [name, setName] = useState(template?.name || '')
  const [description, setDescription] = useState(template?.description || '')
  const [systemPrompt, setSystemPrompt] = useState(template?.content.system_prompt || '')
  const [states, setStates] = useState<PlanState[]>(template?.content.states || [])
  const [selectedStateIndex, setSelectedStateIndex] = useState<number | null>(
    template?.content.states?.length ? 0 : null
  )
  const [xRayMode, setXRayMode] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  const isEditing = !!template?.id

  // Helper to mark content as changed
  const markChanged = () => {
    onContentChange?.()
  }

  const handleAddState = () => {
    const newState = createEmptyState()
    setStates(prev => [...prev, newState])
    setSelectedStateIndex(states.length)
    markChanged()
  }

  const handleUpdateState = (index: number, updated: PlanState) => {
    setStates(prev => prev.map((s, i) => i === index ? updated : s))
    markChanged()
  }

  const handleDeleteState = (index: number) => {
    setStates(prev => prev.filter((_, i) => i !== index))
    if (selectedStateIndex === index) {
      setSelectedStateIndex(states.length > 1 ? Math.max(0, index - 1) : null)
    } else if (selectedStateIndex !== null && selectedStateIndex > index) {
      setSelectedStateIndex(selectedStateIndex - 1)
    }
    markChanged()
  }

  const handleMoveState = (index: number, direction: 'up' | 'down') => {
    const newIndex = direction === 'up' ? index - 1 : index + 1
    if (newIndex < 0 || newIndex >= states.length) return

    const newStates = [...states]
    const [removed] = newStates.splice(index, 1)
    newStates.splice(newIndex, 0, removed)
    setStates(newStates)

    if (selectedStateIndex === index) {
      setSelectedStateIndex(newIndex)
    } else if (selectedStateIndex === newIndex) {
      setSelectedStateIndex(index)
    }
    markChanged()
  }

  const handleImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const content = JSON.parse(e.target?.result as string) as PlanContent
        if (!content.states || !Array.isArray(content.states)) {
          throw new Error('Invalid plan structure')
        }
        setStates(content.states)
        setSelectedStateIndex(content.states.length > 0 ? 0 : null)
        // Also import system_prompt if present
        if (content.system_prompt) {
          setSystemPrompt(content.system_prompt)
        }
        markChanged()
        addToast({ message: 'Plan imported successfully', type: 'success' })
      } catch (err) {
        addToast({ message: 'Failed to parse JSON file', type: 'error' })
      }
    }
    reader.readAsText(file)
    event.target.value = ''
  }

  const handleExport = () => {
    const content: PlanContent = {
      states,
      ...(systemPrompt.trim() ? { system_prompt: systemPrompt.trim() } : {}),
    }
    const json = JSON.stringify(content, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${name || 'plan'}-template.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleSave = async () => {
    if (!name.trim()) {
      addToast({ message: 'Please enter a plan name', type: 'error' })
      return
    }

    if (states.length === 0) {
      addToast({ message: 'Please add at least one state', type: 'error' })
      return
    }

    setIsSaving(true)
    try {
      const content: PlanContent = {
        states,
        ...(systemPrompt.trim() ? { system_prompt: systemPrompt.trim() } : {}),
      }
      let saved: PlanTemplate

      if (isEditing) {
        saved = await apiClient.updatePlanTemplate(template.id, {
          name: name.trim(),
          description: description.trim() || undefined,
          content,
        })
        addToast({ message: 'Plan template updated', type: 'success' })
      } else {
        saved = await apiClient.createPlanTemplate({
          name: name.trim(),
          description: description.trim() || undefined,
          content,
        })
        addToast({ message: 'Plan template created', type: 'success' })
      }

      onSave(saved)
    } catch (err) {
      addToast({
        message: err instanceof Error ? err.message : 'Failed to save template',
        type: 'error',
      })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <motion.div
      className="h-full flex flex-col"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      {/* Header */}
      <motion.div
        className={`px-8 py-5 border-b flex items-center justify-between ${
          isDark ? 'border-border-dark bg-surface-dark' : 'border-border bg-white'
        }`}
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.1 }}
      >
        <div className="flex items-center gap-4">
          {/* Back to Generator button (only when coming from AI generator) */}
          {onBack && (
            <motion.button
              onClick={onBack}
              className={`p-2 rounded-xl transition-colors ${
                isDark
                  ? 'text-content-inverse-secondary hover:text-content-inverse hover:bg-surface-dark-secondary'
                  : 'text-content-secondary hover:text-content hover:bg-surface-secondary'
              }`}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              title="Back to AI Generator"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
            </motion.button>
          )}
          {/* Close button (only when there's no back button) */}
          {!onBack && (
            <motion.button
              onClick={onCancel}
              className={`p-2 rounded-xl transition-colors ${
                isDark
                  ? 'text-content-inverse-secondary hover:text-content-inverse hover:bg-surface-dark-secondary'
                  : 'text-content-secondary hover:text-content hover:bg-surface-secondary'
              }`}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M6 18L18 6M6 6l12 12" />
              </svg>
            </motion.button>
          )}
          <div>
            <h2 className={`text-heading font-semibold ${
              isDark ? 'text-content-inverse' : 'text-content'
            }`}>
              {isEditing ? 'Edit Plan' : 'New Plan'}
            </h2>
            <p className={`text-caption ${
              isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'
            }`}>
              {states.length} {states.length === 1 ? 'state' : 'states'} configured
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* X-ray Toggle */}
          <motion.button
            onClick={() => setXRayMode(!xRayMode)}
            className={`px-4 py-2 rounded-xl text-body-sm font-medium flex items-center gap-2 transition-all ${
              xRayMode
                ? isDark
                  ? 'bg-primary text-white shadow-lg shadow-primary/20'
                  : 'bg-neutral-900 text-white shadow-lg shadow-neutral-900/20'
                : isDark
                  ? 'bg-surface-dark-secondary text-content-inverse hover:bg-surface-dark-tertiary'
                  : 'bg-surface-secondary text-content hover:bg-surface-tertiary'
            }`}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
            X-ray
          </motion.button>

          {/* Save Button */}
          <motion.button
            onClick={handleSave}
            disabled={isSaving}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-body-sm font-medium transition-all ${
              isDark
                ? 'bg-primary text-white shadow-lg shadow-primary/20 hover:bg-primary/90'
                : 'bg-neutral-900 text-white shadow-lg shadow-neutral-900/20 hover:bg-neutral-800'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
            whileHover={{ scale: 1.02, y: -1 }}
            whileTap={{ scale: 0.98 }}
          >
            {isSaving ? (
              <>
                <motion.svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                >
                  <path d="M21 12a9 9 0 11-6.219-8.56" />
                </motion.svg>
                Saving...
              </>
            ) : (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" />
                  <polyline points="17 21 17 13 7 13 7 21" />
                  <polyline points="7 3 7 8 15 8" />
                </svg>
                {isEditing ? 'Save Changes' : 'Create Plan'}
              </>
            )}
          </motion.button>
        </div>
      </motion.div>

      {/* AI-Generated Banner */}
      {isFromGenerator && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className={`mx-8 mt-4 px-4 py-2.5 rounded-xl flex items-center gap-3 ${
            isDark
              ? 'bg-violet-500/10 border border-violet-500/20'
              : 'bg-neutral-100 border border-neutral-200'
          }`}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={isDark ? 'text-violet-500' : 'text-neutral-600'}>
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
          <span className={`text-body-sm ${isDark ? 'text-violet-400' : 'text-neutral-700'}`}>
            AI-generated plan — review and customize as needed
          </span>
        </motion.div>
      )}

      {/* Main Content */}
      <div className={`flex-1 flex overflow-hidden ${isFromGenerator ? 'mt-4' : ''}`}>
        {/* Left Panel - State List */}
        <motion.div
          className={`w-80 border-r flex flex-col ${
            isDark ? 'border-border-dark bg-surface-dark' : 'border-border bg-surface'
          }`}
          initial={{ x: -20, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ delay: 0.15 }}
        >
          {/* Plan Metadata */}
          <div className={`p-5 border-b ${isDark ? 'border-border-dark' : 'border-border'}`}>
            <input
              type="text"
              value={name}
              onChange={(e) => { setName(e.target.value); markChanged() }}
              placeholder="Plan name"
              className={`w-full px-4 py-2.5 rounded-xl text-heading-sm font-semibold border-2 transition-colors ${
                isDark
                  ? 'bg-transparent border-border-dark focus:border-primary text-content-inverse placeholder:text-content-inverse-tertiary'
                  : 'bg-white border-neutral-200 focus:border-neutral-900 text-content placeholder:text-content-tertiary shadow-sm'
              } focus:outline-none`}
            />
            <textarea
              value={description}
              onChange={(e) => { setDescription(e.target.value); markChanged() }}
              placeholder="Description (optional)"
              rows={2}
              className={`w-full mt-3 px-4 py-2.5 rounded-xl text-body-sm border-2 resize-none transition-colors ${
                isDark
                  ? 'bg-transparent border-border-dark focus:border-primary text-content-inverse placeholder:text-content-inverse-tertiary'
                  : 'bg-white border-neutral-200 focus:border-neutral-900 text-content placeholder:text-content-tertiary shadow-sm'
              } focus:outline-none`}
            />

            {/* System Prompt / Initial Instructions */}
            <div className="mt-4">
              <label className={`block text-caption font-medium mb-2 ${
                isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'
              }`}>
                System Prompt
                <span className={`ml-2 text-caption font-normal ${
                  isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'
                }`}>
                  (Agent personality & instructions)
                </span>
              </label>
              <textarea
                value={systemPrompt}
                onChange={(e) => { setSystemPrompt(e.target.value); markChanged() }}
                placeholder="e.g., You are a friendly memory coach helping seniors improve their cognitive abilities..."
                rows={4}
                className={`w-full px-4 py-2.5 rounded-xl text-body-sm border-2 resize-none transition-colors ${
                  isDark
                    ? 'bg-transparent border-border-dark focus:border-primary text-content-inverse placeholder:text-content-inverse-tertiary'
                    : 'bg-white border-neutral-200 focus:border-neutral-900 text-content placeholder:text-content-tertiary shadow-sm'
                } focus:outline-none`}
              />
            </div>
          </div>

          {/* States List */}
          <div className="flex-1 overflow-y-auto p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className={`text-body-sm font-semibold ${
                isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'
              }`}>
                States
              </h3>
              <motion.button
                onClick={handleAddState}
                className={`text-body-sm font-medium flex items-center gap-1.5 transition-colors ${
                  isDark
                    ? 'text-primary hover:text-primary/80'
                    : 'text-neutral-700 hover:text-neutral-900'
                }`}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                Add State
              </motion.button>
            </div>

            <AnimatePresence mode="popLayout">
              {states.length === 0 ? (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className={`text-center py-12 px-4 rounded-2xl ${
                    isDark ? 'bg-surface-dark-secondary' : 'bg-surface-secondary'
                  }`}
                >
                  <div className={`w-14 h-14 mx-auto mb-4 rounded-xl flex items-center justify-center ${
                    isDark ? 'bg-surface-dark-tertiary' : 'bg-white'
                  }`}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'}>
                      <polygon points="12 2 2 7 12 12 22 7 12 2" />
                      <polyline points="2 17 12 22 22 17" />
                      <polyline points="2 12 12 17 22 12" />
                    </svg>
                  </div>
                  <p className={`text-body-sm ${isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'}`}>
                    No states yet
                  </p>
                  <p className={`text-caption mt-1 ${isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'}`}>
                    Add states to structure your plan
                  </p>
                </motion.div>
              ) : (
                <div className="space-y-2">
                  {states.map((state, index) => (
                    <motion.div
                      key={state.id}
                      layout
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -20, scale: 0.9 }}
                      transition={{ delay: index * 0.03 }}
                      className={`group relative flex items-center gap-3 p-4 rounded-xl cursor-pointer transition-all ${
                        selectedStateIndex === index
                          ? isDark
                            ? 'bg-primary/20 ring-2 ring-primary/30'
                            : 'bg-neutral-100 ring-2 ring-neutral-300'
                          : isDark
                            ? 'bg-surface-dark-secondary hover:bg-surface-dark-tertiary'
                            : 'bg-white hover:bg-surface-secondary shadow-sm'
                      }`}
                      onClick={() => setSelectedStateIndex(index)}
                      whileHover={{ scale: selectedStateIndex === index ? 1 : 1.01 }}
                      whileTap={{ scale: 0.99 }}
                    >
                      {/* State number badge */}
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-caption font-semibold ${
                        selectedStateIndex === index
                          ? isDark
                            ? 'bg-primary text-white'
                            : 'bg-neutral-900 text-white'
                          : isDark
                            ? 'bg-primary/20 text-primary ring-2 ring-primary/30'
                            : 'bg-neutral-200 text-neutral-700 ring-2 ring-neutral-300'
                      }`}>
                        {index + 1}
                      </div>

                      {/* State info */}
                      <div className="flex-1 min-w-0">
                        <div className={`text-body-sm font-medium truncate ${
                          selectedStateIndex === index
                            ? isDark
                              ? 'text-primary'
                              : 'text-neutral-900'
                            : isDark
                              ? 'text-content-inverse'
                              : 'text-content'
                        }`}>
                          {state.title || `State ${index + 1}`}
                        </div>
                        <div className={`text-caption ${
                          isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'
                        }`}>
                          {state.tasks.length} {state.tasks.length === 1 ? 'task' : 'tasks'}
                        </div>
                      </div>

                      {/* Reorder buttons */}
                      <div className="flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                        <motion.button
                          onClick={() => handleMoveState(index, 'up')}
                          disabled={index === 0}
                          className={`p-1 rounded ${
                            index === 0
                              ? 'opacity-30 cursor-not-allowed'
                              : isDark
                                ? 'hover:bg-surface-dark-tertiary'
                                : 'hover:bg-surface-tertiary'
                          }`}
                          whileHover={index !== 0 ? { scale: 1.2 } : {}}
                          whileTap={index !== 0 ? { scale: 0.9 } : {}}
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M18 15l-6-6-6 6" />
                          </svg>
                        </motion.button>
                        <motion.button
                          onClick={() => handleMoveState(index, 'down')}
                          disabled={index === states.length - 1}
                          className={`p-1 rounded ${
                            index === states.length - 1
                              ? 'opacity-30 cursor-not-allowed'
                              : isDark
                                ? 'hover:bg-surface-dark-tertiary'
                                : 'hover:bg-surface-tertiary'
                          }`}
                          whileHover={index !== states.length - 1 ? { scale: 1.2 } : {}}
                          whileTap={index !== states.length - 1 ? { scale: 0.9 } : {}}
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M6 9l6 6 6-6" />
                          </svg>
                        </motion.button>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </AnimatePresence>
          </div>

          {/* Import/Export Footer */}
          <div className={`p-4 border-t ${isDark ? 'border-border-dark' : 'border-border'}`}>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={handleImport}
              className="hidden"
            />
            <div className="flex gap-2">
              <motion.button
                onClick={() => fileInputRef.current?.click()}
                className={`flex-1 px-3 py-2 rounded-xl text-caption font-medium flex items-center justify-center gap-2 transition-colors ${
                  isDark
                    ? 'bg-surface-dark-secondary text-content-inverse-secondary hover:bg-surface-dark-tertiary hover:text-content-inverse'
                    : 'bg-surface-secondary text-content-secondary hover:bg-surface-tertiary hover:text-content'
                }`}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                Import
              </motion.button>
              <motion.button
                onClick={handleExport}
                className={`flex-1 px-3 py-2 rounded-xl text-caption font-medium flex items-center justify-center gap-2 transition-colors ${
                  isDark
                    ? 'bg-surface-dark-secondary text-content-inverse-secondary hover:bg-surface-dark-tertiary hover:text-content-inverse'
                    : 'bg-surface-secondary text-content-secondary hover:bg-surface-tertiary hover:text-content'
                }`}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Export
              </motion.button>
            </div>
          </div>
        </motion.div>

        {/* Right Panel - Editor or X-ray */}
        <motion.div
          className={`flex-1 overflow-hidden ${
            isDark ? 'bg-surface-dark' : 'bg-surface'
          }`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
        >
          <AnimatePresence mode="wait">
            {xRayMode ? (
              <motion.div
                key="xray"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ duration: 0.2 }}
                className="h-full"
              >
                <PlanJsonViewer content={{
                  states,
                  ...(systemPrompt.trim() ? { system_prompt: systemPrompt.trim() } : {}),
                }} />
              </motion.div>
            ) : selectedStateIndex !== null && states[selectedStateIndex] ? (
              <motion.div
                key={`state-${selectedStateIndex}`}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.2 }}
                className="h-full overflow-y-auto"
              >
                <PlanStateEditor
                  state={states[selectedStateIndex]}
                  onChange={(updated) => handleUpdateState(selectedStateIndex, updated)}
                  onDelete={() => handleDeleteState(selectedStateIndex)}
                  createEmptyTask={createEmptyTask}
                  createEmptyDeliverable={createEmptyDeliverable}
                />
              </motion.div>
            ) : (
              <motion.div
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className={`flex flex-col items-center justify-center h-full text-center px-8 ${
                  isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'
                }`}
              >
                <motion.div
                  className={`w-20 h-20 rounded-2xl mb-6 flex items-center justify-center ${
                    isDark ? 'bg-surface-dark-secondary' : 'bg-surface-secondary'
                  }`}
                  animate={{ y: [0, -8, 0] }}
                  transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                >
                  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" className="opacity-50">
                    <polygon points="12 2 2 7 12 12 22 7 12 2" />
                    <polyline points="2 17 12 22 22 17" />
                    <polyline points="2 12 12 17 22 12" />
                  </svg>
                </motion.div>
                <p className="text-body font-medium">Select a state to edit</p>
                <p className="text-caption mt-2 max-w-xs">
                  Choose a state from the left panel or add a new state to start building your plan
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    </motion.div>
  )
}
