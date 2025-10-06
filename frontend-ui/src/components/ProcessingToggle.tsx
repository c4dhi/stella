import { useStore } from '../store'

export default function ProcessingToggle() {
  const showProcessingMessages = useStore(s => s.showProcessingMessages)
  const setShowProcessingMessages = useStore(s => s.setShowProcessingMessages)
  const processingMessages = useStore(s => s.processingMessages)

  const currentStreamIds = new Set(
    processingMessages
      .filter(m => Date.now() - m.startedAt < 30000) // Last 30 seconds
      .map(m => m.streamId)
  )

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => setShowProcessingMessages(!showProcessingMessages)}
        className={`h-9 flex items-center gap-1.5 px-4 rounded-lg text-xs font-light transition-all duration-300 ${showProcessingMessages
          ? 'bg-neutral-900 text-white'
          : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
          }`}
      >
        <span className="text-xs">{showProcessingMessages ? '●' : '○'}</span>
        <span>Debug</span>
        {currentStreamIds.size > 0 && (
          <span className="bg-orange-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-medium">
            {currentStreamIds.size}
          </span>
        )}
      </button>
      {processingMessages.length > 0 && showProcessingMessages && (
        <span className="text-xs text-neutral-400 font-light">
          {processingMessages.length}
        </span>
      )}
    </div>
  )
}