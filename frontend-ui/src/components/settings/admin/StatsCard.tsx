import { motion } from 'framer-motion'
import { useThemeStore } from '../../../store/themeStore'

interface StatsCardProps {
  title: string
  value: number
  suffix?: string
  subtitle?: string
  icon: React.ReactNode
  trend?: {
    value: number
    label: string
  }
  color?: 'blue' | 'green' | 'purple' | 'orange' | 'yellow' | 'gray' | 'cyan'
}

const colorClasses = {
  blue: {
    light: 'from-blue-500/20 to-blue-500/5 text-blue-600',
    dark: 'from-blue-500/30 to-blue-500/10 text-blue-400',
    icon: 'text-blue-500',
  },
  green: {
    light: 'from-green-500/20 to-green-500/5 text-green-600',
    dark: 'from-green-500/30 to-green-500/10 text-green-400',
    icon: 'text-green-500',
  },
  purple: {
    light: 'from-purple-500/20 to-purple-500/5 text-purple-600',
    dark: 'from-purple-500/30 to-purple-500/10 text-purple-400',
    icon: 'text-purple-500',
  },
  orange: {
    light: 'from-orange-500/20 to-orange-500/5 text-orange-600',
    dark: 'from-orange-500/30 to-orange-500/10 text-orange-400',
    icon: 'text-orange-500',
  },
  yellow: {
    light: 'from-yellow-500/20 to-yellow-500/5 text-yellow-600',
    dark: 'from-yellow-500/30 to-yellow-500/10 text-yellow-400',
    icon: 'text-yellow-400',
  },
  gray: {
    light: 'from-neutral-400/20 to-neutral-400/5 text-neutral-600',
    dark: 'from-neutral-400/30 to-neutral-400/10 text-neutral-300',
    icon: 'text-neutral-400',
  },
  cyan: {
    light: 'from-cyan-500/20 to-cyan-500/5 text-cyan-600',
    dark: 'from-cyan-500/30 to-cyan-500/10 text-cyan-400',
    icon: 'text-cyan-400',
  },
}

export default function StatsCard({
  title,
  value,
  suffix,
  subtitle,
  icon,
  trend,
  color = 'blue',
}: StatsCardProps) {
  const { resolvedTheme } = useThemeStore()
  const isDark = resolvedTheme === 'dark'
  const colors = colorClasses[color]

  return (
    <motion.div
      className={`p-5 rounded-2xl ${
        isDark ? 'bg-surface-dark-secondary' : 'bg-white border border-neutral-200/60'
      }`}
      whileHover={{ scale: 1.02 }}
      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
    >
      <div className="flex items-start justify-between mb-3">
        <div
          className={`w-10 h-10 rounded-xl flex items-center justify-center bg-gradient-to-br ${
            isDark ? colors.dark : colors.light
          }`}
        >
          <span className={colors.icon}>{icon}</span>
        </div>
        {trend && (
          <span
            className={`text-caption font-medium px-2 py-0.5 rounded-full ${
              trend.value >= 0
                ? isDark
                  ? 'bg-green-500/20 text-green-400'
                  : 'bg-green-50 text-green-600'
                : isDark
                  ? 'bg-red-500/20 text-red-400'
                  : 'bg-red-50 text-red-600'
            }`}
          >
            {trend.value >= 0 ? '+' : ''}
            {trend.value} {trend.label}
          </span>
        )}
      </div>

      <motion.div
        className={`text-3xl font-bold mb-1 ${
          isDark ? 'text-content-inverse' : 'text-content'
        }`}
        key={value}
        initial={{ scale: 1.1, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      >
        {value.toLocaleString()}
        {suffix && <span className="text-xl font-semibold ml-1">{suffix}</span>}
      </motion.div>

      <div
        className={`text-body-sm ${
          isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'
        }`}
      >
        {title}
        {subtitle && (
          <span
            className={`ml-2 ${
              isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'
            }`}
          >
            {subtitle}
          </span>
        )}
      </div>
    </motion.div>
  )
}
