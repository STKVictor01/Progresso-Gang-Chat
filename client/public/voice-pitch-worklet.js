class VoicePitchProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.ratio = options.processorOptions.ratio;
    this.windowSize = Math.round(sampleRate * 0.06);
    this.buffer = new Float32Array(this.windowSize * 2 + 128);
    this.writeIndex = 0;
    this.phase = 0;
  }

  read(delay) {
    const index = (this.writeIndex - delay + this.buffer.length) % this.buffer.length;
    const left = Math.floor(index);
    const fraction = index - left;
    return this.buffer[left] * (1 - fraction) + this.buffer[(left + 1) % this.buffer.length] * fraction;
  }

  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (!output) return true;
    for (let i = 0; i < output.length; i++) {
      this.buffer[this.writeIndex] = input?.[i] ?? 0;
      const secondPhase = (this.phase + 0.5) % 1;
      const weight = 0.5 - 0.5 * Math.cos(2 * Math.PI * this.phase);
      output[i] = this.read(1 + this.phase * this.windowSize) * weight
        + this.read(1 + secondPhase * this.windowSize) * (1 - weight);
      this.phase = (this.phase + (1 - this.ratio) / this.windowSize + 1) % 1;
      this.writeIndex = (this.writeIndex + 1) % this.buffer.length;
    }
    return true;
  }
}

registerProcessor('pg-voice-pitch', VoicePitchProcessor);
