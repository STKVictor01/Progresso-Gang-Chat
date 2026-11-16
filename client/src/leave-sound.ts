// Som curto ao sair da call, só para quem saiu e com volume moderado.
// Se existir /sounds/sair-da-call.mp3 em client/public, ele é usado; senão, toca um "bi-du" sintetizado.
const CUSTOM_SOUND = '/sounds/sair-da-call.mp3';
let context: AudioContext | null = null;

function synthesized(volume: number) {
  try {
    context ??= new AudioContext();
    const audio = context;
    void audio.resume();
    const output = audio.createGain();
    output.gain.value = volume * 0.35;
    output.connect(audio.destination);
    // Duas notas descendentes, curtas e suaves.
    [[880, 0, 0.11], [587.33, 0.12, 0.2]].forEach(([frequency, start, length]) => {
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
    });
  } catch { /* Sem suporte a áudio: sair continua funcionando em silêncio. */ }
}

export function playLeaveSound(volume = 0.4) {
  let fellBack = false;
  const fallback = () => { if (!fellBack) { fellBack = true; synthesized(volume); } };
  try {
    const player = new Audio(CUSTOM_SOUND);
    player.volume = volume;
    player.addEventListener('error', fallback, { once: true });
    void player.play().catch(fallback);
  } catch { fallback(); }
}
