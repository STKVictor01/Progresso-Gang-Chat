export async function convertAudio(file:File) {
  if(file.size>8*1024*1024)throw Error('Escolha um arquivo de até 8 MB.');
  const context=new AudioContext();
  try {
    let decoded:AudioBuffer;
    try { decoded=await context.decodeAudioData(await file.arrayBuffer()); }
    catch { throw Error('Não foi possível ler esse áudio. Escolha outro arquivo.'); }
    if(!decoded.duration || decoded.duration>10)throw Error('Escolha um áudio de até 10 segundos.');
    const length=Math.min(220500,Math.ceil(decoded.duration*22050));
    const offline=new OfflineAudioContext(1,length,22050);
    const source=offline.createBufferSource();source.buffer=decoded;source.connect(offline.destination);source.start();
    const samples=(await offline.startRendering()).getChannelData(0);
    const buffer=new ArrayBuffer(44+samples.length*2), view=new DataView(buffer);
    const write=(offset:number,text:string)=>{for(let i=0;i<text.length;i++)view.setUint8(offset+i,text.charCodeAt(i));};
    write(0,'RIFF');view.setUint32(4,buffer.byteLength-8,true);write(8,'WAVEfmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,22050,true);view.setUint32(28,44100,true);view.setUint16(32,2,true);view.setUint16(34,16,true);write(36,'data');view.setUint32(40,samples.length*2,true);
    for(let i=0;i<samples.length;i++)view.setInt16(44+i*2,Math.round(Math.max(-1,Math.min(1,samples[i]))*32767),true);
    return buffer;
  } finally { await context.close(); }
}
