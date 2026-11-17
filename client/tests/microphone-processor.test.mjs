import test from 'node:test';
import assert from 'node:assert/strict';
import { createMicrophoneProcessor } from '../src/microphone-processor.ts';

function fakeContext(sampleRate = 48000) {
  const nodes = [], inputs = [], outputs = [];
  const node = () => {
    const value = new EventTarget();
    Object.assign(value, { connected: [], disconnected: false,
      connect(target) { this.connected.push(target); }, disconnect() { this.disconnected = true; },
    });
    nodes.push(value);
    return value;
  };
  const context = {
    sampleRate, state: 'running',
    createMediaStreamSource(stream) { const value = node(); inputs.push({ stream, node: value }); return value; },
    createMediaStreamDestination() {
      const track = { stopped: false, stop() { this.stopped = true; } };
      outputs.push(track);
      return Object.assign(node(), { stream: { getTracks: () => [track], getAudioTracks: () => [track] } });
    },
    createBiquadFilter: () => Object.assign(node(), { frequency: {}, Q: {}, gain: {} }),
    createDynamicsCompressor: () => Object.assign(node(), { threshold: {}, knee: {}, ratio: {} }),
    createGain: () => Object.assign(node(), { gain: {} }),
    createOscillator: () => Object.assign(node(), { frequency: {}, start() {}, stop() {} }),
    async close() { this.state = 'closed'; },
  };
  let destroyed = 0;
  const noise = Object.assign(node(), { destroy() { destroyed++; } });
  return { context, nodes, inputs, outputs, noise, destroyed: () => destroyed };
}

test('RNNoise vem antes do efeito e a limpeza preserva a captura e o contexto do LiveKit', async () => {
  const saved = globalThis.MediaStream;
  globalThis.MediaStream = class { constructor(tracks) { this.tracks = tracks; } };
  try {
    for (const effect of ['natural', 'robo', 'radio']) {
      const audio = fakeContext();
      const microphone = { stop() { throw Error('Captura não deve ser encerrada'); } };
      const processor = createMicrophoneProcessor(true, effect, undefined, async () => audio.noise);
      await processor.init({ track: microphone, audioContext: audio.context });
      assert.equal(audio.inputs[0].stream.tracks[0], microphone);
      assert.equal(audio.inputs[0].node.connected[0], audio.noise);
      if (effect !== 'natural') assert.equal(audio.inputs[1].stream.tracks[0], audio.outputs[0]);
      assert.equal(processor.processedTrack, audio.outputs.at(-1));
      await processor.destroy();
      await processor.destroy();
      assert.equal(processor.processedTrack, undefined);
      assert.equal(audio.destroyed(), 1);
      assert.ok(audio.nodes.every(node => node.disconnected));
      assert.ok(audio.outputs.every(track => track.stopped));
      assert.equal(audio.context.state, 'running');
    }
  } finally { globalThis.MediaStream = saved; }
});

test('desligar a supressão não carrega RNNoise e mantém o efeito de voz', async () => {
  const saved = globalThis.MediaStream;
  globalThis.MediaStream = class {};
  const audio = fakeContext();
  const processor = createMicrophoneProcessor(false, 'radio', undefined, () => { throw Error('Não carregar RNNoise'); });
  try {
    await processor.init({ track: {}, audioContext: audio.context });
    assert.equal(processor.processedTrack, audio.outputs[0]);
    await processor.destroy();
    assert.equal(audio.outputs[0].stopped, true);
  } finally { globalThis.MediaStream = saved; }
});

test('44,1 kHz usa contexto próprio de 48 kHz e o fecha ao terminar', async () => {
  const saved = { MediaStream: globalThis.MediaStream, AudioContext: globalThis.AudioContext };
  const room = fakeContext(44100), rnnoise = fakeContext();
  globalThis.MediaStream = class {};
  globalThis.AudioContext = class {
    constructor(options) { assert.equal(options.sampleRate, 48000); return rnnoise.context; }
  };
  const processor = createMicrophoneProcessor(true, 'natural', undefined, async context => {
    assert.equal(context, rnnoise.context); return rnnoise.noise;
  });
  try {
    await processor.init({ track: {}, audioContext: room.context });
    assert.equal(processor.processedTrack, rnnoise.outputs[0]);
    await processor.destroy();
    assert.equal(rnnoise.context.state, 'closed');
    assert.equal(room.context.state, 'running');
  } finally { Object.assign(globalThis, saved); }
});

test('troca de entrada descarta o filtro anterior e falha de carregamento não deixa saída ativa', async () => {
  const saved = globalThis.MediaStream;
  globalThis.MediaStream = class { constructor(tracks) { this.tracks = tracks; } };
  const first = fakeContext(), second = fakeContext();
  let attempts = 0;
  const processor = createMicrophoneProcessor(true, 'natural', undefined, async () => {
    if (++attempts === 3) throw Error('Modelo indisponível');
    return attempts === 1 ? first.noise : second.noise;
  });
  try {
    await processor.init({ track: {}, audioContext: first.context });
    const nextInput = {};
    await processor.restart({ track: nextInput, audioContext: second.context });
    assert.ok(first.outputs.every(track => track.stopped));
    assert.equal(second.inputs[0].stream.tracks[0], nextInput);
    assert.equal(processor.processedTrack, second.outputs[0]);
    await assert.rejects(processor.restart({ track: {}, audioContext: second.context }), /Modelo indisponível/);
    assert.equal(processor.processedTrack, undefined);
    assert.ok(second.outputs.every(track => track.stopped));
  } finally { globalThis.MediaStream = saved; }
});

test('erro do worklet avisa o app e o listener é removido ao desligar', async () => {
  const saved = globalThis.MediaStream;
  globalThis.MediaStream = class {};
  const audio = fakeContext();
  let failures = 0;
  const processor = createMicrophoneProcessor(true, 'natural', () => failures++, async () => audio.noise);
  try {
    await processor.init({ track: {}, audioContext: audio.context });
    audio.noise.dispatchEvent(new Event('processorerror'));
    assert.equal(failures, 1);
    await processor.destroy();
    audio.noise.dispatchEvent(new Event('processorerror'));
    assert.equal(failures, 1);
  } finally { globalThis.MediaStream = saved; }
});
