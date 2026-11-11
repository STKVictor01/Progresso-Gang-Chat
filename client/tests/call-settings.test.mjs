import test from 'node:test';
import assert from 'node:assert/strict';
import { applyNoiseSuppression, isListenerMuted, listenerVolume, toggleListenerMute } from '../src/call-settings.ts';

test('volume altera apenas a voz escolhida e respeita os silenciamentos', () => {
  const volumes = { amigoA: 0.35 };
  assert.equal(listenerVolume({}, volumes, 'amigoA', 'microphone'), 0.35);
  assert.equal(listenerVolume({}, volumes, 'amigoA', 'screen'), 1);
  assert.equal(listenerVolume({}, volumes, 'amigoA', 'screen', { amigoA: 0.2 }), 0.2);
  assert.equal(listenerVolume({ amigoA: { screen: true } }, volumes, 'amigoA', 'screen', { amigoA: 0.2 }), 0);
  assert.equal(listenerVolume({}, volumes, 'amigoB', 'microphone'), 1);
  assert.equal(listenerVolume({ amigoA: { microphone: true } }, volumes, 'amigoA', 'microphone'), 0);
  assert.equal(listenerVolume({ amigoA: { screen: true } }, volumes, 'amigoA', 'screen'), 0);
});

test('silenciar a voz nao silencia a transmissao nem outros participantes', () => {
  const original = { amigoA: { screen: true }, amigoB: { microphone: true } };
  const next = toggleListenerMute(original, 'amigoA', 'microphone');
  assert.equal(isListenerMuted(next, 'amigoA', 'microphone'), true);
  assert.equal(isListenerMuted(next, 'amigoA', 'screen'), true);
  assert.equal(isListenerMuted(next, 'amigoB', 'microphone'), true);
  assert.equal(original.amigoA.microphone, undefined);
  const restored = toggleListenerMute(next, 'amigoA', 'microphone');
  assert.equal(isListenerMuted(restored, 'amigoA', 'microphone'), false);
  assert.equal(isListenerMuted(restored, 'amigoA', 'screen'), true);
  assert.equal(isListenerMuted(restored, 'novoAmigo', 'microphone'), false);
});
test('o filtro usa a resposta real do microfone e nunca o desmuta', async () => {
  const requests = [];
  const track = {
    applyConstraints: async options => { requests.push(options); },
    mediaStreamTrack: { getSettings: () => ({ noiseSuppression: false }) },
    unmute: () => { throw Error('Nunca ativar o microfone ao configurar o filtro'); },
  };
  assert.equal(await applyNoiseSuppression(track, true), false);
  assert.deepEqual(requests[0], { noiseSuppression: true, echoCancellation: true, autoGainControl: true });
  await applyNoiseSuppression(track, false);
  assert.equal(requests[1].noiseSuppression, false);
  track.mediaStreamTrack.getSettings = () => ({});
  assert.equal(await applyNoiseSuppression(track, true), undefined);
});
test('erro do dispositivo e propagado em vez de informar filtro ativo', async () => {
  const track = { applyConstraints: async () => { throw Error('Dispositivo indisponivel'); }, mediaStreamTrack: { getSettings: () => ({ noiseSuppression: true }) } };
  await assert.rejects(() => applyNoiseSuppression(track, true), /Dispositivo indisponivel/);
});
