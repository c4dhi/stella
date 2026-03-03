import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useThemeStore } from '../../store/themeStore'
import type { PipelineThreshold, AgentConfigurationPayload } from '../../lib/api-types'

interface ThresholdsPanelProps {
  thresholds: PipelineThreshold[]
  configuration: AgentConfigurationPayload
  onChange: (config: AgentConfigurationPayload) => void
}

export default function ThresholdsPanel({ thresholds, configuration, onChange }: ThresholdsPanelProps) {
  const { resolvedTheme } = useThemeStore()
  const isDark = resolvedTheme === 'dark'
  const configThresholds = (configuration.thresholds || {}) as Record<string, unknown>
  const [isExpanded, setIsExpanded] = useState(false)

  const modifiedCount = Object.keys(configThresholds).length

  const updateThreshold = (id: string, value: unknown) => {
    const updated = { ...configThresholds }
    if (value === undefined) {
      delete updated[id]
    } else {
      updated[id] = value
    }
    onChange({
      ...configuration,
      thresholds: Object.keys(updated).length > 0 ? updated : undefined,
    })
  }

  if (!thresholds.length) return null

  return (
    <div className={`border-t shrink-0 ${isDark ? 'border-zinc-700/80' : 'border-neutral-200'}`}>
      {/* Collapsible header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={`w-full px-5 py-2.5 flex items-center justify-between text-left transition-colors ${
          isDark ? 'hover:bg-zinc-800/50' : 'hover:bg-neutral-50/50'
        }`}
      >
        <div className="flex items-center gap-2">
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className={`transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''} ${isDark ? 'text-zinc-500' : 'text-neutral-400'}`}
          >
            <path d="M9 18l6-6-6-6" />
          </svg>
          <span className={`text-xs font-medium tracking-wide ${isDark ? 'text-zinc-400' : 'text-neutral-500'}`}>
            Global Thresholds
          </span>
          {modifiedCount > 0 && (
            <span className="px-1.5 py-0.5 text-[9px] rounded bg-amber-500/20 text-amber-500 font-medium">
              {modifiedCount} modified
            </span>
          )}
        </div>
        <div className={`flex items-center gap-3 text-[10px] font-mono ${isDark ? 'text-zinc-600' : 'text-neutral-400'}`}>
          {thresholds.slice(0, 4).map((t) => {
            const val = configThresholds[t.id] as number | undefined
            const isModified = val !== undefined
            return (
              <span key={t.id} className={isModified ? 'text-amber-500' : ''}>
                {t.label.split(' ').map(w => w[0]).join('')}: {val ?? t.default ?? 0}
              </span>
            )
          })}
        </div>
      </button>

      {/* Expandable content */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-3 grid grid-cols-4 gap-4">
              {thresholds.map((t) => {
                const currentValue = configThresholds[t.id] as number | undefined
                const isModified = currentValue !== undefined

                return (
                  <div key={t.id} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <label className={`text-[10px] font-medium ${isDark ? 'text-zinc-400' : 'text-neutral-500'}`}>
                        {t.label}
                        {isModified && (
                          <span className="ml-1.5 px-1 py-0.5 text-[9px] rounded bg-amber-500/20 text-amber-500 font-medium">
                            Modified
                          </span>
                        )}
                      </label>
                      {isModified && (
                        <button
                          onClick={() => updateThreshold(t.id, undefined)}
                          className={`text-[9px] font-medium px-1.5 py-0.5 rounded transition-colors ${
                            isDark ? 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700' : 'text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100'
                          }`}
                        >
                          Reset
                        </button>
                      )}
                    </div>
                    {t.description && (
                      <p className={`text-[10px] font-light line-clamp-1 ${isDark ? 'text-zinc-600' : 'text-neutral-400'}`}>
                        {t.description}
                      </p>
                    )}
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min={t.min ?? 0}
                        max={t.max ?? 100}
                        step={t.step ?? 1}
                        value={currentValue ?? t.default ?? 0}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value)
                          updateThreshold(t.id, val === t.default ? undefined : val)
                        }}
                        className="flex-1 h-1.5 accent-primary-500"
                      />
                      <span className={`text-xs font-mono w-10 text-right tabular-nums ${
                        isModified
                          ? 'text-amber-500'
                          : isDark ? 'text-zinc-300' : 'text-neutral-700'
                      }`}>
                        {currentValue ?? t.default ?? 0}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
