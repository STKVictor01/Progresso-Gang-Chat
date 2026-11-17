// Regras do som de entrada: arquivo de origem até 8 MB e trecho final de até 10 segundos.
export const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
export const MAX_CLIP_SECONDS = 10;
// Decodificadores (MP3, AAC) costumam acrescentar alguns milissegundos; um arquivo de "10 s" não deve ser recusado por isso.
export const DURATION_TOLERANCE = 0.05;
export const TRIM_STEP = 0.1;

export type TrimRange = {start:number;end:number};

export const needsTrim = (duration:number) => Number.isFinite(duration) && duration > MAX_CLIP_SECONDS + DURATION_TOLERANCE;

const round = (value:number) => Math.round(value * 1000) / 1000;

// Trecho inicial sugerido: os primeiros 10 segundos (o usuário ajusta antes de confirmar).
export function initialTrim(duration:number):TrimRange {
  return {start:0, end:round(Math.min(duration, MAX_CLIP_SECONDS))};
}

// Mantém o trecho dentro do arquivo, com duração maior que zero e de no máximo 10 segundos.
// `moved` indica qual ponta o usuário mexeu, para a outra acompanhar quando necessário.
export function clampTrim(duration:number, range:TrimRange, moved:'start'|'end' = 'start'):TrimRange {
  if (!Number.isFinite(duration) || duration <= 0) return {start:0, end:0};
  const minimum = Math.min(TRIM_STEP, duration);
  let start = Math.min(Math.max(0, range.start), duration - minimum);
  let end = Math.min(Math.max(minimum, range.end), duration);
  if (moved === 'start') {
    if (end - start < minimum) end = Math.min(duration, start + minimum);
    if (end - start > MAX_CLIP_SECONDS) end = start + MAX_CLIP_SECONDS;
  } else {
    if (end - start < minimum) start = Math.max(0, end - minimum);
    if (end - start > MAX_CLIP_SECONDS) start = end - MAX_CLIP_SECONDS;
  }
  return {start:round(start), end:round(end)};
}

// Erro em português para um trecho que não pode ser exportado; vazio quando está tudo certo.
export function trimProblem(duration:number, range:TrimRange) {
  if (!Number.isFinite(duration) || duration <= 0) return 'Não foi possível ler a duração desse áudio.';
  if (!(range.start >= 0) || !(range.end <= duration + DURATION_TOLERANCE)) return 'O trecho precisa estar dentro do áudio.';
  const length = range.end - range.start;
  if (!(length > 0)) return 'Escolha um trecho com mais de 0 segundo.';
  if (length > MAX_CLIP_SECONDS + DURATION_TOLERANCE) return 'O trecho pode ter até 10 segundos.';
  return '';
}

// "1,5 s" ou "0:12" para valores maiores; nunca mostra 0 para uma duração desconhecida.
export function formatSeconds(value:number|null|undefined) {
  if (value == null || !Number.isFinite(value) || value < 0) return '—';
  if (value < 60) return value.toLocaleString('pt-BR', {minimumFractionDigits:1, maximumFractionDigits:1}) + ' s';
  const whole = Math.round(value);
  return Math.floor(whole / 60) + ':' + String(whole % 60).padStart(2, '0');
}
