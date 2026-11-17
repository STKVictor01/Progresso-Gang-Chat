import test from 'node:test';
import assert from 'node:assert/strict';
import { microphoneOptions, readNoisePreference, isListenerMuted, listenerId, listenerVolume, readVolumePreferences, toggleListenerMute } from '../src/call-settings.ts';

test('volume salvo usa a conta estável em novas sessões e separa transmissões', () => {
  const user='12345678-1234-1234-1234-123456789abc';
  const owner='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const saved={volumes:{[user]:0.35,'music-bot':0.2,invalid:0.5},screenVolumes:{[user]:0.8}};
  globalThis.localStorage={getItem:key=>key==='pg-call-volumes:'+owner?JSON.stringify(saved):null};
  try {
    const preferences=readVolumePreferences(owner);
    assert.equal(listenerId(user+':primeira'),user);
    assert.equal(listenerId(user+':segunda'),user);
    assert.equal(listenerId('music-bot:nova-sessao'),'music-bot');
    assert.equal(listenerVolume({},preferences.volumes,listenerId(user+':segunda'),'microphone'),0.35);
    assert.equal(listenerVolume({},preferences.volumes,user,'screen',preferences.screenVolumes),0.8);
    assert.equal(preferences.volumes.invalid,undefined);
    assert.deepEqual(readVolumePreferences(user),{volumes:{},screenVolumes:{}});
  } finally { delete globalThis.localStorage; }
});

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
test('captura mantém proteção de eco e não aplica dois supressores', () => {
  assert.deepEqual(microphoneOptions(), { noiseSuppression: false, echoCancellation: true, autoGainControl: true });
});

test('RNNoise preserva a preferência do filtro anterior mesmo sem armazenamento', () => {
  for (const [saved, expected] of [['false', false], ['true', true], [null, true]]) {
    globalThis.localStorage = { getItem: key => key === 'pg-noise-suppression' ? saved : null };
    assert.equal(readNoisePreference(), expected);
  }
  globalThis.localStorage = { getItem: () => { throw Error('Armazenamento bloqueado'); } };
  try { assert.equal(readNoisePreference(), true); }
  finally { delete globalThis.localStorage; }
});
