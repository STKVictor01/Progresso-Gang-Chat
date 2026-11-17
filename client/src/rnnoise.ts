import { loadRnnoise } from '@sapphi-red/web-noise-suppressor';
import workletUrl from './rnnoise-worklet.ts?worker&url';
import wasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url';
import simdUrl from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url';

let binary: Promise<ArrayBuffer> | undefined;
const modules = new WeakMap<AudioContext, Promise<void>>();

async function loadModule(context: AudioContext) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([context.audioWorklet.addModule(workletUrl), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(Error('O filtro demorou para carregar.')), 15000);
    })]);
  } finally { clearTimeout(timer); }
}

export async function createRnnoiseNode(context: AudioContext) {
  // Retry a failed download; keep a successful model in memory between calls.
  binary ??= loadRnnoise({ url: wasmUrl, simdUrl }, { signal: AbortSignal.timeout(15000) })
    .then(value => {
      if (!WebAssembly.validate(value)) throw Error('Filtro de ruído inválido.');
      return value;
    }).catch(error => { binary = undefined; throw error; });
  let module = modules.get(context);
  if (!module) {
    module = loadModule(context).catch(error => { modules.delete(context); throw error; });
    modules.set(context, module);
  }
  const [wasmBinary] = await Promise.all([binary, module]);
  const node = new AudioWorkletNode(context, 'pg-rnnoise-vad', {
    numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
    channelCount: 1, channelCountMode: 'explicit', processorOptions: { wasmBinary },
  });
  let destroyed = false;
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    node.port.postMessage('destroy');
    node.disconnect();
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      const failed = () => reject(Error('Não foi possível iniciar a redução de ruído.'));
      node.addEventListener('processorerror', failed, { once: true });
      timer = setTimeout(failed, 10000);
      node.port.onmessage = event => {
        if (event.data === 'ready') {
          node.removeEventListener('processorerror', failed);
          resolve();
        } else if (event.data === 'error') failed();
        else if (event.data === 'destroyed') node.port.close();
      };
    });
    return Object.assign(node, { destroy });
  } catch (error) { destroy(); throw error; }
  finally { clearTimeout(timer); }
}
