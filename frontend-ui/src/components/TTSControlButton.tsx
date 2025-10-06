import { useStore } from '../store'
import { PeerTransport } from '../services/PeerTransport'

export default function TTSControlButton() {
  const status = useStore(s => s.status)
  const isTTSPlaying = useStore(s => s.isTTSPlaying)
  const isTTSPaused = useStore(s => s.isTTSPaused)
  const setTTSPaused = useStore(s => s.setTTSPaused)
  const transport = useStore(s => s.transport)

  // Always show the TTS control button when connected

  const handleClick = () => {
    if (status !== 'connected' || !transport) return

    const peerTransport = transport as PeerTransport

    if (isTTSPaused) {
      // Resume streaming playback
      peerTransport.resumeTTSPlayback()
      setTTSPaused(false)
    } else {
      // Pause streaming playback
      peerTransport.pauseTTSPlayback()
      setTTSPaused(true)
    }
  }

  const isDisabled = status !== 'connected'

  return (
    <button
      onClick={handleClick}
      disabled={isDisabled}
      className={`w-9 h-9 flex justify-center items-center p-2 rounded-lg transition-all duration-300 ${isDisabled
        ? 'bg-neutral-100/60 text-neutral-300 cursor-not-allowed'
        : isTTSPaused
          ? 'bg-green-500/10 text-green-600 hover:bg-green-500/20'
          : isTTSPlaying
            ? 'bg-neutral-300 text-neutral-700 hover:bg-neutral-400'
            : 'bg-neutral-200 text-neutral-500 hover:bg-neutral-300'
        }`}
      title={
        isDisabled
          ? 'Connect to enable TTS controls'
          : isTTSPaused
            ? 'Resume narration'
            : isTTSPlaying
              ? 'Pause narration'
              : 'TTS controls (ready)'
      }
    >
      {isTTSPaused ? (
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <path d="M8 5v14l11-7z" />
        </svg>
      ) : (
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
        </svg>
      )}
    </button>
  )
}