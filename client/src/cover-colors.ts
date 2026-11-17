// Cores da capa da música: um fundo em degradê e um destaque para as ondas sonoras.
export type CoverPalette = { from: string; to: string; accent: string };
export const DEFAULT_PALETTE: CoverPalette = { from: '#342b32', to: '#211e23', accent: '#cb8883' };

type RGB = [number, number, number];
const hex = ([r, g, b]: RGB) => '#' + [r, g, b].map(value => Math.round(Math.max(0, Math.min(255, value))).toString(16).padStart(2, '0')).join('');
const mix = ([r, g, b]: RGB, [r2, g2, b2]: RGB, amount: number): RGB => [r + (r2 - r) * amount, g + (g2 - g) * amount, b + (b2 - b) * amount];
function hsl([r, g, b]: RGB) {
  const max = Math.max(r, g, b) / 255, min = Math.min(r, g, b) / 255, light = (max + min) / 2;
  const saturation = max === min ? 0 : (max - min) / (1 - Math.abs(2 * light - 1));
  return { saturation, light };
}

// Recebe os pixels RGBA de uma capa reduzida e devolve a paleta.
export function paletteFromPixels(data: ArrayLike<number>): CoverPalette {
  let total: RGB = [0, 0, 0], count = 0, best: RGB | null = null, bestScore = -1;
  for (let index = 0; index + 3 < data.length; index += 4) {
    if (data[index + 3] < 128) continue;
    const color: RGB = [data[index], data[index + 1], data[index + 2]];
    total = [total[0] + color[0], total[1] + color[1], total[2] + color[2]]; count++;
    const { saturation, light } = hsl(color);
    // Prefere cores vivas e nem muito escuras nem muito claras.
    const score = saturation * (1 - Math.abs(light - 0.55) * 1.6);
    if (score > bestScore) { bestScore = score; best = color; }
  }
  if (!count || !best) return DEFAULT_PALETTE;
  const average: RGB = [total[0] / count, total[1] / count, total[2] / count];
  const vivid = bestScore > 0.15 ? best : average;
  let accent = vivid;
  // As ondas precisam aparecer no fundo escuro.
  for (let step = 0; step < 6 && hsl(accent).light < 0.6; step++) accent = mix(accent, [255, 255, 255], 0.25);
  return { from: hex(mix(vivid, [16, 16, 14], 0.55)), to: hex(mix(average, [16, 16, 14], 0.72)), accent: hex(accent) };
}

const cache = new Map<string, CoverPalette>();
export async function coverPalette(url: string): Promise<CoverPalette> {
  const saved = cache.get(url); if (saved) return saved;
  const image = new Image();
  image.decoding = 'async';
  image.src = url;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = 24; canvas.height = 24;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return DEFAULT_PALETTE;
  context.drawImage(image, 0, 0, 24, 24);
  const palette = paletteFromPixels(context.getImageData(0, 0, 24, 24).data);
  cache.set(url, palette); while (cache.size > 30) cache.delete(cache.keys().next().value!);
  return palette;
}
