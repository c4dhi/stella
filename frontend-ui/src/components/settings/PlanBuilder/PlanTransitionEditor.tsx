import { useState } from 'react'
import { useThemeStore } from '../../../store/themeStore'
import type { PlanDeliverable, StateTransition, StateTransitionConditionType, StateType } from '../../../lib/api-types'

interface PlanTransitionEditorProps {
  sourceStateTitle: string
  sourceStateType: StateType
  targetStateTitle: string
  transition: StateTransition
  availableDeliverables: PlanDeliverable[]
  isAmbiguous: boolean
  isConditionIncomplete: boolean
  onChange: (transition: StateTransition) => void
  onDelete: () => void
}

const toNumberOrUndefined = (value: string): number | undefined => {
  if (!value.trim()) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

export default function PlanTransitionEditor({
  sourceStateTitle,
  sourceStateType,
  targetStateTitle,
  transition,
  availableDeliverables,
  isAmbiguous,
  isConditionIncomplete,
  onChange,
  onDelete,
}: PlanTransitionEditorProps) {
  const { resolvedTheme } = useThemeStore()
  const isDark = resolvedTheme === 'dark'
  const [optionsOpen, setOptionsOpen] = useState(false)
  const conditionConfig = transition.condition_config || {}
  const keyValue = typeof conditionConfig.key === 'string' ? conditionConfig.key : ''
  const valueValue = conditionConfig.value
  const selectedDeliverable = availableDeliverables.find((deliverable) => deliverable.key === keyValue)
  const selectedOptions =
    Array.isArray(valueValue) ? valueValue.filter((value): value is string => typeof value === 'string') : []
  const expectedValueText =
    typeof valueValue === 'string' || typeof valueValue === 'number' || typeof valueValue === 'boolean'
      ? String(valueValue).trim()
      : ''
  const isMissingDeliverable =
    (transition.condition_type === 'deliverable_exists' || transition.condition_type === 'deliverable_value') &&
    keyValue.trim().length === 0
  const isMissingExpectedValue =
    transition.condition_type === 'deliverable_value' &&
    !isMissingDeliverable &&
    (selectedDeliverable?.type === 'enum' ? selectedOptions.length === 0 : expectedValueText.length === 0)
  const deliverableTypeLabel =
    selectedDeliverable?.type === 'number'
      ? 'Number'
      : selectedDeliverable?.type === 'boolean'
        ? 'Yes/No'
        : selectedDeliverable?.type === 'enum'
          ? 'Options'
          : 'Text'
  const conditionOptions: StateTransitionConditionType[] = sourceStateType === 'goal'
    ? ['goal_achieved', 'deliverable_exists', 'deliverable_value']
    : ['all_tasks_complete', 'deliverable_exists', 'deliverable_value']

  const handleConditionChange = (conditionType: StateTransitionConditionType) => {
    if (conditionType === 'all_tasks_complete' || conditionType === 'goal_achieved') {
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
      {isAmbiguous && (
        <div className={`rounded-xl border px-3 py-2 text-caption ${
          isDark ? 'border-amber-500/40 bg-amber-500/10 text-amber-300' : 'border-amber-300 bg-amber-50 text-amber-800'
        }`}>
          Ambiguous route: this condition is duplicated on another outgoing transition from the same state.
        </div>
      )}
      {isMissingExpectedValue && (
        <div className={`rounded-xl border px-3 py-2 text-caption ${
          isDark ? 'border-amber-500/40 bg-amber-500/10 text-amber-300' : 'border-amber-300 bg-amber-50 text-amber-800'
        }`}>
          Expected value is required for this condition.
        </div>
      )}
      {isMissingDeliverable && (
        <div className={`rounded-xl border px-3 py-2 text-caption ${
          isDark ? 'border-amber-500/40 bg-amber-500/10 text-amber-300' : 'border-amber-300 bg-amber-50 text-amber-800'
        }`}>
          Deliverable selection is required for this condition.
        </div>
      )}
      {isConditionIncomplete && !isMissingExpectedValue && !isMissingDeliverable && (
        <div className={`rounded-xl border px-3 py-2 text-caption ${
          isDark ? 'border-amber-500/40 bg-amber-500/10 text-amber-300' : 'border-amber-300 bg-amber-50 text-amber-800'
        }`}>
          Transition condition is incomplete.
        </div>
      )}

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
          {conditionOptions.map((condition) => (
            <option key={condition} value={condition}>
              {condition === 'all_tasks_complete' && 'All tasks complete'}
              {condition === 'goal_achieved' && 'Goal achieved'}
              {condition === 'deliverable_exists' && 'Deliverable exists'}
              {condition === 'deliverable_value' && 'Deliverable value'}
            </option>
          ))}
        </select>
      </div>

      {transition.condition_type === 'goal_achieved' && (
        <div className={`rounded-xl border px-3 py-2 text-caption ${
          isDark ? 'border-blue-500/40 bg-blue-500/10 text-blue-300' : 'border-blue-300 bg-blue-50 text-blue-800'
        }`}>
          This transition happens automatically when the conversation goal is met. No additional setup is needed.
        </div>
      )}

      {(transition.condition_type === 'deliverable_exists' || transition.condition_type === 'deliverable_value') && (
        <div>
          <label className={`text-caption font-medium mb-1 block ${
            isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'
          }`}>
            Deliverable
          </label>
          <select
            value={keyValue}
            onChange={(e) => {
              const nextConfig = {
                ...(conditionConfig || {}),
                key: e.target.value,
                ...(transition.condition_type === 'deliverable_value'
                  ? {
                      value:
                        availableDeliverables.find((deliverable) => deliverable.key === e.target.value)?.type === 'enum'
                          ? []
                          : '',
                    }
                  : {}),
              }
              onChange({ ...transition, condition_config: nextConfig })
            }}
            className="input-field w-full"
          >
            <option value="">Select deliverable</option>
            {availableDeliverables.map((deliverable) => (
              <option key={deliverable.key} value={deliverable.key}>
                {deliverable.description}
              </option>
            ))}
          </select>
          {selectedDeliverable && (
            <div className="mt-2 flex gap-2">
              <span className={`px-2 py-1 rounded-md text-[11px] font-medium ${
                isDark ? 'bg-blue-500/15 text-blue-300 border border-blue-500/30' : 'bg-blue-50 text-blue-700 border border-blue-200'
              }`}>
                {selectedDeliverable.required ? 'Deliverable is required' : 'Deliverable not required'}
              </span>
              <span className={`px-2 py-1 rounded-md text-[11px] font-medium ${
                isDark ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
              }`}>
                Type: {deliverableTypeLabel}
              </span>
            </div>
          )}
        </div>
      )}

      {transition.condition_type === 'deliverable_value' && (
        <div>
          <label className={`text-caption font-medium mb-1 block ${
            isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'
          }`}>
            Expected Value
          </label>
          {selectedDeliverable?.type === 'enum' && (selectedDeliverable.enum_values?.length ?? 0) > 0 ? (
            <div className="relative">
              <button
                type="button"
                onClick={() => setOptionsOpen((open) => !open)}
                className="input-field w-full text-left flex items-center justify-between"
              >
                <span className="truncate">
                  {selectedOptions.length > 0 ? selectedOptions.join(', ') : 'Select options'}
                </span>
                <span className={`text-caption ${isDark ? 'text-zinc-400' : 'text-neutral-500'}`}>
                  {optionsOpen ? '▲' : '▼'}
                </span>
              </button>
              {optionsOpen && (
                <div className={`absolute z-20 mt-1 w-full rounded-lg border shadow-lg max-h-56 overflow-y-auto ${
                  isDark ? 'bg-zinc-900 border-zinc-700' : 'bg-white border-neutral-200'
                }`}>
                  {selectedDeliverable.enum_values!.map((enumValue) => {
                    const checked = selectedOptions.includes(enumValue)
                    return (
                      <label
                        key={enumValue}
                        className={`flex items-center gap-2 px-3 py-2 text-body-sm cursor-pointer ${
                          isDark ? 'hover:bg-zinc-800 text-zinc-200' : 'hover:bg-neutral-50 text-neutral-800'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            const next = checked
                              ? selectedOptions.filter((value) => value !== enumValue)
                              : [...selectedOptions, enumValue]
                            onChange({
                              ...transition,
                              condition_config: {
                                ...(conditionConfig || {}),
                                value: next,
                              },
                            })
                          }}
                        />
                        <span>{enumValue}</span>
                      </label>
                    )
                  })}
                </div>
              )}
            </div>
          ) : (
            <input
              type="text"
              value={
                typeof valueValue === 'string' || typeof valueValue === 'number' || typeof valueValue === 'boolean'
                  ? String(valueValue)
                  : ''
              }
              onChange={(e) =>
                onChange({
                  ...transition,
                  condition_config: {
                    ...(conditionConfig || {}),
                    value: e.target.value,
                  },
                })
              }
              placeholder="Expected value"
              className="input-field w-full"
            />
          )}
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
