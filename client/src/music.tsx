import { useEffect, useState } from 'react';
import { jsonApi } from './api';

type MusicState = {current:{title:string;url?:string;query?:string}|null;queue:{url?:string;query?:string}[];error:string;available:boolean};
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
  return <><button className="button music-trigger" title="Música" aria-label="Abrir música" onClick={()=>setOpen(true)}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M9 18V5l10-2v13M9 18c0 1.7-1.6 3-3.5 3S2 20 2 18.5 3.6 16 5.5 16 9 16.5 9 18Zm10-2c0 1.7-1.6 3-3.5 3S12 18 12 16.5 13.6 14 15.5 14s3.5.5 3.5 2Z"/></svg></button>{open&&<dialog className="admin-dialog music-dialog" ref={element=>{if(element&&!element.open)element.showModal();}} onCancel={()=>setOpen(false)} onClose={()=>setOpen(false)} aria-label="Música na call"><header><h2>Música na call</h2><button className="button subtle" onClick={()=>setOpen(false)}>Fechar</button></header><p>Digite o nome da música ou cole um link do YouTube. O primeiro resultado será adicionado à fila.</p><form onSubmit={event=>{event.preventDefault();void action('play');}}><label>Música ou link<input type="text" maxLength={1000} required value={url} onChange={event=>setUrl(event.target.value)} placeholder="Nome da música ou link do YouTube"/></label><button className="button primary" disabled={busy||!url}>Adicionar à fila</button></form><p role="status">{state?.current?'Tocando: '+state.current.title:'Nenhuma música tocando.'}</p><p>Na fila: {state?.queue.length ?? 0}</p>{!!state?.queue.length&&<ol className="music-queue">{state.queue.map((item,index)=><li key={index}>{item.url?<a href={item.url} target="_blank" rel="noreferrer">Vídeo {index+1}</a>:item.query}</li>)}</ol>}<div className="music-actions"><button className="button subtle" disabled={busy||!state?.current} onClick={()=>void action('skip')}>Pular</button><button className="button subtle" disabled={busy||(!state?.current&&!state?.queue.length)} onClick={()=>void action('stop')}>Parar e limpar fila</button></div>{(error||state?.error)&&<p className="error-message" role="alert">{error||state?.error}</p>}</dialog>}</>;
}
