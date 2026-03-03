import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useThemeStore } from '../../store/themeStore'
import type { PipelineSchema, AgentConfigurationPayload, PipelineNode as PipelineNodeType } from '../../lib/api-types'
import PipelineView from './PipelineView'
import NodeConfigPanel from './NodeConfigPanel'

interface AgentConfiguratorModalProps {
  isOpen: boolean
  onClose: () => void
  pipelineSchema: PipelineSchema
  initialConfiguration?: AgentConfigurationPayload
  initialName?: string
  initialDescription?: string
  onSave: (name: string, description: string, configuration: AgentConfigurationPayload) => void
  saveLabel?: string
}

export default function AgentConfiguratorModal({
  isOpen,
  onClose,
  pipelineSchema,
  initialConfiguration,
  initialName = '',
  initialDescription = '',
  onSave,
  saveLabel = 'Save Configuration',
}: AgentConfiguratorModalProps) {
  const { resolvedTheme } = useThemeStore()
  const isDark = resolvedTheme === 'dark'

  const [name, setName] = useState(initialName)
  const [description, setDescription] = useState(initialDescription)
  const [configuration, setConfiguration] = useState<AgentConfigurationPayload>(
    initialConfiguration || { nodes: {}, thresholds: {} },
  )
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)

  const selectedNode = selectedNodeId
    ? pipelineSchema.nodes.find((n) => n.id === selectedNodeId) || null
    : null

  const handleNodeClick = useCallback((nodeId: string) => {
    setSelectedNodeId((prev) => (prev === nodeId ? null : nodeId))
  }, [])

  const handleSave = () => {
    if (!name.trim()) return
    onSave(name.trim(), description.trim(), configuration)
  }

  const modifiedNodeCount = Object.keys(configuration.nodes || {}).filter(
    (k) => configuration.nodes?.[k] && Object.keys(configuration.nodes[k]).length > 0,
  ).length
  const modifiedThresholdCount = Object.keys(configuration.thresholds || {}).length
  const hasModifications = modifiedNodeCount > 0 || modifiedThresholdCount > 0

  if (!isOpen) return null

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        className={`
          rounded-[20px] w-full max-w-7xl h-[90vh] overflow-hidden flex flex-col
          ${isDark
            ? 'bg-zinc-900 border border-zinc-700 shadow-[0_8px_40px_rgba(0,0,0,0.5)]'
            : 'bg-white border border-neutral-200 shadow-[0_1px_40px_rgba(0,0,0,0.12)]'
          }
        `}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`px-6 py-3.5 border-b flex items-center justify-between ${isDark ? 'border-zinc-700/80' : 'border-neutral-200'}`}>
          <div className="flex items-center gap-4 flex-1">
            <div className="flex items-center gap-3">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${isDark ? 'bg-primary-500/10' : 'bg-primary-50'}`}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={isDark ? 'text-primary-400' : 'text-primary-600'}>
                  <path d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                </svg>
              </div>
              <div>
                <h2 className={`text-sm font-semibold ${isDark ? 'text-zinc-100' : 'text-neutral-900'}`}>
                  Pipeline Configurator
                </h2>
                <p className={`text-[11px] font-light ${isDark ? 'text-zinc-500' : 'text-neutral-400'}`}>
                  Click a pipeline stage to customize its behavior
                  {hasModifications && (
                    <span className="ml-2 text-amber-500 font-medium">
                      {modifiedNodeCount} node{modifiedNodeCount !== 1 ? 's' : ''}, {modifiedThresholdCount} threshold{modifiedThresholdCount !== 1 ? 's' : ''} modified
                    </span>
                  )}
                </p>
              </div>
            </div>
            <div className="flex-1 flex gap-2.5 ml-6">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Configuration name..."
                className={`flex-1 max-w-[220px] px-3 py-1.5 rounded-lg text-sm font-light focus:outline-none transition-all ${
                  isDark
                    ? 'bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-600'
                    : 'bg-neutral-50/50 border border-neutral-200/60 text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-400/60'
                }`}
              />
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Description (optional)"
                className={`flex-1 max-w-[280px] px-3 py-1.5 rounded-lg text-sm font-light focus:outline-none transition-all ${
                  isDark
                    ? 'bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-600'
                    : 'bg-neutral-50/50 border border-neutral-200/60 text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-400/60'
                }`}
              />
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            <button
              onClick={onClose}
              className={`py-2 px-4 rounded-xl text-sm font-light tracking-wider transition-all duration-200 ${
                isDark
                  ? 'bg-white/5 text-zinc-300 hover:bg-white/10 border border-white/10'
                  : 'bg-neutral-100/80 text-neutral-600 hover:bg-neutral-200/80'
              }`}
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!name.trim()}
              className={`py-2 px-4 rounded-xl text-sm font-light tracking-wider transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed ${
                isDark
                  ? 'bg-primary-500 text-white hover:bg-primary-400 border border-primary-400/30'
                  : 'bg-neutral-900 text-white hover:bg-neutral-800 shadow-[0_1px_20px_rgba(0,0,0,0.12)]'
              }`}
            >
              {saveLabel}
            </button>
          </div>
        </div>

        {/* Body — horizontal split: pipeline left, config panel right */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left: Pipeline visualization */}
          <div className="flex-1 min-w-0 transition-all duration-300">
            <PipelineView
              schema={pipelineSchema}
              configuration={configuration}
              selectedNodeId={selectedNodeId}
              onNodeClick={handleNodeClick}
              onPaneClick={() => setSelectedNodeId(null)}
            />
          </div>

          {/* Right: Node config panel (slide in from right) */}
          <AnimatePresence>
            {selectedNode && (
              <motion.div
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: 480, opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                className={`border-l overflow-hidden shrink-0 ${isDark ? 'border-zinc-700' : 'border-neutral-200'}`}
              >
                <div className="w-[480px] h-full">
                  <NodeConfigPanel
                    key={selectedNode.id}
                    node={selectedNode}
                    configuration={configuration}
                    onChange={setConfiguration}
                    onClose={() => setSelectedNodeId(null)}
                    thresholds={pipelineSchema.thresholds}
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </motion.div>
  )
}
