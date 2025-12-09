import { useNavigate } from 'react-router-dom'
import { useThemeStore } from '../../store/themeStore'
import ProfileButton from './ProfileButton'

interface AppHeaderProps {
  showBackButton?: boolean
  backPath?: string
  backLabel?: string
}

export default function AppHeader({
  showBackButton = false,
  backPath,
  backLabel = 'Back',
}: AppHeaderProps) {
  const navigate = useNavigate()
  const { resolvedTheme } = useThemeStore()
  const isDark = resolvedTheme === 'dark'

  return (
    <header className={`sticky top-0 z-40 border-b transition-colors duration-200 ${
      isDark ? 'bg-surface-dark/95 border-border-dark' : 'bg-white/95 border-border'
    } backdrop-blur-sm`}>
      <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between">
        {/* Left side */}
        <div className="flex items-center gap-4">
          {showBackButton && backPath && (
            <button
              onClick={() => navigate(backPath)}
              className={`flex items-center gap-1 text-body-sm transition-colors ${
                isDark
                  ? 'text-content-inverse-secondary hover:text-content-inverse'
                  : 'text-content-secondary hover:text-content'
              }`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M15 18l-6-6 6-6" />
              </svg>
              {backLabel}
            </button>
          )}

          <h1 className={`text-heading-sm font-semibold tracking-tight ${
            isDark ? 'text-content-inverse' : 'text-content'
          }`}>
            STELLA
          </h1>
        </div>

        {/* Right side */}
        <div className="flex items-center gap-1">
          <ProfileButton />
        </div>
      </div>
    </header>
  )
}
