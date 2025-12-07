import { useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { usePlanBuilderStore } from '../../../store/planBuilderStore'
import { useThemeStore } from '../../../store/themeStore'
import type { PlanTemplate } from '../../../lib/api-types'
import PlanBuilder from './PlanBuilder'

export default function PlanBuilderModal() {
  const { isOpen, editingTemplate, onSaveCallback, closeModal } = usePlanBuilderStore()
  const { resolvedTheme } = useThemeStore()
  const isDark = resolvedTheme === 'dark'

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        closeModal()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, closeModal])

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen])

  const handleSave = (template: PlanTemplate) => {
    if (onSaveCallback) {
      onSaveCallback(template)
    }
    closeModal()
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={closeModal}
          />

          {/* Modal Content */}
          <motion.div
            className={`relative w-full h-full max-w-7xl max-h-[95vh] m-4 rounded-2xl overflow-hidden shadow-2xl ring-1 ${
              isDark ? 'bg-surface-dark ring-white/10' : 'bg-surface ring-black/5'
            }`}
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          >
            <PlanBuilder
              template={editingTemplate || undefined}
              onSave={handleSave}
              onCancel={closeModal}
            />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
