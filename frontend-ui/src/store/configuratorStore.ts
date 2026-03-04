import { create } from 'zustand'
import type {
  PipelineSchema,
  AgentConfigurationPayload,
  AgentConfiguration,
} from '../lib/api-types'

interface ConfiguratorStore {
  isOpen: boolean
  pipelineSchema: PipelineSchema | null
  initialConfiguration: AgentConfigurationPayload | undefined
  initialName: string
  initialDescription: string
  saveLabel: string
  editingConfig: AgentConfiguration | null
  onSaveCallback: ((name: string, description: string, config: AgentConfigurationPayload) => void) | null

  // Actions
  openModal: (opts: {
    pipelineSchema: PipelineSchema
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
      initialConfiguration: undefined,
      initialName: '',
      initialDescription: '',
      saveLabel: 'Save Configuration',
      editingConfig: null,
      onSaveCallback: null,
    }),
}))
