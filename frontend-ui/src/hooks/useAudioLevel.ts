import { useState, useEffect, useRef } from 'react'

/**
 * Hook that analyzes an audio stream and returns the current audio level (0-100)
 * Uses Web Audio API with RMS analysis for smooth, accurate level detection
 */
export function useAudioLevel(stream: MediaStream | null): number {
  const [level, setLevel] = useState(0)
  const animationFrameRef = useRef<number | null>(null)
  const analyzerRef = useRef<AnalyserNode | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)

  useEffect(() => {
    if (!stream) {
      setLevel(0)
      return
    }

    // Create audio context
    const audioContext = new AudioContext()
    audioContextRef.current = audioContext

    // Create analyzer node
    const analyzer = audioContext.createAnalyser()
    analyzer.fftSize = 256
    analyzer.smoothingTimeConstant = 0.5
    analyzerRef.current = analyzer

    // Connect stream to analyzer
    const source = audioContext.createMediaStreamSource(stream)
    source.connect(analyzer)

    // Buffer for time domain data
    const dataArray = new Uint8Array(analyzer.frequencyBinCount)

    // Animation loop for level detection
    const updateLevel = () => {
      if (!analyzerRef.current) return

      analyzerRef.current.getByteTimeDomainData(dataArray)

      // Calculate RMS (Root Mean Square) for more accurate level
      let sumSquares = 0
      for (let i = 0; i < dataArray.length; i++) {
        // Convert from 0-255 to -1 to 1
        const normalized = (dataArray[i] - 128) / 128
        sumSquares += normalized * normalized
      }
      const rms = Math.sqrt(sumSquares / dataArray.length)

      // Convert to 0-100 scale with some amplification for visibility
      // RMS typically ranges from 0 to ~0.7 for normal speech
      const scaledLevel = Math.min(100, Math.round(rms * 200))

      setLevel(scaledLevel)

      animationFrameRef.current = requestAnimationFrame(updateLevel)
    }

    // Resume audio context if suspended (needed for some browsers)
    if (audioContext.state === 'suspended') {
      audioContext.resume()
    }

    updateLevel()

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
      if (audioContextRef.current) {
        audioContextRef.current.close()
      }
      analyzerRef.current = null
      audioContextRef.current = null
    }
  }, [stream])

  return level
}

export default useAudioLevel
