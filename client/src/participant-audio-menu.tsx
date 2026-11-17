import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { MouseEvent, PointerEvent, ReactNode, CSSProperties } from 'react';
import type { Participant } from 'livekit-client';
import { useRoomContext } from '@livekit/components-react';
import { ParticipantAudioControls } from './call-audio';
import { createLongPress } from './long-press';
import { useAccount } from './accounts';
import { jsonApi } from './api';
import { useCallPreferences } from './call-preferences';
import { isListenerMuted, listenerId } from './call-settings';

// The hook shares its portal with the tile component and the sidebar.
// eslint-disable-next-line react-refresh/only-export-components
export function useParticipantAudioMenu(participant: Participant) {
  const settings = useRef<HTMLDivElement>(null);
  const hold = useRef(createLongPress());
  const [position, setPosition] = useState({top:0,left:0});
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState('');
  const {user} = useAccount();
  const room = useRoomContext();
  const name = participant.name || 'Participante';
  const targetId = participant.identity.split(':')[0];
  const canRemove = user.role === 'admin' && targetId !== user.id && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(targetId);

  async function removeParticipant() {
    if (!window.confirm('Remover '+name+' desta call? A pessoa poderá entrar novamente.')) return;
    setRemoving(true); setError('');
    try { await jsonApi('/api/admin/voice/'+encodeURIComponent(room.name)+'/kick','POST',{userId:targetId}); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível remover a pessoa da call.'); }
    finally { setRemoving(false); }
  }

  function openSettings(anchor: HTMLElement, toggle = false) {
    if (participant.isLocal || !settings.current) return;
    const popover = settings.current;
    if (popover.matches(':popover-open')) {
      if (toggle) popover.hidePopover();
      return;
    }
    const rect = anchor.getBoundingClientRect();
    popover.showPopover();
    const size = popover.getBoundingClientRect();
    const left = rect.right + size.width + 8 <= window.innerWidth ? rect.right + 8 : rect.left - size.width - 8;
    setPosition({left:Math.max(8, Math.min(left, window.innerWidth - size.width - 8)), top:Math.max(8, Math.min(rect.top, window.innerHeight - size.height - 8))});
  }

  useEffect(() => {
    const close = () => { hold.current.cancel(); if (settings.current?.matches(':popover-open')) settings.current.hidePopover(); };
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    const gesture = hold.current;
    return () => { gesture.cancel(); window.removeEventListener('resize', close); window.removeEventListener('scroll', close, true); };
  }, []);

  const isTarget = (event: MouseEvent<HTMLElement> | PointerEvent<HTMLElement>) => event.currentTarget.contains(event.target as Node);
  const handlers = participant.isLocal ? {} : {
    onContextMenu: (event: MouseEvent<HTMLElement>) => {
      if (!isTarget(event)) return;
      event.preventDefault(); event.stopPropagation(); hold.current.contextMenu(); openSettings(event.currentTarget);
    },
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (!isTarget(event) || !event.isPrimary) return;
      if (event.pointerType !== 'touch') { hold.current.consumeClick(); return; }
      const anchor = event.currentTarget;
      hold.current.start(event.clientX, event.clientY, () => openSettings(anchor));
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => { if (event.pointerType === 'touch') hold.current.move(event.clientX, event.clientY); },
    onPointerUp: () => hold.current.cancel(),
    onPointerCancel: () => hold.current.cancel(),
    onClickCapture: (event: MouseEvent<HTMLElement>) => {
      if (isTarget(event) && hold.current.consumeClick()) { event.preventDefault(); event.stopPropagation(); }
    },
  };
  const menu = !participant.isLocal && createPortal(<div popover="auto" ref={settings} className="voice-audio-popover" style={{top:position.top,left:position.left}} role="dialog" aria-label={'Opções de '+name}><strong>{name}</strong><ParticipantAudioControls participant={participant} />{canRemove&&<><button type="button" className="voice-remove-button" disabled={removing} onClick={()=>void removeParticipant()}>{removing?'Removendo…':'Remover da call'}</button>{error&&<p className="voice-remove-error" role="alert">{error}</p>}</>}</div>, document.body);
  return { handlers, menu, openSettings };
}

export function ParticipantAudioTarget({ participant, className, children, style }: {participant:Participant;className:string;children:ReactNode;style?:CSSProperties}) {
  const {handlers, menu, openSettings} = useParticipantAudioMenu(participant);
  const {muted}=useCallPreferences();
  const silenced=isListenerMuted(muted,listenerId(participant.identity),'microphone');
  const name = participant.name || 'Participante';
  return <div className={className + (!participant.isLocal ? ' participant-audio-target' : '')} style={style} {...handlers}>
    {children}
    {!participant.isLocal && <button type="button" className={'participant-audio-button'+(silenced?' is-muted':'')} title={'Ajustar áudio de '+name} aria-label={'Ajustar áudio de '+name+(silenced?' (voz silenciada)':'')} aria-haspopup="dialog" onClick={event=>openSettings(event.currentTarget,true)}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m11 5-5 4H3v6h3l5 4V5Z"/>{silenced?<path d="M3 3l18 18"/>:<path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>}</svg></button>}
    {menu}
  </div>;
}
