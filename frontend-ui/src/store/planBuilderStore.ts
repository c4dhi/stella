import { create } from 'zustand'
import type { PlanTemplate } from '../lib/api-types'

interface PlanBuilderStore {
  isOpen: boolean
  editingTemplate: PlanTemplate | null
  onSaveCallback: ((template: PlanTemplate) => void) | null
  openModal: (template?: PlanTemplate, onSave?: (template: PlanTemplate) => void) => void
  closeModal: () => void
}

export const usePlanBuilderStore = create<PlanBuilderStore>((set) => ({
  isOpen: false,
  editingTemplate: null,
  onSaveCallback: null,

  openModal: (template, onSave) => set({
    isOpen: true,
    editingTemplate: template || null,
    onSaveCallback: onSave || null,
  }),

  closeModal: () => set({
    isOpen: false,
    editingTemplate: null,
    onSaveCallback: null,
  }),
}))
