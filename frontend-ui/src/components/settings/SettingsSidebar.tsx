import { motion } from 'framer-motion'
import { useThemeStore } from '../../store/themeStore'

export type SettingsSection = 'profile' | 'preferences' | 'plan-builder'

interface SettingsSidebarProps {
  activeSection: SettingsSection
  onSectionChange: (section: SettingsSection) => void
}

const sections: { id: SettingsSection; label: string; icon: React.ReactNode; description: string }[] = [
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
]

export default function SettingsSidebar({ activeSection, onSectionChange }: SettingsSidebarProps) {
  const { resolvedTheme } = useThemeStore()
  const isDark = resolvedTheme === 'dark'

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
                    isDark ? 'bg-surface-dark-secondary' : 'bg-surface-secondary'
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
                    : 'text-black'
                  : isDark
                    ? 'text-neutral-500'
                    : 'text-neutral-400'
              }`}>
                {section.icon}
              </span>

              {/* Text */}
              <div className="relative z-10 flex-1 min-w-0">
                <div className={`text-body-sm font-semibold ${
                  isActive
                    ? isDark
                      ? 'text-primary'
                      : 'text-black'
                    : isDark
                      ? 'text-neutral-500'
                      : 'text-neutral-400'
                }`}>
                  {section.label}
                </div>
                <div className={`text-caption truncate ${
                  isActive
                    ? isDark
                      ? 'text-primary/60'
                      : 'text-neutral-600'
                    : isDark
                      ? 'text-neutral-600'
                      : 'text-neutral-400/80'
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
                      ? 'text-neutral-600'
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
