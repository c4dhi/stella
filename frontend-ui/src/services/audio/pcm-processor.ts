import type { PeerTransport } from '../PeerTransport'
import { useStore } from '../../store'

export class PCMAudioProcessor {
  private audioContext?: AudioContext
  private workletNode?: AudioWorkletNode
  private sourceNode?: MediaStreamAudioSourceNode
  private transport?: PeerTransport
  private isStreaming = false
  private sessionId?: string

  constructor() {
    // Initialize will be called when needed
  }

  async initialize(audioContext: AudioContext, transport: PeerTransport): Promise<void> {
    this.audioContext = audioContext
    this.transport = transport

    // Load the PCM processor worklet if not already loaded
    try {
      await audioContext.audioWorklet.addModule('/src/services/audio/pcm-worklet.js')
    } catch (error) {
      console.error('Failed to load PCM worklet:', error)
      throw error
    }

    // Create worklet node for PCM processing
    this.workletNode = new AudioWorkletNode(audioContext, 'pcm-processor', {
      processorOptions: {
        sampleRate: 16000, // Target 16kHz for transcription
        frameSizeMs: 20,   // 20ms frames as specified
      }
    })

    // Listen for data from worklet
    this.workletNode.port.onmessage = (event) => {
      if (event.data.type === 'pcm-frame' && this.isStreaming) {
        const pcmData = event.data.data as ArrayBuffer
        this.transport?.sendAudioFrame(pcmData, 'pcm16')
      } else if (event.data.type === 'vu-level') {
        // Update VU meter in store
        const vu = Math.min(1, Math.max(0, Number(event.data.data) || 0))
        useStore.getState().setVu(vu)
      }
    }
  }

  async startStreaming(micStream: MediaStream): Promise<void> {
    if (!this.audioContext || !this.workletNode || !this.transport) {
      throw new Error('PCM processor not initialized')
    }

    if (this.isStreaming) {
      this.stopStreaming()
    }

    try {
      // Create source node from microphone
      this.sourceNode = this.audioContext.createMediaStreamSource(micStream)

      // Connect source to worklet
      this.sourceNode.connect(this.workletNode)
      // Note: We don't connect to destination to avoid feedback

      // Start streaming session
      this.sessionId = `pcm_session_${Date.now()}`
      this.transport.startAudioStream(this.sessionId, 'pcm16', 16000)

      this.isStreaming = true
    } catch (error) {
      console.error('Failed to start PCM streaming:', error)
      throw error
    }
  }

  stopStreaming(): void {
    if (!this.isStreaming) return

    try {
      // Disconnect audio nodes
      if (this.sourceNode && this.workletNode) {
        this.sourceNode.disconnect(this.workletNode)
      }

      // Stop streaming session
      this.transport?.stopAudioStream()

      this.isStreaming = false
      this.sourceNode = undefined
      this.sessionId = undefined
    } catch (error) {
      console.error('Error stopping PCM streaming:', error)
    }
  }

  async flushAndStop(): Promise<void> {
    if (!this.isStreaming) return

    try {
      // Give worklet a moment to process any remaining audio chunks
      await new Promise(resolve => setTimeout(resolve, 50))

      // Send mute signal to backend before stopping
      this.transport?.sendMuteSignal()

      // Now stop normally
      this.stopStreaming()
    } catch (error) {
      console.error('Error during flush and stop:', error)
      // Fallback to normal stop if flush fails
      this.stopStreaming()
    }
  }

  isActive(): boolean {
    return this.isStreaming
  }

  getSessionId(): string | undefined {
    return this.sessionId
  }

  cleanup(): void {
    this.stopStreaming()
    this.audioContext = undefined
    this.workletNode = undefined
    this.transport = undefined
  }
}