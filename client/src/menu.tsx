import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';

// Larguras de computador (o celular mantém a organização própria).
// eslint-disable-next-line react-refresh/only-export-components
export function useIsDesktop() {
  const query = '(min-width: 768px)';
  const [matches,setMatches] = useState(() => typeof window === 'undefined' || window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const changed = () => setMatches(media.matches);
    media.addEventListener('change',changed);
    return () => media.removeEventListener('change',changed);
  }, []);
  return matches;
}

export type MenuItem = {label:string; onSelect:()=>void; disabled?:boolean; danger?:boolean; hidden?:boolean; key?:string};

// Botão que abre um menu: setas, Home/End, Escape e clique fora fecham; o foco volta ao botão.
export function MenuButton({label,className,children,items,menuClassName=''}:{label:string;className:string;children:ReactNode;items:MenuItem[];menuClassName?:string}) {
  const [open,setOpen] = useState(false);
  const [position,setPosition] = useState<{top:number;left:number}|null>(null);
  const [host,setHost] = useState<Element|null>(null);
  const button = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null);
  const visible = items.filter(item => !item.hidden);
  function openMenu() { setHost(button.current?.closest('dialog') ?? document.body); setOpen(true); }
  function close(returnFocus=true) { setOpen(false); setPosition(null); if (returnFocus) button.current?.focus(); }
  // Abre abaixo do botão; se não couber, acima. Sempre dentro da área visível.
  // Retorna false quando o botão saiu da tela (o menu então fecha).
  function place() {
    if (!button.current || !menu.current) return true;
    const anchor = button.current.getBoundingClientRect(), box = menu.current.getBoundingClientRect(), margin = 8;
    if (anchor.bottom < 0 || anchor.top > window.innerHeight) return false;
    const left = Math.max(margin, Math.min(anchor.right - box.width, window.innerWidth - box.width - margin));
    let top = anchor.bottom + 6;
    if (top + box.height > window.innerHeight - margin) top = Math.max(margin, anchor.top - 6 - box.height);
    setPosition(current => current && current.top === top && current.left === left ? current : {top,left});
    return true;
  }
  useLayoutEffect(() => { if (open) place(); }, [open]);
  // O foco entra no menu só depois de posicionado (elementos invisíveis não recebem foco).
  useEffect(() => { if (open && position) menu.current?.querySelector<HTMLButtonElement>('[role=menuitem]:not(:disabled)')?.focus(); }, [open, position]);
  useEffect(() => {
    if (!open) return;
    const outside = (event:PointerEvent) => { const target = event.target as Node; if (!menu.current?.contains(target) && !button.current?.contains(target)) close(false); };
    // No iPhone, a barra do Safari aparece e some ao rolar e dispara "resize" só na altura: o menu acompanha.
    // Fecha apenas quando a largura muda (girar o aparelho, redimensionar a janela).
    let width = window.innerWidth;
    const resized = () => { if (window.innerWidth !== width) { width = window.innerWidth; close(false); } else if (!place()) close(false); };
    // Rolar a página ou o diálogo mantém o menu preso ao botão; fecha se o botão sair da tela.
    const scrolled = (event:Event) => { if (menu.current?.contains(event.target as Node)) return; if (!place()) close(false); };
    // Escape fecha só o menu, mesmo dentro de um diálogo, e devolve o foco ao botão.
    const escape = (event:globalThis.KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } };
    document.addEventListener('pointerdown',outside,true);
    document.addEventListener('keydown',escape,true);
    document.addEventListener('scroll',scrolled,true);
    window.addEventListener('resize',resized);
    window.visualViewport?.addEventListener('resize',resized);
    return () => { document.removeEventListener('pointerdown',outside,true); document.removeEventListener('keydown',escape,true); document.removeEventListener('scroll',scrolled,true); window.removeEventListener('resize',resized); window.visualViewport?.removeEventListener('resize',resized); };
  }, [open]);
  function onKeyDown(event:KeyboardEvent<HTMLDivElement>) {
    const entries = [...(menu.current?.querySelectorAll<HTMLButtonElement>('[role=menuitem]:not(:disabled)') ?? [])];
    const index = entries.indexOf(document.activeElement as HTMLButtonElement);
    const focus = (next:number) => { event.preventDefault(); entries[(next + entries.length) % entries.length]?.focus(); };
    if (event.key === 'ArrowDown') focus(index + 1);
    else if (event.key === 'ArrowUp') focus(index - 1);
    else if (event.key === 'Home') focus(0);
    else if (event.key === 'End') focus(entries.length - 1);
    else if (event.key === 'Tab') close(false);
  }
  return <>
    <button ref={button} type="button" className={className} aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open}
      onClick={() => open ? close(false) : openMenu()} onKeyDown={event => { if (event.key === 'ArrowDown' && !open) { event.preventDefault(); openMenu(); } }}>{children}</button>
    {/* O menu sai do cartão e de áreas com rolagem: no iOS, elementos fixos dentro delas ficam cortados.
        Vai para o diálogo aberto (para ficar acima dele) ou para a página. */}
    {open && host && createPortal(<div ref={menu} className={'popover-menu '+menuClassName} role="menu" aria-label={label} onKeyDown={onKeyDown} style={position ? {top:position.top,left:position.left} : {top:0,left:0,visibility:'hidden'}}>
      {visible.map(item => <button key={item.key ?? item.label} type="button" role="menuitem" className={'popover-menu-item' + (item.danger ? ' danger' : '')} disabled={item.disabled} onClick={() => { close(); item.onSelect(); }}>{item.label}</button>)}
    </div>, host)}
  </>;
}
