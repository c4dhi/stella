
class VUProcessor extends AudioWorkletProcessor {
  constructor() { super(); this._last = 0 }
  process(inputs) {
    const input = inputs[0]
    if (input && input[0]) {
      const ch = input[0]
      let sum = 0
      for (let i = 0; i < ch.length; i++) sum += ch[i]*ch[i]
      const rms = Math.sqrt(sum / ch.length)
      // simple smoothing
      this._last = 0.8 * this._last + 0.2 * rms
      this.port.postMessage(this._last)
    }
    return true
  }
}
registerProcessor('vu-processor', VUProcessor)
