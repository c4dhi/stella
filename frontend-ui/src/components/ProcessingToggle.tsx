import { useStore } from '../store'
import { useThemeStore } from '../store/themeStore'

export default function ProcessingToggle() {
  const showProcessingMessages = useStore(s => s.showProcessingMessages)
  const setShowProcessingMessages = useStore(s => s.setShowProcessingMessages)
  const processingMessages = useStore(s => s.processingMessages)
  const { resolvedTheme } = useThemeStore()
  const isDark = resolvedTheme === 'dark'

  const currentStreamIds = new Set(
    processingMessages
      .filter(m => Date.now() - m.startedAt < 30000) // Last 30 seconds
      .map(m => m.streamId)
  )

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => setShowProcessingMessages(!showProcessingMessages)}
        className={`h-9 flex items-center gap-1.5 px-4 rounded-lg text-label transition-all duration-200 ${
          showProcessingMessages
            ? 'btn-primary'
            : isDark
              ? 'bg-surface-dark-tertiary text-content-inverse-secondary hover:bg-surface-dark-secondary border border-border-dark'
              : 'bg-surface-secondary text-content-secondary hover:bg-zinc-100 border border-border'
        }`}
      >
        <span className="text-xs">{showProcessingMessages ? '●' : '○'}</span>
        <span>Debug</span>
        {currentStreamIds.size > 0 && (
          <span className="badge-warning ml-1 rounded-full min-w-5 h-5 flex items-center justify-center">
            {currentStreamIds.size}
          </span>
        )}
      </button>
      {processingMessages.length > 0 && showProcessingMessages && (
        <span className={`text-caption ${isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'}`}>
          {processingMessages.length}
        </span>
      )}
    </div>
  )
}
