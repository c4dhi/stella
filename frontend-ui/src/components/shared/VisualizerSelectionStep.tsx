import { motion } from 'framer-motion'
import { useThemeStore } from '../../store/themeStore'
import { VISUALIZER_CONFIGS, type VisualizerType } from '../face/types'
import VisualizerPreview from '../face/VisualizerPreview'

interface VisualizerSelectionStepProps {
  visualizerType: VisualizerType | undefined
  visualizerLocked: boolean
  onVisualizerTypeChange: (type: VisualizerType | undefined) => void
  onVisualizerLockedChange: (locked: boolean) => void
}

export default function VisualizerSelectionStep({
  visualizerType,
  visualizerLocked,
  onVisualizerTypeChange,
  onVisualizerLockedChange,
}: VisualizerSelectionStepProps) {
  const { resolvedTheme } = useThemeStore()
  const isDark = resolvedTheme === 'dark'

  return (
    <div>
      <div className="grid grid-cols-4 gap-3">
        {/* Let them choose option */}
        <button
          onClick={() => {
            onVisualizerTypeChange(undefined)
            onVisualizerLockedChange(false)
          }}
          className={`
            p-4 rounded-xl flex flex-col items-center gap-2 transition-all
            ${!visualizerType
              ? isDark
                ? 'bg-primary-500/20 border-2 border-primary-500'
                : 'bg-neutral-100 border-2 border-neutral-900'
              : isDark
                ? 'bg-zinc-700/50 border border-zinc-600 hover:border-zinc-500'
                : 'bg-neutral-50 border border-neutral-200 hover:border-neutral-300'
            }
          `}
        >
          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${isDark ? 'bg-zinc-600' : 'bg-neutral-200'}`}>
            <span className="text-xl">🎨</span>
          </div>
          <span className={`text-xs font-light ${isDark ? 'text-zinc-300' : 'text-neutral-600'}`}>
            Their choice
          </span>
        </button>

        {/* Visualizer options */}
        {VISUALIZER_CONFIGS.map((config) => (
          <button
            key={config.id}
            onClick={() => onVisualizerTypeChange(config.id)}
            className={`
              p-4 rounded-xl flex flex-col items-center gap-2 transition-all
              ${visualizerType === config.id
                ? isDark
                  ? 'bg-primary-500/20 border-2 border-primary-500'
                  : 'bg-neutral-100 border-2 border-neutral-900'
                : isDark
                  ? 'bg-zinc-700/50 border border-zinc-600 hover:border-zinc-500'
                  : 'bg-neutral-50 border border-neutral-200 hover:border-neutral-300'
              }
            `}
          >
            <div className={`relative w-10 h-10 rounded-full flex items-center justify-center overflow-hidden ${config.previewBg}`}>
              <VisualizerPreview type={config.id} size="sm" />
            </div>
            <span className={`text-xs font-light ${isDark ? 'text-zinc-300' : 'text-neutral-600'}`}>
              {config.name}
            </span>
          </button>
        ))}
      </div>

      {/* Lock option */}
      {visualizerType && (
        <label className={`flex items-center gap-3 p-4 rounded-xl cursor-pointer mt-4 ${isDark ? 'bg-zinc-700/50' : 'bg-neutral-50'}`}>
          <input
            type="checkbox"
            checked={visualizerLocked}
            onChange={(e) => onVisualizerLockedChange(e.target.checked)}
            className="sr-only"
          />
          <div className={`
            w-10 h-6 rounded-full p-0.5 transition-colors
            ${visualizerLocked
              ? isDark ? 'bg-primary-500' : 'bg-neutral-900'
              : isDark ? 'bg-zinc-600' : 'bg-neutral-300'
            }
          `}>
            <motion.div
              className="w-5 h-5 rounded-full bg-white shadow"
              animate={{ x: visualizerLocked ? 16 : 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            />
          </div>
          <div>
            <p className={`text-sm ${isDark ? 'text-zinc-200' : 'text-neutral-700'}`}>Lock visualizer</p>
            <p className={`text-xs ${isDark ? 'text-zinc-400' : 'text-neutral-500'}`}>
              Participant won't be able to change it
            </p>
          </div>
        </label>
      )}
    </div>
  )
}
