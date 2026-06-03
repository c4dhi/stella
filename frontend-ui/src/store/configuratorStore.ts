import { create } from 'zustand'
import type {
  PipelineSchema,
  AgentConfigurationPayload,
  AgentConfiguration,
  RuntimeVariable,
} from '../lib/api-types'

interface ConfiguratorStore {
  isOpen: boolean
  pipelineSchema: PipelineSchema | null
  // Manifest-declared {{placeholder}} palette for the agent type being configured.
  runtimeVariables: RuntimeVariable[] | null
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
      initialConfiguration: undefined,
      initialName: '',
      initialDescription: '',
      saveLabel: 'Save Configuration',
      editingConfig: null,
      onSaveCallback: null,
    }),
}))
