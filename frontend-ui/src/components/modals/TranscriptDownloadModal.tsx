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

// Types selected by default when the modal opens — the "clean transcript" set.
const DEFAULT_SELECTED = new Set<string>([
  'user_text',
  'agent_text',
  'transcript',
])

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

  // Fetch the actual messageTypes stored for this session whenever the modal opens.
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
        // Seed selection with default set ∩ available.
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

  const selectAll = () => {
    setSelected(new Set((available ?? []).map((t) => t.messageType)))
  }
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

  // Group the available types by their configured group; unknown types → "Other".
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
        <>
          <motion.div
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[60]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            className="fixed inset-0 z-[60] flex items-center justify-center p-4"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
          >
            <div
              className={`rounded-2xl max-w-lg w-full max-h-[85vh] flex flex-col ${
                isDark
                  ? 'bg-zinc-900 border border-zinc-700 shadow-[0_8px_40px_rgba(0,0,0,0.5)]'
                  : 'bg-white shadow-2xl'
              }`}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                className={`flex items-center justify-between px-6 py-4 border-b ${
                  isDark ? 'border-zinc-800' : 'border-neutral-200'
                }`}
              >
                <div>
                  <h2 className={`text-lg font-light ${isDark ? 'text-zinc-100' : 'text-neutral-900'}`}>
                    Download transcript
                  </h2>
                  <p className={`text-xs mt-1 ${isDark ? 'text-zinc-500' : 'text-neutral-500'}`}>
                    Pick which message types to include
                  </p>
                </div>
                <button
                  onClick={onClose}
                  className={`p-2 rounded-lg transition-colors ${
                    isDark ? 'hover:bg-white/10' : 'hover:bg-neutral-100'
                  }`}
                >
                  <svg
                    className={`w-5 h-5 ${isDark ? 'text-zinc-400' : 'text-neutral-600'}`}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  >
                    <path d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {available && available.length > 0 && (
                <div className={`px-6 py-3 border-b flex items-center justify-between gap-2 text-xs ${
                  isDark ? 'border-zinc-800 text-zinc-400' : 'border-neutral-200 text-neutral-600'
                }`}>
                  <span>{available.length} type{available.length === 1 ? '' : 's'} stored in this session</span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={selectAll}
                      className={`px-2 py-1 rounded ${
                        isDark ? 'hover:bg-white/10' : 'hover:bg-neutral-100'
                      }`}
                    >
                      Select all
                    </button>
                    <button
                      onClick={clearAll}
                      className={`px-2 py-1 rounded ${
                        isDark ? 'hover:bg-white/10' : 'hover:bg-neutral-100'
                      }`}
                    >
                      Clear
                    </button>
                  </div>
                </div>
              )}

              <div className="flex-1 overflow-auto px-6 py-4 space-y-5">
                {loadError && (
                  <div className={`text-xs ${isDark ? 'text-red-400' : 'text-red-600'}`}>
                    {loadError}
                  </div>
                )}
                {!available && !loadError && (
                  <div className={`text-xs ${isDark ? 'text-zinc-500' : 'text-neutral-500'}`}>
                    Loading available message types…
                  </div>
                )}
                {available && available.length === 0 && (
                  <div className={`text-xs ${isDark ? 'text-zinc-500' : 'text-neutral-500'}`}>
                    This session has no stored messages yet.
                  </div>
                )}

                {orderedGroups.map((group) => {
                  const types = grouped.get(group)!
                  const allOn = types.every((t) => selected.has(t.messageType))
                  return (
                    <div key={group}>
                      <div className="flex items-center justify-between mb-1.5">
                        <div className={`text-xs font-medium uppercase tracking-wide ${
                          isDark ? 'text-zinc-300' : 'text-neutral-700'
                        }`}>
                          {group}
                        </div>
                        <button
                          onClick={() => toggleGroup(types)}
                          className={`text-[11px] px-2 py-0.5 rounded ${
                            isDark ? 'text-zinc-400 hover:bg-white/10' : 'text-neutral-600 hover:bg-neutral-100'
                          }`}
                        >
                          {allOn ? 'Clear' : 'Select all'}
                        </button>
                      </div>
                      <div className="space-y-1 pl-1">
                        {types.map((t) => {
                          const label = TYPE_META[t.messageType]?.label ?? t.messageType
                          return (
                            <label
                              key={t.messageType}
                              className={`flex items-center justify-between gap-2 text-xs cursor-pointer py-0.5 ${
                                isDark ? 'text-zinc-300' : 'text-neutral-700'
                              }`}
                            >
                              <span className="flex items-center gap-2 min-w-0">
                                <input
                                  type="checkbox"
                                  checked={selected.has(t.messageType)}
                                  onChange={() => toggle(t.messageType)}
                                  className="rounded"
                                />
                                <span className="truncate">{label}</span>
                                {label !== t.messageType && (
                                  <span className={`text-[10px] font-mono ${
                                    isDark ? 'text-zinc-600' : 'text-neutral-400'
                                  }`}>
                                    {t.messageType}
                                  </span>
                                )}
                              </span>
                              <span className={`text-[10px] tabular-nums ${
                                isDark ? 'text-zinc-500' : 'text-neutral-500'
                              }`}>
                                {t.count}
                              </span>
                            </label>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}

                {available && available.length > 0 && (
                  <div className={`pt-3 border-t ${isDark ? 'border-zinc-800' : 'border-neutral-200'}`}>
                    <label className={`flex items-center gap-2 text-xs cursor-pointer ${
                      isDark ? 'text-zinc-300' : 'text-neutral-700'
                    }`}>
                      <input
                        type="checkbox"
                        checked={includeMetadata}
                        onChange={(e) => setIncludeMetadata(e.target.checked)}
                        className="rounded"
                      />
                      Include raw message metadata (verbose)
                    </label>
                  </div>
                )}
              </div>

              <div className={`flex items-center justify-between px-6 py-3 border-t ${
                isDark ? 'border-zinc-800' : 'border-neutral-200'
              }`}>
                <span className={`text-xs ${isDark ? 'text-zinc-500' : 'text-neutral-500'}`}>
                  {selected.size} type{selected.size === 1 ? '' : 's'} selected
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={onClose}
                    className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
                      isDark
                        ? 'text-zinc-300 hover:bg-white/10'
                        : 'text-neutral-700 hover:bg-neutral-100'
                    }`}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDownload}
                    disabled={selected.size === 0 || isDownloading}
                    className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
                      selected.size === 0 || isDownloading
                        ? 'opacity-40 cursor-not-allowed bg-neutral-300 text-neutral-600'
                        : isDark
                          ? 'bg-zinc-100 text-zinc-900 hover:bg-white'
                          : 'bg-neutral-900 text-white hover:bg-neutral-800'
                    }`}
                  >
                    {isDownloading ? 'Downloading…' : 'Download'}
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
