import { create } from 'zustand'
import type { PlanTemplate, PlanContent } from '../lib/api-types'

type ModalView = 'generator' | 'builder'

interface PlanBuilderStore {
  isOpen: boolean
  editingTemplate: PlanTemplate | null
  onSaveCallback: ((template: PlanTemplate) => void) | null
  isNested: boolean  // True when opened from another modal (e.g., DeployAgentModal)

  // View management for AI generator
  currentView: ModalView
  generatedContent: PlanContent | null
  suggestedName: string
  suggestedDescription: string

  // Actions
  openModal: (template?: PlanTemplate, onSave?: (template: PlanTemplate) => void, isNested?: boolean) => void
  closeModal: () => void
  setView: (view: ModalView) => void
  setGeneratedContent: (content: PlanContent, name: string, description: string) => void
  clearGeneratedContent: () => void
}

export const usePlanBuilderStore = create<PlanBuilderStore>((set) => ({
  isOpen: false,
  editingTemplate: null,
  onSaveCallback: null,
  isNested: false,
  currentView: 'generator',
  generatedContent: null,
  suggestedName: '',
  suggestedDescription: '',

  openModal: (template, onSave, isNested = false) => set({
    isOpen: true,
    editingTemplate: template || null,
    onSaveCallback: onSave || null,
    isNested,
    // If editing existing template, go directly to builder; otherwise show generator
    currentView: template ? 'builder' : 'generator',
    generatedContent: null,
    suggestedName: '',
    suggestedDescription: '',
  }),

  closeModal: () => set({
    isOpen: false,
    editingTemplate: null,
    onSaveCallback: null,
    isNested: false,
    currentView: 'generator',
    generatedContent: null,
    suggestedName: '',
    suggestedDescription: '',
  }),

  setView: (view) => set({ currentView: view }),

  setGeneratedContent: (content, name, description) => set({
    generatedContent: content,
    suggestedName: name,
    suggestedDescription: description,
    currentView: 'builder',
  }),

  clearGeneratedContent: () => set({
    generatedContent: null,
    suggestedName: '',
    suggestedDescription: '',
  }),
}))
