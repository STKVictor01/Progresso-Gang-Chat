// Sons curtos da call (entrar e sair), com volume moderado e só para quem está ouvindo.
// Arquivos próprios podem ser colocados em client/public/sounds/entrar-na-call.mp3 e sair-da-call.mp3;
// sem eles, toca um "bi-du" sintetizado (subindo ao entrar, descendo ao sair).
let context: AudioContext | null = null;
type Note = [frequency: number, start: number, length: number];
const JOIN: Note[] = [[587.33, 0, 0.11], [880, 0.12, 0.2]];
const LEAVE: Note[] = [[880, 0, 0.11], [587.33, 0.12, 0.2]];

function synthesized(notes: Note[], volume: number) {
  try {
    context ??= new AudioContext();
    const audio = context;
    void audio.resume();
    const output = audio.createGain();
    output.gain.value = volume * 0.35;
    output.connect(audio.destination);
    for (const [frequency, start, length] of notes) {
      const oscillator = audio.createOscillator();
      const envelope = audio.createGain();
      const at = audio.currentTime + start;
      oscillator.type = 'square';
      oscillator.frequency.setValueAtTime(frequency, at);
      envelope.gain.setValueAtTime(0.0001, at);
      envelope.gain.exponentialRampToValueAtTime(1, at + 0.01);
      envelope.gain.exponentialRampToValueAtTime(0.0001, at + length);
      oscillator.connect(envelope).connect(output);
      oscillator.start(at);
      oscillator.stop(at + length + 0.02);
    }
  } catch { /* Sem suporte a áudio: a call continua funcionando em silêncio. */ }
}

function play(file: string, notes: Note[], volume: number) {
  let fellBack = false;
  const fallback = () => { if (!fellBack) { fellBack = true; synthesized(notes, volume); } };
  try {
    const player = new Audio(file);
    player.volume = volume;
    player.addEventListener('error', fallback, { once: true });
    void player.play().catch(fallback);
  } catch { fallback(); }
}

export function playJoinSound(volume = 0.4) { play('/sounds/entrar-na-call.mp3', JOIN, volume); }
export function playLeaveSound(volume = 0.4) { play('/sounds/sair-da-call.mp3', LEAVE, volume); }
