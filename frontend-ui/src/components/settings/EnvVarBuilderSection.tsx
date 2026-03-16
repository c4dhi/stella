import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useThemeStore } from '../../store/themeStore'
import { useToastStore } from '../../store/toastStore'
import { apiClient } from '../../services/ApiClient'
import type { EnvVarTemplate } from '../../lib/api-types'
import EnvVarTemplateCard from './EnvVarTemplateCard'
import EnvVarBuilderModal from './EnvVarBuilder/EnvVarBuilderModal'
import ConfirmDialog from '../modals/ConfirmDialog'

const containerVariants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.08
    }
  }
}

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.4,
      ease: [0.25, 0.46, 0.45, 0.94] as const
    }
  }
}

export default function EnvVarBuilderSection() {
  const { resolvedTheme } = useThemeStore()
  const { addToast } = useToastStore()
  const isDark = resolvedTheme === 'dark'

  const [templates, setTemplates] = useState<EnvVarTemplate[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<EnvVarTemplate | null>(null)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [templateToDelete, setTemplateToDelete] = useState<EnvVarTemplate | null>(null)

  const loadTemplates = async () => {
    try {
      setIsLoading(true)
      setError(null)
      const data = await apiClient.listEnvVarTemplates()
      setTemplates(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load templates')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadTemplates()
  }, [])

  const handleCreate = () => {
    setEditingTemplate(null)
    setIsModalOpen(true)
  }

  const handleEdit = (template: EnvVarTemplate) => {
    setEditingTemplate(template)
    setIsModalOpen(true)
  }

  const handleDelete = (template: EnvVarTemplate) => {
    setTemplateToDelete(template)
    setDeleteConfirmOpen(true)
  }

  const confirmDeleteTemplate = async () => {
    if (!templateToDelete) return
    try {
      await apiClient.deleteEnvVarTemplate(templateToDelete.id)
      setTemplates(prev => prev.filter(t => t.id !== templateToDelete.id))
      addToast({ message: `"${templateToDelete.name}" deleted`, type: 'success' })
    } catch (err) {
      addToast({
        message: err instanceof Error ? err.message : 'Failed to delete template',
        type: 'error',
      })
    } finally {
      setDeleteConfirmOpen(false)
      setTemplateToDelete(null)
    }
  }

  const handleDuplicate = async (template: EnvVarTemplate) => {
    try {
      const duplicated = await apiClient.duplicateEnvVarTemplate(template.id)
      setTemplates(prev => [duplicated, ...prev])
      addToast({ message: `"${template.name}" duplicated`, type: 'success' })
    } catch (err) {
      addToast({
        message: err instanceof Error ? err.message : 'Failed to duplicate template',
        type: 'error',
      })
    }
  }

  const handleModalClose = () => {
    setIsModalOpen(false)
    setEditingTemplate(null)
  }

  return (
    <>
      <motion.div
        className="max-w-5xl"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        {/* Header */}
        <motion.div
          className="flex items-start justify-between mb-8"
          variants={itemVariants}
        >
          <div>
            <h2 className={`text-heading-lg font-semibold ${isDark ? 'text-content-inverse' : 'text-content'
              }`}>
              Environment Variables
            </h2>
            <p className={`text-body-sm mt-1.5 max-w-lg ${isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'
              }`}>
              Create reusable, encrypted environment variable templates for your agents
            </p>
          </div>

          <motion.button
            onClick={handleCreate}
            className="btn-primary flex items-center gap-2 shadow-lg shadow-primary/20"
            whileHover={{ scale: 1.02, y: -1 }}
            whileTap={{ scale: 0.98 }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14" />
            </svg>
            New Template
          </motion.button>
        </motion.div>

        {/* Loading State */}
        <AnimatePresence mode="wait">
          {isLoading && (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center py-20"
            >
              <motion.div
                className={`w-12 h-12 rounded-xl flex items-center justify-center mb-4 ${isDark ? 'bg-surface-dark-secondary' : 'bg-surface-secondary'
                  }`}
                animate={{ rotate: 360 }}
                transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'}>
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              </motion.div>
              <p className={`text-body-sm ${isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'}`}>
                Loading templates...
              </p>
            </motion.div>
          )}

          {/* Error State */}
          {error && !isLoading && (
            <motion.div
              key="error"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className={`p-6 rounded-2xl flex items-start gap-4 ${isDark
                  ? 'bg-red-500/10 border border-red-500/20'
                  : 'bg-red-50 border border-red-200'
                }`}
            >
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${isDark ? 'bg-red-500/20' : 'bg-red-100'
                }`}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={isDark ? 'text-red-400' : 'text-red-600'}>
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              </div>
              <div>
                <h4 className={`text-body font-medium mb-1 ${isDark ? 'text-red-400' : 'text-red-700'}`}>
                  Failed to load templates
                </h4>
                <p className={`text-body-sm ${isDark ? 'text-red-400/80' : 'text-red-600'}`}>
                  {error}
                </p>
              </div>
            </motion.div>
          )}

          {/* Empty State */}
          {!isLoading && !error && templates.length === 0 && (
            <motion.div
              key="empty"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className={`text-center py-16 px-8 rounded-3xl ${isDark ? 'bg-surface-dark-secondary' : 'bg-white border border-neutral-200/60'
                }`}
            >
              <motion.div
                className={`w-20 h-20 rounded-2xl mx-auto mb-6 flex items-center justify-center border ${isDark
                    ? 'bg-gradient-to-br from-amber-500/30 to-orange-500/10 border-amber-500/20'
                    : 'bg-gradient-to-br from-amber-500/20 to-orange-500/5 border-amber-500/20'
                  }`}
                transition={{ type: 'spring', stiffness: 300, damping: 15 }}
              >
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-amber-500">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              </motion.div>
              <h3 className={`text-heading font-semibold mb-2 ${isDark ? 'text-content-inverse' : 'text-content'}`}>
                No environment templates yet
              </h3>
              <p className={`text-body mb-8 max-w-sm mx-auto ${isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'}`}>
                Create encrypted environment variable templates to securely pass API keys and secrets to your agents
              </p>
              <motion.button
                onClick={handleCreate}
                className="btn-primary inline-flex items-center gap-2"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                Create Your First Template
              </motion.button>
            </motion.div>
          )}

          {/* Templates Grid */}
          {!isLoading && !error && templates.length > 0 && (
            <motion.div
              key="templates"
              className="grid grid-cols-1 lg:grid-cols-2 gap-5"
              variants={containerVariants}
              initial="hidden"
              animate="visible"
            >
              <AnimatePresence mode="popLayout">
                {templates.map((template, index) => (
                  <EnvVarTemplateCard
                    key={template.id}
                    template={template}
                    index={index}
                    onEdit={() => handleEdit(template)}
                    onDelete={() => handleDelete(template)}
                    onDuplicate={() => handleDuplicate(template)}
                  />
                ))}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* Builder Modal */}
      <EnvVarBuilderModal
        isOpen={isModalOpen}
        template={editingTemplate}
        onClose={handleModalClose}
        onSave={loadTemplates}
      />

      <ConfirmDialog
        isOpen={deleteConfirmOpen}
        title="Delete Environment Template"
        message={`Delete "${templateToDelete?.name}"? This cannot be undone.`}
        confirmText="Delete"
        cancelText="Cancel"
        confirmVariant="danger"
        onConfirm={confirmDeleteTemplate}
        onCancel={() => { setDeleteConfirmOpen(false); setTemplateToDelete(null) }}
      />
    </>
  )
}
