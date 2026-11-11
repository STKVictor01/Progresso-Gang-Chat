import { useEffect, useRef, useState } from 'react';
import { useAccount } from './accounts';
import { api } from './api';
import { hasMention } from './mentions';

type Message = { user_id:string|null; name:string; text:string };
export function MentionNotifications() {
  const {user,text,voice} = useAccount();
  const channels = [...text.map(item => item.id), ...voice.map(item => 'voice:'+item.id)].join('|');
  const audio = useRef<AudioContext|null>(null);
  const [notice,setNotice] = useState('');
  useEffect(() => {
    const enable = () => {
      try { audio.current ??= new AudioContext(); void audio.current.resume().catch(() => {}); } catch { /* Visual notification remains available. */ }
    };
    window.addEventListener('pointerdown',enable,{once:true});
    window.addEventListener('keydown',enable,{once:true});
    return () => { window.removeEventListener('pointerdown',enable); window.removeEventListener('keydown',enable); void audio.current?.close(); audio.current=null; };
  }, []);
  useEffect(() => {
    let stopped=false; let timer:ReturnType<typeof setTimeout>;
    const cursors=new Map<string,number>();
    const ids=channels ? channels.split('|') : [];
    async function poll() {
      await Promise.all(ids.map(async channel => {
        try {
          const query=new URLSearchParams({channel}); const cursor=cursors.get(channel);
          if(cursor!==undefined)query.set('since',String(cursor));
          const response=await api('/api/messages?'+query,{cache:'no-store'});
          if(!response.ok)return;
          const data=await response.json() as {cursor:number;messages:Message[]};
          if(stopped)return;
          cursors.set(channel,data.cursor);
          if(cursor===undefined)return;
          const message=data.messages.find(item => item.user_id!==user.id && hasMention(item.text,user.name));
          if(!message)return;
          setNotice(message.name+' mencionou você em '+(channel.startsWith('voice:')?'uma call':'um chat')+'.');
          const context=audio.current;
          if(context?.state==='running') {
            const oscillator=context.createOscillator(), gain=context.createGain();
            oscillator.type='sine'; oscillator.frequency.value=660; gain.gain.setValueAtTime(0.08,context.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001,context.currentTime+0.2);
            oscillator.connect(gain); gain.connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime+0.2);
            oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};
          }
        } catch { /* Keep polling after transient failures. */ }
      }));
      if(!stopped)timer=setTimeout(poll,3000);
    }
    void poll();
    return () => {stopped=true;clearTimeout(timer);};
  }, [channels,user.id,user.name]);
  return notice ? <div className="mention-notice" role="status">{notice} <button className="button subtle" onClick={()=>setNotice('')} aria-label="Fechar aviso de menção">×</button></div> : null;
}
