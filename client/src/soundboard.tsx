import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useRoomContext } from '@livekit/components-react';
import { RoomEvent } from 'livekit-client';
import { api, jsonApi } from './api';

type Sound = {id:string;name:string;canDelete:boolean};
const topic='pg-soundboard-v1';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

async function convertAudio(file:File) {
  if(file.size>8*1024*1024)throw Error('Escolha um arquivo de até 8 MB.');
  const context=new AudioContext();
  try {
    const decoded=await context.decodeAudioData(await file.arrayBuffer());
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
export function Soundboard({channel}:{channel:string}) {
  const room=useRoomContext();
  const [open,setOpen]=useState(false),[sounds,setSounds]=useState<Sound[]>([]),[file,setFile]=useState<File|null>(null),[name,setName]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const audio=useRef<HTMLAudioElement|null>(null);
  const fileInput=useRef<HTMLInputElement>(null);
  const last=useRef(0);
  async function refresh(){const data=await jsonApi('/api/soundboard?'+new URLSearchParams({channel}));setSounds(data.sounds);}
  const play=useCallback((id:string) => {
    if(!uuid.test(id))return;
    audio.current?.pause();
    const player=new Audio('/api/soundboard/'+id+'?'+new URLSearchParams({channel}));
    audio.current=player;
    void player.play().catch(()=>setError('Não foi possível reproduzir o som. Confira o áudio do navegador.'));
  },[channel]);
  useEffect(()=>{
    const receive=(payload:Uint8Array,_participant:unknown,_kind:unknown,receivedTopic?:string)=>{
      if(receivedTopic!==topic||payload.length>100)return;
      const id=new TextDecoder().decode(payload);
      if(Date.now()-last.current<500)return;
      last.current=Date.now();play(id);
    };
    room.on(RoomEvent.DataReceived,receive);
    return()=>{room.off(RoomEvent.DataReceived,receive);audio.current?.pause();};
  },[room,channel,play]);
  async function broadcast(sound:Sound){
    if(busy)return;setBusy(true);setError('');
    try{const sent=room.localParticipant.publishData(new TextEncoder().encode(sound.id),{reliable:true,topic});play(sound.id);await sent;}
    catch{setError('Não foi possível enviar o som à chamada.');}finally{setBusy(false);}
  }
  async function upload(event:FormEvent){
    event.preventDefault();if(!file||busy)return;setBusy(true);setError('');
    try{
      const wav=await convertAudio(file);
      const response=await api('/api/soundboard',{method:'POST',headers:{'Content-Type':'application/octet-stream','x-sound-channel':channel,'x-sound-name':encodeURIComponent(name.trim())},body:wav});
      if(!response.ok){const data=await response.json();throw Error(data.error||'Não foi possível adicionar o som.');}
      setFile(null);setName('');if(fileInput.current)fileInput.current.value='';await refresh();
    }catch(cause){setError(cause instanceof Error?cause.message:'Não foi possível ler o áudio.');}finally{setBusy(false);}
  }
  async function remove(sound:Sound){
    if(!window.confirm('Excluir o som '+sound.name+' deste canal?'))return;
    try{const response=await api('/api/soundboard/'+sound.id,{method:'DELETE'});if(!response.ok)throw Error('Não foi possível excluir o som.');await refresh();}catch(cause){setError(cause instanceof Error?cause.message:'Erro ao excluir.');}
  }
  return <><button className="button soundboard-trigger" title="Soundboard" aria-label="Abrir soundboard" onClick={()=>{setOpen(true);void refresh().catch(()=>setError('Não foi possível carregar os sons.'));}}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg></button>{open&&<dialog className="admin-dialog soundboard-dialog" ref={element=>{if(element&&!element.open)element.showModal();}} onCancel={()=>setOpen(false)} onClose={()=>setOpen(false)} aria-label="Soundboard"><header><h2>Soundboard</h2><button className="button subtle" onClick={()=>setOpen(false)}>Fechar</button></header><p>Toque um som para todas as pessoas neste canal.</p><div className="soundboard-grid">{sounds.map(sound=><div className="soundboard-tile" key={sound.id}><button className="soundboard-play" disabled={busy} onClick={()=>void broadcast(sound)} aria-label={'Tocar '+sound.name}>▶ <span>{sound.name}</span></button>{sound.canDelete&&<button className="icon-button" onClick={()=>void remove(sound)} aria-label={'Excluir '+sound.name}>×</button>}</div>)}</div>{!sounds.length&&<p>Adicione o primeiro som deste canal.</p>}<form onSubmit={upload}><label>Nome do som<input required maxLength={40} value={name} onChange={event=>setName(event.target.value)} /></label><label>Arquivo de áudio<input ref={fileInput} type="file" required accept="audio/*" onChange={event=>setFile(event.target.files?.[0]||null)}/></label><small>Até 10 segundos e 8 MB por arquivo. Limite de 50 sons por canal.</small><button className="button primary" disabled={busy||!file}>{busy?'Aguarde…':'Adicionar som'}</button></form>{error&&<p className="error-message" role="alert">{error}</p>}</dialog>}{!open&&error&&<span className="sr-only" role="status">{error}</span>}</>;
}
