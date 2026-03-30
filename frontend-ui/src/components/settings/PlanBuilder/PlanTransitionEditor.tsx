import { useThemeStore } from '../../../store/themeStore'
import type { StateTransition, StateTransitionConditionType } from '../../../lib/api-types'

interface PlanTransitionEditorProps {
  sourceStateTitle: string
  targetStateTitle: string
  transition: StateTransition
  onChange: (transition: StateTransition) => void
  onDelete: () => void
}

const SUPPORTED_CONDITIONS: StateTransitionConditionType[] = [
  'all_tasks_complete',
  'deliverable_exists',
  'deliverable_value',
]

const toNumberOrUndefined = (value: string): number | undefined => {
  if (!value.trim()) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

export default function PlanTransitionEditor({
  sourceStateTitle,
  targetStateTitle,
  transition,
  onChange,
  onDelete,
}: PlanTransitionEditorProps) {
  const { resolvedTheme } = useThemeStore()
  const isDark = resolvedTheme === 'dark'
  const isSupported = SUPPORTED_CONDITIONS.includes(transition.condition_type)
  const conditionConfig = transition.condition_config || {}
  const keyValue = typeof conditionConfig.key === 'string' ? conditionConfig.key : ''
  const valueValue =
    typeof conditionConfig.value === 'string' || typeof conditionConfig.value === 'number'
      ? String(conditionConfig.value)
      : ''

  const handleConditionChange = (conditionType: StateTransitionConditionType) => {
    if (conditionType === 'all_tasks_complete') {
      onChange({
        ...transition,
        condition_type: conditionType,
        condition_config: undefined,
      })
      return
    }

    onChange({
      ...transition,
      condition_type: conditionType,
      condition_config: {
        key: keyValue,
        ...(conditionType === 'deliverable_value' ? { value: valueValue } : {}),
      },
    })
  }

  return (
    <div className="p-6 space-y-5">
      <div className={`rounded-xl border p-4 ${
        isDark ? 'border-zinc-700 bg-zinc-900/30' : 'border-neutral-200 bg-neutral-50'
      }`}>
        <div className={`text-caption font-medium ${isDark ? 'text-zinc-400' : 'text-neutral-500'}`}>
          Transition
        </div>
        <div className={`mt-1 text-body-sm font-semibold ${isDark ? 'text-zinc-100' : 'text-neutral-800'}`}>
          {sourceStateTitle} → {targetStateTitle}
        </div>
      </div>

      <div>
        <label className={`text-caption font-medium mb-1 block ${
          isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'
        }`}>
          Condition Type
        </label>
        <select
          value={transition.condition_type}
          onChange={(e) => handleConditionChange(e.target.value as StateTransitionConditionType)}
          className="input-field w-full"
        >
          {!isSupported && (
            <option value={transition.condition_type}>
              {transition.condition_type.replace(/_/g, ' ')} (Existing)
            </option>
          )}
          <option value="all_tasks_complete">All tasks complete</option>
          <option value="deliverable_exists">Deliverable exists</option>
          <option value="deliverable_value">Deliverable value</option>
        </select>
      </div>

      {(transition.condition_type === 'deliverable_exists' || transition.condition_type === 'deliverable_value') && (
        <div>
          <label className={`text-caption font-medium mb-1 block ${
            isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'
          }`}>
            Deliverable Key
          </label>
          <input
            type="text"
            value={keyValue}
            onChange={(e) => {
              const nextConfig = {
                ...(conditionConfig || {}),
                key: e.target.value,
              }
              onChange({ ...transition, condition_config: nextConfig })
            }}
            placeholder="e.g. user_budget"
            className="input-field w-full"
          />
        </div>
      )}

      {transition.condition_type === 'deliverable_value' && (
        <div>
          <label className={`text-caption font-medium mb-1 block ${
            isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'
          }`}>
            Expected Value
          </label>
          <input
            type="text"
            value={valueValue}
            onChange={(e) => {
              const nextConfig = {
                ...(conditionConfig || {}),
                value: e.target.value,
              }
              onChange({ ...transition, condition_config: nextConfig })
            }}
            placeholder="e.g. premium"
            className="input-field w-full"
          />
        </div>
      )}

      <div>
        <label className={`text-caption font-medium mb-1 block ${
          isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'
        }`}>
          Priority
        </label>
        <input
          type="number"
          value={transition.priority ?? ''}
          onChange={(e) =>
            onChange({
              ...transition,
              priority: toNumberOrUndefined(e.target.value),
            })
          }
          placeholder="0"
          className="input-field w-full max-w-[160px]"
        />
        <p className={`mt-1 text-caption ${isDark ? 'text-zinc-500' : 'text-neutral-500'}`}>
          Lower number runs first.
        </p>
      </div>

      <button
        onClick={onDelete}
        className={`px-3 py-2 rounded-lg text-caption font-medium transition-colors ${
          isDark
            ? 'text-red-300 bg-red-500/10 hover:bg-red-500/20'
            : 'text-red-700 bg-red-50 hover:bg-red-100'
        }`}
      >
        Delete Transition
      </button>
    </div>
  )
}
