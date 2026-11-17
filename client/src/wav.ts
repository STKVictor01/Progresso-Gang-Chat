// WAV PCM mono de 16 bits, o formato aceito pelo servidor para sons.
export const WAV_RATE = 22050;
export function encodeWav(samples:Float32Array) {
  const buffer = new ArrayBuffer(44 + samples.length * 2), view = new DataView(buffer);
  const write = (offset:number, text:string) => { for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)); };
  write(0,'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); write(8,'WAVEfmt '); view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,1,true); view.setUint32(24,WAV_RATE,true); view.setUint32(28,WAV_RATE*2,true); view.setUint16(32,2,true); view.setUint16(34,16,true); write(36,'data'); view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), true);
  return buffer;
}
