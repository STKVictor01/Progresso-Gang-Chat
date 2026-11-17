import { DURATION_TOLERANCE, MAX_CLIP_SECONDS, MAX_SOURCE_BYTES, trimProblem } from './audio-trim';
import type { TrimRange } from './audio-trim';
import { encodeWav, WAV_RATE as RATE } from './wav';

const MAX_SAMPLES = RATE * MAX_CLIP_SECONDS; // 220.500 amostras: WAV de 441.044 bytes, o limite do servidor.

async function decode(file:Blob) {
  if (file.size > MAX_SOURCE_BYTES) throw Error('Escolha um arquivo de até 8 MB.');
  const context = new AudioContext();
  try {
    try { return await context.decodeAudioData(await file.arrayBuffer()); }
    catch { throw Error('Não foi possível ler esse áudio. Escolha outro arquivo.'); }
  } finally { await context.close(); }
}

// Lê o arquivo só para descobrir a duração (e validar se o navegador consegue decodificá-lo).
export async function readAudioDuration(file:Blob) {
  const decoded = await decode(file);
  if (!decoded.duration) throw Error('Esse áudio está vazio.');
  return decoded.duration;
}

// Converte para WAV PCM mono, 22.050 Hz e 16 bits. Sem `trim`, aceita até 10 segundos (comportamento do soundboard).
// Com `trim`, exporta somente o trecho escolhido.
export async function convertAudio(file:Blob, trim?:TrimRange) {
  const decoded = await decode(file);
  let offset = 0, seconds = decoded.duration;
  if (trim) {
    const problem = trimProblem(decoded.duration, trim);
    if (problem) throw Error(problem);
    offset = trim.start; seconds = Math.min(trim.end, decoded.duration) - trim.start;
  } else if (!decoded.duration || decoded.duration > MAX_CLIP_SECONDS + DURATION_TOLERANCE) throw Error('Escolha um áudio de até 10 segundos.');
  const length = Math.max(1, Math.min(MAX_SAMPLES, Math.ceil(seconds * RATE)));
  const offline = new OfflineAudioContext(1, length, RATE);
  const source = offline.createBufferSource(); source.buffer = decoded; source.connect(offline.destination);
  source.start(0, offset, seconds);
  return encodeWav((await offline.startRendering()).getChannelData(0));
}
