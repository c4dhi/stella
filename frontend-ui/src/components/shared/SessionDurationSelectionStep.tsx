import { Check } from 'lucide-react'
import { useThemeStore } from '../../store/themeStore'

export interface SessionDurationOption {
  value: number | null
  label: string
  description: string
}

// Values are in seconds; `null` = no limit.
// Cap is 7200s (2h) — enforced in the backend DTO.
export const DEFAULT_SESSION_DURATION_OPTIONS: SessionDurationOption[] = [
  { value: null, label: 'No limit', description: 'Session runs until ended manually' },
  { value: 5 * 60, label: '5 minutes', description: 'Ends 5 min after first agent message' },
  { value: 7 * 60, label: '7 minutes', description: 'Ends 7 min after first agent message' },
  { value: 10 * 60, label: '10 minutes', description: 'Ends 10 min after first agent message' },
  { value: 15 * 60, label: '15 minutes', description: 'Ends 15 min after first agent message' },
  { value: 30 * 60, label: '30 minutes', description: 'Ends 30 min after first agent message' },
  { value: 60 * 60, label: '1 hour', description: 'Ends 1 hour after first agent message' },
  { value: 120 * 60, label: '2 hours', description: 'Ends 2 hours after first agent message' },
]

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

  return (
    <div className="space-y-3">
      {options.map((option) => (
        <button
          key={option.value ?? 'no-limit'}
          onClick={() => onMaxSessionDurationSecondsChange(option.value)}
          className={`
            w-full p-4 rounded-xl flex items-center justify-between transition-all
            ${maxSessionDurationSeconds === option.value
              ? isDark
                ? 'bg-primary-500/20 border-2 border-primary-500'
                : 'bg-neutral-100 border-2 border-neutral-900'
              : isDark
                ? 'bg-zinc-700/50 border border-zinc-600 hover:border-zinc-500'
                : 'bg-neutral-50 border border-neutral-200 hover:border-neutral-300'
            }
          `}
        >
          <div className="text-left">
            <p className={`text-sm font-medium ${isDark ? 'text-zinc-200' : 'text-neutral-800'}`}>
              {option.label}
            </p>
            <p className={`text-xs ${isDark ? 'text-zinc-400' : 'text-neutral-500'}`}>
              {option.description}
            </p>
          </div>
          {maxSessionDurationSeconds === option.value && (
            <div className={`w-5 h-5 rounded-full flex items-center justify-center ${isDark ? 'bg-primary-500' : 'bg-neutral-900'}`}>
              <Check className="w-3 h-3 text-white" />
            </div>
          )}
        </button>
      ))}
    </div>
  )
}
