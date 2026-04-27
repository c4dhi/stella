import { useThemeStore } from '../../../store/themeStore'
import type { EndNodeConfig } from '../../../lib/api-types'

// Sidebar panel rendered when the End node is selected on the canvas.
// Config is stored in metadata.plan_builder.canvas.end_node_config and
// consumed by the backend when the state machine transitions to the end state.

interface PlanEndEditorProps {
  config: EndNodeConfig
  onChange: (config: EndNodeConfig) => void
}

export default function PlanEndEditor({ config, onChange }: PlanEndEditorProps) {
  const { resolvedTheme } = useThemeStore()
  const isDark = resolvedTheme === 'dark'

  return (
    <div className="p-6 space-y-6">
      {/* Optional message the agent sends as its final turn before the session is closed. */}
      <div>
        <label className={`text-caption font-medium mb-1 block ${isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'}`}>
          Farewell Message
        </label>
        <textarea
          value={config.farewell_message || ''}
          // Store empty string as undefined so the field is omitted from the plan JSON when blank.
          onChange={(e) => onChange({ ...config, farewell_message: e.target.value || undefined })}
          placeholder="Optional message the agent sends when the conversation ends..."
          rows={4}
          className={`w-full px-3 py-2.5 rounded-lg text-[13px] border resize-none transition-colors focus:outline-none ${
            isDark
              ? 'bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-500'
              : 'bg-white border-neutral-200 text-neutral-900 placeholder:text-neutral-400'
          }`}
        />
      </div>

      {/* Controls whether the agent produces a conversation summary before ending.
          'none' — end immediately, 'brief' — short recap, 'full' — detailed summary. */}
      <div>
        <label className={`text-caption font-medium mb-1 block ${isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'}`}>
          Summary Behavior
        </label>
        <select
          value={config.summary_behavior || 'none'}
          onChange={(e) => onChange({ ...config, summary_behavior: e.target.value as EndNodeConfig['summary_behavior'] })}
          className="input-field w-full max-w-[220px]"
        >
          <option value="none">None</option>
          <option value="brief">Brief — short recap before ending</option>
          <option value="full">Full — detailed conversation summary</option>
        </select>
      </div>
    </div>
  )
}
