import { create } from 'zustand'
import type {
  PipelineSchema,
  AgentConfigurationPayload,
  AgentConfiguration,
  RuntimeVariable,
  ExpertDefault,
} from '../lib/api-types'

interface ConfiguratorStore {
  isOpen: boolean
  pipelineSchema: PipelineSchema | null
  // Manifest-declared {{placeholder}} palette for the agent type being configured.
  runtimeVariables: RuntimeVariable[] | null
  // Agent-declared default experts (config/experts/*.json) for the Expert Module.
  expertDefaults: ExpertDefault[] | null
  // Agent capabilities (e.g. ['voice','text','plans','experts']) — gate which
  // Configurator sections show: task_extraction ← plans, assessment pool ← experts.
  capabilities: string[] | null
  initialConfiguration: AgentConfigurationPayload | undefined
  initialName: string
  initialDescription: string
  saveLabel: string
  editingConfig: AgentConfiguration | null
  onSaveCallback: ((name: string, description: string, config: AgentConfigurationPayload) => void) | null

  // Actions
  openModal: (opts: {
    pipelineSchema: PipelineSchema
    runtimeVariables?: RuntimeVariable[] | null
    expertDefaults?: ExpertDefault[] | null
    capabilities?: string[] | null
    initialConfiguration?: AgentConfigurationPayload
    initialName?: string
    initialDescription?: string
    saveLabel?: string
    editingConfig?: AgentConfiguration | null
    onSave: (name: string, description: string, config: AgentConfigurationPayload) => void
  }) => void
  closeModal: () => void
}

export const useConfiguratorStore = create<ConfiguratorStore>((set) => ({
  isOpen: false,
  pipelineSchema: null,
  runtimeVariables: null,
  expertDefaults: null,
  capabilities: null,
  initialConfiguration: undefined,
  initialName: '',
  initialDescription: '',
  saveLabel: 'Save Configuration',
  editingConfig: null,
  onSaveCallback: null,

  openModal: (opts) =>
    set({
      isOpen: true,
      pipelineSchema: opts.pipelineSchema,
      runtimeVariables: opts.runtimeVariables ?? null,
      expertDefaults: opts.expertDefaults ?? null,
      capabilities: opts.capabilities ?? null,
      initialConfiguration: opts.initialConfiguration,
      initialName: opts.initialName || '',
      initialDescription: opts.initialDescription || '',
      saveLabel: opts.saveLabel || 'Save Configuration',
      editingConfig: opts.editingConfig || null,
      onSaveCallback: opts.onSave,
    }),

  closeModal: () =>
    set({
      isOpen: false,
      pipelineSchema: null,
      runtimeVariables: null,
      expertDefaults: null,
      capabilities: null,
      initialConfiguration: undefined,
      initialName: '',
      initialDescription: '',
      saveLabel: 'Save Configuration',
      editingConfig: null,
      onSaveCallback: null,
    }),
}))
