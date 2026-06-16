import { useState } from 'react'
import { Check } from 'lucide-react'
import { useThemeStore } from '../../store/themeStore'

export interface SessionDurationOption {
  value: number | null
  label: string
  description: string
}

// Values are in seconds; `null` = no limit.
// Custom durations cap at 7200s (2h) — enforced in the backend DTO.
export const DEFAULT_SESSION_DURATION_OPTIONS: SessionDurationOption[] = [
  { value: null, label: 'No limit', description: 'Session runs until ended manually' },
  { value: 5 * 60, label: '5 minutes', description: 'Ends 5 min after first agent message' },
  { value: 7 * 60, label: '7 minutes', description: 'Ends 7 min after first agent message' },
  { value: 10 * 60, label: '10 minutes', description: 'Ends 10 min after first agent message' },
  { value: 20 * 60, label: '20 minutes', description: 'Ends 20 min after first agent message' },
]

// Custom input bounds (minutes). Backend DTO enforces 60–7200s.
const CUSTOM_MIN_MINUTES = 1
const CUSTOM_MAX_MINUTES = 120

interface SessionDurationSelectionStepProps {
  maxSessionDurationSeconds: number | null
  onMaxSessionDurationSecondsChange: (seconds: number | null) => void
  options?: SessionDurationOption[]
}

export default function SessionDurationSelectionStep({
  maxSessionDurationSeconds,
  onMaxSessionDurationSecondsChange,
  options = DEFAULT_SESSION_DURATION_OPTIONS,
}: SessionDurationSelectionStepProps) {
  const { resolvedTheme } = useThemeStore()
  const isDark = resolvedTheme === 'dark'

  // A non-null value that matches no preset is a custom duration. Seeds the custom
  // UI when editing an existing invite/public config that used a custom value.
  const isCustomValue =
    maxSessionDurationSeconds != null &&
    !options.some((o) => o.value === maxSessionDurationSeconds)
  const [showCustom, setShowCustom] = useState(isCustomValue)
  const [customMinutes, setCustomMinutes] = useState<string>(
    isCustomValue && maxSessionDurationSeconds != null
      ? String(Math.round(maxSessionDurationSeconds / 60))
      : '',
  )

  const selectedClasses = isDark
    ? 'bg-primary-500/20 border-2 border-primary-500'
    : 'bg-neutral-100 border-2 border-neutral-900'
  const unselectedClasses = isDark
    ? 'bg-zinc-700/50 border border-zinc-600 hover:border-zinc-500'
    : 'bg-neutral-50 border border-neutral-200 hover:border-neutral-300'

  const checkBadge = (
    <div className={`w-5 h-5 rounded-full flex items-center justify-center ${isDark ? 'bg-primary-500' : 'bg-neutral-900'}`}>
      <Check className="w-3 h-3 text-white" />
    </div>
  )

  return (
    <div className="space-y-3">
      {options.map((option) => {
        const selected = !showCustom && maxSessionDurationSeconds === option.value
        return (
          <button
            key={option.value ?? 'no-limit'}
            onClick={() => {
              setShowCustom(false)
              onMaxSessionDurationSecondsChange(option.value)
            }}
            className={`w-full p-4 rounded-xl flex items-center justify-between transition-all ${selected ? selectedClasses : unselectedClasses}`}
          >
            <div className="text-left">
              <p className={`text-sm font-medium ${isDark ? 'text-zinc-200' : 'text-neutral-800'}`}>
                {option.label}
              </p>
              <p className={`text-xs ${isDark ? 'text-zinc-400' : 'text-neutral-500'}`}>
                {option.description}
              </p>
            </div>
            {selected && checkBadge}
          </button>
        )
      })}

      {/* Custom duration */}
      <button
        onClick={() => {
          setShowCustom(true)
          // Apply any minutes already typed; otherwise leave the value untouched
          // until the user enters one.
          if (customMinutes !== '') {
            const m = Math.max(CUSTOM_MIN_MINUTES, Math.min(CUSTOM_MAX_MINUTES, Number(customMinutes)))
            onMaxSessionDurationSecondsChange(m * 60)
          }
        }}
        className={`w-full p-4 rounded-xl flex items-center justify-between transition-all ${showCustom ? selectedClasses : unselectedClasses}`}
      >
        <div className="text-left">
          <p className={`text-sm font-medium ${isDark ? 'text-zinc-200' : 'text-neutral-800'}`}>
            Custom
          </p>
          <p className={`text-xs ${isDark ? 'text-zinc-400' : 'text-neutral-500'}`}>
            Set your own limit ({CUSTOM_MIN_MINUTES}–{CUSTOM_MAX_MINUTES} min)
          </p>
        </div>
        {showCustom && checkBadge}
      </button>

      {showCustom && (
        <div className="flex items-center gap-2 pl-4">
          <input
            type="number"
            min={CUSTOM_MIN_MINUTES}
            max={CUSTOM_MAX_MINUTES}
            value={customMinutes}
            onChange={(e) => {
              const raw = e.target.value
              if (raw === '') {
                setCustomMinutes('')
                onMaxSessionDurationSecondsChange(null)
                return
              }
              const m = Math.max(CUSTOM_MIN_MINUTES, Math.min(CUSTOM_MAX_MINUTES, Number(raw)))
              setCustomMinutes(String(m))
              onMaxSessionDurationSecondsChange(m * 60)
            }}
            autoFocus
            className={`w-24 px-2 py-1 rounded-lg text-sm text-center focus:outline-none ${
              isDark
                ? 'bg-zinc-600 border border-zinc-500 text-zinc-100'
                : 'bg-white border border-neutral-300 text-neutral-900'
            }`}
            placeholder="—"
          />
          <span className={`text-sm ${isDark ? 'text-zinc-400' : 'text-neutral-500'}`}>
            minutes
          </span>
        </div>
      )}
    </div>
  )
}
