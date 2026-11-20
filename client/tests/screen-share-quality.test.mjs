import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SHARE_QUALITY, SHARE_QUALITY_KEY, normalizeShareQuality, readShareQuality, saveShareQuality, shareBitrate, sharePlan } from '../src/screen-share-quality.ts';

const chrome = { safari:false, firefox:false };

test('padrão recomendado: 1080p a 60 quadros por segundo, priorizando fluidez', () => {
  assert.deepEqual(DEFAULT_SHARE_QUALITY, { resolution:'1080', framerate:60, bitrate:'equilibrada', priority:'fluidez' });
  const plan = sharePlan(DEFAULT_SHARE_QUALITY, chrome);
  assert.deepEqual(plan.capture.resolution, { width:1920, height:1080, frameRate:60 });
  assert.equal(plan.encoding.maxFramerate, 60);
  assert.equal(plan.encoding.maxBitrate, 6_000_000);
  assert.equal(plan.capture.contentHint, 'motion');
  assert.equal(plan.degradationPreference, 'maintain-framerate');
});

test('a camada menor mantém os mesmos quadros por segundo', () => {
  const plan = sharePlan({ ...DEFAULT_SHARE_QUALITY, resolution:'1440' }, chrome);
  assert.deepEqual(plan.layers, [{ width:1280, height:720, maxBitrate:Math.round(plan.encoding.maxBitrate * .4), maxFramerate:60 }]);
  const small = sharePlan({ ...DEFAULT_SHARE_QUALITY, resolution:'720', framerate:30 }, chrome);
  assert.equal(small.layers[0].height, 480);
  assert.equal(small.layers[0].maxFramerate, 30);
});

test('bitrate cresce com resolução, quadros e qualidade', () => {
  assert.ok(shareBitrate({ ...DEFAULT_SHARE_QUALITY, framerate:30 }) < shareBitrate(DEFAULT_SHARE_QUALITY));
  assert.ok(shareBitrate({ ...DEFAULT_SHARE_QUALITY, bitrate:'economica' }) < shareBitrate(DEFAULT_SHARE_QUALITY));
  assert.ok(shareBitrate({ ...DEFAULT_SHARE_QUALITY, bitrate:'alta' }) > shareBitrate(DEFAULT_SHARE_QUALITY));
  assert.ok(shareBitrate({ ...DEFAULT_SHARE_QUALITY, resolution:'2160' }) > shareBitrate({ ...DEFAULT_SHARE_QUALITY, resolution:'1440' }));
});

test('nitidez e equilíbrio mudam a prioridade quando a rede aperta', () => {
  const sharp = sharePlan({ ...DEFAULT_SHARE_QUALITY, priority:'nitidez' }, chrome);
  assert.equal(sharp.capture.contentHint, 'detail');
  assert.equal(sharp.degradationPreference, 'maintain-resolution');
  const balanced = sharePlan({ ...DEFAULT_SHARE_QUALITY, priority:'equilibrio' }, chrome);
  assert.equal(balanced.capture.contentHint, undefined);
  assert.equal(balanced.degradationPreference, 'balanced');
});

test('Safari não recebe resolução (bug do WebKit) e todos transmitem em VP8', () => {
  const safari = sharePlan(DEFAULT_SHARE_QUALITY, { safari:true, firefox:false });
  assert.equal(safari.capture.resolution, undefined);
  assert.equal(safari.encoding.maxFramerate, 60);
  for (const browser of [chrome, { safari:true, firefox:false }, { safari:false, firefox:true }]) assert.equal(sharePlan(DEFAULT_SHARE_QUALITY, browser).videoCodec, 'vp8');
});

test('valores salvos inválidos voltam ao recomendado e a escolha é lembrada', () => {
  assert.deepEqual(normalizeShareQuality({ resolution:'999', framerate:240, bitrate:'x', priority:null }), DEFAULT_SHARE_QUALITY);
  assert.deepEqual(normalizeShareQuality('lixo'), DEFAULT_SHARE_QUALITY);
  const memory = new Map();
  const storage = { getItem:key => memory.get(key) ?? null, setItem:(key, value) => memory.set(key, value) };
  saveShareQuality({ resolution:'1440', framerate:30, bitrate:'alta', priority:'nitidez' }, storage);
  assert.ok(memory.has(SHARE_QUALITY_KEY));
  assert.deepEqual(readShareQuality(storage), { resolution:'1440', framerate:30, bitrate:'alta', priority:'nitidez' });
  assert.deepEqual(readShareQuality({ getItem:() => '{quebrado' }), DEFAULT_SHARE_QUALITY);
  assert.deepEqual(readShareQuality({ getItem:() => { throw Error('bloqueado'); } }), DEFAULT_SHARE_QUALITY);
});
