import { useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useThemeStore } from '../../../store/themeStore'
import { useToastStore } from '../../../store/toastStore'
import { apiClient } from '../../../services/ApiClient'
import type {
  PlanTemplate,
  PlanContent,
  PlanMetadata,
  PlanCanvasMetadata,
  PlanCanvasPosition,
  PlanState,
  PlanTask,
  PlanDeliverable,
} from '../../../lib/api-types'
import PlanStateEditor from './PlanStateEditor'
import PlanJsonViewer from './PlanJsonViewer'
import PlanCanvas from './PlanCanvas'
import { getDefaultStatePosition } from './planCanvasLayout'

interface PlanBuilderProps {
  template?: PlanTemplate
  onSave: (template: PlanTemplate) => void
  onCancel: () => void
  onBack?: () => void
  isFromGenerator?: boolean
  onContentChange?: () => void  // Called when content is modified
}

type PlanStateWithLegacyType = Omit<PlanState, 'type'> & {
  type?: PlanState['type'] | 'strict' | 'loose'
}

const createEmptyState = (): PlanState => ({
  id: crypto.randomUUID(),
  title: '',
  // Migration: UI now stores "flexible" instead of legacy "loose"
  type: 'flexible',
  tasks: [],
})

const normalizeStateType = (type: unknown): PlanState['type'] => {
  if (type === 'sequential' || type === 'goal' || type === 'flexible') return type
  if (type === 'strict') return 'sequential' // Backward compatibility for legacy plans
  if (type === 'loose') return 'flexible' // Backward compatibility for legacy plans
  return 'flexible'
}

// Migration: normalize persisted/imported legacy state types for editor safety.
const normalizePlanStates = (inputStates: PlanStateWithLegacyType[]): PlanState[] =>
  inputStates.map((state) => ({
    ...state,
    type: normalizeStateType(state.type),
  }))

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

const extractCanvasMetadata = (metadata: PlanMetadata | undefined): PlanCanvasMetadata => {
  const planBuilder = metadata?.plan_builder
  if (!planBuilder || typeof planBuilder !== 'object') return {}

  const canvas = planBuilder.canvas
  if (!canvas || typeof canvas !== 'object') return {}

  const rawStatePositions = canvas.state_positions
  const parsedStatePositions: Record<string, PlanCanvasPosition> = {}

  if (rawStatePositions && typeof rawStatePositions === 'object') {
    for (const [stateId, position] of Object.entries(rawStatePositions)) {
      if (
        position &&
        typeof position === 'object' &&
        typeof (position as { x?: unknown }).x === 'number' &&
        typeof (position as { y?: unknown }).y === 'number'
      ) {
        parsedStatePositions[stateId] = {
          x: (position as { x: number }).x,
          y: (position as { y: number }).y,
        }
      }
    }
  }

  const endNodePosition = canvas.end_node_position
  const parsedEndNodePosition =
    endNodePosition &&
    typeof endNodePosition === 'object' &&
    typeof (endNodePosition as { x?: unknown }).x === 'number' &&
    typeof (endNodePosition as { y?: unknown }).y === 'number'
      ? {
          x: (endNodePosition as { x: number }).x,
          y: (endNodePosition as { y: number }).y,
        }
      : undefined

  return {
    state_positions: parsedStatePositions,
    show_end_node: canvas.show_end_node === true,
    end_node_position: parsedEndNodePosition,
  }
}

const hasMetadataContent = (metadata: PlanMetadata) => Object.keys(metadata).length > 0

export default function PlanBuilder({ template, onSave, onCancel, onBack, isFromGenerator, onContentChange }: PlanBuilderProps) {
  const { resolvedTheme } = useThemeStore()
  const { addToast } = useToastStore()
  const isDark = resolvedTheme === 'dark'
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [name, setName] = useState(template?.name || '')
  const [description, setDescription] = useState(template?.description || '')
  const [systemPrompt, setSystemPrompt] = useState(template?.content.system_prompt || '')
  const [states, setStates] = useState<PlanState[]>(
    normalizePlanStates(template?.content.states || [])
  )
  const [metadata, setMetadata] = useState<PlanMetadata>(template?.content.metadata || {})
  const [selectedStateIndex, setSelectedStateIndex] = useState<number | null>(
    template?.content.states?.length ? 0 : null
  )
  const [xRayMode, setXRayMode] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [autoFitKey, setAutoFitKey] = useState(0)

  const isEditing = !!template?.id

  // Helper to mark content as changed
  const markChanged = () => {
    onContentChange?.()
  }

  const updateCanvasMetadata = (updater: (current: PlanCanvasMetadata) => PlanCanvasMetadata) => {
    setMetadata((prev) => {
      const currentCanvas = extractCanvasMetadata(prev)
      const nextCanvas = updater(currentCanvas)
      return {
        ...prev,
        plan_builder: {
          ...(prev.plan_builder || {}),
          canvas: nextCanvas,
        },
      }
    })
  }

  const canvasMetadata = extractCanvasMetadata(metadata)
  const statePositions = canvasMetadata.state_positions || {}
  const showEndNode = canvasMetadata.show_end_node === true

  const buildContent = (): PlanContent => ({
    states,
    ...(hasMetadataContent(metadata) ? { metadata } : {}),
    ...(systemPrompt.trim() ? { system_prompt: systemPrompt.trim() } : {}),
  })

  const handleAddState = () => {
    const newState = createEmptyState()
    const newIndex = states.length

    setStates((prev) => [...prev, newState])
    setSelectedStateIndex(newIndex)

    updateCanvasMetadata((current) => ({
      ...current,
      state_positions: {
        ...(current.state_positions || {}),
        [newState.id]: getDefaultStatePosition(newIndex),
      },
    }))

    setAutoFitKey((prev) => prev + 1)
    markChanged()
  }

  const handleUpdateState = (index: number, updated: PlanState) => {
    setStates((prev) => prev.map((s, i) => (i === index ? updated : s)))
    markChanged()
  }

  const handleDeleteState = (index: number) => {
    const stateToDelete = states[index]
    if (!stateToDelete) return

    setStates((prev) => prev.filter((_, i) => i !== index))

    if (selectedStateIndex === index) {
      setSelectedStateIndex(states.length > 1 ? Math.max(0, index - 1) : null)
    } else if (selectedStateIndex !== null && selectedStateIndex > index) {
      setSelectedStateIndex(selectedStateIndex - 1)
    }

    updateCanvasMetadata((current) => {
      const nextPositions = { ...(current.state_positions || {}) }
      delete nextPositions[stateToDelete.id]
      return {
        ...current,
        state_positions: nextPositions,
      }
    })

    markChanged()
  }

  const handleDeleteStateById = (stateId: string) => {
    const index = states.findIndex((state) => state.id === stateId)
    if (index >= 0) {
      handleDeleteState(index)
    }
  }

  const handleSelectStateById = (stateId: string) => {
    const index = states.findIndex((state) => state.id === stateId)
    setSelectedStateIndex(index >= 0 ? index : null)
  }

  const handleStatePositionChange = (stateId: string, position: PlanCanvasPosition) => {
    updateCanvasMetadata((current) => ({
      ...current,
      state_positions: {
        ...(current.state_positions || {}),
        [stateId]: position,
      },
    }))
    markChanged()
  }

  const handleToggleEndNode = () => {
    updateCanvasMetadata((current) => ({
      ...current,
      show_end_node: !showEndNode,
    }))
    setAutoFitKey((prev) => prev + 1)
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

        const normalizedStates = normalizePlanStates(content.states as PlanStateWithLegacyType[])
        setStates(normalizedStates)
        setSelectedStateIndex(normalizedStates.length > 0 ? 0 : null)
        setSystemPrompt(content.system_prompt || '')
        setMetadata((content.metadata as PlanMetadata) || {})
        setAutoFitKey((prev) => prev + 1)

        markChanged()
        addToast({ message: 'Plan imported successfully', type: 'success' })
      } catch {
        addToast({ message: 'Failed to parse JSON file', type: 'error' })
      }
    }
    reader.readAsText(file)
    event.target.value = ''
  }

  const handleExport = () => {
    const content = buildContent()
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
      const content = buildContent()
      let saved: PlanTemplate

      if (isEditing) {
        saved = await apiClient.updatePlanTemplate(template!.id, {
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
    <div className="h-full flex flex-col">
      <div className={`px-4 py-3 border-b flex items-center gap-3 ${isDark ? 'border-zinc-700/80 bg-surface-dark' : 'border-neutral-200 bg-white'}`}>
        {onBack ? (
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
        ) : (
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

        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${isDark ? 'bg-primary-500/10' : 'bg-primary-50'}`}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={isDark ? 'text-primary-400' : 'text-primary-600'}>
              <path d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
            </svg>
          </div>
          <div>
            <h2 className={`text-body-sm font-semibold ${isDark ? 'text-content-inverse' : 'text-content'}`}>
              Plan Builder
            </h2>
            <p className={`text-caption ${isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'}`}>
              {states.length} {states.length === 1 ? 'state' : 'states'} configured
            </p>
          </div>
        </div>

        <div className="flex-1 flex gap-2.5 ml-3">
          <input
            type="text"
            value={name}
            onChange={(e) => { setName(e.target.value); markChanged() }}
            placeholder="Plan name..."
            className={`flex-1 max-w-[220px] px-3 py-1.5 rounded-lg text-body-sm focus:outline-none transition-all ${
              isDark
                ? 'bg-surface-dark-secondary border border-border-dark text-content-inverse placeholder:text-content-inverse-tertiary focus:border-border-dark-secondary'
                : 'bg-surface-secondary border border-border text-content placeholder:text-content-tertiary focus:border-border-secondary'
            }`}
          />
          <input
            type="text"
            value={description}
            onChange={(e) => { setDescription(e.target.value); markChanged() }}
            placeholder="Description (optional)"
            className={`flex-1 max-w-[280px] px-3 py-1.5 rounded-lg text-body-sm focus:outline-none transition-all ${
              isDark
                ? 'bg-surface-dark-secondary border border-border-dark text-content-inverse placeholder:text-content-inverse-tertiary focus:border-border-dark-secondary'
                : 'bg-surface-secondary border border-border text-content placeholder:text-content-tertiary focus:border-border-secondary'
            }`}
          />
        </div>

        <div className="flex items-center gap-2">
          <motion.button
            onClick={() => setXRayMode(!xRayMode)}
            className={`px-3 py-1.5 rounded-lg text-body-sm font-medium transition-all ${
              xRayMode
                ? isDark ? 'bg-primary text-white' : 'bg-neutral-900 text-white'
                : isDark
                  ? 'bg-surface-dark-secondary text-content-inverse hover:bg-surface-dark-tertiary'
                  : 'bg-surface-secondary text-content hover:bg-surface-tertiary'
            }`}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
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
            {isSaving ? 'Saving...' : isEditing ? 'Save Changes' : 'Create Plan'}
          </motion.button>
        </div>
      </div>

      {/* AI-Generated Banner */}
      {isFromGenerator && (
        <div className={`mx-4 mt-3 px-4 py-2.5 rounded-xl flex items-center gap-3 ${
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
        </div>
      )}

      <div className={`flex-1 flex overflow-hidden ${isFromGenerator ? 'mt-3' : ''}`}>
        <div className="flex-1 min-w-0">
          {xRayMode ? (
            <PlanJsonViewer content={buildContent()} />
          ) : (
            <div className="h-full flex flex-col">
              <div className={`px-6 py-3 border-b flex items-center justify-between ${
                isDark ? 'border-zinc-700/80 bg-surface-dark' : 'border-neutral-200 bg-surface'
              }`}>
                <span className={`text-[11px] font-medium tracking-wide uppercase ${isDark ? 'text-zinc-500' : 'text-neutral-400'}`}>
                  Conversation Flow
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleToggleEndNode}
                    className={`px-2.5 py-1.5 rounded-lg text-caption font-medium transition-colors ${
                      showEndNode
                        ? isDark
                          ? 'bg-primary/20 text-primary'
                          : 'bg-neutral-200 text-neutral-900'
                        : isDark
                          ? 'bg-surface-dark-secondary text-content-inverse-secondary hover:text-content-inverse'
                          : 'bg-surface-secondary text-content-secondary hover:text-content'
                    }`}
                  >
                    {showEndNode ? 'Hide End' : 'Show End'}
                  </button>
                  <button
                    onClick={handleAddState}
                    className={`px-2.5 py-1.5 rounded-lg text-caption font-medium transition-colors ${
                      isDark
                        ? 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                        : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
                    }`}
                  >
                    Add State
                  </button>
                </div>
              </div>
              <div className="flex-1 min-h-0">
                <PlanCanvas
                  states={states}
                  selectedStateId={selectedStateIndex !== null ? states[selectedStateIndex]?.id || null : null}
                  statePositions={statePositions}
                  showEndNode={showEndNode}
                  autoFitKey={autoFitKey}
                  isDark={isDark}
                  onSelectState={handleSelectStateById}
                  onDeleteState={handleDeleteStateById}
                  onStatePositionChange={handleStatePositionChange}
                />
              </div>
              <div className={`p-4 border-t shrink-0 ${isDark ? 'border-zinc-700/80 bg-surface-dark' : 'border-neutral-200 bg-surface'}`}>
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
                    Export
                  </motion.button>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className={`w-[440px] shrink-0 border-l overflow-hidden ${isDark ? 'border-zinc-700' : 'border-neutral-200'}`}>
          <div className="h-full flex flex-col overflow-hidden">
            <div className={`px-5 py-4 border-b shrink-0 ${isDark ? 'border-zinc-700/80' : 'border-neutral-200'}`}>
              <h3 className={`text-sm font-semibold ${isDark ? 'text-zinc-100' : 'text-neutral-800'}`}>
                State Editor
              </h3>
              <p className={`text-[11px] font-light mt-1 ${isDark ? 'text-zinc-500' : 'text-neutral-400'}`}>
                Click a state node to edit details
              </p>
            </div>

            <div className={`px-5 py-4 border-b shrink-0 ${isDark ? 'border-zinc-700/70 bg-zinc-900/20' : 'border-neutral-200 bg-neutral-50/50'}`}>
              <label className={`block text-caption font-medium mb-2 ${
                isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'
              }`}>
                System Prompt
              </label>
              <textarea
                value={systemPrompt}
                onChange={(e) => { setSystemPrompt(e.target.value); markChanged() }}
                placeholder="Agent personality and high-level instructions..."
                rows={5}
                className={`w-full px-3 py-2.5 rounded-lg text-[13px] border resize-none transition-colors ${
                  isDark
                    ? 'bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-500'
                    : 'bg-white border-neutral-200 text-neutral-900 placeholder:text-neutral-400'
                } focus:outline-none`}
              />
            </div>

            <div className="flex-1 overflow-y-auto overflow-x-hidden">
              <AnimatePresence mode="wait">
                {selectedStateIndex !== null && states[selectedStateIndex] ? (
                  <motion.div
                    key={`state-${selectedStateIndex}`}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ duration: 0.2 }}
                    className="h-full"
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
                    className={`h-full flex items-center justify-center text-center px-6 ${
                      isDark ? 'text-zinc-500' : 'text-neutral-400'
                    }`}
                  >
                    Select a state from the canvas to edit it.
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

          </div>
        </div>
      </div>
    </div>
  )
}
