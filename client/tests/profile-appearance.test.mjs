import test from 'node:test';
import assert from 'node:assert/strict';
import { contrast, DEFAULT_PROFILE_PALETTE, paletteFromBannerPixels, paletteVars, resolvePalette, validCrop, luminance } from '../src/profile-appearance.ts';

const fill = (count, [r, g, b, a = 255]) => Array.from({ length: count }, () => [r, g, b, a]).flat();
const hue = hex => { const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)); return { r, g, b }; };
function assertReadable(palette) {
  const vars = paletteVars(palette);
  for (const surface of [vars['--pf-primary'], vars['--pf-secondary']]) {
    assert.ok(contrast(vars['--pf-text'], surface) >= 4.5, 'texto ' + JSON.stringify(vars));
    assert.ok(contrast(vars['--pf-muted'], surface) >= 4.5, 'texto secundário ' + JSON.stringify(vars));
    assert.ok(contrast(vars['--pf-accent'], surface) >= 3, 'destaque ' + JSON.stringify(vars));
  }
  assert.ok(contrast(vars['--pf-on-accent'], vars['--pf-accent']) >= 4.5, 'texto sobre o destaque');
}

test('banner colorido gera paleta do mesmo tom e legível', () => {
  const palette = paletteFromBannerPixels([...fill(300, [30, 60, 160]), ...fill(80, [240, 200, 40])]);
  const primary = hue(palette.primary);
  assert.ok(primary.b > primary.r && primary.b > primary.g, palette.primary);
  const accent = hue(palette.accent);
  assert.ok(accent.r > accent.b && accent.g > accent.b, 'destaque vem do amarelo ' + palette.accent);
  assertReadable(palette);
});

test('banners claros e escuros continuam com fundo escuro e texto legível', () => {
  for (const color of [[250, 248, 240], [5, 5, 8], [255, 255, 255]]) {
    const palette = paletteFromBannerPixels(fill(200, color));
    assert.ok(luminance(palette.primary) < 0.1, palette.primary);
    assertReadable(palette);
  }
});

test('um pixel extremo não domina a paleta', () => {
  const palette = paletteFromBannerPixels([...fill(500, [40, 120, 60]), ...fill(1, [255, 0, 255])]);
  const accent = hue(palette.accent);
  assert.ok(accent.g > accent.r && accent.g > accent.b, palette.accent);
});

test('banner vazio ou transparente usa a paleta padrão', () => {
  assert.deepEqual(paletteFromBannerPixels([]), DEFAULT_PROFILE_PALETTE);
  assert.deepEqual(paletteFromBannerPixels(fill(10, [255, 0, 0, 0])), DEFAULT_PROFILE_PALETTE);
});

test('modo personalizado prevalece e o automático usa o banner ou o padrão', () => {
  const custom = ['#e9e3d6', '#d8d0bf', '#a3281f'], auto = ['#101820', '#0a0f14', '#7fb2ff'];
  assert.deepEqual(resolvePalette({ appearanceMode: 'custom', customColors: custom, autoPalette: auto }), { primary: custom[0], secondary: custom[1], accent: custom[2] });
  assert.deepEqual(resolvePalette({ appearanceMode: 'auto', customColors: custom, autoPalette: auto }), { primary: auto[0], secondary: auto[1], accent: auto[2] });
  assert.deepEqual(resolvePalette({ appearanceMode: 'auto', customColors: custom, autoPalette: null }), DEFAULT_PROFILE_PALETTE);
  assert.deepEqual(resolvePalette({ appearanceMode: 'custom', customColors: null }), DEFAULT_PROFILE_PALETTE);
});

test('combinações ruins têm texto e destaque corrigidos', () => {
  for (const palette of [
    { primary: '#ffffff', secondary: '#f4f4f4', accent: '#ffff00' },
    { primary: '#777777', secondary: '#808080', accent: '#7a7a7a' },
    { primary: '#000000', secondary: '#050505', accent: '#000010' },
    { primary: '#ff0000', secondary: '#00ff00', accent: '#0000ff' },
    { primary: '#824367', secondary: '#a69060', accent: '#fd2b2d' },
    { primary: '#fef687', secondary: '#c2dfdd', accent: '#728bee' },
  ]) assertReadable(palette);
  // A cor escolhida para as superfícies é preservada.
  assert.equal(paletteVars({ primary: '#777777', secondary: '#808080', accent: '#7a7a7a' })['--pf-primary'], '#777777');
});

test('recorte inválido volta ao centro', () => {
  assert.deepEqual(validCrop({ x: 20, y: 80, zoom: 150 }), { x: 20, y: 80, zoom: 150 });
  for (const crop of [null, { x: -1, y: 0, zoom: 100 }, { x: 0, y: 0, zoom: 400 }, { x: 1.5, y: 0, zoom: 100 }]) assert.deepEqual(validCrop(crop), { x: 50, y: 50, zoom: 100 });
});
