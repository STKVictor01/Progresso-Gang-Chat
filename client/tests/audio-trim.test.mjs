import test from 'node:test';
import assert from 'node:assert/strict';
import { clampTrim, formatSeconds, initialTrim, MAX_SOURCE_BYTES, needsTrim, trimProblem } from '../src/audio-trim.ts';
import { encodeWav } from '../src/wav.ts';

test('áudio curto e de exatamente 10 segundos não pedem recorte; maior que 10 pede', () => {
  assert.equal(needsTrim(3), false);
  assert.equal(needsTrim(10), false);
  assert.equal(needsTrim(10.026), false, 'folga do decodificador de MP3');
  assert.equal(needsTrim(10.5), true);
  assert.equal(needsTrim(Number.NaN), false);
  assert.equal(MAX_SOURCE_BYTES, 8 * 1024 * 1024);
});

test('trecho inicial sugere os primeiros 10 segundos sem passar do arquivo', () => {
  assert.deepEqual(initialTrim(42), { start: 0, end: 10 });
  assert.deepEqual(initialTrim(4.2), { start: 0, end: 4.2 });
});

test('mover o início puxa o fim para manter no máximo 10 segundos', () => {
  assert.deepEqual(clampTrim(42, { start: 5, end: 20 }, 'start'), { start: 5, end: 15 });
  assert.deepEqual(clampTrim(42, { start: 12, end: 10 }, 'start'), { start: 12, end: 12.1 });
});

test('mover o fim puxa o início e o trecho nunca sai do arquivo', () => {
  assert.deepEqual(clampTrim(42, { start: 0, end: 30 }, 'end'), { start: 20, end: 30 });
  assert.deepEqual(clampTrim(42, { start: 0, end: 99 }, 'end'), { start: 32, end: 42 });
  assert.deepEqual(clampTrim(42, { start: -3, end: 4 }, 'start'), { start: 0, end: 4 });
  // Recorte encostado no final do arquivo.
  assert.deepEqual(clampTrim(42, { start: 41.95, end: 42 }, 'start'), { start: 41.9, end: 42 });
});

test('trechos inválidos têm mensagem clara', () => {
  assert.equal(trimProblem(42, { start: 2, end: 12 }), '');
  assert.equal(trimProblem(42, { start: 32, end: 42 }), '', 'trecho no final');
  assert.match(trimProblem(42, { start: 5, end: 5 }), /mais de 0/);
  assert.match(trimProblem(42, { start: 0, end: 15 }), /até 10 segundos/);
  assert.match(trimProblem(42, { start: 40, end: 50 }), /dentro do áudio/);
  assert.match(trimProblem(Number.NaN, { start: 0, end: 1 }), /duração/);
});

test('duração desconhecida não aparece como zero', () => {
  assert.equal(formatSeconds(undefined), '—');
  assert.equal(formatSeconds(Number.POSITIVE_INFINITY), '—');
  assert.equal(formatSeconds(Number.NaN), '—');
  assert.equal(formatSeconds(0.8), '0,8 s');
  assert.equal(formatSeconds(10), '10,0 s');
  assert.equal(formatSeconds(75), '1:15');
});

test('WAV de 10 segundos cabe exatamente no limite do servidor', () => {
  const wav = new DataView(encodeWav(new Float32Array(22050 * 10)));
  assert.equal(wav.byteLength, 441044);
  const text = (offset, length) => String.fromCharCode(...Array.from({ length }, (_, i) => wav.getUint8(offset + i)));
  assert.equal(text(0, 4), 'RIFF');
  assert.equal(wav.getUint32(4, true), wav.byteLength - 8);
  assert.equal(text(8, 8), 'WAVEfmt ');
  assert.equal(wav.getUint16(22, true), 1, 'mono');
  assert.equal(wav.getUint32(24, true), 22050);
  assert.equal(wav.getUint16(34, true), 16);
});
