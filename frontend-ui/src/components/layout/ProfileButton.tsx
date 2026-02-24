import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../store/authStore'
import { useThemeStore } from '../../store/themeStore'
import { useNotificationStore } from '../../store/notificationStore'

export default function ProfileButton() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const { resolvedTheme } = useThemeStore()
  const isDark = resolvedTheme === 'dark'
  const { unreadCount } = useNotificationStore()

  const displayName = user?.name || user?.email?.split('@')[0] || 'User'
  const initials = displayName
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)

  return (
    <button
      onClick={() => navigate('/settings')}
      className={`relative flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors ${
        isDark
          ? 'hover:bg-surface-dark-secondary text-content-inverse'
          : 'hover:bg-surface-secondary text-content'
      }`}
      title="Settings"
    >
      {/* Avatar */}
      <div className={`relative w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium ${
        isDark
          ? 'bg-primary/20 text-primary'
          : 'bg-primary/10 text-primary'
      }`}>
        {initials}
        {/* Notification badge */}
        {unreadCount > 0 && (
          <div className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse" />
        )}
      </div>

      {/* Name */}
      <span className={`text-body-sm hidden sm:block ${
        isDark ? 'text-content-inverse' : 'text-content'
      }`}>
        {displayName}
      </span>

      {/* Chevron */}
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        className={`hidden sm:block ${
          isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'
        }`}
      >
        <path d="M9 18l6-6-6-6" />
      </svg>
    </button>
  )
}
