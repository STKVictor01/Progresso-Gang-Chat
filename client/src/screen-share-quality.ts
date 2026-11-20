// Qualidade da transmissão de tela: escolhas do usuário e as opções enviadas ao LiveKit.
// Sem as opções, o LiveKit usa 1080p a 15 quadros por segundo, o que deixava jogos travados.

export type ShareResolution = '720' | '1080' | '1440' | '2160';
export type ShareFramerate = 30 | 60;
export type ShareBitrate = 'economica' | 'equilibrada' | 'alta';
export type SharePriority = 'fluidez' | 'equilibrio' | 'nitidez';
export type ShareQuality = {resolution:ShareResolution; framerate:ShareFramerate; bitrate:ShareBitrate; priority:SharePriority};

export const DEFAULT_SHARE_QUALITY:ShareQuality = {resolution:'1080', framerate:60, bitrate:'equilibrada', priority:'fluidez'};
export const SHARE_QUALITY_KEY = 'pg-screen-share-quality';

export const RESOLUTIONS:{id:ShareResolution;label:string;width:number;height:number}[] = [
  {id:'720',label:'720p',width:1280,height:720},
  {id:'1080',label:'1080p (Full HD)',width:1920,height:1080},
  {id:'1440',label:'1440p (2K)',width:2560,height:1440},
  {id:'2160',label:'2160p (4K)',width:3840,height:2160},
];
export const FRAMERATES:{id:ShareFramerate;label:string}[] = [
  {id:30,label:'30 quadros por segundo'},
  {id:60,label:'60 quadros por segundo'},
];
export const BITRATES:{id:ShareBitrate;label:string;factor:number}[] = [
  {id:'economica',label:'Econômica: para internet mais fraca',factor:.6},
  {id:'equilibrada',label:'Equilibrada: recomendada',factor:1},
  {id:'alta',label:'Alta: internet boa de quem transmite e de quem assiste',factor:1.5},
];
export const PRIORITIES:{id:SharePriority;label:string;description:string}[] = [
  {id:'fluidez',label:'Fluidez',description:'Para jogos e vídeos: mantém os quadros por segundo e reduz a nitidez se a rede apertar.'},
  {id:'equilibrio',label:'Equilíbrio',description:'Divide a redução entre nitidez e quadros por segundo.'},
  {id:'nitidez',label:'Nitidez',description:'Para textos e código: mantém a imagem nítida e reduz os quadros por segundo se a rede apertar.'},
];

// Bitrate base (bits/s) a 30 quadros por segundo; 60 quadros pedem cerca de 1,5×.
const BASE_BITRATE:Record<ShareResolution,number> = {'720':2_500_000,'1080':4_000_000,'1440':6_000_000,'2160':10_000_000};

export function normalizeShareQuality(value:unknown):ShareQuality {
  const input = value && typeof value === 'object' ? value as Partial<Record<keyof ShareQuality,unknown>> : {};
  const pick = <T,>(options:readonly T[], candidate:unknown, fallback:T) => options.includes(candidate as T) ? candidate as T : fallback;
  return {
    resolution:pick(RESOLUTIONS.map(item => item.id), input.resolution, DEFAULT_SHARE_QUALITY.resolution),
    framerate:pick(FRAMERATES.map(item => item.id), input.framerate, DEFAULT_SHARE_QUALITY.framerate),
    bitrate:pick(BITRATES.map(item => item.id), input.bitrate, DEFAULT_SHARE_QUALITY.bitrate),
    priority:pick(PRIORITIES.map(item => item.id), input.priority, DEFAULT_SHARE_QUALITY.priority),
  };
}

export function readShareQuality(storage:Pick<Storage,'getItem'>|undefined = globalThis.localStorage):ShareQuality {
  try { return normalizeShareQuality(JSON.parse(storage?.getItem(SHARE_QUALITY_KEY) ?? 'null')); }
  catch { return DEFAULT_SHARE_QUALITY; }
}

export function saveShareQuality(quality:ShareQuality, storage:Pick<Storage,'setItem'>|undefined = globalThis.localStorage) {
  try { storage?.setItem(SHARE_QUALITY_KEY, JSON.stringify(normalizeShareQuality(quality))); } catch { /* Armazenamento opcional. */ }
}

export function shareBitrate(quality:ShareQuality) {
  const factor = BITRATES.find(item => item.id === quality.bitrate)?.factor ?? 1;
  return Math.round(BASE_BITRATE[quality.resolution] * (quality.framerate === 60 ? 1.5 : 1) * factor);
}

export type ShareLayer = {width:number;height:number;maxBitrate:number;maxFramerate:number};
export type SharePlan = {
  capture:{resolution?:{width:number;height:number;frameRate:number};contentHint?:'motion'|'detail'};
  encoding:{maxBitrate:number;maxFramerate:number;priority:'high'};
  layers:ShareLayer[];
  degradationPreference:'maintain-framerate'|'balanced'|'maintain-resolution';
  videoCodec:'vp8';
};

// Converte as escolhas nas opções de captura e envio. Navegadores que assistem com conexão pior
// recebem uma camada menor com os mesmos quadros por segundo, em vez de travar a imagem.
export function sharePlan(quality:ShareQuality, browser:{safari:boolean;firefox:boolean}):SharePlan {
  const size = RESOLUTIONS.find(item => item.id === quality.resolution) ?? RESOLUTIONS[1];
  const maxBitrate = shareBitrate(quality);
  const lowHeight = size.height > 720 ? 720 : 480;
  const lowWidth = Math.round(lowHeight * 16 / 9);
  return {
    // No Safari 17, informar a resolução derruba a captura para baixa definição (bug do WebKit 263015).
    capture:{...(browser.safari ? {} : {resolution:{width:size.width,height:size.height,frameRate:quality.framerate}}), ...(quality.priority === 'fluidez' ? {contentHint:'motion'} : quality.priority === 'nitidez' ? {contentHint:'detail'} : {})},
    encoding:{maxBitrate,maxFramerate:quality.framerate,priority:'high'},
    layers:[{width:lowWidth,height:lowHeight,maxBitrate:Math.round(maxBitrate * .4),maxFramerate:quality.framerate}],
    degradationPreference:quality.priority === 'fluidez' ? 'maintain-framerate' : quality.priority === 'nitidez' ? 'maintain-resolution' : 'balanced',
    // VP8 é aceito por todos os navegadores do grupo (PC, iPhone e Android). Em teste com o LiveKit,
    // o H.264 com camadas não liberou a camada principal e manteve a banda estimada abaixo de 1 Mbps.
    videoCodec:'vp8',
  };
}

export function formatMbps(bitsPerSecond:number) {
  return (bitsPerSecond / 1_000_000).toLocaleString('pt-BR', {maximumFractionDigits:1}) + ' Mbps';
}
