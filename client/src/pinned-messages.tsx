import { useCallback, useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { api } from './api';
import { gifId } from './giphy';

// Mensagens fixadas do canal. O servidor guarda só referências; o texto vem da própria mensagem.
export type PinnedMessage = { id:number; name:string; text:string; timestamp:number; user_id:string|null; attachments?:{mime:string}[] };
export type Pin = { message:PinnedMessage; pinnedAt:number; pinnedBy:string|null; canUnpin:boolean };

async function failure(response:Response, fallback:string) {
  const data = await response.json().catch(() => ({})) as {error?:string};
  return data.error || fallback;
}

// eslint-disable-next-line react-refresh/only-export-components
export function snippet(message:PinnedMessage) {
  if (gifId(message.text)) return 'GIF do GIPHY';
  if (message.text) return message.text;
  const count = message.attachments?.length ?? 0;
  return count > 1 ? count + ' arquivos' : 'Arquivo ou imagem';
}

// Lista do canal: carrega ao abrir, a cada 30 s enquanto o chat estiver visível e depois de cada ação.
// eslint-disable-next-line react-refresh/only-export-components
export function usePins(channel:string, visible:boolean) {
  const [pins,setPins] = useState<Pin[]>([]);
  const refresh = useCallback(async () => {
    const response = await api('/api/pins?channel=' + encodeURIComponent(channel));
    if (!response.ok) throw Error(await failure(response, 'Não foi possível carregar as mensagens fixadas.'));
    const data = await response.json() as {pins:Pin[]};
    setPins(Array.isArray(data.pins) ? data.pins : []);
  }, [channel]);
  useEffect(() => {
    if (!visible) return;
    let active = true;
    const load = () => { if (active) void refresh().catch(() => {}); };
    load();
    const timer = window.setInterval(load, 30000);
    return () => { active = false; window.clearInterval(timer); };
  }, [refresh, visible]);
  async function change(id:number, pinned:boolean) {
    const response = await api('/api/messages/' + id + '/pin', pinned ? {method:'POST', headers:{'Content-Type':'application/json'}, body:'{}'} : {method:'DELETE'});
    if (!response.ok) throw Error(await failure(response, pinned ? 'Não foi possível fixar a mensagem.' : 'Não foi possível desafixar a mensagem.'));
    await refresh().catch(() => {});
  }
  return {
    pins,
    refresh,
    pin:(id:number) => change(id, true),
    unpin:(id:number) => change(id, false),
    find:(id:number) => pins.find(pin => pin.message.id === id),
  };
}

export function PinIcon({size=16}:{size?:number}) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 3h6l-1 6 4 4H6l4-4-1-6Z"/><path d="M12 13v8"/></svg>;
}

// Faixa no topo do chat com a fixada mais recente; abre a lista completa.
export function PinnedBar({pins,onOpen,name,style}:{pins:Pin[];onOpen:()=>void;name:(message:PinnedMessage)=>string;style:(message:PinnedMessage)=>CSSProperties|undefined}) {
  if (!pins.length) return null;
  const latest = pins[0].message;
  return <button type="button" className="pinned-bar" onClick={onOpen} aria-haspopup="dialog" aria-label={'Mensagens fixadas: ' + pins.length + '. Abrir lista'}>
    <span className="pinned-bar-icon"><PinIcon/></span>
    <span className="pinned-bar-copy"><small>{pins.length === 1 ? 'Mensagem fixada' : pins.length + ' mensagens fixadas'}</small><span><strong style={style(latest)}>{name(latest)}:</strong> {snippet(latest)}</span></span>
    <span className="pinned-bar-more" aria-hidden="true">Ver todas</span>
  </button>;
}

export function PinnedDialog({pins,onClose,onJump,onUnpin,name,style}:{pins:Pin[];onClose:()=>void;onJump:(id:number)=>void;onUnpin:(id:number)=>Promise<void>;name:(message:PinnedMessage)=>string;style:(message:PinnedMessage)=>CSSProperties|undefined}) {
  const [busy,setBusy] = useState<number|null>(null);
  const [error,setError] = useState('');
  async function unpin(id:number) {
    setBusy(id); setError('');
    try { await onUnpin(id); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível desafixar a mensagem.'); }
    finally { setBusy(null); }
  }
  return <dialog className="admin-dialog pinned-dialog" ref={element => {if(element && !element.open)element.showModal();}} onCancel={onClose} onClose={onClose} aria-labelledby="pinned-title">
    <header><h2 id="pinned-title">Mensagens fixadas</h2><button type="button" className="button subtle" onClick={onClose}>Fechar</button></header>
    {error && <p className="error-message" role="alert">{error}</p>}
    {pins.length ? <ol className="pinned-list">{pins.map(pin => {
      const time = new Date(pin.message.timestamp);
      return <li key={pin.message.id} className="pinned-item">
        <div className="pinned-item-head"><strong style={style(pin.message)}>{name(pin.message)}</strong><time dateTime={time.toISOString()}>{time.toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</time></div>
        <p className="pinned-item-text">{snippet(pin.message)}</p>
        <div className="pinned-item-foot">
          <small>{pin.pinnedBy ? 'Fixada por ' + pin.pinnedBy : 'Fixada'}</small>
          <div className="pinned-item-actions">
            <button type="button" className="button subtle" onClick={() => { onClose(); onJump(pin.message.id); }}>Ir para a mensagem</button>
            {pin.canUnpin && <button type="button" className="button subtle" disabled={busy === pin.message.id} onClick={() => void unpin(pin.message.id)}>{busy === pin.message.id ? 'Desafixando…' : 'Desafixar'}</button>}
          </div>
        </div>
      </li>;
    })}</ol> : <p className="pinned-empty">Nenhuma mensagem fixada neste canal. Abra as opções de uma mensagem e escolha "Fixar mensagem".</p>}
  </dialog>;
}
