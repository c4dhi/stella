import { Check } from 'lucide-react'
import { useThemeStore } from '../../store/themeStore'

export interface ExpirationOption {
  value: number | undefined
  label: string
  description: string
}

// Default expiration options - can be overridden via props
export const DEFAULT_EXPIRATION_OPTIONS: ExpirationOption[] = [
  { value: undefined, label: 'Never expires', description: 'Link remains valid indefinitely' },
  { value: 24, label: '24 hours', description: 'Expires in 1 day' },
  { value: 168, label: '1 week', description: 'Expires in 7 days' },
  { value: 720, label: '30 days', description: 'Expires in 1 month' },
  { value: 2160, label: '90 days', description: 'Expires in 3 months' },
]

// Extended options with 1 hour for invitations
export const INVITATION_EXPIRATION_OPTIONS: ExpirationOption[] = [
  { value: undefined, label: 'Never expires', description: 'Link remains valid indefinitely' },
  { value: 1, label: '1 hour', description: 'Expires in 1 hour' },
  { value: 24, label: '24 hours', description: 'Expires in 1 day' },
  { value: 72, label: '3 days', description: 'Expires in 3 days' },
  { value: 168, label: '1 week', description: 'Expires in 7 days' },
]

interface ExpirationSelectionStepProps {
  expiresInHours: number | undefined
  onExpiresInHoursChange: (hours: number | undefined) => void
  options?: ExpirationOption[]
}

export default function ExpirationSelectionStep({
  expiresInHours,
  onExpiresInHoursChange,
  options = DEFAULT_EXPIRATION_OPTIONS,
}: ExpirationSelectionStepProps) {
  const { resolvedTheme } = useThemeStore()
  const isDark = resolvedTheme === 'dark'

  return (
    <div className="space-y-3">
      {options.map((option) => (
        <button
          key={option.value ?? 'never'}
          onClick={() => onExpiresInHoursChange(option.value)}
          className={`
            w-full p-4 rounded-xl flex items-center justify-between transition-all
            ${expiresInHours === option.value
              ? isDark
                ? 'bg-primary-500/20 border-2 border-primary-500'
                : 'bg-primary-50 border-2 border-primary-500'
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
          {expiresInHours === option.value && (
            <div className="w-5 h-5 rounded-full bg-primary-500 flex items-center justify-center">
              <Check className="w-3 h-3 text-white" />
            </div>
          )}
        </button>
      ))}
    </div>
  )
}
