import { useThemeStore } from '../../../store/themeStore'
import type {
  AgentSpawnMode,
  PlanState,
  SessionContext,
  SessionContextField,
  ParticipantEventMessageConfig,
} from '../../../lib/api-types'
import {
  JOIN_MESSAGE_PLACEHOLDER,
  LEFT_MESSAGE_PLACEHOLDER,
  PARTICIPANT_EVENT_TOKEN_OPTIONS,
} from './participantEventConfig'

interface PlanStartEditorProps {
  states: PlanState[]
  initialStateId: string | null
  spawnMode: AgentSpawnMode
  sessionContext: SessionContext
  onParticipantJoin: ParticipantEventMessageConfig
  onParticipantLeft: ParticipantEventMessageConfig
  onInitialStateChange: (stateId: string) => void
  onSpawnModeChange: (mode: AgentSpawnMode) => void
  onSessionContextChange: (context: SessionContext) => void
  onParticipantJoinChange: (config: ParticipantEventMessageConfig) => void
  onParticipantLeftChange: (config: ParticipantEventMessageConfig) => void
}

const createField = (): SessionContextField => ({
  id: `field_${crypto.randomUUID().slice(0, 8)}`,
  label: '',
  type: 'string',
  required: false,
})

export default function PlanStartEditor({
  states,
  initialStateId,
  spawnMode,
  sessionContext,
  onParticipantJoin,
  onParticipantLeft,
  onInitialStateChange,
  onSpawnModeChange,
  onSessionContextChange,
  onParticipantJoinChange,
  onParticipantLeftChange,
}: PlanStartEditorProps) {
  const { resolvedTheme } = useThemeStore()
  const isDark = resolvedTheme === 'dark'
  const fields = sessionContext.fields || []

  const renderPreview = (template: string) =>
    template
      .split('{participant_name}').join('Alex')
      .split('{agent_name}').join('Stella')

  const insertToken = (
    current: ParticipantEventMessageConfig,
    token: string,
    onChange: (config: ParticipantEventMessageConfig) => void,
  ) => {
    const base = current.message_template || ''
    const spacer = base.endsWith(' ') || base.length === 0 ? '' : ' '
    onChange({
      ...current,
      message_template: `${base}${spacer}${token}`,
    })
  }

  const renderMessageEditor = ({
    title,
    value,
    enabled,
    placeholder,
    onEnabledChange,
    onTemplateChange,
  }: {
    title: string
    value: string
    enabled: boolean
    placeholder: string
    onEnabledChange: (enabled: boolean) => void
    onTemplateChange: (value: string) => void
  }) => (
    <div className={`rounded-lg border p-4 space-y-3 ${isDark ? 'border-zinc-700 bg-zinc-900/30' : 'border-neutral-200 bg-white'}`}>
      <div className="flex items-center justify-between gap-3">
        <label className={`text-caption font-medium ${isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'}`}>
          {title}
        </label>
        <label className="flex items-center gap-2 text-caption">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => onEnabledChange(e.target.checked)}
          />
          Enabled
        </label>
      </div>

      <div className="space-y-2">
        <div className={`text-caption ${isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'}`}>
          Message
        </div>
        <textarea
          value={value}
          onChange={(e) => onTemplateChange(e.target.value)}
          placeholder={placeholder}
          rows={3}
          className="input-field w-full"
        />
      </div>

        <div className="space-y-2">
          <div className={`text-caption ${isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'}`}>
            Insert Dynamic Value
          </div>
          <div className="flex flex-wrap gap-2">
          {PARTICIPANT_EVENT_TOKEN_OPTIONS.map((option) => (
            <button
              key={option.token}
              type="button"
              onClick={() => insertToken(
                { message_template: value, enabled },
                option.token,
                (cfg) => onTemplateChange(cfg.message_template || ''),
              )}
              className={`px-2.5 py-1 rounded-md text-caption border transition-colors ${
                isDark
                  ? 'border-zinc-600 text-zinc-200 hover:bg-zinc-800'
                  : 'border-neutral-300 text-neutral-700 hover:bg-neutral-100'
              }`}
            >
              {option.label}
            </button>
          ))}
          </div>
      </div>

      <div className={`rounded-md px-3 py-2 text-caption ${isDark ? 'bg-zinc-800 text-zinc-200' : 'bg-neutral-50 text-neutral-700'}`}>
        Preview: {renderPreview(value || placeholder)}
      </div>
    </div>
  )

  return (
    <div className="p-6 space-y-6">
      <div>
        <label className={`text-caption font-medium mb-1 block ${isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'}`}>
          Initial State
        </label>
        <select
          value={initialStateId || ''}
          onChange={(e) => onInitialStateChange(e.target.value)}
          className="input-field w-full"
        >
          <option value="" disabled>Select initial state...</option>
          {states.map((state, index) => (
            <option key={state.id} value={state.id}>
              {state.title || `State ${index + 1}`}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className={`text-caption font-medium mb-1 block ${isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'}`}>
          Agent Spawn Mode
        </label>
        <select
          value={spawnMode}
          onChange={(e) => onSpawnModeChange(e.target.value as AgentSpawnMode)}
          className="input-field w-full max-w-[220px]"
        >
          <option value="immediate">Immediate</option>
          <option value="on_demand">On demand</option>
        </select>
      </div>

      {renderMessageEditor({
        title: 'On Participant Joined',
        value: onParticipantJoin.message_template || '',
        enabled: onParticipantJoin.enabled === true,
        placeholder: JOIN_MESSAGE_PLACEHOLDER,
        onEnabledChange: (enabled) => onParticipantJoinChange({ ...onParticipantJoin, enabled }),
        onTemplateChange: (message_template) => onParticipantJoinChange({ ...onParticipantJoin, message_template }),
      })}

      {renderMessageEditor({
        title: 'On Participant Left',
        value: onParticipantLeft.message_template || '',
        enabled: onParticipantLeft.enabled === true,
        placeholder: LEFT_MESSAGE_PLACEHOLDER,
        onEnabledChange: (enabled) => onParticipantLeftChange({ ...onParticipantLeft, enabled }),
        onTemplateChange: (message_template) => onParticipantLeftChange({ ...onParticipantLeft, message_template }),
      })}

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className={`text-caption font-medium ${isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'}`}>
            Session Context Fields
          </label>
          <button
            onClick={() => onSessionContextChange({ fields: [...fields, createField()] })}
            className={`text-caption transition-colors ${isDark ? 'text-primary hover:text-primary/80' : 'text-neutral-700 hover:text-neutral-900'}`}
          >
            Add Field
          </button>
        </div>

        {fields.length === 0 ? (
          <p className={`text-caption italic ${isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'}`}>
            No session context fields.
          </p>
        ) : (
          <div className="space-y-3">
            {fields.map((field, index) => (
              <div key={field.id} className={`rounded-lg border p-3 space-y-2 ${isDark ? 'border-zinc-700 bg-zinc-900/30' : 'border-neutral-200 bg-white'}`}>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={field.label}
                    onChange={(e) => {
                      const next = [...fields]
                      next[index] = { ...field, label: e.target.value }
                      onSessionContextChange({ fields: next })
                    }}
                    placeholder="Label"
                    className="input-field"
                  />
                  <button
                    onClick={() => onSessionContextChange({ fields: fields.filter((_, i) => i !== index) })}
                    className={`px-2 py-1 rounded text-caption ${isDark ? 'text-red-300 hover:bg-red-500/20' : 'text-red-700 hover:bg-red-50'}`}
                  >
                    Delete
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  <input
                    type="text"
                    value={field.id}
                    onChange={(e) => {
                      const next = [...fields]
                      next[index] = { ...field, id: e.target.value }
                      onSessionContextChange({ fields: next })
                    }}
                    placeholder="id"
                    className="input-field w-44 text-caption font-mono"
                  />
                  <select
                    value={field.type}
                    onChange={(e) => {
                      const next = [...fields]
                      next[index] = { ...field, type: e.target.value as SessionContextField['type'] }
                      onSessionContextChange({ fields: next })
                    }}
                    className="input-field w-36"
                  >
                    <option value="string">string</option>
                    <option value="number">number</option>
                    <option value="boolean">boolean</option>
                    <option value="select">select</option>
                  </select>
                  <label className="flex items-center gap-1 text-caption">
                    <input
                      type="checkbox"
                      checked={field.required}
                      onChange={(e) => {
                        const next = [...fields]
                        next[index] = { ...field, required: e.target.checked }
                        onSessionContextChange({ fields: next })
                      }}
                    />
                    Required
                  </label>
                </div>
                <input
                  type="text"
                  value={field.description || ''}
                  onChange={(e) => {
                    const next = [...fields]
                    next[index] = { ...field, description: e.target.value || undefined }
                    onSessionContextChange({ fields: next })
                  }}
                  placeholder="Description (optional)"
                  className="input-field"
                />
                {field.type === 'select' && (
                  <input
                    type="text"
                    value={(field.options || []).join(', ')}
                    onChange={(e) => {
                      const next = [...fields]
                      next[index] = {
                        ...field,
                        options: e.target.value.split(',').map((opt) => opt.trim()).filter(Boolean),
                      }
                      onSessionContextChange({ fields: next })
                    }}
                    placeholder="Options (comma-separated)"
                    className="input-field"
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
