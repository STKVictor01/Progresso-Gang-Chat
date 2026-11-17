import { loadRnnoise, RnnoiseWorkletNode } from '@sapphi-red/web-noise-suppressor';
import workletUrl from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url';
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
  const node = new RnnoiseWorkletNode(context, { wasmBinary, maxChannels: 1 });
  node.channelCount = 1;
  node.channelCountMode = 'explicit';
  return node;
}
