import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useThemeStore } from '../../store/themeStore'
import { apiClient } from '../../services/ApiClient'
import AgentConfiguratorModal from '../configurator/AgentConfiguratorModal'
import type {
  AgentConfiguration,
  AgentConfigurationPayload,
  PipelineSchema,
} from '../../lib/api-types'

interface ConfigurationSelectionStepProps {
  agentTypeId: string
  pipelineSchema: PipelineSchema
  selectedConfiguration: AgentConfiguration | null
  customConfiguration: AgentConfigurationPayload | null
  onSelectConfiguration: (config: AgentConfiguration | null) => void
  onCustomConfiguration: (config: AgentConfigurationPayload | null) => void
}

export default function ConfigurationSelectionStep({
  agentTypeId,
  pipelineSchema,
  selectedConfiguration,
  customConfiguration,
  onSelectConfiguration,
  onCustomConfiguration,
}: ConfigurationSelectionStepProps) {
  const { resolvedTheme } = useThemeStore()
  const isDark = resolvedTheme === 'dark'
  const [configurations, setConfigurations] = useState<AgentConfiguration[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showConfigurator, setShowConfigurator] = useState(false)
  const [editingConfig, setEditingConfig] = useState<AgentConfiguration | null>(null)

  useEffect(() => {
    setIsLoading(true)
    apiClient
      .listAgentConfigurations(agentTypeId)
      .then(setConfigurations)
      .catch((err) => console.error('Failed to load configurations:', err))
      .finally(() => setIsLoading(false))
  }, [agentTypeId])

  const handleCreateNew = () => {
    setEditingConfig(null)
    setShowConfigurator(true)
  }

  const handleEditExisting = (config: AgentConfiguration) => {
    setEditingConfig(config)
    setShowConfigurator(true)
  }

  const handleSaveFromConfigurator = async (
    name: string,
    description: string,
    configuration: AgentConfigurationPayload,
  ) => {
    try {
      if (editingConfig) {
        const updated = await apiClient.updateAgentConfiguration(editingConfig.id, {
          name,
          description,
          configuration,
        })
        setConfigurations((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
        onSelectConfiguration(updated)
      } else {
        const created = await apiClient.createAgentConfiguration({
          name,
          description,
          agentTypeId,
          configuration,
        })
        setConfigurations((prev) => [created, ...prev])
        onSelectConfiguration(created)
      }
      setShowConfigurator(false)
    } catch (err) {
      console.error('Failed to save configuration:', err)
    }
  }

  const handleUseInline = () => {
    setEditingConfig(null)
    setShowConfigurator(true)
  }

  const countModifiedNodes = (config: AgentConfigurationPayload) => {
    return Object.keys(config.nodes || {}).filter(
      (k) => config.nodes?.[k] && Object.keys(config.nodes[k]).length > 0,
    ).length
  }

  return (
    <>
      <div className="space-y-4">
        {/* Mode toggle */}
        <div className="flex gap-3">
          <button
            onClick={() => {
              onCustomConfiguration(null)
            }}
            className={`flex-1 py-2.5 px-4 rounded-xl text-sm font-light tracking-wider transition-all duration-200 border ${
              !customConfiguration
                ? isDark
                  ? 'bg-primary-500/10 border-primary-400/30 text-primary-300'
                  : 'bg-neutral-900/5 border-neutral-300 text-neutral-900'
                : isDark
                  ? 'bg-white/5 border-white/10 text-zinc-400 hover:bg-white/10'
                  : 'bg-neutral-50 border-neutral-200 text-neutral-500 hover:bg-neutral-100'
            }`}
          >
            Select Saved
          </button>
          <button
            onClick={handleUseInline}
            className={`flex-1 py-2.5 px-4 rounded-xl text-sm font-light tracking-wider transition-all duration-200 border ${
              customConfiguration
                ? isDark
                  ? 'bg-primary-500/10 border-primary-400/30 text-primary-300'
                  : 'bg-neutral-900/5 border-neutral-300 text-neutral-900'
                : isDark
                  ? 'bg-white/5 border-white/10 text-zinc-400 hover:bg-white/10'
                  : 'bg-neutral-50 border-neutral-200 text-neutral-500 hover:bg-neutral-100'
            }`}
          >
            Customize
          </button>
        </div>

        {/* Saved configurations grid */}
        {!customConfiguration && (
          <>
            {isLoading ? (
              <div className={`h-32 flex items-center justify-center text-sm ${isDark ? 'text-zinc-500' : 'text-neutral-400'}`}>
                <div className="flex items-center gap-3">
                  <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  Loading configurations...
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {/* Default (no config) card */}
                <motion.button
                  whileHover={{ y: -2 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => onSelectConfiguration(null)}
                  className={`p-4 rounded-xl border-2 text-left transition-all ${
                    !selectedConfiguration
                      ? isDark
                        ? 'border-primary-400/50 bg-primary-500/5'
                        : 'border-primary-500/50 bg-primary-50/50'
                      : isDark
                        ? 'border-zinc-700 bg-zinc-800/50 hover:border-zinc-600'
                        : 'border-neutral-200 bg-white hover:border-neutral-300'
                  }`}
                >
                  <div className={`text-sm font-medium ${isDark ? 'text-zinc-200' : 'text-neutral-800'}`}>
                    Default Configuration
                  </div>
                  <p className={`text-xs font-light mt-1 ${isDark ? 'text-zinc-500' : 'text-neutral-400'}`}>
                    Use the agent's built-in defaults
                  </p>
                </motion.button>

                {/* Saved configs */}
                {configurations.map((config) => (
                  <motion.button
                    key={config.id}
                    whileHover={{ y: -2 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => onSelectConfiguration(config)}
                    className={`p-4 rounded-xl border-2 text-left transition-all relative group ${
                      selectedConfiguration?.id === config.id
                        ? isDark
                          ? 'border-primary-400/50 bg-primary-500/5'
                          : 'border-primary-500/50 bg-primary-50/50'
                        : isDark
                          ? 'border-zinc-700 bg-zinc-800/50 hover:border-zinc-600'
                          : 'border-neutral-200 bg-white hover:border-neutral-300'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className={`text-sm font-medium ${isDark ? 'text-zinc-200' : 'text-neutral-800'}`}>
                        {config.name}
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleEditExisting(config)
                        }}
                        className={`opacity-0 group-hover:opacity-100 text-[10px] px-2 py-1 rounded-lg transition-all ${
                          isDark ? 'bg-zinc-700 text-zinc-300' : 'bg-neutral-100 text-neutral-600'
                        }`}
                      >
                        Edit
                      </button>
                    </div>
                    {config.description && (
                      <p className={`text-xs font-light mt-1 line-clamp-2 ${isDark ? 'text-zinc-500' : 'text-neutral-400'}`}>
                        {config.description}
                      </p>
                    )}
                    <div className={`text-[10px] font-light mt-2 ${isDark ? 'text-zinc-600' : 'text-neutral-400'}`}>
                      {countModifiedNodes(config.configuration)} modified nodes
                    </div>
                  </motion.button>
                ))}

                {/* Create new */}
                <motion.button
                  whileHover={{ y: -2 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleCreateNew}
                  className={`p-4 rounded-xl border-2 border-dashed text-left transition-all ${
                    isDark
                      ? 'border-zinc-700 hover:border-zinc-600 text-zinc-500 hover:text-zinc-400'
                      : 'border-neutral-200 hover:border-neutral-300 text-neutral-400 hover:text-neutral-600'
                  }`}
                >
                  <div className="text-sm font-light">+ Create New</div>
                  <p className="text-xs font-light mt-1">
                    Open the pipeline configurator
                  </p>
                </motion.button>
              </div>
            )}
          </>
        )}

        {/* Inline customization info */}
        {customConfiguration && (
          <div className={`p-4 rounded-xl border ${isDark ? 'border-amber-500/20 bg-amber-500/5' : 'border-amber-200 bg-amber-50/50'}`}>
            <div className={`text-sm font-medium ${isDark ? 'text-amber-300' : 'text-amber-700'}`}>
              Custom Configuration (unsaved)
            </div>
            <p className={`text-xs font-light mt-1 ${isDark ? 'text-zinc-400' : 'text-neutral-500'}`}>
              {countModifiedNodes(customConfiguration)} modified nodes, {Object.keys(customConfiguration.thresholds || {}).length} modified thresholds
            </p>
            <button
              onClick={handleUseInline}
              className={`mt-2 text-xs font-light px-3 py-1.5 rounded-lg transition-colors ${
                isDark ? 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600' : 'bg-neutral-200 text-neutral-600 hover:bg-neutral-300'
              }`}
            >
              Edit Configuration
            </button>
          </div>
        )}

        {/* Skip option */}
        <p className={`text-center text-[11px] font-light ${isDark ? 'text-zinc-600' : 'text-neutral-400'}`}>
          Configuration is optional. You can proceed with defaults.
        </p>
      </div>

      {/* Configurator modal */}
      <AnimatePresence>
        {showConfigurator && (
          <AgentConfiguratorModal
            isOpen={showConfigurator}
            onClose={() => setShowConfigurator(false)}
            pipelineSchema={pipelineSchema}
            initialConfiguration={editingConfig?.configuration || customConfiguration || undefined}
            initialName={editingConfig?.name || ''}
            initialDescription={editingConfig?.description || ''}
            onSave={(n, d, config) => {
              if (editingConfig) {
                handleSaveFromConfigurator(n, d, config)
              } else {
                // Use as inline (unsaved) configuration
                onCustomConfiguration(config)
                onSelectConfiguration(null)
                setShowConfigurator(false)
              }
            }}
            saveLabel={editingConfig ? 'Save Configuration' : 'Use This Configuration'}
          />
        )}
      </AnimatePresence>
    </>
  )
}
