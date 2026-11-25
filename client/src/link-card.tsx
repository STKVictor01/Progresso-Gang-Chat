import { useEffect, useRef, useState } from 'react';
import { api } from './api';

type Card = {title?:string; description?:string; thumbnail?:string};
const cache = new Map<string,{ until:number; result:Promise<Card> }>();
function load(target:string) {
  const url=new URL(target);
  url.hash='';
  const href=url.href;
  const hit = cache.get(href);
  if (hit && hit.until > Date.now()) return hit.result;
  const entry = {until:Date.now()+15*60000, result:api('/api/link-preview',{
    method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({url:href}),
  }).then(async response => {
    if (!response.ok) throw Error();
    return await response.json() as Card;
  }).catch(() => { cache.delete(href); return {} as Card; })};
  if (cache.size >= 60) cache.delete(cache.keys().next().value!);
  cache.set(href,entry);
  return entry.result;
}

export function LinkCard({href}:{href:string}) {
  const anchor = useRef<HTMLAnchorElement>(null);
  const [card,setCard] = useState<Card>({});
  useEffect(() => {
    const element = anchor.current;
    if (!element) return;
    let active = true;
    const request = () => { void load(href).then(value => { if (active) setCard(value); }); };
    const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
      if (entries.some(entry=>entry.isIntersecting)) { observer?.disconnect(); request(); }
    }) : null;
    if (observer) observer.observe(element); else request();
    return () => { active=false; observer?.disconnect(); };
  },[href]);
  const url = new URL(href);
  return <a ref={anchor} className="news-link-card" href={href} target="_blank" rel="noopener noreferrer">
    {card.thumbnail && <img alt="" src={card.thumbnail} loading="lazy" decoding="async"/>}
    <span className="news-link-copy"><small>{url.host}</small><strong>{card.title || (url.pathname !== '/' ? url.pathname : url.hostname)}</strong>
      {card.description && <span>{card.description}</span>}
    </span>
  </a>;
}
