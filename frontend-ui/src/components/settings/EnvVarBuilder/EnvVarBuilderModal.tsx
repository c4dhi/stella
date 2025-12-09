import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useThemeStore } from '../../../store/themeStore'
import { useToastStore } from '../../../store/toastStore'
import { apiClient } from '../../../services/ApiClient'
import type { EnvVarTemplate, CreateEnvVarTemplateDto } from '../../../lib/api-types'

interface EnvVarBuilderModalProps {
  isOpen: boolean
  template?: EnvVarTemplate | null
  onClose: () => void
  onSave: () => void
}

interface EnvVarEntry {
  id: string
  key: string
  value: string
}

export default function EnvVarBuilderModal({
  isOpen,
  template,
  onClose,
  onSave,
}: EnvVarBuilderModalProps) {
  const { resolvedTheme } = useThemeStore()
  const { addToast } = useToastStore()
  const isDark = resolvedTheme === 'dark'

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [entries, setEntries] = useState<EnvVarEntry[]>([])
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [showCloseConfirmation, setShowCloseConfirmation] = useState(false)

  const isEditing = !!template

  // Check if form has content (for unsaved changes tracking)
  const hasContent = useCallback(() => {
    return name.trim() !== '' ||
      description.trim() !== '' ||
      entries.some(e => e.key.trim() !== '' || e.value.trim() !== '')
  }, [name, description, entries])

  // Request close - shows confirmation if there are unsaved changes
  const requestClose = useCallback(() => {
    if (hasUnsavedChanges && hasContent()) {
      setShowCloseConfirmation(true)
    } else {
      onClose()
    }
  }, [hasUnsavedChanges, hasContent, onClose])

  // Confirm close - force close without saving
  const confirmClose = useCallback(() => {
    setShowCloseConfirmation(false)
    setHasUnsavedChanges(false)
    onClose()
  }, [onClose])

  // Cancel close request
  const cancelClose = useCallback(() => {
    setShowCloseConfirmation(false)
  }, [])

  // Reset form when modal opens/closes or template changes
  useEffect(() => {
    if (isOpen) {
      if (template) {
        setName(template.name)
        setDescription(template.description || '')
        // For editing, we only have keys - values need to be re-entered
        setEntries(
          template.variableKeys.map((key, idx) => ({
            id: `${idx}-${Date.now()}`,
            key,
            value: '', // Values are not returned from API for security
          }))
        )
      } else {
        setName('')
        setDescription('')
        setEntries([{ id: `0-${Date.now()}`, key: '', value: '' }])
      }
      setError(null)
      setHasUnsavedChanges(false)
      setShowCloseConfirmation(false)
    }
  }, [isOpen, template])

  // Handle escape key
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

  const addEntry = () => {
    setEntries([...entries, { id: `${entries.length}-${Date.now()}`, key: '', value: '' }])
    setHasUnsavedChanges(true)
  }

  const removeEntry = (id: string) => {
    if (entries.length > 1) {
      setEntries(entries.filter((e) => e.id !== id))
      setHasUnsavedChanges(true)
    }
  }

  const updateEntry = (id: string, field: 'key' | 'value', value: string) => {
    setEntries(entries.map((e) => (e.id === id ? { ...e, [field]: value } : e)))
    setHasUnsavedChanges(true)
  }

  // Update name with change tracking
  const handleNameChange = (value: string) => {
    setName(value)
    setHasUnsavedChanges(true)
  }

  // Update description with change tracking
  const handleDescriptionChange = (value: string) => {
    setDescription(value)
    setHasUnsavedChanges(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!name.trim()) {
      setError('Name is required')
      return
    }

    // Filter out empty entries
    const validEntries = entries.filter((e) => e.key.trim())
    if (validEntries.length === 0) {
      setError('At least one environment variable is required')
      return
    }

    // Check for duplicate keys
    const keys = validEntries.map((e) => e.key.trim())
    const uniqueKeys = new Set(keys)
    if (uniqueKeys.size !== keys.length) {
      setError('Duplicate variable keys are not allowed')
      return
    }

    // For editing, check if any values are empty (must re-enter values)
    if (isEditing) {
      const emptyValues = validEntries.filter((e) => !e.value.trim())
      if (emptyValues.length > 0) {
        setError('Please enter values for all variables (values are not stored in browser for security)')
        return
      }
    }

    // Build variables object
    const variables: Record<string, string> = {}
    validEntries.forEach((e) => {
      variables[e.key.trim()] = e.value
    })

    setIsSaving(true)

    try {
      if (isEditing && template) {
        await apiClient.updateEnvVarTemplate(template.id, {
          name: name.trim(),
          description: description.trim() || undefined,
          variables,
        })
        addToast({ message: 'Template updated successfully', type: 'success' })
      } else {
        await apiClient.createEnvVarTemplate({
          name: name.trim(),
          description: description.trim() || undefined,
          variables,
        })
        addToast({ message: 'Template created successfully', type: 'success' })
      }
      setHasUnsavedChanges(false)
      onSave()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save template')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/20 backdrop-blur-sm"
          onClick={requestClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className={`
              backdrop-blur-xl rounded-[20px] w-full max-w-xl overflow-hidden
              ${isDark
                ? 'bg-zinc-800 border border-zinc-700 shadow-[0_8px_40px_rgba(0,0,0,0.5)]'
                : 'bg-white border border-neutral-200 shadow-[0_1px_40px_rgba(0,0,0,0.12)]'
              }
            `}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className={`px-6 pt-6 pb-4 border-b ${isDark ? 'border-zinc-700' : 'border-neutral-200'}`}>
              <div className="relative">
                <button
                  onClick={requestClose}
                  disabled={isSaving}
                  className={`
                    absolute -top-1 -right-1 p-2 rounded-lg transition-all duration-200
                    disabled:opacity-60 disabled:cursor-not-allowed
                    ${isDark
                      ? 'text-zinc-400 hover:text-zinc-200 hover:bg-white/10'
                      : 'text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100'
                    }
                  `}
                  title="Close"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>

                <div className={`
                  w-12 h-12 rounded-xl flex items-center justify-center mb-4
                  bg-gradient-to-br from-amber-500/20 to-orange-500/20
                `}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-amber-500">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                </div>

                <h2 className={`text-xl font-semibold ${isDark ? 'text-zinc-100' : 'text-neutral-900'}`}>
                  {isEditing ? 'Edit Environment Template' : 'New Environment Template'}
                </h2>
                <p className={`text-sm mt-1 ${isDark ? 'text-zinc-400' : 'text-neutral-500'}`}>
                  {isEditing
                    ? 'Update the template. You must re-enter all values for security.'
                    : 'Create a reusable set of environment variables for your agents'
                  }
                </p>
              </div>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit}>
              <div className="p-6 space-y-5 max-h-[60vh] overflow-y-auto">
                {/* Name */}
                <div>
                  <label className={`block text-xs font-medium tracking-wider uppercase mb-2 ${isDark ? 'text-zinc-400' : 'text-neutral-600'}`}>
                    Template Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => handleNameChange(e.target.value)}
                    maxLength={255}
                    className={`
                      w-full px-4 py-3 rounded-xl text-sm
                      focus:outline-none transition-all duration-200
                      ${isDark
                        ? 'bg-zinc-700/50 border border-zinc-600 text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-500'
                        : 'bg-neutral-50 border border-neutral-200 text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-400'
                      }
                    `}
                    placeholder="e.g., OpenAI Production Keys"
                  />
                </div>

                {/* Description */}
                <div>
                  <label className={`block text-xs font-medium tracking-wider uppercase mb-2 ${isDark ? 'text-zinc-400' : 'text-neutral-600'}`}>
                    Description
                  </label>
                  <textarea
                    value={description}
                    onChange={(e) => handleDescriptionChange(e.target.value)}
                    rows={2}
                    maxLength={2000}
                    className={`
                      w-full px-4 py-3 rounded-xl text-sm resize-none
                      focus:outline-none transition-all duration-200
                      ${isDark
                        ? 'bg-zinc-700/50 border border-zinc-600 text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-500'
                        : 'bg-neutral-50 border border-neutral-200 text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-400'
                      }
                    `}
                    placeholder="Optional description..."
                  />
                </div>

                {/* Environment Variables */}
                <div>
                  <label className={`block text-xs font-medium tracking-wider uppercase mb-2 ${isDark ? 'text-zinc-400' : 'text-neutral-600'}`}>
                    Environment Variables <span className="text-red-500">*</span>
                  </label>
                  <div className="space-y-3">
                    {entries.map((entry, idx) => (
                      <div key={entry.id} className="flex gap-2">
                        <input
                          type="text"
                          value={entry.key}
                          onChange={(e) => updateEntry(entry.id, 'key', e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))}
                          className={`
                            flex-1 px-3 py-2.5 rounded-lg text-sm font-mono
                            focus:outline-none transition-all duration-200
                            ${isDark
                              ? 'bg-zinc-700/50 border border-zinc-600 text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-500'
                              : 'bg-neutral-50 border border-neutral-200 text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-400'
                            }
                          `}
                          placeholder="KEY_NAME"
                        />
                        <input
                          type="password"
                          value={entry.value}
                          onChange={(e) => updateEntry(entry.id, 'value', e.target.value)}
                          className={`
                            flex-1 px-3 py-2.5 rounded-lg text-sm
                            focus:outline-none transition-all duration-200
                            ${isDark
                              ? 'bg-zinc-700/50 border border-zinc-600 text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-500'
                              : 'bg-neutral-50 border border-neutral-200 text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-400'
                            }
                          `}
                          placeholder="Value (hidden)"
                        />
                        <button
                          type="button"
                          onClick={() => removeEntry(entry.id)}
                          disabled={entries.length === 1}
                          className={`
                            p-2.5 rounded-lg transition-all duration-200
                            ${entries.length === 1
                              ? 'opacity-30 cursor-not-allowed'
                              : isDark
                                ? 'text-zinc-400 hover:text-red-400 hover:bg-red-500/10'
                                : 'text-neutral-400 hover:text-red-500 hover:bg-red-50'
                            }
                          `}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                            <path d="M18 6L6 18M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={addEntry}
                    className={`
                      mt-3 flex items-center gap-2 text-sm font-medium transition-colors
                      ${isDark
                        ? 'text-primary-400 hover:text-primary-300'
                        : 'text-primary-600 hover:text-primary-700'
                      }
                    `}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                    Add Variable
                  </button>
                </div>

                {/* Security notice */}
                <div className={`
                  p-3 rounded-xl text-xs
                  ${isDark
                    ? 'bg-amber-500/10 border border-amber-500/20 text-amber-400'
                    : 'bg-amber-50 border border-amber-200 text-amber-700'
                  }
                `}>
                  <div className="flex gap-2">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="shrink-0 mt-0.5">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                    <div>
                      <div className="font-medium">Encrypted Storage</div>
                      <div className="mt-0.5 opacity-80">
                        Values are encrypted at rest and never exposed via the API. They are only decrypted during agent deployment.
                      </div>
                    </div>
                  </div>
                </div>

                {/* Error */}
                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`p-3 rounded-lg text-sm ${isDark
                        ? 'bg-red-500/10 border border-red-500/20 text-red-400'
                        : 'bg-red-50 border border-red-200 text-red-600'
                      }`}
                  >
                    {error}
                  </motion.div>
                )}
              </div>

              {/* Footer */}
              <div className={`px-6 py-4 border-t ${isDark ? 'border-zinc-700' : 'border-neutral-200'}`}>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={requestClose}
                    disabled={isSaving}
                    className={`
                      flex-1 py-2.5 px-4 rounded-xl text-sm font-medium
                      transition-all duration-200 disabled:opacity-60
                      ${isDark
                        ? 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
                        : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
                      }
                    `}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSaving}
                    className={`
                      flex-1 py-2.5 px-4 rounded-xl text-sm font-medium
                      transition-all duration-200 disabled:opacity-60
                      ${isDark
                        ? 'bg-primary-500 text-white hover:bg-primary-400'
                        : 'bg-neutral-900 text-white hover:bg-neutral-800'
                      }
                    `}
                  >
                    {isSaving ? 'Saving...' : isEditing ? 'Update Template' : 'Create Template'}
                  </button>
                </div>
              </div>
            </form>

            {/* Close Confirmation Dialog */}
            <AnimatePresence>
              {showCloseConfirmation && (
                <motion.div
                  className="absolute inset-0 z-10 flex items-center justify-center rounded-[20px] overflow-hidden"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={cancelClose} />
                  <motion.div
                    className={`relative z-10 p-6 rounded-2xl shadow-2xl max-w-sm mx-4 ${
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
                      You have unsaved changes. Are you sure you want to close without saving?
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
        </motion.div>
      )}
    </AnimatePresence>
  )
}
