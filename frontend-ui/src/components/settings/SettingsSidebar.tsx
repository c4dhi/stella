import { motion } from 'framer-motion'
import { useThemeStore } from '../../store/themeStore'
import { useNotificationStore } from '../../store/notificationStore'

export type SettingsSection = 'profile' | 'preferences' | 'plan-builder' | 'env-vars' | 'inbox'

interface SettingsSidebarProps {
  activeSection: SettingsSection
  onSectionChange: (section: SettingsSection) => void
}

const sections: { id: SettingsSection; label: string; icon: React.ReactNode; description: string; hasBadge?: boolean }[] = [
  {
    id: 'profile',
    label: 'Profile',
    description: 'Your account details',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    ),
  },
  {
    id: 'inbox',
    label: 'Inbox',
    description: 'Messages & invitations',
    hasBadge: true,
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
        <polyline points="22,6 12,13 2,6" />
      </svg>
    ),
  },
  {
    id: 'preferences',
    label: 'Preferences',
    description: 'Theme & display',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="12" cy="12" r="3" />
        <path d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72l1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
      </svg>
    ),
  },
  {
    id: 'plan-builder',
    label: 'Plan Builder',
    description: 'Create agent plans',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <polygon points="12 2 2 7 12 12 22 7 12 2" />
        <polyline points="2 17 12 22 22 17" />
        <polyline points="2 12 12 17 22 12" />
      </svg>
    ),
  },
  {
    id: 'env-vars',
    label: 'Environment Variables',
    description: 'Secure secrets & keys',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
    ),
  },
]

export default function SettingsSidebar({ activeSection, onSectionChange }: SettingsSidebarProps) {
  const { resolvedTheme } = useThemeStore()
  const isDark = resolvedTheme === 'dark'
  const { unreadCount } = useNotificationStore()

  return (
    <motion.aside
      className={`w-72 border-r flex flex-col ${
        isDark ? 'border-border-dark bg-surface-dark' : 'border-border bg-surface'
      }`}
      initial={{ x: -20, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
    >
      {/* Header */}
      <div className={`px-6 py-5 border-b ${isDark ? 'border-border-dark' : 'border-border'}`}>
        <motion.h1
          className={`text-heading-lg font-semibold ${
            isDark ? 'text-content-inverse' : 'text-content'
          }`}
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          Settings
        </motion.h1>
        <motion.p
          className={`text-body-sm mt-1 ${
            isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'
          }`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
        >
          Manage your account and preferences
        </motion.p>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-1">
        {sections.map((section, index) => {
          const isActive = activeSection === section.id
          return (
            <motion.button
              key={section.id}
              onClick={() => onSectionChange(section.id)}
              className={`w-full flex items-center gap-4 px-4 py-3.5 rounded-xl text-left transition-all duration-200 relative overflow-hidden ${
                isActive
                  ? isDark
                    ? ''
                    : ''
                  : isDark
                    ? 'hover:bg-surface-dark-secondary'
                    : 'hover:bg-surface-secondary'
              }`}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.1 + index * 0.05 }}
              whileHover={{ scale: isActive ? 1 : 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              {/* Active Background */}
              {isActive && (
                <motion.div
                  className={`absolute inset-0 rounded-xl ${
                    isDark ? 'bg-surface-dark-secondary' : 'bg-white border border-neutral-200'
                  }`}
                  layoutId="activeSection"
                  transition={{ type: 'spring', bounce: 0.2, duration: 0.5 }}
                />
              )}

              {/* Icon */}
              <span className={`relative z-10 ${
                isActive
                  ? isDark
                    ? 'text-primary'
                    : 'text-neutral-900'
                  : isDark
                    ? 'text-neutral-400'
                    : 'text-neutral-500'
              }`}>
                {section.icon}
              </span>

              {/* Text */}
              <div className="relative z-10 flex-1 min-w-0">
                <div className={`text-body-sm font-semibold flex items-center gap-2 ${
                  isActive
                    ? isDark
                      ? 'text-primary'
                      : 'text-neutral-900'
                    : isDark
                      ? 'text-neutral-400'
                      : 'text-neutral-600'
                }`}>
                  {section.label}
                  {/* Unread badge for inbox */}
                  {section.hasBadge && unreadCount > 0 && (
                    <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-red-500 text-white min-w-[18px] text-center">
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  )}
                </div>
                <div className={`text-caption truncate ${
                  isActive
                    ? isDark
                      ? 'text-primary/60'
                      : 'text-neutral-600'
                    : isDark
                      ? 'text-neutral-500'
                      : 'text-neutral-400'
                }`}>
                  {section.description}
                </div>
              </div>

              {/* Arrow indicator */}
              <motion.svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                className={`relative z-10 ${
                  isActive
                    ? isDark
                      ? 'text-primary/60'
                      : 'text-neutral-600'
                    : isDark
                      ? 'text-neutral-500'
                      : 'text-neutral-400'
                }`}
                initial={{ opacity: 0, x: -5 }}
                animate={{ opacity: isActive ? 1 : 0, x: isActive ? 0 : -5 }}
                transition={{ duration: 0.2 }}
              >
                <path d="M9 18l6-6-6-6" />
              </motion.svg>
            </motion.button>
          )
        })}
      </nav>

      {/* Footer */}
      <motion.div
        className={`px-6 py-4 border-t ${isDark ? 'border-border-dark' : 'border-border'}`}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
      >
        <div className={`text-caption ${
          isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'
        }`}>
          STELLA v1.0
        </div>
      </motion.div>
    </motion.aside>
  )
}
