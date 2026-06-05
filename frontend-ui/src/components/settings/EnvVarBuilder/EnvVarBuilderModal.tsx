import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useThemeStore } from '../../../store/themeStore'
import { useToastStore } from '../../../store/toastStore'
import { apiClient } from '../../../services/ApiClient'
import { parseDeclaredEnvVars, type EnvVarTemplate, type AgentType } from '../../../lib/api-types'
import { useEnvVarListEditor } from '../../shared/EnvVarListEditor/useEnvVarListEditor'
import EnvVarListEditor from '../../shared/EnvVarListEditor/EnvVarListEditor'

interface EnvVarBuilderModalProps {
  isOpen: boolean
  template?: EnvVarTemplate | null
  // Agent types the template can be scoped to (required on create, immutable after).
  agentTypes: AgentType[]
  onClose: () => void
  onSave: () => void
}

export default function EnvVarBuilderModal({
  isOpen,
  template,
  agentTypes,
  onClose,
  onSave,
}: EnvVarBuilderModalProps) {
  const { resolvedTheme } = useThemeStore()
  const { addToast } = useToastStore()
  const isDark = resolvedTheme === 'dark'

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [agentTypeId, setAgentTypeId] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [showCloseConfirmation, setShowCloseConfirmation] = useState(false)
  // Pending agent-type switch awaiting confirmation (set when it would reshuffle user content).
  const [pendingAgentType, setPendingAgentType] = useState<{ id: string; apply: () => void } | null>(null)

  const isEditing = !!template

  const editor = useEnvVarListEditor({
    mode: isEditing ? 'edit' : 'create',
    allowEmptyValues: true,
    requireAllValuesWhenTouched: isEditing,
  })

  // Check if form has content (for unsaved changes tracking)
  const hasContent = useCallback(() => {
    return name.trim() !== '' ||
      description.trim() !== '' ||
      editor.rows.some(e => e.key.trim() !== '' || e.value.trim() !== '')
  }, [name, description, editor.rows])

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
        setAgentTypeId(template.agentTypeId) // immutable; shown read-only
        // Editing: only keys are returned (values are encrypted at rest). Seed
        // preserved rows so a rename needs no value re-entry.
        editor.reset({
          mode: 'edit',
          initial: Object.fromEntries(template.variableKeys.map((key) => [key, ''])),
        })
      } else {
        setName('')
        setDescription('')
        // Preselect when there's exactly one type; otherwise force an explicit choice.
        const preselected = agentTypes.length === 1 ? agentTypes[0].id : ''
        setAgentTypeId(preselected)
        const declared = preselected
          ? parseDeclaredEnvVars(agentTypes[0].configSchema)
          : { required: [], optional: [] }
        editor.reset({
          mode: 'create',
          requiredKeys: declared.required,
          optionalKeys: declared.optional,
        })
      }
      setError(null)
      setHasUnsavedChanges(false)
      setShowCloseConfirmation(false)
      setPendingAgentType(null)
    }
  }, [isOpen, template])

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        if (pendingAgentType) {
          setPendingAgentType(null)
        } else if (showCloseConfirmation) {
          cancelClose()
        } else {
          requestClose()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, showCloseConfirmation, pendingAgentType, requestClose, cancelClose])

  // Switching agent type prefills that type's declared env vars. Reconcile keeps
  // any value the user already typed; confirm first when content would be reshuffled.
  const handleAgentTypeChange = (id: string) => {
    const declared = parseDeclaredEnvVars(agentTypes.find((t) => t.id === id)?.configSchema)
    const { hasUserContent, apply } = editor.applyAgentType(declared.required, declared.optional)
    if (hasUserContent) {
      setPendingAgentType({ id, apply })
    } else {
      setAgentTypeId(id)
      apply()
      setHasUnsavedChanges(true)
    }
  }

  const confirmAgentTypeChange = () => {
    if (!pendingAgentType) return
    setAgentTypeId(pendingAgentType.id)
    pendingAgentType.apply()
    setHasUnsavedChanges(true)
    setPendingAgentType(null)
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

    // Agent type is required on create (templates are scoped to one type).
    if (!isEditing && !agentTypeId) {
      setError('Please select an agent type for this template')
      return
    }

    // Shared editor surfaces per-row issues inline; null means something is invalid.
    const variables = editor.toVariablesMap()
    if (variables === null) {
      setError(editor.variablesTouched
        ? 'Please enter a value for every variable (existing values must be re-entered when changing variables)'
        : 'Please fix the highlighted variables')
      return
    }

    if (!isEditing && Object.keys(variables).length === 0) {
      setError('At least one environment variable is required')
      return
    }

    setIsSaving(true)

    try {
      if (isEditing && template) {
        // Untouched variables are omitted so the backend keeps the encrypted values
        // (a rename needs no value re-entry). Touched edits send a full replacement.
        await apiClient.updateEnvVarTemplate(template.id, {
          name: name.trim(),
          description: description.trim() || undefined,
          ...(editor.variablesTouched ? { variables } : {}),
        })
        addToast({ message: 'Template updated successfully', type: 'success' })
      } else {
        await apiClient.createEnvVarTemplate({
          name: name.trim(),
          description: description.trim() || undefined,
          variables,
          agentTypeId,
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
                    ? 'Update the template. Existing values are kept unless you change a variable.'
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

                {/* Agent Type — required on create, immutable after */}
                <div>
                  <label className={`block text-xs font-medium tracking-wider uppercase mb-2 ${isDark ? 'text-zinc-400' : 'text-neutral-600'}`}>
                    Agent Type <span className="text-red-500">*</span>
                  </label>
                  {isEditing ? (
                    <div
                      className={`w-full px-4 py-3 rounded-xl text-sm flex items-center justify-between ${isDark ? 'bg-zinc-700/30 border border-zinc-700 text-zinc-300' : 'bg-neutral-100 border border-neutral-200 text-neutral-600'}`}
                    >
                      <span>
                        {agentTypes.find((t) => t.id === agentTypeId)?.name || 'Unknown agent type'}
                      </span>
                      <span className={`text-[11px] ${isDark ? 'text-zinc-500' : 'text-neutral-400'}`}>
                        Immutable — duplicate to rebind
                      </span>
                    </div>
                  ) : (
                    <select
                      value={agentTypeId}
                      onChange={(e) => handleAgentTypeChange(e.target.value)}
                      className={`
                        w-full px-4 py-3 rounded-xl text-sm
                        focus:outline-none transition-all duration-200
                        ${isDark
                          ? 'bg-zinc-700/50 border border-zinc-600 text-zinc-100 focus:border-zinc-500'
                          : 'bg-neutral-50 border border-neutral-200 text-neutral-900 focus:border-neutral-400'
                        }
                      `}
                    >
                      <option value="" disabled>Select an agent type…</option>
                      {agentTypes.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                  )}
                  <p className={`text-[11px] mt-1.5 ${isDark ? 'text-zinc-500' : 'text-neutral-400'}`}>
                    This template will only be offered when deploying agents of this type.
                  </p>
                </div>

                {/* Environment Variables */}
                <div>
                  <label className={`block text-xs font-medium tracking-wider uppercase mb-2 ${isDark ? 'text-zinc-400' : 'text-neutral-600'}`}>
                    Environment Variables <span className="text-red-500">*</span>
                  </label>
                  <EnvVarListEditor
                    editor={editor}
                    isDark={isDark}
                    onChange={() => setHasUnsavedChanges(true)}
                  />
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

            {/* Agent-type switch confirmation (would reshuffle entered variables) */}
            <AnimatePresence>
              {pendingAgentType && (
                <motion.div
                  className="absolute inset-0 z-10 flex items-center justify-center rounded-[20px] overflow-hidden"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setPendingAgentType(null)} />
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
                      Switch agent type?
                    </h3>
                    <p className={`text-sm mb-6 ${isDark ? 'text-zinc-400' : 'text-neutral-600'}`}>
                      This will load the new agent type's declared variables. Values you've already entered are kept, but variables specific to the previous type will be reorganized.
                    </p>
                    <div className="flex gap-3">
                      <button
                        onClick={() => setPendingAgentType(null)}
                        className={`flex-1 py-2.5 px-4 rounded-xl text-sm font-medium transition-colors ${
                          isDark
                            ? 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
                            : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
                        }`}
                      >
                        Cancel
                      </button>
                      <button
                        onClick={confirmAgentTypeChange}
                        className={`flex-1 py-2.5 px-4 rounded-xl text-sm font-medium text-white transition-colors ${isDark ? 'bg-primary-500 hover:bg-primary-400' : 'bg-neutral-900 hover:bg-neutral-800'}`}
                      >
                        Switch & Load
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
