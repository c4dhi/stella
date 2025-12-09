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
    hasUnsavedChanges,
    showCloseConfirmation,
    closeModal,
    requestClose,
    confirmClose,
    cancelClose,
    setHasUnsavedChanges,
    setView,
    clearGeneratedContent,
  } = usePlanBuilderStore()
  const { resolvedTheme } = useThemeStore()
  const isDark = resolvedTheme === 'dark'

  // Handle escape key - request close instead of direct close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        if (showCloseConfirmation) {
          cancelClose()
        } else {
          requestClose()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, showCloseConfirmation, requestClose, cancelClose])

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
    setHasUnsavedChanges(false)
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
          {/* Don't close on click - require explicit close action */}
          <motion.div
            className={`absolute inset-0 ${
              isNested
                ? 'bg-black/80'  // Solid overlay when opened from another modal
                : 'bg-black/60 backdrop-blur-sm'  // Blurred when standalone
            }`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={requestClose}
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
                <AIGeneratorView key="generator" onClose={requestClose} />
              ) : (
                <PlanBuilder
                  key="builder"
                  template={initialTemplate}
                  onSave={handleSave}
                  onCancel={requestClose}
                  onBack={!editingTemplate && generatedContent ? handleBackToGenerator : undefined}
                  isFromGenerator={!!generatedContent}
                  onContentChange={() => setHasUnsavedChanges(true)}
                />
              )}
            </AnimatePresence>
          </motion.div>

          {/* Close Confirmation Dialog */}
          <AnimatePresence>
            {showCloseConfirmation && (
              <motion.div
                className="absolute inset-0 z-10 flex items-center justify-center"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <div className="absolute inset-0 bg-black/50" onClick={cancelClose} />
                <motion.div
                  className={`relative z-10 p-6 rounded-2xl shadow-2xl max-w-md mx-4 ${
                    isDark ? 'bg-zinc-800 border border-zinc-700' : 'bg-white border border-neutral-200'
                  }`}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                >
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-4 bg-amber-500/10`}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-amber-500">
                      <path d="M12 9v4M12 17h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <h3 className={`text-lg font-semibold mb-2 ${isDark ? 'text-zinc-100' : 'text-neutral-900'}`}>
                    Unsaved Changes
                  </h3>
                  <p className={`text-sm mb-6 ${isDark ? 'text-zinc-400' : 'text-neutral-600'}`}>
                    You have unsaved changes in the plan builder. Are you sure you want to close without saving?
                  </p>
                  <div className="flex gap-3">
                    <button
                      onClick={cancelClose}
                      className={`flex-1 py-2.5 px-4 rounded-xl text-sm font-medium transition-colors ${
                        isDark
                          ? 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
                          : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
                      }`}
                    >
                      Keep Editing
                    </button>
                    <button
                      onClick={confirmClose}
                      className="flex-1 py-2.5 px-4 rounded-xl text-sm font-medium bg-red-500 text-white hover:bg-red-600 transition-colors"
                    >
                      Discard Changes
                    </button>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
