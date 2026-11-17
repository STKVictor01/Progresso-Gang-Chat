// Soundboard clips are stored as validated mono, 16-bit PCM WAV files.
export function validSoundboardWav(b) {
  return Buffer.isBuffer(b) && b.length>=46 && b.length<=441044 && b.toString('ascii',0,4)==='RIFF' && b.readUInt32LE(4)===b.length-8 && b.toString('ascii',8,16)==='WAVEfmt ' && b.readUInt32LE(16)===16 && b.readUInt16LE(20)===1 && b.readUInt16LE(22)===1 && b.readUInt32LE(24)===22050 && b.readUInt32LE(28)===44100 && b.readUInt16LE(32)===2 && b.readUInt16LE(34)===16 && b.toString('ascii',36,40)==='data' && b.readUInt32LE(40)===b.length-44 && (b.length-44)%2===0;
}
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
