// Cores do perfil: paleta tirada do banner (modo automático) ou escolhida pela pessoa (modo personalizado).
// Só afetam o cartão de perfil; o tema do site continua o mesmo.

export type ProfilePalette = {primary:string;secondary:string;accent:string};
export type BannerCrop = {x:number;y:number;zoom:number};
export type AppearanceSource = {appearanceMode?:'auto'|'custom';customColors?:string[]|null;autoPalette?:string[]|null};

// Perfis sem personalização seguem a paleta pastel do site.
export const DEFAULT_PROFILE_PALETTE:ProfilePalette = {primary:'#282329',secondary:'#211e23',accent:'#cb8883'};
export const DEFAULT_CROP:BannerCrop = {x:50,y:50,zoom:100};
export const PROFILE_COLOR_SUGGESTIONS:ProfilePalette[] = [
  {primary:'#2b1d1a',secondary:'#1b1311',accent:'#ff8b7f'},
  {primary:'#1c2230',secondary:'#12161f',accent:'#7fb2ff'},
  {primary:'#1d2a22',secondary:'#121a15',accent:'#8fd694'},
  {primary:'#2a2418',secondary:'#1a1610',accent:'#e6c48b'},
  {primary:'#271d33',secondary:'#181221',accent:'#b79cff'},
  {primary:'#e9e3d6',secondary:'#d8d0bf',accent:'#a3281f'},
];

const HEX = /^#[0-9a-f]{6}$/i;
export const isHex = (value:unknown):value is string => typeof value === 'string' && HEX.test(value);
const clamp = (value:number,min:number,max:number) => Math.min(max,Math.max(min,value));
const toHex = (rgb:number[]) => '#'+rgb.map(value => Math.round(clamp(value,0,255)).toString(16).padStart(2,'0')).join('');
const fromHex = (hex:string) => [1,3,5].map(index => parseInt(hex.slice(index,index+2),16));

function rgbToHsl([r,g,b]:number[]) {
  r/=255; g/=255; b/=255;
  const max=Math.max(r,g,b), min=Math.min(r,g,b), light=(max+min)/2, delta=max-min;
  if (!delta) return [0,0,light];
  const saturation = delta/(1-Math.abs(2*light-1));
  const hue = max===r ? ((g-b)/delta)%6 : max===g ? (b-r)/delta+2 : (r-g)/delta+4;
  return [(hue*60+360)%360,saturation,light];
}
function hslToRgb([h,s,l]:number[]) {
  const c=(1-Math.abs(2*l-1))*s, x=c*(1-Math.abs((h/60)%2-1)), m=l-c/2;
  const [r,g,b] = h<60?[c,x,0]:h<120?[x,c,0]:h<180?[0,c,x]:h<240?[0,x,c]:h<300?[x,0,c]:[c,0,x];
  return [(r+m)*255,(g+m)*255,(b+m)*255];
}

export function luminance(hex:string) {
  const [r,g,b] = fromHex(hex).map(value => value/255).map(c => c <= 0.03928 ? c/12.92 : ((c+0.055)/1.055)**2.4);
  return 0.2126*r + 0.7152*g + 0.0722*b;
}
export function contrast(a:string,b:string) {
  const [high,low] = [luminance(a),luminance(b)].sort((x,y) => y-x);
  return (high+0.05)/(low+0.05);
}
function mix(a:string,b:string,amount:number) {
  const [x,y] = [fromHex(a),fromHex(b)];
  return toHex(x.map((value,index) => value+(y[index]-value)*amount));
}

// Empurra a luminosidade da cor para longe do fundo até atingir o contraste pedido, mantendo o tom.
export function ensureContrast(color:string,backgrounds:string[],ratio:number) {
  const okay = (value:string) => backgrounds.every(background => contrast(value,background) >= ratio);
  if (okay(color)) return color;
  const canLighten = okay('#ffffff'), canDarken = okay('#000000');
  const [h,s,l] = rgbToHsl(fromHex(color));
  for (let step=1; step<=20; step++) {
    const lighter = toHex(hslToRgb([h,s,clamp(l+(1-l)*step/20,0,1)]));
    const darker = toHex(hslToRgb([h,s,clamp(l-l*step/20,0,1)]));
    if (canLighten && okay(lighter)) return lighter;
    if (canDarken && okay(darker)) return darker;
  }
  return canLighten ? '#ffffff' : '#000000';
}

// Agrupa os pixels em tons próximos: a cor de um único pixel extremo não domina a paleta.
export function paletteFromBannerPixels(pixels:ArrayLike<number>):ProfilePalette {
  const buckets = new Map<number,{count:number;r:number;g:number;b:number}>();
  let total = 0;
  for (let index=0; index+3<pixels.length; index+=4) {
    if (pixels[index+3] < 128) continue;
    const [r,g,b] = [pixels[index],pixels[index+1],pixels[index+2]];
    const key = (r>>4)<<8 | (g>>4)<<4 | (b>>4);
    const bucket = buckets.get(key) ?? {count:0,r:0,g:0,b:0};
    bucket.count++; bucket.r+=r; bucket.g+=g; bucket.b+=b; buckets.set(key,bucket); total++;
  }
  if (!total) return DEFAULT_PROFILE_PALETTE;
  const colors = [...buckets.values()].filter(bucket => bucket.count >= Math.max(2,total*0.01)).map(bucket => {
    const rgb = [bucket.r/bucket.count,bucket.g/bucket.count,bucket.b/bucket.count];
    const [,saturation,light] = rgbToHsl(rgb);
    return {rgb,share:bucket.count/total,saturation,light};
  });
  if (!colors.length) return DEFAULT_PROFILE_PALETTE;
  // Base: o tom mais presente, favorecendo cores e evitando preto ou branco puros.
  const base = colors.reduce((best,color) => {
    const score = color.share*(0.4+color.saturation)*(color.light<0.06||color.light>0.94?0.3:1);
    return score>best.score?{color,score}:best;
  },{color:colors[0],score:-1}).color;
  // Destaque: a cor viva mais relevante, de preferência num tom diferente da base; sem cor viva, um tom neutro.
  const baseHue = rgbToHsl(base.rgb)[0];
  const accentSource = colors.reduce((best,color) => {
    const distance = Math.abs(((rgbToHsl(color.rgb)[0]-baseHue+540)%360)-180);
    const score = color.share**0.5*color.saturation**2*(0.6+0.4*distance/180);
    return score>best.score?{color,score}:best;
  },{color:base,score:-1}).color;
  const [h,s] = rgbToHsl(base.rgb);
  const tone = Math.min(s,0.45);
  const primary = toHex(hslToRgb([h,tone,0.16]));
  const secondary = toHex(hslToRgb([h,tone,0.1]));
  const [ah,as] = rgbToHsl(accentSource.rgb);
  const accent = ensureContrast(toHex(hslToRgb([ah,as<0.12?as:Math.max(as,0.55),0.68])),[primary,secondary],3);
  return {primary,secondary,accent};
}

export function tripleToPalette(colors?:string[]|null):ProfilePalette|null {
  return Array.isArray(colors) && colors.length===3 && colors.every(isHex) ? {primary:colors[0].toLowerCase(),secondary:colors[1].toLowerCase(),accent:colors[2].toLowerCase()} : null;
}
export const paletteToTriple = (palette:ProfilePalette) => [palette.primary,palette.secondary,palette.accent];

// Qual paleta o perfil usa agora. `computed` é a paleta calculada no navegador quando ainda não foi salva.
export function resolvePalette(source:AppearanceSource,computed?:ProfilePalette|null):ProfilePalette {
  if (source.appearanceMode==='custom') return tripleToPalette(source.customColors) ?? DEFAULT_PROFILE_PALETTE;
  return tripleToPalette(source.autoPalette) ?? computed ?? DEFAULT_PROFILE_PALETTE;
}

// Variáveis CSS do cartão, com texto e destaque ajustados para WCAG AA (4,5:1 no texto, 3:1 nos detalhes).
export function paletteVars(palette:ProfilePalette):Record<string,string> {
  const worst = (text:string,surfaces:string[]) => Math.min(...surfaces.map(surface => contrast(text,surface)));
  const candidates = ['#f5f1e8','#151412','#ffffff','#000000'];
  const pick = (surfaces:string[]) => candidates.find(text => worst(text,surfaces)>=4.5) ?? candidates.sort((a,b) => worst(b,surfaces)-worst(a,surfaces))[0];
  let {primary,secondary} = palette;
  const text = pick([primary,secondary]);
  // Camada de contraste: se nem preto nem branco bastam, as superfícies mudam só o necessário.
  primary = ensureContrast(primary,[text],4.5); secondary = ensureContrast(secondary,[text],4.5);
  let muted = text;
  for (const amount of [0.4,0.32,0.24,0.16,0.08]) { const candidate = mix(text,secondary,amount); if (contrast(candidate,primary)>=4.5 && contrast(candidate,secondary)>=4.5) { muted = candidate; break; } }
  const accent = ensureContrast(palette.accent,[primary,secondary],3);
  const onAccent = contrast('#ffffff',accent) >= contrast('#000000',accent) ? '#ffffff' : '#000000';
  return {'--pf-primary':primary,'--pf-secondary':secondary,'--pf-accent':accent,'--pf-text':text,'--pf-muted':muted,'--pf-on-accent':onAccent};
}

export function validCrop(value:unknown):BannerCrop {
  const crop = value as BannerCrop|null;
  return crop && [crop.x,crop.y,crop.zoom].every(Number.isInteger) && crop.x>=0 && crop.x<=100 && crop.y>=0 && crop.y<=100 && crop.zoom>=100 && crop.zoom<=300 ? crop : DEFAULT_CROP;
}
export const memberSinceLabel = (time?:number|null) => time ? 'Membro desde '+new Date(time).toLocaleDateString('pt-BR',{day:'numeric',month:'long',year:'numeric'}) : '';
