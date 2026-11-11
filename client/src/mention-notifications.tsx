import { useEffect, useRef, useState } from 'react';
import { useAccount } from './accounts';
import { api } from './api';
import { hasMention } from './mentions';

type Message = {id:number; user_id:string|null; name:string; text:string};
type Notice = {id:number; channel:string; name:string};
function readNotices(key:string):Notice[] {
  try { const data=JSON.parse(localStorage.getItem(key)||'[]');return Array.isArray(data)?data.filter(item=>Number.isSafeInteger(item.id)&&typeof item.channel==='string'&&typeof item.name==='string').slice(-50):[]; } catch { return []; }
}
export function MentionNotifications({onOpen}: {onOpen: (channel:string)=>void}) {
  const {user,text,voice} = useAccount();
  const channels = [...text.map(item => item.id), ...voice.map(item => 'voice:'+item.id)].join('|');
  const key='pg-mentions-pending:'+user.id;
  const audio = useRef<AudioContext|null>(null);
  const [notices,setNotices] = useState<Notice[]>(()=>readNotices(key));
  useEffect(() => {
    const enable = () => { try { audio.current ??= new AudioContext(); void audio.current.resume().catch(() => {}); } catch { /* Visual notification remains available. */ } };
    window.addEventListener('pointerdown',enable,{once:true});window.addEventListener('keydown',enable,{once:true});
    return () => { window.removeEventListener('pointerdown',enable);window.removeEventListener('keydown',enable);void audio.current?.close();audio.current=null; };
  }, []);
  useEffect(() => {
    let stopped=false;let timer:ReturnType<typeof setTimeout>;
    const cursors=new Map<string,number>();const ids=channels ? channels.split('|') : [];
    for(const channel of ids)try {const value=localStorage.getItem('pg-mention-cursor:'+user.id+':'+channel);if(value!==null&&/^\d+$/.test(value)&&Number.isSafeInteger(Number(value)))cursors.set(channel,Number(value));}catch{/* Storage is optional. */}
    async function poll() {
      await Promise.all(ids.map(async channel => {
        try {
          const query=new URLSearchParams({channel});const cursor=cursors.get(channel);if(cursor!==undefined)query.set('since',String(cursor));
          const response=await api('/api/messages?'+query,{cache:'no-store'});if(!response.ok)return;
          const data=await response.json() as {cursor:number;messages:Message[];deletedIds?:number[];hasMore?:boolean};if(stopped)return;
          const found=data.messages.filter(item=>item.user_id!==user.id&&hasMention(item.text,user.name)).map(item=>({id:item.id,channel,name:item.name}));
          // On a new device, walk saved history until we find recent mentions, then switch to the event cursor.
          if(cursor===undefined) {
            let page=data;
            while(page.hasMore && page.messages.length && found.length<50 && !stopped) {
              const older=new URLSearchParams({channel,before:String(page.messages[0].id)});
              const result=await api('/api/messages?'+older,{cache:'no-store'});if(!result.ok)throw Error('Histórico indisponível');
              page=await result.json() as typeof data;
              found.unshift(...page.messages.filter(item=>item.user_id!==user.id&&hasMention(item.text,user.name)).map(item=>({id:item.id,channel,name:item.name})));
            }
            if(stopped)return;
          }
          if(found.length||data.deletedIds?.length) {
            setNotices(previous=>{
              const merged=[...new Map([...previous.filter(item=>!data.deletedIds?.includes(item.id)),...found].map(item=>[item.channel+':'+item.id,item])).values()].slice(-50);
              try {localStorage.setItem(key,JSON.stringify(merged));}catch{/* Storage is optional. */}return merged;
            });
            if(found.length&&cursor!==undefined&&audio.current?.state==='running') {
              const context=audio.current, oscillator=context.createOscillator(), gain=context.createGain();
              oscillator.type='sine';oscillator.frequency.value=660;gain.gain.setValueAtTime(0.08,context.currentTime);gain.gain.exponentialRampToValueAtTime(0.001,context.currentTime+0.2);
              oscillator.connect(gain);gain.connect(context.destination);oscillator.start();oscillator.stop(context.currentTime+0.2);oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};
            }
          }
          cursors.set(channel,data.cursor);try{localStorage.setItem('pg-mention-cursor:'+user.id+':'+channel,String(data.cursor));}catch{/* Storage is optional. */}
        } catch { /* Keep polling after transient failures. */ }
      }));
      if(!stopped)timer=setTimeout(poll,3000);
    }
    void poll();return()=>{stopped=true;clearTimeout(timer);};
  },[channels,user.id,user.name,key]);
  function dismiss(){setNotices([]);try{localStorage.removeItem(key);}catch{/* Storage is optional. */}}
  if(!notices.length)return null;
  return <div className="mention-notice" role="status"><div><strong>Menções para você ({notices.length})</strong><ul>{[...notices].reverse().map(item=>{const channelName=item.channel.startsWith('voice:') ? 'chat da call '+(voice.find(channel=>channel.id===item.channel.slice(6))?.name || '') : '#'+(text.find(channel=>channel.id===item.channel)?.name || 'chat');return <li key={item.channel+':'+item.id}><button type="button" onClick={()=>onOpen(item.channel)}>{item.name} · {channelName}</button></li>;})}</ul></div><button className="button subtle" onClick={dismiss} aria-label="Fechar aviso de menções">×</button></div>;
}
