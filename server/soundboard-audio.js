// Soundboard clips are stored as validated mono, 16-bit PCM WAV files.
export function normalizeSoundboardWav(input) {
  const output = Buffer.from(input);
  let peak = 0;
  for (let offset = 44; offset < output.length; offset += 2) {
    peak = Math.max(peak, Math.abs(output.readInt16LE(offset)));
  }
  if (peak === 0) return output;
  const target = Math.floor(32767 * 10 ** (-6 / 20));
  const gain = target / peak;
  for (let offset = 44; offset < output.length; offset += 2) {
    output.writeInt16LE(Math.round(output.readInt16LE(offset) * gain), offset);
  }
  return output;
}
