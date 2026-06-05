import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useThemeStore } from '../../store/themeStore'
import { useToastStore } from '../../store/toastStore'
import { useConfiguratorStore } from '../../store/configuratorStore'
import { apiClient } from '../../services/ApiClient'
import type { AgentConfiguration, AgentConfigurationPayload, AgentType, PipelineSchema } from '../../lib/api-types'
import ConfirmDialog from '../modals/ConfirmDialog'


// Gradient color palette for configuration cards (matches ConfigurationSelectionStep)
const getConfigCardStyle = (id: string) => {
  const gradients = [
    'from-indigo-500/20 to-blue-500/20',
    'from-teal-500/20 to-emerald-500/20',
    'from-orange-500/20 to-amber-500/20',
    'from-rose-500/20 to-pink-500/20',
    'from-violet-500/20 to-purple-500/20',
  ]
  const iconColors = [
    'text-indigo-500',
    'text-teal-500',
    'text-orange-500',
    'text-rose-500',
    'text-violet-500',
  ]
  // Derive a stable hash from the config id so color doesn't shift on reorder
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0
  }
  const colorIndex = Math.abs(hash) % 5
  return { gradient: gradients[colorIndex], iconColor: iconColors[colorIndex] }
}

export default function AgentConfigSection() {
  const { resolvedTheme } = useThemeStore()
  const { addToast } = useToastStore()
  const { openModal } = useConfiguratorStore()
  const isDark = resolvedTheme === 'dark'

  const [configurations, setConfigurations] = useState<AgentConfiguration[]>([])
  const [agentTypes, setAgentTypes] = useState<AgentType[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [configToDelete, setConfigToDelete] = useState<AgentConfiguration | null>(null)

  // Agent type selector modal state
  const [showAgentTypeSelector, setShowAgentTypeSelector] = useState(false)

  const configurableAgentTypes = agentTypes.filter((t) => t.pipelineSchema)

  const loadData = async () => {
    try {
      setIsLoading(true)
      setError(null)
      const [configs, types] = await Promise.all([
        apiClient.listAgentConfigurations(),
        apiClient.getAgentTypes(),
      ])
      setConfigurations(configs)
      setAgentTypes(types)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  const handleCreate = () => {
    if (configurableAgentTypes.length === 1) {
      openConfiguratorForCreate(configurableAgentTypes[0])
    } else {
      setShowAgentTypeSelector(true)
    }
  }

  const openConfiguratorForCreate = (agentType: AgentType) => {
    if (!agentType.pipelineSchema) return
    openModal({
      pipelineSchema: agentType.pipelineSchema,
      runtimeVariables: agentType.runtimeVariables,
      expertDefaults: agentType.expertDefaults,
      capabilities: agentType.capabilities,
      saveLabel: 'Create Configuration',
      onSave: async (name, description, configuration) => {
        try {
          const created = await apiClient.createAgentConfiguration({
            name,
            description,
            agentTypeId: agentType.id,
            configuration,
          })
          setConfigurations((prev) => [created, ...prev])
          addToast({ type: 'success', message: `Created "${name}"` })
        } catch (err) {
          addToast({ type: 'error', message: 'Failed to save configuration' })
        }
      },
    })
  }

  const handleSelectAgentTypeAndCreate = (agentTypeId: string) => {
    setShowAgentTypeSelector(false)
    const agentType = agentTypes.find((t) => t.id === agentTypeId)
    if (agentType) openConfiguratorForCreate(agentType)
  }

  const handleEdit = (config: AgentConfiguration) => {
    const schema = getPipelineSchema(config.agentTypeId)
    if (!schema) return
    openModal({
      pipelineSchema: schema,
      runtimeVariables: agentTypes.find((t) => t.id === config.agentTypeId)?.runtimeVariables,
      expertDefaults: agentTypes.find((t) => t.id === config.agentTypeId)?.expertDefaults,
      capabilities: agentTypes.find((t) => t.id === config.agentTypeId)?.capabilities,
      initialConfiguration: config.configuration,
      initialName: config.name,
      initialDescription: config.description || '',
      editingConfig: config,
      saveLabel: 'Save Changes',
      onSave: async (name, description, configuration) => {
        try {
          const updated = await apiClient.updateAgentConfiguration(config.id, {
            name,
            description,
            configuration,
          })
          setConfigurations((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
          addToast({ type: 'success', message: `Updated "${name}"` })
        } catch (err) {
          addToast({ type: 'error', message: 'Failed to save configuration' })
        }
      },
    })
  }

  const handleDuplicate = async (config: AgentConfiguration) => {
    try {
      const duplicated = await apiClient.duplicateAgentConfiguration(config.id)
      setConfigurations((prev) => [duplicated, ...prev])
      addToast({ type: 'success', message: `Duplicated "${config.name}"` })
    } catch (err) {
      addToast({ type: 'error', message: 'Failed to duplicate configuration' })
    }
  }

  const handleDelete = (config: AgentConfiguration) => {
    setConfigToDelete(config)
    setDeleteConfirmOpen(true)
  }

  const confirmDelete = async () => {
    if (!configToDelete) return
    try {
      await apiClient.deleteAgentConfiguration(configToDelete.id)
      setConfigurations((prev) => prev.filter((c) => c.id !== configToDelete.id))
      addToast({ type: 'success', message: `Deleted "${configToDelete.name}"` })
    } catch (err) {
      addToast({ type: 'error', message: 'Failed to delete configuration' })
    } finally {
      setDeleteConfirmOpen(false)
      setConfigToDelete(null)
    }
  }

  const countModifiedNodes = (config: AgentConfigurationPayload) => {
    const nodes = config.nodes || {}
    return Object.keys(nodes).filter(
      (k) => nodes[k] && Object.keys(nodes[k]).length > 0,
    ).length
  }

  const getAgentTypeName = (agentTypeId: string) => {
    return agentTypes.find((t) => t.id === agentTypeId)?.name || agentTypeId
  }

  const getPipelineSchema = (agentTypeId: string): PipelineSchema | null => {
    return agentTypes.find((t) => t.id === agentTypeId)?.pipelineSchema || null
  }

  // Group configurations by agent type
  const groupedConfigs = configurations.reduce<Record<string, AgentConfiguration[]>>((acc, config) => {
    const key = config.agentTypeId
    if (!acc[key]) acc[key] = []
    acc[key].push(config)
    return acc
  }, {})

  return (
    <>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className={`text-xl font-semibold ${isDark ? 'text-zinc-100' : 'text-neutral-900'}`}>
              Agent Configurations
            </h2>
            <p className={`text-sm font-light mt-1 ${isDark ? 'text-zinc-400' : 'text-neutral-500'}`}>
              Manage pipeline configurations for your agents
            </p>
          </div>
          {configurableAgentTypes.length > 0 && (
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={handleCreate}
              className={`px-4 py-2.5 rounded-xl text-sm font-light tracking-wider transition-all duration-200 ${
                isDark
                  ? 'bg-primary-500 text-white hover:bg-primary-400 border border-primary-400/30'
                  : 'bg-neutral-900 text-white hover:bg-neutral-800 shadow-[0_1px_20px_rgba(0,0,0,0.12)]'
              }`}
            >
              + New Configuration
            </motion.button>
          )}
        </div>

        {/* Loading */}
        {isLoading && (
          <div className={`h-48 flex items-center justify-center text-sm ${isDark ? 'text-zinc-500' : 'text-neutral-400'}`}>
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" />
              Loading configurations...
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className={`p-4 rounded-xl text-sm ${isDark ? 'bg-red-500/10 border border-red-500/20 text-red-400' : 'bg-red-50 border border-red-200 text-red-600'}`}>
            {error}
            <button onClick={loadData} className="ml-2 underline">Retry</button>
          </div>
        )}

        {/* Empty state */}
        {!isLoading && !error && configurations.length === 0 && (
          <div className={`text-center py-16 rounded-2xl border-2 border-dashed ${isDark ? 'border-zinc-700 text-zinc-500' : 'border-neutral-200 text-neutral-400'}`}>
            <div className="text-4xl mb-4">
              <svg className="w-12 h-12 mx-auto opacity-40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
              </svg>
            </div>
            <p className="text-sm font-light mb-1">No configurations yet</p>
            <p className="text-xs font-light mb-4">Create a pipeline configuration to customize agent behavior</p>
            {configurableAgentTypes.length > 0 && (
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleCreate}
                className={`px-4 py-2 rounded-xl text-sm font-light ${
                  isDark
                    ? 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
                    : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                }`}
              >
                + Create Your First Configuration
              </motion.button>
            )}
          </div>
        )}

        {/* Grouped configurations */}
        {!isLoading && !error && Object.keys(groupedConfigs).length > 0 && (
          <div className="space-y-6">
            {Object.entries(groupedConfigs).map(([agentTypeId, configs]) => (
              <div key={agentTypeId}>
                <div className="flex items-center gap-2 mb-3">
                  <span className={`text-xs font-medium tracking-wider uppercase ${isDark ? 'text-zinc-500' : 'text-neutral-400'}`}>
                    {getAgentTypeName(agentTypeId)}
                  </span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full ${isDark ? 'bg-zinc-700 text-zinc-400' : 'bg-neutral-100 text-neutral-500'}`}>
                    {configs.length}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  <AnimatePresence mode="popLayout">
                  {configs.map((config, index) => {
                    const style = getConfigCardStyle(config.id)
                    const modifiedNodes = countModifiedNodes(config.configuration)
                    const modifiedThresholds = Object.keys(config.configuration.thresholds || {}).length

                    return (
                      <motion.div
                        key={config.id}
                        layout
                        initial={{ opacity: 0, y: 20, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
                        transition={{ delay: index * 0.05, type: 'spring', stiffness: 300, damping: 25 }}
                        className={`group/card relative p-4 rounded-xl border transition-[border-color,background-color,box-shadow] cursor-pointer ${
                          isDark
                            ? 'border-zinc-700 bg-zinc-800/50 hover:border-zinc-600 hover:bg-zinc-800/80'
                            : 'border-neutral-200 bg-white hover:border-neutral-300 hover:shadow-md'
                        }`}
                        onClick={() => handleEdit(config)}
                      >
                        {/* Top-right actions */}
                        <div className="absolute top-3 right-3 flex items-center gap-1">
                          <motion.button
                            onClick={(e) => {
                              e.stopPropagation()
                              handleEdit(config)
                            }}
                            whileHover={{ scale: 1.1 }}
                            whileTap={{ scale: 0.95 }}
                            className={`
                              p-1.5 rounded-lg
                              opacity-0 group-hover/card:opacity-100 transition-opacity duration-200
                              ${isDark
                                ? 'hover:bg-zinc-600 text-zinc-400 hover:text-zinc-200'
                                : 'hover:bg-neutral-100 text-neutral-400 hover:text-neutral-600'
                              }
                            `}
                            title="Edit"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                            </svg>
                          </motion.button>
                          <motion.button
                            onClick={(e) => {
                              e.stopPropagation()
                              handleDuplicate(config)
                            }}
                            whileHover={{ scale: 1.1 }}
                            whileTap={{ scale: 0.95 }}
                            className={`
                              p-1.5 rounded-lg
                              opacity-0 group-hover/card:opacity-100 transition-opacity duration-200
                              ${isDark
                                ? 'hover:bg-zinc-600 text-zinc-400 hover:text-zinc-200'
                                : 'hover:bg-neutral-100 text-neutral-400 hover:text-neutral-600'
                              }
                            `}
                            title="Duplicate"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                            </svg>
                          </motion.button>
                          <motion.button
                            onClick={(e) => {
                              e.stopPropagation()
                              handleDelete(config)
                            }}
                            whileHover={{ scale: 1.1 }}
                            whileTap={{ scale: 0.95 }}
                            className={`
                              p-1.5 rounded-lg
                              opacity-0 group-hover/card:opacity-100 transition-opacity duration-200
                              ${isDark
                                ? 'hover:bg-red-500/20 text-zinc-400 hover:text-red-400'
                                : 'hover:bg-red-50 text-neutral-400 hover:text-red-500'
                              }
                            `}
                            title="Delete"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                              <polyline points="3 6 5 6 21 6" />
                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                            </svg>
                          </motion.button>
                        </div>

                        {/* Icon */}
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 bg-gradient-to-br ${style.gradient}`}>
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={style.iconColor}>
                            <path d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                          </svg>
                        </div>

                        {/* Title */}
                        <h3 className={`text-sm font-semibold truncate mb-1 ${isDark ? 'text-zinc-100' : 'text-neutral-900'}`}>
                          {config.name}
                        </h3>

                        {/* Description */}
                        {config.description && (
                          <p className={`text-xs line-clamp-2 mb-3 ${isDark ? 'text-zinc-400' : 'text-neutral-500'}`}>
                            {config.description}
                          </p>
                        )}

                        {/* Stats */}
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {config.compatibility === 'OUTDATED' && (
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${isDark ? 'bg-amber-500/20 text-amber-300' : 'bg-amber-100 text-amber-700'}`}
                              title={config.compatibilityNote || 'This agent type changed; review and re-save to use this configuration'}
                            >
                              Outdated — review & re-save
                            </span>
                          )}
                          {modifiedNodes === 0 && modifiedThresholds === 0 ? (
                            <span className={`
                              inline-flex items-center px-2 py-0.5 rounded-full text-xs
                              ${isDark ? 'bg-zinc-600/50 text-zinc-300' : 'bg-neutral-100 text-neutral-600'}
                            `}>
                              Default settings
                            </span>
                          ) : (
                            <>
                              {modifiedNodes > 0 && (
                                <span className={`
                                  inline-flex items-center px-2 py-0.5 rounded-full text-xs
                                  ${isDark ? 'bg-zinc-600/50 text-zinc-300' : 'bg-neutral-100 text-neutral-600'}
                                `}>
                                  {modifiedNodes} node{modifiedNodes !== 1 ? 's' : ''} customized
                                </span>
                              )}
                              {modifiedThresholds > 0 && (
                                <span className={`
                                  inline-flex items-center px-2 py-0.5 rounded-full text-xs
                                  ${isDark ? 'bg-zinc-600/50 text-zinc-300' : 'bg-neutral-100 text-neutral-600'}
                                `}>
                                  {modifiedThresholds} threshold{modifiedThresholds !== 1 ? 's' : ''}
                                </span>
                              )}
                            </>
                          )}
                          <span className={`
                            inline-flex items-center px-2 py-0.5 rounded-full text-xs
                            ${isDark ? 'bg-zinc-600/50 text-zinc-300' : 'bg-neutral-100 text-neutral-600'}
                          `}>
                            {new Date(config.updatedAt).toLocaleDateString()}
                          </span>
                        </div>
                      </motion.div>
                    )
                  })}
                  </AnimatePresence>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Agent type selector modal */}
      <AnimatePresence>
        {showAgentTypeSelector && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm"
            onClick={() => setShowAgentTypeSelector(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className={`rounded-2xl p-6 w-full max-w-sm ${
                isDark
                  ? 'bg-zinc-900 border border-zinc-700'
                  : 'bg-white border border-neutral-200 shadow-lg'
              }`}
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className={`text-sm font-medium mb-4 ${isDark ? 'text-zinc-200' : 'text-neutral-800'}`}>
                Select Agent Type
              </h3>
              <div className="space-y-2">
                {configurableAgentTypes.map((type) => (
                  <button
                    key={type.id}
                    onClick={() => handleSelectAgentTypeAndCreate(type.id)}
                    className={`w-full p-3 rounded-xl text-left transition-all ${
                      isDark
                        ? 'hover:bg-zinc-800 border border-zinc-700'
                        : 'hover:bg-neutral-50 border border-neutral-200'
                    }`}
                  >
                    <div className={`text-sm font-medium ${isDark ? 'text-zinc-200' : 'text-neutral-800'}`}>
                      {type.icon} {type.name}
                    </div>
                    <p className={`text-xs font-light mt-0.5 ${isDark ? 'text-zinc-500' : 'text-neutral-400'}`}>
                      {type.description}
                    </p>
                  </button>
                ))}
              </div>
              <button
                onClick={() => setShowAgentTypeSelector(false)}
                className={`mt-4 w-full py-2 rounded-xl text-sm font-light ${
                  isDark ? 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700' : 'bg-neutral-100 text-neutral-500 hover:bg-neutral-200'
                }`}
              >
                Cancel
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete confirmation */}
      <ConfirmDialog
        isOpen={deleteConfirmOpen}
        onCancel={() => {
          setDeleteConfirmOpen(false)
          setConfigToDelete(null)
        }}
        onConfirm={confirmDelete}
        title="Delete Configuration"
        message={`Are you sure you want to delete "${configToDelete?.name}"? This action cannot be undone.`}
        confirmText="Delete"
        confirmVariant="danger"
      />
    </>
  )
}
