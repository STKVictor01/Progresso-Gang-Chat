import { createRnnoiseEngine, RnnoiseStream } from './rnnoise-core';

declare class AudioWorkletProcessor { readonly port: MessagePort; }
declare function registerProcessor(name: string, processor: typeof RnnoiseProcessor): void;

class RnnoiseProcessor extends AudioWorkletProcessor {
  private stream: RnnoiseStream | undefined;
  private destroyed = false;

  constructor(options: { processorOptions: { wasmBinary: ArrayBuffer } }) {
    super();
    this.port.onmessage = event => {
      if (event.data !== 'destroy') return;
      this.destroyed = true;
      this.stream?.destroy();
      this.stream = undefined;
      this.port.postMessage('destroyed');
    };
    void createRnnoiseEngine(options.processorOptions.wasmBinary).then(engine => {
      if (this.destroyed) { engine.destroy(); return; }
      this.stream = new RnnoiseStream(engine);
      this.port.postMessage('ready');
    }).catch(() => { this.port.postMessage('error'); });
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]) {
    if (this.destroyed) return false;
    const output = outputs[0]?.[0];
    if (output && this.stream) this.stream.process(inputs[0]?.[0], output);
    return true;
  }
}

registerProcessor('pg-rnnoise-vad', RnnoiseProcessor);
