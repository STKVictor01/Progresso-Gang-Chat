import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { coverPalette, DEFAULT_PALETTE } from './cover-colors';
import type { CoverPalette } from './cover-colors';
import { jsonApi } from './api';
import { useMultibandTrackVolume, useParticipants, useTracks } from '@livekit/components-react';
import { Track } from 'livekit-client';
import { ParticipantAudioTarget } from './participant-audio-menu';
import { useCallPreferences } from './call-preferences';
import { isListenerMuted, listenerId } from './call-settings';

type MusicState = {current:{title:string;artist?:string;cover?:string;url?:string;query?:string}|null;queue:{url?:string;query?:string}[];error:string;available:boolean};
const waveformOptions={bands:12,loPass:1,hiPass:256,updateInterval:120};
export function MusicNote({size=20}:{size?:number}) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M9 18V5l10-2v13M9 18c0 1.7-1.6 3-3.5 3S2 20 2 18.5 3.6 16 5.5 16 9 16.5 9 18Zm10-2c0 1.7-1.6 3-3.5 3S12 18 12 16.5 13.6 14 15.5 14s3.5.5 3.5 2Z"/></svg>;
}
// Capa da música, ou uma nota musical quando não há capa.
export function CoverArt({cover,className='music-cover'}:{cover?:string;className?:string}) {
  const [failed,setFailed]=useState<string|null>(null);
  return cover && failed!==cover ? <img className={className} src={cover} alt="" onError={()=>setFailed(cover)}/> : <span className={className+' music-cover-empty'}><MusicNote/></span>;
}
// Paleta tirada da capa; enquanto carrega (ou sem capa), usa as cores padrão.
// eslint-disable-next-line react-refresh/only-export-components
export function useCoverPalette(cover?:string):CoverPalette {
  const [loaded,setLoaded]=useState<Record<string,CoverPalette>>({});
  useEffect(()=>{
    if(!cover||loaded[cover])return;
    let alive=true;
    coverPalette(cover).then(palette=>{if(alive)setLoaded(previous=>({...previous,[cover]:palette}));}).catch(()=>{});
    return()=>{alive=false;};
  },[cover,loaded]);
  return cover&&loaded[cover]||DEFAULT_PALETTE;
}
export function MusicNowPlaying({channel}:{channel:string}) {
  const participants=useParticipants();
  const bot=participants.find(participant=>participant.identity.startsWith('music-bot:'));
  const audio=useTracks([Track.Source.Microphone],{onlySubscribed:true});
  const {muted,deafened}=useCallPreferences();
  const silent=deafened || !!bot && isListenerMuted(muted,listenerId(bot.identity),'microphone');
  const reference=audio.find(item=>item.participant.identity===bot?.identity);
  const bands=useMultibandTrackVolume(silent?undefined:reference,waveformOptions);
  const [state,setState]=useState<MusicState|null>(null);
  useEffect(()=>{
    if(!bot)return;
    let stopped=false;let timer:ReturnType<typeof setTimeout>;
    async function refresh(){try{const data=await jsonApi('/api/music/'+encodeURIComponent(channel)) as MusicState;if(!stopped)setState(data);}catch{if(!stopped)setState(null);}finally{if(!stopped)timer=setTimeout(refresh,3000);}}
    void refresh();return()=>{stopped=true;clearTimeout(timer);};
  },[channel,bot]);
  const current=state?.current;
  const palette=useCoverPalette(current?.cover);
  if(!bot)return null;
  const loading=!!current && (!current.title || current.title==='Carregando…');
  const colors={'--music-from':palette.from,'--music-to':palette.to,'--music-accent':palette.accent} as CSSProperties;
  return <ParticipantAudioTarget participant={bot} className="music-now-playing" style={colors}><CoverArt cover={current?.cover}/><div className="music-now-copy"><strong>{current ? loading ? 'Carregando…' : current.artist || 'Artista desconhecido' : 'Música'}</strong><span>{current ? loading ? 'Buscando a música' : current.title : 'Nenhuma música tocando'}</span></div><div className="music-wave" aria-hidden="true">{Array.from({length:12},(_,index)=><i key={index} style={{transform:`scaleY(${Math.max(.1,Math.min(1,(bands[index]||0)*1.2))})`}} />)}</div></ParticipantAudioTarget>;
}
export function MusicControl({channel}:{channel:string}) {
  const [open,setOpen]=useState(false),[url,setUrl]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [state,setState]=useState<MusicState|null>(null);
  useEffect(()=>{
    if(!open)return;
    let stopped=false;let timer:ReturnType<typeof setTimeout>;
    async function refresh(){try{const result=await jsonApi('/api/music/'+encodeURIComponent(channel)) as MusicState;if(!stopped)setState(result);}catch(cause){if(!stopped)setError(cause instanceof Error?cause.message:'Música indisponível.');}finally{if(!stopped)timer=setTimeout(refresh,3000);}}
    void refresh();return()=>{stopped=true;clearTimeout(timer);};
  },[channel,open]);
  async function action(kind:'play'|'skip'|'stop') {
    if(busy)return;setBusy(true);setError('');
    try { const base='/api/music/'+encodeURIComponent(channel);const result=await jsonApi(kind==='play'?base:base+'/'+kind,'POST',kind==='play'?{url}:{});setState(result as MusicState);if(kind==='play')setUrl(''); }
    catch(cause){setError(cause instanceof Error?cause.message:'Não foi possível controlar a música.');}finally{setBusy(false);}
  }
  return <><button className="button music-trigger" title="Música" aria-label="Abrir música" onClick={()=>setOpen(true)}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M9 18V5l10-2v13M9 18c0 1.7-1.6 3-3.5 3S2 20 2 18.5 3.6 16 5.5 16 9 16.5 9 18Zm10-2c0 1.7-1.6 3-3.5 3S12 18 12 16.5 13.6 14 15.5 14s3.5.5 3.5 2Z"/></svg></button>{open&&<dialog className="admin-dialog music-dialog" ref={element=>{if(element&&!element.open)element.showModal();}} onCancel={()=>setOpen(false)} onClose={()=>setOpen(false)} aria-label="Música na call"><header><h2>Música na call</h2><button className="button subtle" onClick={()=>setOpen(false)}>Fechar</button></header><section className="music-now-panel" aria-labelledby="music-now-title"><CoverArt cover={state?.current?.cover}/><div className="music-now-panel-copy"><small id="music-now-title"><MusicNote size={14}/> Tocando agora</small><strong role="status">{state?.current ? state.current.title==='Carregando…' ? 'Carregando…' : state.current.title : 'Nada tocando'}</strong>{state?.current?.artist && <span>{state.current.artist}</span>}</div><div className="music-now-panel-actions"><button className="button subtle" disabled={busy||!state?.current} onClick={()=>void action('skip')} title="Pular para a próxima">Pular</button><button className="button subtle danger" disabled={busy||(!state?.current&&!state?.queue.length)} onClick={()=>void action('stop')} title="Parar e limpar a fila">Parar</button></div></section><form className="music-search" onSubmit={event=>{event.preventDefault();void action('play');}}><label>Adicionar à fila<input type="text" maxLength={1000} required value={url} onChange={event=>setUrl(event.target.value)} placeholder="Nome da música ou link do YouTube"/></label><button className="button primary" disabled={busy||!url}>Adicionar</button></form><small className="field-help">O primeiro resultado da busca entra na fila.</small><div className="playlist" aria-labelledby="playlist-title"><div className="playlist-heading"><h3 id="playlist-title">Próximas</h3><span>{state?.queue.length ?? 0} {state?.queue.length===1?'música':'músicas'}</span></div>{state?.queue.length ? <ol className="playlist-rows">{state.queue.map((item,index)=><li key={index} className="playlist-row"><span className="playlist-position">{index+1}</span><CoverArt className="playlist-cover"/><span className="playlist-title"><strong>{item.url ? 'Vídeo do YouTube' : item.query}</strong><small>{item.url ? <a href={item.url} target="_blank" rel="noreferrer">Abrir link</a> : 'Busca por nome'}</small></span></li>)}</ol> : <p className="playlist-empty">A fila está vazia. Adicione uma música acima.</p>}</div>{(error||state?.error)&&<p className="error-message" role="alert">{error||state?.error}</p>}</dialog>}</>;
}
