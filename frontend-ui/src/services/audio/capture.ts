
import { useStore } from '../../store'
import { PCMAudioProcessor } from './pcm-processor'
import type { PeerTransport } from '../PeerTransport'

export async function startMicWithVu(audioContext: AudioContext, transport?: PeerTransport) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      sampleRate: 48000, // Use high quality input, we'll downsample
      echoCancellation: false,  // Disable browser AEC - agent handles this or user disables via DISABLE_AEC
      noiseSuppression: false,  // Disable browser NS - was too aggressive
      autoGainControl: true     // Enable AGC to boost quiet audio
    }
  })
  
  const src = audioContext.createMediaStreamSource(stream)
  
  // Load VU meter worklet if not loaded
  try {
    await audioContext.audioWorklet.addModule('/src/services/audio/vu-worklet.js')
  } catch (e) {
    console.warn('VU worklet already loaded or failed to load:', e)
  }

  const vuNode = new AudioWorkletNode(audioContext, 'vu-processor')
  vuNode.port.onmessage = (e) => {
    const vu = Math.min(1, Math.max(0, Number(e.data) || 0))
    useStore.getState().setVu(vu)
  }

  src.connect(vuNode)
  // Don't connect to destination to avoid feedback - just use for VU monitoring
  
  return stream
}

export async function startPCMCapture(audioContext: AudioContext, transport: PeerTransport) {
  const processor = new PCMAudioProcessor()
  await processor.initialize(audioContext, transport)
  
  const stream = await navigator.mediaDevices.getUserMedia({ 
    audio: { 
      channelCount: 1,
      sampleRate: 48000, // High quality input
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: false
    } 
  })
  
  await processor.startStreaming(stream)
  
  return {
    stream,
    processor,
    stop: () => {
      processor.stopStreaming()
      processor.cleanup()
      stream.getTracks().forEach(track => track.stop())
    },
    flushAndStop: async () => {
      await processor.flushAndStop()
      processor.cleanup()
      stream.getTracks().forEach(track => track.stop())
    }
  }
}
