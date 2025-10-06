
import { useEffect, useState } from 'react'
import { useStore } from '../store'
import type { TranscriptChunk, ProcessingMessage, ParticipantEvent } from '../lib/types'
import { generateUUID } from '../lib/uuid'

interface ConnectPanelProps {
  roomName?: string
}

export default function ConnectPanel({ roomName }: ConnectPanelProps = {}) {
  const status = useStore(s => s.status)
  const setStatus = useStore(s => s.setStatus)
  const vu = useStore(s => s.vu)
  const vadEnabled = useStore(s => s.vadEnabled)
  const setVadEnabled = useStore(s => s.setVadEnabled)
  const upsertChunk = useStore(s => s.upsertChunk)
  const addProcessingMessage = useStore(s => s.addProcessingMessage)
  const addParticipantEvent = useStore(s => s.addParticipantEvent)
  const setTTSPlaying = useStore(s => s.setTTSPlaying)
  const setTTSPaused = useStore(s => s.setTTSPaused)

  // Get transport from store (already initialized during store creation)
  const transport = useStore(s => s.transport)
  const [voiceNarrationEnabled, setVoiceNarrationEnabled] = useState(true)

  useEffect(() => {
    // Set up transport event handlers

    transport.onConnected = () => setStatus('connected')
    transport.onDisconnected = () => setStatus('idle')
    transport.onError = (e) => { console.error(e); setStatus('error') }
    transport.onTranscript = (c: TranscriptChunk) => upsertChunk(c)
    transport.onProcessingMessage = (m: ProcessingMessage) => addProcessingMessage(m)
    transport.onTTSStart = () => {
      setTTSPlaying(true)
      setTTSPaused(false)
    }
    transport.onTTSStop = () => {
      setTTSPlaying(false)
      setTTSPaused(false)
    }
    transport.onParticipantJoined = (participantId: string, participantName?: string) => {
      const event: ParticipantEvent = {
        id: generateUUID(),
        type: 'joined',
        participantId,
        participantName,
        startedAt: Date.now(), // Use local timestamp for consistency with server message parsing
        messageType: 'participant'
      }
      addParticipantEvent(event)
    }
    transport.onParticipantLeft = (participantId: string, participantName?: string) => {
      const event: ParticipantEvent = {
        id: generateUUID(),
        type: 'left',
        participantId,
        participantName,
        startedAt: Date.now(), // Use local timestamp for consistency with server message parsing
        messageType: 'participant'
      }
      addParticipantEvent(event)
    }

  }, [transport, setStatus, upsertChunk, addProcessingMessage, addParticipantEvent, setTTSPlaying, setTTSPaused])

  const connect = async () => {
    try {
      setStatus('connecting')

      // Connect to LiveKit with the session's room name
      await transport.connect(roomName)

      // Note: Microphone will be started when user clicks unmute button in Composer
      // This ensures microphone starts muted by default

    } catch (e) {
      console.error(e)
      setStatus('error')
    }
  }

  const disconnect = async () => {
    await transport.disconnect()
  }

  const toggleVoiceNarration = async () => {
    if (status !== 'connected') return

    const newState = !voiceNarrationEnabled

    try {
      // Send voice narration control using the transport's sendControl method
      transport.sendControl('voice_narration_control', {
        action: newState ? "enable" : "disable"
      })

      setVoiceNarrationEnabled(newState)
    } catch (error) {
      console.error('Error toggling voice narration:', error)
    }
  }

  const reconnect = async () => {
    try {
      setStatus('connecting')
      await disconnect()
      // Wait for disconnect to complete
      await new Promise(resolve => setTimeout(resolve, 500))
      await connect()
    } catch (error) {
      console.error('[ConnectPanel] Reconnect failed:', error)
      setStatus('error')
    }
  }

  return (
    <div className="px-4 py-2 rounded-xl bg-white/90 backdrop-blur-xl shadow-sm border border-neutral-200/60 flex items-center gap-3">
      <button
        onClick={reconnect}
        disabled={status === 'connecting'}
        className={`h-9 px-4 py-2 rounded-lg text-xs font-light tracking-wider transition-all duration-300 disabled:opacity-60 disabled:cursor-not-allowed ${
          status === 'connecting'
            ? 'bg-neutral-100/80 text-neutral-600 border border-neutral-300/50'
            : 'bg-neutral-900 text-white hover:bg-neutral-800 shadow-[0_1px_20px_rgba(0,0,0,0.12)] border border-neutral-800/40'
        }`}
      >
        {status === 'connecting' ? 'Connecting...' : 'Reconnect'}
      </button>

      {status === 'connected' && (
        <>

          {/* Voice Narration Toggle */}
          <button
            onClick={toggleVoiceNarration}
            className={`h-9 px-4 py-2 rounded-lg text-xs font-light tracking-wider transition-all duration-300 border flex items-center gap-2 ${
              voiceNarrationEnabled
                ? 'bg-neutral-900 text-white hover:bg-neutral-800 border-neutral-800/40 shadow-[0_1px_20px_rgba(0,0,0,0.12)]'
                : 'bg-neutral-100/80 text-neutral-600 hover:bg-neutral-200/80 border-neutral-300/50'
            }`}
            title={`${voiceNarrationEnabled ? 'Disable' : 'Enable'} voice narration`}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              {voiceNarrationEnabled ? (
                // Speaker icon (enabled)
                <path d="M11 5L6 9H2v6h4l5 4V5zM15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14"/>
              ) : (
                // Speaker muted icon (disabled)
                <>
                  <path d="M11 5L6 9H2v6h4l5 4V5zM22 9l-6 6M16 9l6 6"/>
                </>
              )}
            </svg>
            Voice
          </button>
        </>
      )}

      <div className="flex items-center gap-3 ml-auto">
        <div className="flex items-center gap-2">
          <div className={`w-1 h-1 rounded-full transition-all duration-300 ${status === 'connected'
            ? 'bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.5)]'
            : status === 'connecting'
              ? 'bg-yellow-500 animate-pulse'
              : 'bg-neutral-300'
            }`} />
          <div className="text-[10px] text-neutral-600 font-light tracking-wider uppercase">
            {status}
          </div>
        </div>

        {vu > 0 && (
          <div className="w-12 h-px bg-neutral-200/80 rounded-full overflow-hidden backdrop-blur-sm">
            <div
              className="h-px bg-neutral-700 rounded-full transition-all duration-100"
              style={{ width: `${Math.round(vu * 100)}%` }}
            />
          </div>
        )}
      </div>
    </div>
  )
}
