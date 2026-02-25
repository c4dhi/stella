import { motion } from 'framer-motion'
import { useThemeStore, type Theme } from '../../store/themeStore'

const containerVariants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.1
    }
  }
}

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.4,
      ease: [0.25, 0.46, 0.45, 0.94] as const
    }
  }
}

export default function PreferencesSection() {
  const { theme, setTheme, resolvedTheme } = useThemeStore()
  const isDark = resolvedTheme === 'dark'

  const themeOptions: { value: Theme; label: string; description: string; icon: React.ReactNode }[] = [
    {
      value: 'light',
      label: 'Light',
      description: 'Always use light theme',
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="12" cy="12" r="5" />
          <line x1="12" y1="1" x2="12" y2="3" />
          <line x1="12" y1="21" x2="12" y2="23" />
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
          <line x1="1" y1="12" x2="3" y2="12" />
          <line x1="21" y1="12" x2="23" y2="12" />
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
        </svg>
      ),
    },
    {
      value: 'dark',
      label: 'Dark',
      description: 'Always use dark theme',
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      ),
    },
    {
      value: 'system',
      label: 'System',
      description: 'Follow system preference',
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
          <line x1="8" y1="21" x2="16" y2="21" />
          <line x1="12" y1="17" x2="12" y2="21" />
        </svg>
      ),
    },
  ]

  return (
    <motion.div
      className="max-w-2xl"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      <motion.h2
        className={`text-heading-lg mb-6 ${
          isDark ? 'text-content-inverse' : 'text-content'
        }`}
        variants={itemVariants}
      >
        Preferences
      </motion.h2>

      {/* Theme Selection */}
      <motion.div
        className={`p-6 rounded-2xl ${
          isDark ? 'bg-surface-dark-secondary' : 'bg-white border border-neutral-200/60'
        }`}
        variants={itemVariants}
      >
        <h3 className={`text-heading-sm font-semibold mb-2 ${
          isDark ? 'text-content-inverse' : 'text-content'
        }`}>
          Appearance
        </h3>
        <p className={`text-body-sm mb-6 ${
          isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'
        }`}>
          Choose how STELLA looks to you
        </p>

        <div className="grid grid-cols-3 gap-4">
          {themeOptions.map((option, index) => {
            const isSelected = theme === option.value
            return (
              <motion.button
                key={option.value}
                onClick={() => setTheme(option.value)}
                className={`relative p-5 rounded-2xl text-left transition-all duration-300 overflow-hidden ${
                  isSelected
                    ? isDark
                      ? 'ring-2 ring-primary ring-offset-2 ring-offset-surface-dark-secondary'
                      : 'ring-2 ring-primary ring-offset-2 ring-offset-surface-secondary'
                    : isDark
                      ? 'hover:bg-surface-dark-tertiary'
                      : 'hover:bg-surface-tertiary'
                }`}
                whileHover={{ scale: 1.02, y: -2 }}
                whileTap={{ scale: 0.98 }}
              >
                {/* Background */}
                <motion.div
                  className={`absolute inset-0 rounded-2xl ${
                    isSelected
                      ? isDark
                        ? 'bg-primary/10'
                        : 'bg-primary/5'
                      : isDark
                        ? 'bg-surface-dark-tertiary'
                        : 'bg-white'
                  }`}
                  initial={false}
                  animate={{
                    opacity: isSelected ? 1 : 0.5
                  }}
                  transition={{ duration: 0.2 }}
                />

                {/* Theme Preview */}
                <motion.div
                  className={`relative w-full aspect-[4/3] rounded-xl mb-4 flex items-center justify-center overflow-hidden ${
                    option.value === 'dark'
                      ? 'bg-neutral-900'
                      : option.value === 'light'
                        ? 'bg-white border border-neutral-200'
                        : 'bg-gradient-to-r from-white to-neutral-900'
                  }`}
                  whileHover={{ scale: 1.02 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                >
                  {/* Preview content - mini UI mockup */}
                  <div className={`absolute inset-2 rounded-lg ${
                    option.value === 'dark' ? 'bg-neutral-800' : option.value === 'light' ? 'bg-neutral-100' : ''
                  }`}>
                    {option.value !== 'system' && (
                      <>
                        <div className={`h-2 w-8 rounded-full m-2 ${
                          option.value === 'dark' ? 'bg-neutral-600' : 'bg-neutral-300'
                        }`} />
                        <div className={`h-1.5 w-12 rounded-full mx-2 mb-1 ${
                          option.value === 'dark' ? 'bg-neutral-700' : 'bg-neutral-200'
                        }`} />
                        <div className={`h-1.5 w-10 rounded-full mx-2 ${
                          option.value === 'dark' ? 'bg-neutral-700' : 'bg-neutral-200'
                        }`} />
                      </>
                    )}
                  </div>

                  {/* Center icon */}
                  <span className={`relative z-10 ${
                    option.value === 'dark'
                      ? 'text-neutral-400'
                      : option.value === 'light'
                        ? 'text-neutral-500'
                        : 'text-neutral-500'
                  }`}>
                    {option.icon}
                  </span>
                </motion.div>

                {/* Label */}
                <div className="relative">
                  <div className={`text-body-sm font-semibold mb-0.5 ${
                    isSelected
                      ? 'text-primary'
                      : isDark
                        ? 'text-content-inverse'
                        : 'text-content'
                  }`}>
                    {option.label}
                  </div>
                  <div className={`text-caption ${
                    isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'
                  }`}>
                    {option.description}
                  </div>
                </div>

                {/* Selected indicator */}
                {isSelected && (
                  <motion.div
                    className="absolute top-3 right-3"
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 25 }}
                  >
                    <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                    </div>
                  </motion.div>
                )}
              </motion.button>
            )
          })}
        </div>

        {/* Current theme indicator */}
        <div
          className={`mt-6 pt-6 border-t flex items-center justify-between ${
            isDark ? 'border-border-dark/50' : 'border-border/50'
          }`}
        >
          <span className={`text-body-sm ${
            isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'
          }`}>
            Current appearance
          </span>
          <span className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-caption font-medium ${
            isDark
              ? 'bg-surface-dark-tertiary text-content-inverse'
              : 'bg-white text-content'
          }`}>
            <span className={`w-2 h-2 rounded-full ${
              resolvedTheme === 'dark' ? 'bg-indigo-400' : 'bg-yellow-400'
            }`} />
            {resolvedTheme === 'dark' ? 'Dark' : 'Light'} mode
          </span>
        </div>
      </motion.div>
    </motion.div>
  )
}
