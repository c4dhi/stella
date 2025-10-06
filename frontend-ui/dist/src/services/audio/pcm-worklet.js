// PCM Audio Worklet Processor for Real-time Transcription
// Processes audio at 16kHz and sends 20ms PCM16 frames

class PCMProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()
    
    // Configuration
    this.targetSampleRate = options.processorOptions?.sampleRate || 16000
    this.frameSizeMs = options.processorOptions?.frameSizeMs || 20
    this.inputSampleRate = sampleRate // AudioWorklet's sample rate (usually 48kHz)
    
    // Calculate frame sizes
    this.inputFrameSize = Math.floor((this.inputSampleRate * this.frameSizeMs) / 1000)
    this.outputFrameSize = Math.floor((this.targetSampleRate * this.frameSizeMs) / 1000)
    
    // Resampling
    this.resampleRatio = this.targetSampleRate / this.inputSampleRate
    this.inputBuffer = []
    this.outputBuffer = new Int16Array(this.outputFrameSize)
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0]
    
    if (!input || !input[0]) {
      return true // Keep processor alive
    }

    const inputData = input[0] // Mono channel
    
    // Calculate VU meter value from raw input
    let sum = 0
    for (let i = 0; i < inputData.length; i++) {
      sum += inputData[i] * inputData[i]
    }
    const rms = Math.sqrt(sum / inputData.length)
    // Simple smoothing for VU meter
    this.lastVu = (this.lastVu || 0) * 0.8 + rms * 0.2

    // Send VU data to main thread
    this.port.postMessage({
      type: 'vu-level',
      data: this.lastVu
    })

    // Add input data to buffer
    for (let i = 0; i < inputData.length; i++) {
      this.inputBuffer.push(inputData[i])
    }

    // Process frames when we have enough data
    while (this.inputBuffer.length >= this.inputFrameSize) {
      const frame = this.inputBuffer.splice(0, this.inputFrameSize)
      this.processFrame(frame)
    }

    return true
  }

  processFrame(inputFrame) {
    // Resample from input rate to target rate (e.g., 48kHz -> 16kHz)
    const resampledFrame = this.resample(inputFrame)
    
    // Convert to 16-bit PCM
    const pcmFrame = this.convertToPCM16(resampledFrame)
    
    // Send PCM frame to main thread
    this.port.postMessage({
      type: 'pcm-frame',
      data: pcmFrame.buffer, // Send as ArrayBuffer
      sampleRate: this.targetSampleRate,
      timestamp: currentTime
    })
  }

  resample(inputFrame) {
    // Simple linear interpolation resampling
    const outputLength = Math.floor(inputFrame.length * this.resampleRatio)
    const output = new Float32Array(outputLength)
    
    for (let i = 0; i < outputLength; i++) {
      const inputIndex = i / this.resampleRatio
      const index = Math.floor(inputIndex)
      const fraction = inputIndex - index
      
      if (index + 1 < inputFrame.length) {
        // Linear interpolation
        output[i] = inputFrame[index] * (1 - fraction) + inputFrame[index + 1] * fraction
      } else {
        output[i] = inputFrame[index] || 0
      }
    }
    
    return output
  }

  convertToPCM16(floatArray) {
    // Convert 32-bit float audio to 16-bit PCM
    const pcm16 = new Int16Array(floatArray.length)
    
    for (let i = 0; i < floatArray.length; i++) {
      // Clamp to [-1, 1] and convert to 16-bit range
      const sample = Math.max(-1, Math.min(1, floatArray[i]))
      pcm16[i] = Math.floor(sample * 32767)
    }
    
    return pcm16
  }
}

registerProcessor('pcm-processor', PCMProcessor)