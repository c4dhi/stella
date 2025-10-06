import { create } from 'zustand'
import { generateUUID } from '../lib/uuid'

export interface Toast {
  id: string
  message: string
  type: 'success' | 'error' | 'info'
  duration?: number
}

interface ToastState {
  toasts: Toast[]
  addToast: (toast: Omit<Toast, 'id'>) => void
  removeToast: (id: string) => void
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],

  addToast: (toast) => {
    const id = generateUUID()
    set((state) => ({
      toasts: [...state.toasts, { ...toast, id }],
    }))
  },

  removeToast: (id) => {
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    }))
  },
}))
