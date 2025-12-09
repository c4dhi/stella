import { useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { usePlanBuilderStore } from '../../../store/planBuilderStore'
import { useThemeStore } from '../../../store/themeStore'
import type { PlanTemplate } from '../../../lib/api-types'
import PlanBuilder from './PlanBuilder'
import AIGeneratorView from './AIGeneratorView'

export default function PlanBuilderModal() {
  const {
    isOpen,
    editingTemplate,
    onSaveCallback,
    isNested,
    currentView,
    generatedContent,
    suggestedName,
    suggestedDescription,
    closeModal,
    setView,
    clearGeneratedContent,
  } = usePlanBuilderStore()
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

  const handleBackToGenerator = () => {
    clearGeneratedContent()
    setView('generator')
  }

  // Build initial template from generated content or editing template
  const initialTemplate = generatedContent
    ? {
        id: '',
        userId: '',
        name: suggestedName,
        description: suggestedDescription,
        content: generatedContent,
        createdAt: '',
        updatedAt: '',
      }
    : editingTemplate || undefined

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-[200] flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          {/* Backdrop - use blur when standalone, solid overlay when nested to avoid double blur */}
          <motion.div
            className={`absolute inset-0 ${
              isNested
                ? 'bg-black/80'  // Solid overlay when opened from another modal
                : 'bg-black/60 backdrop-blur-sm'  // Blurred when standalone
            }`}
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
            <AnimatePresence mode="wait">
              {currentView === 'generator' ? (
                <AIGeneratorView key="generator" onClose={closeModal} />
              ) : (
                <PlanBuilder
                  key="builder"
                  template={initialTemplate}
                  onSave={handleSave}
                  onCancel={closeModal}
                  onBack={!editingTemplate && generatedContent ? handleBackToGenerator : undefined}
                  isFromGenerator={!!generatedContent}
                />
              )}
            </AnimatePresence>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
