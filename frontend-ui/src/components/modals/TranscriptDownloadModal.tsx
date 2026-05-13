import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { apiClient } from '../../services/ApiClient'
import { useThemeStore } from '../../store/themeStore'

interface TranscriptDownloadModalProps {
  isOpen: boolean
  onClose: () => void
  sessionId: string
}

// Grouped, user-facing labels for each message type. The keys must match
// the messageType values stored in the database / accepted by the backend.
const TYPE_GROUPS: Array<{
  label: string
  description: string
  types: Array<{ key: string; label: string }>
}> = [
  {
    label: 'Conversation',
    description: 'Spoken / typed messages between user and agent',
    types: [
      { key: 'user_text', label: 'User text' },
      { key: 'agent_text', label: 'Agent text' },
      { key: 'transcript', label: 'Transcript (final)' },
      { key: 'transcript_chunk', label: 'Transcript chunks (partial)' },
    ],
  },
  {
    label: 'Participant events',
    description: 'Joins, leaves, and other participant lifecycle events',
    types: [
      { key: 'participant_joined', label: 'Participant joined' },
      { key: 'participant_left', label: 'Participant left' },
      { key: 'participant_event', label: 'Other participant events' },
    ],
  },
  {
    label: 'Sub-agent verdicts',
    description: 'Expert evaluations and safety checks',
    types: [
      { key: 'expert_status', label: 'Expert verdicts' },
      { key: 'safety_check', label: 'Safety checks' },
    ],
  },
  {
    label: 'Decisions & prompts',
    description: 'Reasoning streams and LLM prompt execution',
    types: [
      { key: 'decision_stream', label: 'Decision stream' },
      { key: 'prompt_execution', label: 'Prompt execution' },
      { key: 'llm_config', label: 'LLM config' },
    ],
  },
  {
    label: 'Plan & state',
    description: 'Plan progress, deliverables, and state transitions',
    types: [
      { key: 'plan_progress_update', label: 'Plan progress update' },
      { key: 'plan_deliverable_update', label: 'Plan deliverable update' },
      { key: 'state_change_notification', label: 'State change notification' },
      { key: 'complete_todo_list', label: 'Complete todo list' },
      { key: 'task_progress_update', label: 'Task progress update' },
      { key: 'progress_update', label: 'Progress update' },
      { key: 'task_update', label: 'Task update' },
    ],
  },
  {
    label: 'Diagnostics',
    description: 'Low-level debug entries',
    types: [{ key: 'debug', label: 'Debug' }],
  },
]

const DEFAULT_SELECTION = new Set<string>([
  'user_text',
  'agent_text',
  'transcript',
  'transcript_chunk',
])

const PRESET_VERDICTS = new Set<string>([
  ...DEFAULT_SELECTION,
  'expert_status',
  'safety_check',
])

const ALL_TYPES = new Set<string>(
  TYPE_GROUPS.flatMap((g) => g.types.map((t) => t.key)),
)

export default function TranscriptDownloadModal({
  isOpen,
  onClose,
  sessionId,
}: TranscriptDownloadModalProps) {
  const { resolvedTheme } = useThemeStore()
  const isDark = resolvedTheme === 'dark'
  const [selected, setSelected] = useState<Set<string>>(new Set(DEFAULT_SELECTION))
  const [includeMetadata, setIncludeMetadata] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const toggleGroup = (types: Array<{ key: string }>) => {
    const allOn = types.every((t) => selected.has(t.key))
    setSelected((prev) => {
      const next = new Set(prev)
      for (const t of types) {
        if (allOn) next.delete(t.key)
        else next.add(t.key)
      }
      return next
    })
  }

  const applyPreset = (preset: 'transcript' | 'verdicts' | 'full') => {
    if (preset === 'transcript') setSelected(new Set(DEFAULT_SELECTION))
    else if (preset === 'verdicts') setSelected(new Set(PRESET_VERDICTS))
    else setSelected(new Set(ALL_TYPES))
  }

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

  const selectedCount = selected.size
  const totalCount = ALL_TYPES.size

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

              <div className={`px-6 py-3 border-b flex items-center gap-2 text-xs ${
                isDark ? 'border-zinc-800 text-zinc-400' : 'border-neutral-200 text-neutral-600'
              }`}>
                <span>Presets:</span>
                <button
                  onClick={() => applyPreset('transcript')}
                  className={`px-2 py-1 rounded ${
                    isDark ? 'hover:bg-white/10' : 'hover:bg-neutral-100'
                  }`}
                >
                  Transcript only
                </button>
                <button
                  onClick={() => applyPreset('verdicts')}
                  className={`px-2 py-1 rounded ${
                    isDark ? 'hover:bg-white/10' : 'hover:bg-neutral-100'
                  }`}
                >
                  + Verdicts
                </button>
                <button
                  onClick={() => applyPreset('full')}
                  className={`px-2 py-1 rounded ${
                    isDark ? 'hover:bg-white/10' : 'hover:bg-neutral-100'
                  }`}
                >
                  Everything
                </button>
              </div>

              <div className="flex-1 overflow-auto px-6 py-4 space-y-5">
                {TYPE_GROUPS.map((group) => {
                  const allOn = group.types.every((t) => selected.has(t.key))
                  const someOn = group.types.some((t) => selected.has(t.key))
                  return (
                    <div key={group.label}>
                      <div className="flex items-center justify-between mb-1.5">
                        <div>
                          <div className={`text-xs font-medium uppercase tracking-wide ${
                            isDark ? 'text-zinc-300' : 'text-neutral-700'
                          }`}>
                            {group.label}
                          </div>
                          <div className={`text-[11px] ${isDark ? 'text-zinc-500' : 'text-neutral-500'}`}>
                            {group.description}
                          </div>
                        </div>
                        <button
                          onClick={() => toggleGroup(group.types)}
                          className={`text-[11px] px-2 py-0.5 rounded ${
                            isDark ? 'text-zinc-400 hover:bg-white/10' : 'text-neutral-600 hover:bg-neutral-100'
                          }`}
                        >
                          {allOn ? 'Clear' : someOn ? 'Select all' : 'Select all'}
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 pl-1">
                        {group.types.map((t) => (
                          <label
                            key={t.key}
                            className={`flex items-center gap-2 text-xs cursor-pointer py-0.5 ${
                              isDark ? 'text-zinc-300' : 'text-neutral-700'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={selected.has(t.key)}
                              onChange={() => toggle(t.key)}
                              className="rounded"
                            />
                            {t.label}
                          </label>
                        ))}
                      </div>
                    </div>
                  )
                })}

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
              </div>

              <div className={`flex items-center justify-between px-6 py-3 border-t ${
                isDark ? 'border-zinc-800' : 'border-neutral-200'
              }`}>
                <span className={`text-xs ${isDark ? 'text-zinc-500' : 'text-neutral-500'}`}>
                  {selectedCount} of {totalCount} types selected
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
                    disabled={selectedCount === 0 || isDownloading}
                    className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
                      selectedCount === 0 || isDownloading
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
