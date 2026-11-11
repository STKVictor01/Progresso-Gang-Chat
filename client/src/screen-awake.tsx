import { useEffect, useRef, useState } from 'react';

export function KeepScreenAwake() {
  const lock=useRef<WakeLockSentinel|null>(null),mounted=useRef(false),pending=useRef(false);
  const [active,setActive]=useState(false),[message,setMessage]=useState('');
  const supported=typeof navigator!=='undefined' && 'wakeLock' in navigator;
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;void lock.current?.release();lock.current=null;};},[]);
  useEffect(()=>{if(!message)return;const timer=setTimeout(()=>setMessage(''),5000);return()=>clearTimeout(timer);},[message]);
  async function toggle() {
    if(pending.current)return;
    pending.current=true;
    try {
      if(lock.current) {await lock.current.release();lock.current=null;if(mounted.current){setActive(false);setMessage('A tela pode apagar normalmente.');}return;}
      const next=await navigator.wakeLock.request('screen');
      if(!mounted.current){await next.release();return;}
      lock.current=next;setActive(true);setMessage('Tela ligada enquanto o chat estiver visível.');
      next.addEventListener('release',()=>{if(lock.current===next){lock.current=null;if(mounted.current){setActive(false);setMessage('A tela pode apagar normalmente.');}}},{once:true});
    } catch {if(mounted.current)setMessage('Não foi possível manter a tela ligada neste aparelho.');}
    finally {pending.current=false;}
  }
  if(!supported)return null;
  const label=active?'Permitir que a tela apague':'Manter tela ligada durante a call';
  return <div className="screen-wake-control"><button className="button screen-wake-toggle" aria-label={label} title={label} aria-pressed={active} onClick={()=>void toggle()}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><rect x="6" y="2" width="12" height="20" rx="2"/><path d="M10 19h4M12 6v6m-3-3h6"/></svg></button><span className="screen-wake-status" role="status">{message}</span></div>;
}
