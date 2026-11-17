export const RNNOISE_FRAME_SIZE = 480;
export const SPEECH_FILTER = {
  openProbability: 0.75,
  closeProbability: 0.5,
  holdMs: 240,
  lookaheadMs: 20,
  attenuationDb: 18,
  attackMs: 2,
  releaseMs: 100,
} as const;

export type DenoiseEngine = {
  processFrame: (frame: Float32Array) => number;
  destroy: () => void;
};

type RnnoiseExports = {
  memory: WebAssembly.Memory;
  emscripten_stack_init: () => void;
  __wasm_call_ctors: () => void;
  rnnoise_get_frame_size: () => number;
  rnnoise_create: (model: number) => number;
  rnnoise_destroy: (state: number) => void;
  rnnoise_process_frame: (state: number, output: number, input: number) => number;
  malloc: (bytes: number) => number;
  free: (pointer: number) => void;
};

// Host the pinned 2022.2.0 binary already shipped by our adapter. It imports only
// these three Emscripten functions; accessing its native API preserves the VAD
// result that the adapter's standard worklet discards.
export async function createRnnoiseEngine(binary: ArrayBuffer): Promise<DenoiseEngine> {
  const { instance } = await WebAssembly.instantiate(binary, { env: {
    emscripten_memcpy_big: (destination: number, source: number, size: number) => {
      new Uint8Array(memory.buffer).copyWithin(destination, source, source + size);
      return destination;
    },
    emscripten_resize_heap: (size: number) => {
      try {
        memory.grow(Math.max(0, Math.ceil((size - memory.buffer.byteLength) / 65536)));
        return 1;
      } catch { return 0; }
    },
    __assert_fail: () => { throw Error('Falha no processamento de áudio.'); },
  } });
  const wasm = instance.exports as unknown as RnnoiseExports;
  const memory = wasm.memory;
  wasm.emscripten_stack_init();
  wasm.__wasm_call_ctors();
  if (wasm.rnnoise_get_frame_size() !== RNNOISE_FRAME_SIZE) throw Error('Modelo de áudio incompatível.');
  const state = wasm.rnnoise_create(0);
  const input = wasm.malloc(RNNOISE_FRAME_SIZE * 4);
  const output = wasm.malloc(RNNOISE_FRAME_SIZE * 4);
  if (!state || !input || !output) {
    if (state) wasm.rnnoise_destroy(state);
    if (input) wasm.free(input);
    if (output) wasm.free(output);
    throw Error('Memória de áudio indisponível.');
  }
  let destroyed = false;
  return {
    processFrame(frame) {
      if (destroyed || frame.length !== RNNOISE_FRAME_SIZE) throw Error('Quadro de áudio inválido.');
      const pcm = new Float32Array(memory.buffer, input, RNNOISE_FRAME_SIZE);
      for (let i = 0; i < frame.length; i++) pcm[i] = frame[i] * 32767;
      const probability = wasm.rnnoise_process_frame(state, output, input);
      const denoised = new Float32Array(memory.buffer, output, RNNOISE_FRAME_SIZE);
      for (let i = 0; i < frame.length; i++) frame[i] = denoised[i] / 32767;
      return probability;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      wasm.rnnoise_destroy(state);
      wasm.free(input);
      wasm.free(output);
    },
  };
}

export class SpeechAttenuator {
  private history = new Float32Array(48000 * SPEECH_FILTER.lookaheadMs / 1000);
  private position = 0;
  private hold = 0;
  private gain = Math.pow(10, -SPEECH_FILTER.attenuationDb / 20);
  private readonly floor = this.gain;
  private readonly attack = 1 - Math.exp(-1 / (48 * SPEECH_FILTER.attackMs));
  private readonly release = 1 - Math.exp(-1 / (48 * SPEECH_FILTER.releaseMs));

  processFrame(frame: Float32Array, probability: number, output: Float32Array) {
    // Hysteresis keeps quieter syllables open; 240 ms holds sentence endings.
    if (probability >= SPEECH_FILTER.openProbability || (this.hold > 0 && probability >= SPEECH_FILTER.closeProbability)) this.hold = SPEECH_FILTER.holdMs / 10;
    else this.hold = Math.max(0, this.hold - 1);
    const target = this.hold > 0 ? 1 : this.floor;
    const smoothing = target > this.gain ? this.attack : this.release;
    // Twenty ms of pre-roll lets the VAD open before the buffered first syllable.
    for (let i = 0; i < frame.length; i++) {
      this.gain += (target - this.gain) * smoothing;
      output[i] = this.history[this.position + i] * this.gain;
      this.history[this.position + i] = frame[i];
    }
    this.position = (this.position + RNNOISE_FRAME_SIZE) % this.history.length;
  }
}

export class RnnoiseStream {
  private frame = new Float32Array(RNNOISE_FRAME_SIZE);
  private filtered = new Float32Array(RNNOISE_FRAME_SIZE);
  private queued = new Float32Array(RNNOISE_FRAME_SIZE * 2);
  private fill = 0;
  private read = 0;
  private write = 0;
  private available = 0;
  private speech = new SpeechAttenuator();
  private readonly engine: DenoiseEngine;

  constructor(engine: DenoiseEngine) { this.engine = engine; }

  process(input: Float32Array | undefined, output: Float32Array) {
    for (let i = 0; i < output.length; i++) {
      this.frame[this.fill++] = input?.[i] ?? 0;
      if (this.fill === RNNOISE_FRAME_SIZE) {
        const probability = this.engine.processFrame(this.frame);
        if (!Number.isFinite(probability)) throw Error('Detecção de fala indisponível.');
        this.speech.processFrame(this.frame, probability, this.filtered);
        for (const sample of this.filtered) {
          this.queued[this.write] = sample;
          this.write = (this.write + 1) % this.queued.length;
        }
        this.available += RNNOISE_FRAME_SIZE;
        this.fill = 0;
      }
      output[i] = this.available > 0 ? this.queued[this.read] : 0;
      if (this.available > 0) {
        this.read = (this.read + 1) % this.queued.length;
        this.available--;
      }
    }
  }

  destroy() { this.engine.destroy(); }
}
