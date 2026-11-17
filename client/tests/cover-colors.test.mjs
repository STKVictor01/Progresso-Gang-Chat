import test from 'node:test';
import assert from 'node:assert/strict';
import { paletteFromPixels, DEFAULT_PALETTE } from '../src/cover-colors.ts';

const pixels = (...colors) => colors.flatMap(([r, g, b, a = 255]) => [r, g, b, a]);
const light = color => { const [r, g, b] = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16)); return (Math.max(r, g, b) + Math.min(r, g, b)) / 510; };

test('capa vermelha gera destaque avermelhado e fundo escuro', () => {
  const palette = paletteFromPixels(pixels([200, 20, 20], [180, 30, 30], [40, 40, 40]));
  const [r, g, b] = [1, 3, 5].map(i => parseInt(palette.accent.slice(i, i + 2), 16));
  assert.ok(r > g && r > b, palette.accent);
  assert.ok(light(palette.accent) >= 0.6, 'ondas visíveis no fundo escuro');
  assert.ok(light(palette.from) < 0.4 && light(palette.to) < 0.4, 'fundo escuro para o texto claro');
});

test('capa transparente ou vazia usa as cores padrão', () => {
  assert.deepEqual(paletteFromPixels([]), DEFAULT_PALETTE);
  assert.deepEqual(paletteFromPixels(pixels([255, 0, 0, 0])), DEFAULT_PALETTE);
});

test('capa cinza não inventa cor viva', () => {
  const palette = paletteFromPixels(pixels([90, 90, 90], [100, 100, 100]));
  const [r, g, b] = [1, 3, 5].map(i => parseInt(palette.accent.slice(i, i + 2), 16));
  assert.ok(Math.max(r, g, b) - Math.min(r, g, b) < 12, palette.accent);
});
