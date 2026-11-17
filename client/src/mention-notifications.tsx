import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useAccount } from './accounts';
import { api } from './api';
import { hasMention } from './mentions';
import { activityPollDelay } from './polling';

type Message = {id:number; user_id:string|null; name:string; text:string};
type Notice = {id:number; channel:string; name:string};
type Activity = {
  notices: Notice[];
  dismiss: () => void;
  // Por conversa: há mensagens novas de outras pessoas e quantas menções ainda não lidas.
  unread: (channel: string) => boolean;
  mentions: (channel: string) => number;
  markRead: (channel: string, id: number) => void;
};
const ActivityContext = createContext<Activity | null>(null);
// eslint-disable-next-line react-refresh/only-export-components
export function useActivity() { const value = useContext(ActivityContext); if (!value) throw Error('Atividade não carregada'); return value; }

function readNotices(key:string):Notice[] {
  try { const data=JSON.parse(localStorage.getItem(key)||'[]');return Array.isArray(data)?data.filter(item=>Number.isSafeInteger(item.id)&&typeof item.channel==='string'&&typeof item.name==='string').slice(-50):[]; } catch { return []; }
}
function readNumber(key:string) { try { const value=localStorage.getItem(key); return value!==null&&/^\d+$/.test(value)&&Number.isSafeInteger(Number(value))?Number(value):undefined; } catch { return undefined; } }
function writeNumber(key:string,value:number) { try { localStorage.setItem(key,String(value)); } catch { /* Armazenamento opcional. */ } }

export function ActivityProvider({children}:{children:ReactNode}) {
  const {user,text,voice} = useAccount();
  const channels = [...text.map(item => item.id), ...voice.map(item => 'voice:'+item.id)].join('|');
  const key='pg-mentions-pending:'+user.id;
  const readKey=useCallback((channel:string)=>'pg-read:'+user.id+':'+channel,[user.id]);
  const audio = useRef<AudioContext|null>(null);
  const [notices,setNotices] = useState<Notice[]>(()=>readNotices(key));
  const [latest,setLatest] = useState<Record<string,number>>({});
  const [read,setRead] = useState<Record<string,number>>({});
  useEffect(() => {
    const enable = () => { try { audio.current ??= new AudioContext(); void audio.current.resume().catch(() => {}); } catch { /* Visual notification remains available. */ } };
    window.addEventListener('pointerdown',enable,{once:true});window.addEventListener('keydown',enable,{once:true});
    return () => { window.removeEventListener('pointerdown',enable);window.removeEventListener('keydown',enable);void audio.current?.close();audio.current=null; };
  }, []);
  useEffect(() => {
    let stopped=false,running=false;let timer:ReturnType<typeof setTimeout>;
    const cursors=new Map<string,number>();const ids=channels ? channels.split('|') : [];
    const started=new Set<string>();
    for(const channel of ids){const value=readNumber('pg-mention-cursor:'+user.id+':'+channel);if(value!==undefined)cursors.set(channel,value);}
    async function poll() {
      if(stopped||running)return;
      running=true;
      await Promise.all(ids.map(async channel => {
        try {
          const query=new URLSearchParams({channel});const cursor=cursors.get(channel);if(cursor!==undefined)query.set('since',String(cursor));
          const response=await api('/api/messages?'+query,{cache:'no-store'});if(!response.ok)return;
          const data=await response.json() as {cursor:number;messages:Message[];deletedIds?:number[];hasMore?:boolean};if(stopped)return;
          const newest=Math.max(0,...data.messages.filter(item=>item.user_id!==user.id).map(item=>item.id));
          // Primeira verificação desta sessão: usa o que já foi lido; num aparelho novo, o que já existia conta como lido.
          if(!started.has(channel)){
            started.add(channel);
            const saved=readNumber('pg-read:'+user.id+':'+channel);
            if(saved===undefined)writeNumber('pg-read:'+user.id+':'+channel,newest);
            setRead(previous=>previous[channel]!==undefined?previous:{...previous,[channel]:saved ?? newest});
          }
          if(newest)setLatest(previous=>previous[channel]>=newest?previous:{...previous,[channel]:newest});
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
          cursors.set(channel,data.cursor);writeNumber('pg-mention-cursor:'+user.id+':'+channel,data.cursor);
        } catch { /* Keep polling after transient failures. */ }
      }));
      running=false;
      if(!stopped)timer=setTimeout(poll,activityPollDelay(!document.hidden));
    }
    const resumed=()=>{if(!document.hidden){clearTimeout(timer);void poll();}};
    document.addEventListener('visibilitychange',resumed);
    void poll();return()=>{stopped=true;clearTimeout(timer);document.removeEventListener('visibilitychange',resumed);};
  },[channels,user.id,user.name,key]);
  const markRead=useCallback((channel:string,id:number)=>{
    if(!Number.isSafeInteger(id)||id<=0)return;
    setRead(previous=>{if((previous[channel]??0)>=id)return previous;writeNumber(readKey(channel),id);return {...previous,[channel]:id};});
    // Menções já vistas saem do aviso.
    setNotices(previous=>{if(!previous.some(item=>item.channel===channel&&item.id<=id))return previous;const next=previous.filter(item=>item.channel!==channel||item.id>id);try{localStorage.setItem(key,JSON.stringify(next));}catch{/* Armazenamento opcional. */}return next;});
  },[key,readKey]);
  const unread=useCallback((channel:string)=>(latest[channel]??0)>(read[channel]??Infinity),[latest,read]);
  const mentions=useCallback((channel:string)=>notices.filter(item=>item.channel===channel&&item.id>(read[channel]??0)).length,[notices,read]);
  const dismiss=useCallback(()=>{setNotices([]);try{localStorage.removeItem(key);}catch{/* Storage is optional. */}},[key]);
  return <ActivityContext.Provider value={{notices,dismiss,unread,mentions,markRead}}>{children}</ActivityContext.Provider>;
}

export function MentionNotifications({onOpen}: {onOpen: (channel:string)=>void}) {
  const {text,voice} = useAccount();
  const {notices,dismiss} = useActivity();
  const [expanded,setExpanded] = useState(false);
  if(!notices.length)return null;
  return <div className="mention-notice" role="status">
    <div className="mention-notice-head"><button type="button" className="mention-notice-expand" aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}><strong>Menções para você</strong><span className="mention-notice-count">{notices.length}</span><span aria-hidden="true">{expanded?'▴':'▾'}</span></button><button type="button" className="mention-notice-close" onClick={dismiss} aria-label="Fechar aviso de menções">×</button></div>
    {expanded&&<ul>{[...notices].reverse().map(item=>{const channelName=item.channel.startsWith('voice:') ? 'chat da call '+(voice.find(channel=>channel.id===item.channel.slice(6))?.name || '') : '#'+(text.find(channel=>channel.id===item.channel)?.name || 'chat');return <li key={item.channel+':'+item.id}><button type="button" onClick={()=>onOpen(item.channel)}><span className="mention-notice-who">{item.name}</span><span className="mention-notice-where">mencionou você em {channelName}</span></button></li>;})}</ul>}
  </div>;
}
