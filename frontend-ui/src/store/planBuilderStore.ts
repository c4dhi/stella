import { create } from 'zustand'
import type { PlanTemplate, PlanContent } from '../lib/api-types'

type ModalView = 'generator' | 'builder'

interface PlanBuilderStore {
  isOpen: boolean
  editingTemplate: PlanTemplate | null
  onSaveCallback: ((template: PlanTemplate) => void) | null

  // View management for AI generator
  currentView: ModalView
  generatedContent: PlanContent | null
  suggestedName: string
  suggestedDescription: string

  // Actions
  openModal: (template?: PlanTemplate, onSave?: (template: PlanTemplate) => void) => void
  closeModal: () => void
  setView: (view: ModalView) => void
  setGeneratedContent: (content: PlanContent, name: string, description: string) => void
  clearGeneratedContent: () => void
}

export const usePlanBuilderStore = create<PlanBuilderStore>((set) => ({
  isOpen: false,
  editingTemplate: null,
  onSaveCallback: null,
  currentView: 'generator',
  generatedContent: null,
  suggestedName: '',
  suggestedDescription: '',

  openModal: (template, onSave) => set({
    isOpen: true,
    editingTemplate: template || null,
    onSaveCallback: onSave || null,
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
