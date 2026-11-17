import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRnnoiseEngine, RNNOISE_FRAME_SIZE, RnnoiseStream, SpeechAttenuator } from '../src/rnnoise-core.ts';

const frame = () => new Float32Array(RNNOISE_FRAME_SIZE).fill(0.1);
const mean = samples => samples.reduce((sum, sample) => sum + sample, 0) / samples.length;

test('atenua 18 dB quando não há fala e preserva o início com pre-roll', () => {
  const attenuator = new SpeechAttenuator();
  const output = new Float32Array(RNNOISE_FRAME_SIZE);
  for (let i = 0; i < 10; i++) attenuator.processFrame(frame(), 0.66, output);
  const floor = Math.pow(10, -18 / 20);
  assert.ok(Math.abs(mean(output) / 0.1 - floor) < 1e-6);
  // The first two speech frames are buffered while confidence rises.
  const onset = frame().fill(0.2);
  attenuator.processFrame(onset, 0.1, output);
  attenuator.processFrame(onset, 0.3, output);
  attenuator.processFrame(onset, 0.8, output);
  assert.ok(output[300] > 0.19, 'o início aguardava no buffer quando a detecção abriu');
  assert.ok(output.every(Number.isFinite));
});

test('mantém terminações por 200 ms e fecha gradualmente sem zerar o áudio', () => {
  const attenuator = new SpeechAttenuator();
  const output = new Float32Array(RNNOISE_FRAME_SIZE);
  for (let i = 0; i < 10; i++) attenuator.processFrame(frame(), 0.9, output);
  for (let i = 0; i < 20; i++) {
    attenuator.processFrame(frame(), 0, output);
    assert.ok(output.every(sample => sample > 0.099), 'preservar final de fala');
  }
  const closing = [];
  for (let i = 0; i < 120; i++) {
    attenuator.processFrame(frame(), 0, output);
    closing.push(...output);
  }
  assert.ok(closing.every(sample => sample > 0));
  assert.ok(closing.at(-1) < 0.013);
  for (let i = 1; i < closing.length; i++) assert.ok(Math.abs(closing[i] - closing[i - 1]) < 0.0001, 'rampa sem salto de ganho');
});

test('histerese mantém a voz enquanto a confiança oscila moderadamente', () => {
  const attenuator = new SpeechAttenuator();
  const output = new Float32Array(RNNOISE_FRAME_SIZE);
  for (let i = 0; i < 5; i++) attenuator.processFrame(frame(), 0.9, output);
  for (let i = 0; i < 100; i++) attenuator.processFrame(frame(), 0.55, output);
  assert.ok(output.every(sample => sample > 0.099));
});

test('adapta blocos diferentes sem perder nem reordenar amostras', () => {
  let destroyed = 0;
  const stream = new RnnoiseStream({ processFrame: () => 1, destroy() { destroyed++; } });
  const input = Float32Array.from({ length: 24000 }, (_, i) => Math.sin(i * 0.013) * 0.1);
  const collected = [];
  let offset = 0, iteration = 0;
  while (offset < input.length) {
    const size = Math.min([64, 128, 256][iteration++ % 3], input.length - offset);
    const output = new Float32Array(size);
    stream.process(input.subarray(offset, offset + size), output);
    collected.push(...output);
    offset += size;
  }
  const delay = RNNOISE_FRAME_SIZE - 1 + RNNOISE_FRAME_SIZE * 2;
  for (let i = 6000; i < collected.length; i++) assert.ok(Math.abs(collected[i] - input[i - delay]) < 1e-6);
  stream.destroy();
  assert.equal(destroyed, 1);
});

test('WASM regular e SIMD retornam áudio e probabilidade válidos e liberam o estado', async () => {
  for (const filename of ['rnnoise.wasm', 'rnnoise_simd.wasm']) {
    const data = Uint8Array.from(readFileSync(new URL(`../node_modules/@sapphi-red/web-noise-suppressor/dist/${filename}`, import.meta.url)));
    if (!WebAssembly.validate(data)) continue;
    const engine = await createRnnoiseEngine(data.buffer);
    let seed = 123;
    for (let i = 0; i < 80; i++) {
      const samples = Float32Array.from({ length: RNNOISE_FRAME_SIZE }, () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return (seed / 0x100000000 - 0.5) * 0.02;
      });
      const probability = engine.processFrame(samples);
      assert.ok(Number.isFinite(probability) && probability >= 0 && probability <= 1);
      assert.ok(samples.every(Number.isFinite));
    }
    engine.destroy();
    engine.destroy();
    assert.throws(() => engine.processFrame(frame()), /inválido/);
  }
});

test('modelo inválido falha em vez de iniciar um filtro silencioso', async () => {
  await assert.rejects(createRnnoiseEngine(new ArrayBuffer(4)));
  const stream = new RnnoiseStream({ processFrame: () => NaN, destroy() {} });
  assert.throws(() => stream.process(frame(), frame()), /Detecção de fala/);
});
