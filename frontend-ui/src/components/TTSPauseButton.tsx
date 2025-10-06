import { useStore } from '../store'
import { PeerTransport } from '../services/PeerTransport'

export default function TTSPauseButton() {
  const status = useStore(s => s.status)
  const isTTSPlaying = useStore(s => s.isTTSPlaying)
  const isTTSPaused = useStore(s => s.isTTSPaused)
  const setTTSPaused = useStore(s => s.setTTSPaused)
  const transport = useStore(s => s.transport)

  const getButtonState = () => {
    // Always show pause/resume controls when connected (TTS may start soon)
    if (isTTSPaused) return { emoji: '▶️', action: 'resume' }
    if (isTTSPlaying) return { emoji: '⏸️', action: 'pause' }
    return { emoji: '⏸️', action: 'ready' } // Ready to pause when TTS starts
  }

  const handleClick = () => {
    if (status !== 'connected' || !transport) return

    const peerTransport = transport as PeerTransport

    if (isTTSPaused) {
      // Resume streaming playback
      peerTransport.resumeTTSPlayback()
      setTTSPaused(false)
    } else {
      // Pause streaming playback (works even if TTS hasn't started yet)
      peerTransport.pauseTTSPlayback()
      setTTSPaused(true)
    }
  }

  const buttonState = getButtonState()
  const isDisabled = status !== 'connected'

  return (
    <button
      onClick={handleClick}
      disabled={isDisabled}
      className="px-4 py-2 bg-black text-white rounded-lg hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-lg"
      title={
        isDisabled
          ? 'Connect to enable TTS controls'
          : buttonState.action === 'pause'
            ? 'Pause TTS'
            : buttonState.action === 'resume'
              ? 'Resume TTS'
              : 'Ready to pause TTS'
      }
    >
      {buttonState.emoji}
    </button>
  )
}