import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { apiClient } from '../../services/ApiClient'
import { useThemeStore } from '../../store/themeStore'

interface TranscriptDownloadModalProps {
  isOpen: boolean
  onClose: () => void
  sessionId: string
}

// Friendly labels + grouping for known messageType values. Unknown types
// are rendered under "Other" using their raw key.
const TYPE_META: Record<string, { label: string; group: string }> = {
  user_text: { label: 'User text', group: 'Conversation' },
  agent_text: { label: 'Agent text', group: 'Conversation' },
  transcript: { label: 'Transcript', group: 'Conversation' },
  transcript_chunk: { label: 'Transcript chunks (partial)', group: 'Conversation' },
  participant_joined: { label: 'Participant joined', group: 'Participant events' },
  participant_left: { label: 'Participant left', group: 'Participant events' },
  participant_event: { label: 'Other participant events', group: 'Participant events' },
  expert_status: { label: 'Expert verdicts', group: 'Sub-agent verdicts' },
  safety_check: { label: 'Safety checks', group: 'Sub-agent verdicts' },
  decision_stream: { label: 'Decision stream', group: 'Decisions & prompts' },
  prompt_execution: { label: 'Prompt execution', group: 'Decisions & prompts' },
  llm_config: { label: 'LLM config', group: 'Decisions & prompts' },
  task_update: { label: 'Task update', group: 'Plan & state' },
  state_change: { label: 'State change', group: 'Plan & state' },
  deliverable: { label: 'Deliverable', group: 'Plan & state' },
  debug: { label: 'Debug', group: 'Diagnostics' },
  system: { label: 'System', group: 'Diagnostics' },
}

const GROUP_ORDER = [
  'Conversation',
  'Participant events',
  'Sub-agent verdicts',
  'Decisions & prompts',
  'Plan & state',
  'Diagnostics',
  'Other',
]

const DEFAULT_SELECTED = new Set<string>(['user_text', 'agent_text', 'transcript'])

type AvailableType = { messageType: string; count: number }

export default function TranscriptDownloadModal({
  isOpen,
  onClose,
  sessionId,
}: TranscriptDownloadModalProps) {
  const { resolvedTheme } = useThemeStore()
  const isDark = resolvedTheme === 'dark'
  const [available, setAvailable] = useState<AvailableType[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [includeMetadata, setIncludeMetadata] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    let cancelled = false
    setAvailable(null)
    setLoadError(null)
    apiClient
      .getTranscriptMessageTypes(sessionId)
      .then((res) => {
        if (cancelled) return
        setAvailable(res.types)
        const seed = new Set<string>()
        for (const t of res.types) {
          if (DEFAULT_SELECTED.has(t.messageType)) seed.add(t.messageType)
        }
        setSelected(seed)
      })
      .catch((err) => {
        if (cancelled) return
        console.error('Failed to load message types:', err)
        setLoadError('Could not load available message types.')
      })
    return () => {
      cancelled = true
    }
  }, [isOpen, sessionId])

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const toggleGroup = (types: AvailableType[]) => {
    const allOn = types.every((t) => selected.has(t.messageType))
    setSelected((prev) => {
      const next = new Set(prev)
      for (const t of types) {
        if (allOn) next.delete(t.messageType)
        else next.add(t.messageType)
      }
      return next
    })
  }

  const selectAll = () => setSelected(new Set((available ?? []).map((t) => t.messageType)))
  const clearAll = () => setSelected(new Set())

  const handleDownload = async () => {
    if (selected.size === 0 || isDownloading) return
    try {
      setIsDownloading(true)
      await apiClient.downloadTranscript(sessionId, {
        types: Array.from(selected),
        includeMetadata,
      })
      onClose()
    } catch (err) {
      console.error('Failed to download transcript:', err)
    } finally {
      setIsDownloading(false)
    }
  }

  const handleClose = () => {
    if (isDownloading) return
    onClose()
  }

  const grouped = new Map<string, AvailableType[]>()
  for (const t of available ?? []) {
    const group = TYPE_META[t.messageType]?.group ?? 'Other'
    const list = grouped.get(group) ?? []
    list.push(t)
    grouped.set(group, list)
  }
  const orderedGroups = GROUP_ORDER.filter((g) => grouped.has(g))

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
          onClick={handleClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className={`card-elevated w-full max-w-lg max-h-[85vh] flex flex-col ${
              isDark ? 'bg-surface-dark-secondary' : ''
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="px-6 pt-6 pb-4 relative">
              <button
                onClick={handleClose}
                disabled={isDownloading}
                className={`absolute top-5 right-5 p-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  isDark
                    ? 'text-content-inverse-tertiary hover:text-content-inverse hover:bg-surface-dark-tertiary'
                    : 'text-content-tertiary hover:text-content hover:bg-surface-secondary'
                }`}
                title="Close"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
              <h2 className={`text-heading-lg ${isDark ? 'text-content-inverse' : 'text-content'}`}>
                Download transcript
              </h2>
              <p
                className={`text-body mt-1 ${
                  isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'
                }`}
              >
                Choose which message types to include in the export
              </p>
            </div>

            {/* Toolbar */}
            {available && available.length > 0 && (
              <div
                className={`px-6 py-3 flex items-center justify-between border-t border-b ${
                  isDark ? 'border-zinc-700' : 'border-border'
                }`}
              >
                <span
                  className={`text-caption ${
                    isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'
                  }`}
                >
                  {available.length} type{available.length === 1 ? '' : 's'} stored in this session
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={selectAll}
                    className={`text-caption px-2 py-1 rounded transition-colors ${
                      isDark
                        ? 'text-content-inverse-secondary hover:text-content-inverse hover:bg-surface-dark-tertiary'
                        : 'text-content-secondary hover:text-content hover:bg-surface-secondary'
                    }`}
                  >
                    Select all
                  </button>
                  <button
                    onClick={clearAll}
                    className={`text-caption px-2 py-1 rounded transition-colors ${
                      isDark
                        ? 'text-content-inverse-secondary hover:text-content-inverse hover:bg-surface-dark-tertiary'
                        : 'text-content-secondary hover:text-content hover:bg-surface-secondary'
                    }`}
                  >
                    Clear
                  </button>
                </div>
              </div>
            )}

            {/* Body */}
            <div className="flex-1 overflow-auto px-6 py-4 space-y-5">
              {loadError && (
                <div
                  className={`p-3 rounded-lg text-body-sm ${
                    isDark
                      ? 'bg-red-500/10 border border-red-500/20 text-red-400'
                      : 'bg-red-50 border border-red-200 text-red-700'
                  }`}
                >
                  {loadError}
                </div>
              )}
              {!available && !loadError && (
                <div
                  className={`text-body-sm ${
                    isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'
                  }`}
                >
                  Loading available message types…
                </div>
              )}
              {available && available.length === 0 && (
                <div
                  className={`text-body-sm ${
                    isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'
                  }`}
                >
                  This session has no stored messages yet.
                </div>
              )}

              {orderedGroups.map((group) => {
                const types = grouped.get(group)!
                const allOn = types.every((t) => selected.has(t.messageType))
                return (
                  <div key={group}>
                    <div className="flex items-center justify-between mb-2">
                      <div
                        className={`text-label uppercase ${
                          isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'
                        }`}
                      >
                        {group}
                      </div>
                      <button
                        onClick={() => toggleGroup(types)}
                        className={`text-caption px-2 py-0.5 rounded transition-colors ${
                          isDark
                            ? 'text-content-inverse-tertiary hover:text-content-inverse hover:bg-surface-dark-tertiary'
                            : 'text-content-tertiary hover:text-content hover:bg-surface-secondary'
                        }`}
                      >
                        {allOn ? 'Clear' : 'Select all'}
                      </button>
                    </div>
                    <div className="space-y-0.5">
                      {types.map((t) => {
                        const known = !!TYPE_META[t.messageType]
                        const label = TYPE_META[t.messageType]?.label ?? t.messageType
                        return (
                          <label
                            key={t.messageType}
                            className={`flex items-center justify-between gap-2 py-1.5 px-2 -mx-2 rounded cursor-pointer transition-colors ${
                              isDark ? 'hover:bg-surface-dark-tertiary' : 'hover:bg-surface-secondary'
                            }`}
                          >
                            <span className="flex items-center gap-2.5 min-w-0">
                              <input
                                type="checkbox"
                                checked={selected.has(t.messageType)}
                                onChange={() => toggle(t.messageType)}
                                className="rounded shrink-0"
                              />
                              <span
                                className={`text-body-sm truncate ${
                                  isDark ? 'text-content-inverse' : 'text-content'
                                }`}
                              >
                                {label}
                              </span>
                              {known && (
                                <span
                                  className={`text-caption font-mono shrink-0 ${
                                    isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'
                                  }`}
                                >
                                  {t.messageType}
                                </span>
                              )}
                            </span>
                            <span
                              className={`text-caption tabular-nums shrink-0 ${
                                isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'
                              }`}
                            >
                              {t.count.toLocaleString()}
                            </span>
                          </label>
                        )
                      })}
                    </div>
                  </div>
                )
              })}

              {available && available.length > 0 && (
                <div className={`pt-4 border-t ${isDark ? 'border-zinc-700' : 'border-border'}`}>
                  <label
                    className={`flex items-center gap-2.5 cursor-pointer text-body-sm ${
                      isDark ? 'text-content-inverse' : 'text-content'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={includeMetadata}
                      onChange={(e) => setIncludeMetadata(e.target.checked)}
                      className="rounded"
                    />
                    Include raw message metadata
                    <span
                      className={`text-caption ${
                        isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'
                      }`}
                    >
                      (verbose)
                    </span>
                  </label>
                </div>
              )}
            </div>

            {/* Footer */}
            <div
              className={`flex items-center justify-between gap-3 px-6 py-4 border-t ${
                isDark ? 'border-zinc-700' : 'border-border'
              }`}
            >
              <span
                className={`text-caption ${
                  isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'
                }`}
              >
                {selected.size} type{selected.size === 1 ? '' : 's'} selected
              </span>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleClose}
                  disabled={isDownloading}
                  className="btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDownload}
                  disabled={selected.size === 0 || isDownloading}
                  className="btn-primary"
                >
                  {isDownloading ? 'Downloading…' : 'Download'}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
