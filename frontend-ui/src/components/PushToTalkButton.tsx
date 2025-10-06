import { useCallback, useEffect, useRef } from 'react'
import { useStore } from '../store'
import { startPCMCapture } from '../services/audio/capture'

export default function PushToTalkButton() {
  const status = useStore(s => s.status)
  const transport = useStore(s => s.transport)
  const isPushToTalkActive = useStore(s => s.isPushToTalkActive)
  const isRecording = useStore(s => s.isRecording)
  const setPushToTalkActive = useStore(s => s.setPushToTalkActive)
  const setIsRecording = useStore(s => s.setIsRecording)
  const vu = useStore(s => s.vu)

  const audioContextRef = useRef<AudioContext | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const vuNodeRef = useRef<AudioWorkletNode | null>(null)
  const pcmCaptureRef = useRef<any>(null)

  const startRecording = useCallback(async () => {
    if (!transport || status !== 'connected') {
      console.warn('Cannot start recording: not connected or transport unavailable')
      return
    }

    try {
      // Create new AudioContext for push-to-talk
      const audioContext = new AudioContext()
      audioContextRef.current = audioContext

      // Start PCM capture for real-time transcription (same as continuous mode)
      const pcmCapture = await startPCMCapture(audioContext, transport as any)
      pcmCaptureRef.current = pcmCapture

      // Store the stream reference for VU meter
      streamRef.current = pcmCapture.stream

      // Set up VU meter for visual feedback using the same stream
      await setupVUMeter(pcmCapture.stream)

      setIsRecording(true)

    } catch (error) {
      console.error('Error starting push-to-talk recording:', error)
      setIsRecording(false)
      setPushToTalkActive(false)
    }
  }, [transport, status, setIsRecording, setPushToTalkActive])

  const stopRecording = useCallback(async () => {
    if (pcmCaptureRef.current && isRecording) {
      // Use flushAndStop to ensure remaining audio chunks are sent
      if (typeof pcmCaptureRef.current.flushAndStop === 'function') {
        await pcmCaptureRef.current.flushAndStop()
      } else {
        // Fallback to normal stop if flushAndStop not available
        pcmCaptureRef.current.stop()
      }

      pcmCaptureRef.current = null

      // Clean up VU meter
      cleanupVUMeter()

      // Update state
      setIsRecording(false)
      setPushToTalkActive(false)

      // Clear stream reference
      streamRef.current = null
    }
  }, [isRecording, setIsRecording, setPushToTalkActive])

  const handleMouseDown = useCallback(() => {
    if (!isPushToTalkActive) {
      setPushToTalkActive(true)
      startRecording()
    }
  }, [isPushToTalkActive, setPushToTalkActive, startRecording])

  const handleMouseUp = useCallback(() => {
    if (isPushToTalkActive) {
      stopRecording()
    }
  }, [isPushToTalkActive, stopRecording])

  // Keyboard event listeners removed - no more spacebar push-to-talk

  // Clean up on component unmount
  useEffect(() => {
    return () => {
      if (pcmCaptureRef.current) {
        pcmCaptureRef.current.stop()
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop())
      }
      cleanupVUMeter()
    }
  }, [])

  const setupVUMeter = async (stream: MediaStream) => {
    try {
      const audioContext = new AudioContext()
      audioContextRef.current = audioContext

      const src = audioContext.createMediaStreamSource(stream)

      // Load worklet if not already loaded
      // @ts-ignore
      if (!audioContext.audioWorklet?.modules?.length) {
        await audioContext.audioWorklet.addModule('/src/services/audio/vu-worklet.js')
      }

      const vuNode = new AudioWorkletNode(audioContext, 'vu-processor')
      vuNodeRef.current = vuNode

      vuNode.port.onmessage = (e) => {
        const vuValue = Math.min(1, Math.max(0, Number(e.data) || 0))
        useStore.getState().setVu(vuValue)
      }

      src.connect(vuNode)
      vuNode.connect(audioContext.destination)

    } catch (error) {
      console.error('Error setting up VU meter:', error)
    }
  }

  const cleanupVUMeter = () => {
    if (vuNodeRef.current) {
      vuNodeRef.current.disconnect()
      vuNodeRef.current = null
    }
    if (audioContextRef.current) {
      audioContextRef.current.close()
      audioContextRef.current = null
    }
    // Reset VU meter display
    useStore.getState().setVu(0)
  }


  const buttonClasses = `
    px-6 py-4 rounded-full font-semibold text-white transition-all duration-150 min-w-32
    ${isPushToTalkActive
      ? 'bg-red-500 shadow-lg transform scale-105 animate-pulse'
      : 'bg-blue-500 hover:bg-blue-600'
    }
    ${status !== 'connected' ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
  `.trim()

  return (
    <div className="flex flex-col items-center gap-3">
      <button
        className={buttonClasses}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp} // Handle mouse leave to stop recording
        disabled={status !== 'connected'}
      >
        {isRecording ? '🎤 Recording...' : '🎤 Hold to Talk'}
      </button>

      {/* Visual feedback */}
      <div className="text-sm text-gray-400 text-center">
        <div>Hold the button to record</div>
        {isRecording && (
          <div className="flex items-center gap-2 mt-2">
            <div className="w-20 h-2 bg-gray-600 rounded overflow-hidden">
              <div
                className="h-2 bg-green-400 rounded transition-all duration-100"
                style={{ width: `${Math.round(vu * 100)}%` }}
              />
            </div>
            <span className="text-xs text-green-400">Recording</span>
          </div>
        )}
      </div>
    </div>
  )
}

