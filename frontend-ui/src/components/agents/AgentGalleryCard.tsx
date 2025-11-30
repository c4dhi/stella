import { motion } from 'framer-motion'
import { useThemeStore } from '../../store/themeStore'
import type { AgentType } from '../../lib/api-types'

interface AgentGalleryCardProps {
  agentType: AgentType
  isSelected: boolean
  onClick: () => void
}

export default function AgentGalleryCard({
  agentType,
  isSelected,
  onClick,
}: AgentGalleryCardProps) {
  const { resolvedTheme } = useThemeStore()
  const isDark = resolvedTheme === 'dark'

  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileHover={{ scale: 1.01 }}
      whileTap={{ scale: 0.99 }}
      className={`
        relative w-full h-[160px] p-3 rounded-xl text-left transition-all duration-200 border-2
        ${isSelected
          ? isDark
            ? 'bg-primary-500/20 border-primary-500 shadow-lg shadow-primary-500/20'
            : 'bg-primary-50 border-primary-500 shadow-lg shadow-primary-500/10'
          : isDark
            ? 'bg-zinc-800/50 border-zinc-700/50 hover:bg-zinc-700/50 hover:border-zinc-600'
            : 'bg-white border-neutral-200/60 hover:bg-neutral-50 hover:border-neutral-300 shadow-sm'
        }
      `}
    >
      {/* Selection indicator */}
      {isSelected && (
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          className={`
            absolute top-2 right-2 w-4 h-4 rounded-full flex items-center justify-center
            ${isDark ? 'bg-primary-500' : 'bg-primary-500'}
          `}
        >
          <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
            <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </motion.div>
      )}

      {/* Icon */}
      <div
        className={`
          w-10 h-10 rounded-lg flex items-center justify-center text-2xl mb-2
          ${isDark
            ? 'bg-zinc-700/50'
            : 'bg-neutral-100'
          }
        `}
      >
        {agentType.icon || '🤖'}
      </div>

      {/* Name */}
      <h3
        className={`
          text-sm font-medium mb-0.5
          ${isSelected
            ? isDark ? 'text-primary-300' : 'text-primary-700'
            : isDark ? 'text-zinc-100' : 'text-neutral-900'
          }
        `}
      >
        {agentType.name}
      </h3>

      {/* Description */}
      <p
        className={`
          text-xs font-light leading-relaxed line-clamp-2 pr-8
          ${isDark ? 'text-zinc-400' : 'text-neutral-500'}
        `}
      >
        {agentType.description}
      </p>

      {/* Capabilities badges */}
      {agentType.capabilities && agentType.capabilities.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {agentType.capabilities.slice(0, 3).map((cap) => (
            <span
              key={cap}
              className={`
                px-1.5 py-0.5 rounded text-[10px] font-light
                ${isDark
                  ? 'bg-zinc-700/50 text-zinc-400'
                  : 'bg-neutral-100 text-neutral-500'
                }
              `}
            >
              {cap}
            </span>
          ))}
          {agentType.capabilities.length > 3 && (
            <span
              className={`
                px-1.5 py-0.5 text-[10px] font-light
                ${isDark ? 'text-zinc-500' : 'text-neutral-400'}
              `}
            >
              +{agentType.capabilities.length - 3}
            </span>
          )}
        </div>
      )}

      {/* Version badge */}
      <div
        className={`
          absolute bottom-2 right-2 text-[10px] font-light
          ${isDark ? 'text-zinc-500' : 'text-neutral-400'}
        `}
      >
        v{agentType.version}
      </div>
    </motion.button>
  )
}
