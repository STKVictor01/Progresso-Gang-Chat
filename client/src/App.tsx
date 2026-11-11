import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import { RoomContext, TrackToggle, DisconnectButton, MediaDeviceMenu, StartAudio, useParticipants, useConnectionState, useIsSpeaking, useLocalParticipant, useTracks } from '@livekit/components-react';
import { ConnectionState, Room, RoomEvent, Track } from 'livekit-client';
import type { Participant } from 'livekit-client';
import '@livekit/components-styles';
import './App.css';
import { CallPreferencesProvider, PersonalAudioRenderer, ParticipantAudioControls, QuickParticipantMute, NoiseSuppressionControl, VoiceEffectControl } from './call-audio';
import { useCallPreferences } from './call-preferences';
import { microphoneOptions, readNoisePreference } from './call-settings';
import { MediaFocusStage } from './media-focus';
import { ChannelChat } from './channel-chat';
import { AccountGate, AccountActions, useAccount } from './accounts';
import { api } from './api';
import { Soundboard } from './soundboard';
import { OnlineMembers, ProfileEditor, PresenceProvider, usePresence } from './presence';

type Session = { token: string; serverUrl: string };
type IconName = 'voice' | 'voiceQuiet' | 'arrow' | 'link' | 'shield' | 'chat' | 'close' | 'chevron' | 'headphones' | 'menu';
function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, ReactNode> = {
    voice: <><path d="M11 5 6 9H3v6h3l5 4V5Z" /><path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" /></>,
    voiceQuiet: <path d="M11 5 6 9H3v6h3l5 4V5Z" />,
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
    link: <path d="m10 13 4-4m-6 6-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 3 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" transform="translate(1 0)" />,
    shield: <><path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Z" /><path d="m8 12 3 3 5-6" /></>,
    chat: <path d="M21 11a8 8 0 0 1-8 8H7l-4 3V7a4 4 0 0 1 4-4h6a8 8 0 0 1 8 8Z" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    chevron: <path d="m8 10 4 4 4-4" />,
    menu: <path d="M4 6h16M4 12h16M4 18h16" />,
    headphones: <><path d="M4 14v-3a8 8 0 0 1 16 0v3" /><rect x="3" y="12" width="4" height="8" rx="2" /><rect x="17" y="12" width="4" height="8" rx="2" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
function Mark() {
  return <svg className="brand-mark" viewBox="0 0 64 64" aria-hidden="true"><path d="M32 6 58 32 32 58 6 32Z" fill="currentColor" /><circle cx="32" cy="32" r="16" fill="var(--surface)" /><path d="m32 18 3.3 9.7H46l-8.7 6.2 3.4 10.2L32 38l-8.7 6.1 3.4-10.2-8.7-6.2h10.7Z" fill="currentColor" /></svg>;
}
function InviteButton() {
  const [message, setMessage] = useState('Copiar endereço');
  async function copy() {
    try { await navigator.clipboard.writeText(window.location.origin); setMessage('Link copiado!'); }
    catch { setMessage('Copie o endereço do navegador'); }
  }
  return <button className="button subtle invite-button" onClick={copy}><Icon name="link" /><span aria-live="polite">{message}</span></button>;
}
function Member({ participant }: { participant: Participant }) {
  const speaking = useIsSpeaking(participant);
  const {profiles,showProfile} = usePresence();
  const profile = profiles.find(person => person.id === participant.identity.split(':')[0]);
  const label = participant.name || 'Participante';
  const settings = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const [position,setPosition] = useState({top:0,left:0});
  function openSettings() {
    const rect = button.current?.getBoundingClientRect();
    if (!rect || !settings.current) return;
    if (settings.current.matches(':popover-open')) { settings.current.hidePopover(); return; }
    setPosition({left: Math.max(8, Math.min(rect.right + 8, window.innerWidth - 288)), top: Math.max(8, Math.min(rect.top, window.innerHeight - 280))});
    settings.current.showPopover();
  }
  useEffect(() => {
    const close = () => { if (settings.current?.matches(':popover-open')) settings.current.hidePopover(); };
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => { window.removeEventListener('resize', close); window.removeEventListener('scroll', close, true); };
  }, []);
  return <li className={`member ${speaking ? 'speaking' : ''}`}>
    <button className="voice-profile-button" disabled={!profile} onClick={()=>profile && showProfile(profile.id)} aria-label={'Ver perfil de '+label}>{profile?.avatarUrl ? <img className="member-avatar" src={profile.avatarUrl} alt=""/> : <span className="member-avatar">{label.slice(0,2).toLocaleUpperCase('pt-BR')}</span>}</button>
    {participant.isLocal ? <span className="member-name">{label}<small>Você</small></span> : <><button className="voice-member-trigger" ref={button} onClick={openSettings} aria-label={'Ajustar áudio de '+label} aria-haspopup="dialog"><span className="member-name">{label}<small>{speaking ? 'Falando agora' : 'Ajustar áudio'}</small></span></button>{createPortal(<div popover="auto" ref={settings} className="voice-audio-popover" style={{top:position.top,left:position.left}} role="dialog" aria-label={'Áudio de '+label}><strong>{label}</strong><ParticipantAudioControls participant={participant} /></div>,document.body)}</>}
    <QuickParticipantMute participant={participant} />
  </li>;
}
type VoiceId = string;
type Navigation = {
  selectedText: string; selectText: (id:string)=>void;
  name: string; view: 'text' | 'voice'; setView: (view: 'text' | 'voice') => void;
  selectedVoice: VoiceId; selectVoice: (id: VoiceId) => void; activeVoice: VoiceId | null;
  joinVoice: (id: VoiceId) => void; joining: boolean; audio: boolean; setAudio: (audio: boolean) => void;
  error: string; setError: (error: string) => void;
  callChatOpen: boolean; setCallChatOpen: (open: boolean) => void;
};
const NavigationContext = createContext<Navigation | null>(null);
function useNavigation() { const value = useContext(NavigationContext); if (!value) throw Error('Missing navigation'); return value; }
function Brand() { const {site}=useAccount(); return <a className="brand" href="#principal" aria-label={site.name}><Mark /><span>{site.name}</span></a>; }
function Sidebar({open, close}: {open: boolean; close: () => void}) {
  const {voice:CHANNELS,text,site}=useAccount();
  const nav = useNavigation();
  const participants = useParticipants();
  return <aside id="community-sidebar" className={"sidebar community-sidebar " + (open ? "mobile-open" : "")} aria-label="Canais da comunidade"><div className="mobile-sidebar-header"><Brand /><button className="mobile-menu-close" onClick={close} aria-label="Fechar canais"><Icon name="close" /></button></div><OnlineMembers /><div className="community-label">{site.tagline} <span className="tiny-star">★</span></div><nav className="channel-navigation" aria-label="Canais" onClick={event => { if ((event.target as HTMLElement).closest("button")) close(); }}><div className="sidebar-section-label">CONVERSA</div>{text.map(channel=><button key={channel.id} className={'channel text-channel ' + (nav.view === 'text' && nav.selectedText === channel.id ? 'active' : '')} aria-current={nav.view === 'text' && nav.selectedText === channel.id ? 'page' : undefined} onClick={() => nav.selectText(channel.id)}><Icon name="chat" /><span>#{channel.name}<small>{channel.hint}</small></span></button>)}<div className="sidebar-section-label voice-label">CANAIS DE VOZ <span>{CHANNELS.length}</span></div>{CHANNELS.map(channel => <VoiceChannel key={channel.id} channel={channel} />)}</nav>{nav.activeVoice && <><div className="sidebar-section-label participants-label voice-members-heading">CALL · {CHANNELS.find(c => c.id === nav.activeVoice)?.name.toUpperCase()} <span>{participants.length}</span></div><ul className="members">{participants.map(p => <Member key={p.identity} participant={p} />)}</ul></>}<div className="sidebar-bottom"><ProfileEditor status={nav.activeVoice ? 'Conectado à voz' : 'Só no texto. De boa.'} /><div className="network-state"><Icon name="shield" size={17} />Rede privada</div></div></aside>;
}
function VoiceChannel({channel}:{channel:{id:string;name:string;hint:string}}) {
  const nav = useNavigation();
  const {voiceChannels,profiles} = usePresence();
  const members = voiceChannels?.[channel.id];
  const people = members?.map(id=>profiles.find(profile=>profile.id===id));
  const count = members?.length;
  const status = count === undefined ? 'ocupação indisponível' : `${count} ${count === 1 ? 'pessoa' : 'pessoas'} na voz`;
  const names = people?.map(person=>person?.name || 'Participante').join(', ');
  return <button className={'channel voice-channel ' + (nav.view === 'voice' && nav.selectedVoice === channel.id ? 'active' : '')} aria-current={nav.view === 'voice' && nav.selectedVoice === channel.id ? 'page' : undefined} aria-label={`${channel.name}, ${status}${names ? ': '+names : ''}`} onClick={() => nav.selectVoice(channel.id)} disabled={nav.joining}>
    <Icon name={count ? 'voice' : 'voiceQuiet'} />
    <span className="voice-channel-info"><span>{channel.name}</span><small>{nav.activeVoice === channel.id ? 'Você está neste canal' : channel.hint}</small>{!!count && <span className="voice-channel-avatars" aria-hidden="true">{people?.slice(0,4).map((person,index)=>person?.avatarUrl ? <img key={members![index]} className="member-avatar" src={person.avatarUrl} alt="" title={person.name}/> : <span key={members![index]} className="member-avatar" title={person?.name}>{person?.name.slice(0,2).toLocaleUpperCase('pt-BR') || '?'}</span>)}{count > 4 && <span className="voice-avatar-more">+{count-4}</span>}</span>}</span>
    <span className="voice-channel-count" title={status} aria-hidden="true">{count ?? '—'}</span>
  </button>;
}
function PageHeader({openMenu, menuOpen}: {openMenu: () => void; menuOpen: boolean}) {
  const {voice:CHANNELS,text}=useAccount();
  const {voiceChannels}=usePresence();
  const nav = useNavigation();
  const channel = CHANNELS.find(c => c.id === nav.selectedVoice);
  return <header className="page-header"><button className="mobile-menu-button" onClick={openMenu} aria-label="Abrir canais" aria-controls="community-sidebar" aria-expanded={menuOpen}><Icon name="menu" /></button><div className="channel-heading"><Icon name={nav.view === 'text' ? 'chat' : voiceChannels?.[nav.selectedVoice]?.length ? 'voice' : 'voiceQuiet'} size={23} /><div><strong>{nav.view === 'text' ? '#'+text.find(c=>c.id===nav.selectedText)?.name : channel?.name}</strong><span>{nav.view === 'text' ? 'O papo continua. Com ou sem microfone.' : channel?.hint}</span></div></div><AccountActions /><InviteButton /></header>;
}

function PublicChat() { const {name,view,selectedText}=useNavigation(); const {text}=useAccount(); return <ChannelChat key={selectedText} name={name} channel={selectedText} title={'#'+text.find(c=>c.id===selectedText)?.name} visible={view==='text'} />; }
function VoiceControls() {
  const preferences = useCallPreferences();
  const navigation = useNavigation();
  const { isMicrophoneEnabled, isCameraEnabled, isScreenShareEnabled } = useLocalParticipant();
  const audioShares = useTracks([Track.Source.ScreenShareAudio], { onlySubscribed: false });
  const localShareHasAudio = audioShares.some(t => t.participant.isLocal && !t.publication.isMuted);
  const firefox = /\bFirefox\//.test(navigator.userAgent);
  const deviceError = () => navigation.setError('Confira as permissões de câmera, microfone ou transmissão do navegador e tente novamente.');
  return <><div className="call-controls" aria-label="Controles da chamada"><div className="media-control"><TrackToggle source={Track.Source.Microphone} captureOptions={microphoneOptions(preferences.noiseSupported && preferences.noiseSuppression)} onDeviceError={deviceError} title={isMicrophoneEnabled ? 'Desligar microfone' : 'Ligar microfone'} aria-label={isMicrophoneEnabled ? 'Desligar microfone' : 'Ligar microfone'} /><MediaDeviceMenu kind="audioinput" aria-label="Escolher microfone" /></div><div className="media-control"><TrackToggle source={Track.Source.Camera} onDeviceError={deviceError} title={isCameraEnabled ? 'Desligar câmera' : 'Ligar câmera'} aria-label={isCameraEnabled ? 'Desligar câmera' : 'Ligar câmera'} /><MediaDeviceMenu kind="videoinput" aria-label="Escolher câmera" /></div>{typeof navigator !== 'undefined' && navigator.mediaDevices && 'getDisplayMedia' in navigator.mediaDevices && <TrackToggle source={Track.Source.ScreenShare} captureOptions={{ audio: true, systemAudio: "include", suppressLocalAudioPlayback: false }} onDeviceError={deviceError} title={isScreenShareEnabled ? 'Parar transmissão' : 'Compartilhar tela'} aria-label={isScreenShareEnabled ? 'Parar transmissão' : 'Compartilhar tela'} />}<button className="button chat-toggle" title="Chat da call" aria-label="Chat da call" aria-expanded={navigation.callChatOpen && navigation.view === "voice"} onClick={() => { if(navigation.activeVoice){ navigation.selectVoice(navigation.activeVoice); navigation.setCallChatOpen(navigation.view !== "voice" || !navigation.callChatOpen); } }}><Icon name="chat" /></button><NoiseSuppressionControl /><VoiceEffectControl />{navigation.activeVoice && <Soundboard key={navigation.activeVoice} channel={navigation.activeVoice} />}<DisconnectButton className="leave-button" title="Sair da call" aria-label="Sair da call"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 17l5-5-5-5M15 12H3"/><path d="M12 3h7a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-7"/></svg><span>Sair da call</span></DisconnectButton></div>{isScreenShareEnabled && !localShareHasAudio && <p className="share-audio-notice" role="status">{firefox ? 'O Firefox está compartilhando a imagem, mas não captura o som da tela. Para transmitir som, abra o chat no Chrome ou Edge e compartilhe uma aba com áudio.' : 'Esta transmissão está sem áudio. Compartilhe novamente e marque a opção de áudio no seletor do navegador, se disponível.'}</p>}</>;
}
function Community() {
  const {voice:CHANNELS}=useAccount();
  const nav = useNavigation();
  const state = useConnectionState();
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    if (!menuOpen) return;
    document.querySelector<HTMLButtonElement>('.mobile-menu-close')?.focus();
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') { setMenuOpen(false); document.querySelector<HTMLButtonElement>('.mobile-menu-button')?.focus(); } };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [menuOpen]);
  const closeMenu = () => { if (menuOpen) { setMenuOpen(false); document.querySelector<HTMLButtonElement>('.mobile-menu-button')?.focus(); } };
  const channel = CHANNELS.find(c=>c.id===nav.selectedVoice)!;
  return <div className="app-shell room-shell community-shell"><Sidebar open={menuOpen} close={closeMenu} />{menuOpen && <button className="mobile-menu-backdrop" aria-label="Fechar canais" onClick={closeMenu} />}<main className="main-panel" id="principal"><PageHeader openMenu={() => setMenuOpen(true)} menuOpen={menuOpen} />{nav.error && <div className="room-error" role="alert">{nav.error}<button className="icon-button" onClick={()=>nav.setError('')} aria-label="Fechar aviso"><Icon name="close" /></button></div>}<PublicChat /><section className="voice-view" hidden={nav.view !== 'voice'} aria-label={'Canal de voz '+channel.name}><div className="room-heading"><div><span className="eyebrow">CANAL DE VOZ</span><h1>{channel.name}</h1></div><span className="connection-badge" role="status">{nav.joining ? 'Entrando no canal…' : state===ConnectionState.Reconnecting || state===ConnectionState.SignalReconnecting ? 'Reconectando…' : nav.activeVoice===channel.id ? 'Na mesma sintonia' : 'O próximo papo começa aqui'}</span></div>{nav.activeVoice===channel.id ? <div className={"voice-content-row " + (nav.callChatOpen ? "call-chat-open" : "")}><MediaFocusStage /><aside className="call-chat-side" hidden={!nav.callChatOpen}><ChannelChat key={nav.activeVoice} name={nav.name} channel={"voice:"+nav.activeVoice} title={channel.name} compact visible={nav.callChatOpen && nav.view === "voice"} onClose={() => nav.setCallChatOpen(false)} /></aside></div> : <div className="voice-welcome"><div className="join-symbol"><Icon name="headphones" size={30} /></div><h2>{channel.id==='jogatina' ? 'Fecha o squad.' : 'Puxa uma cadeira.'}</h2><p>{nav.activeVoice ? 'Ao entrar aqui, você sai do outro canal de voz.' : 'Entre quando quiser conversar. Seu microfone só liga com a sua escolha.'}</p><label className="mic-option"><input type="checkbox" checked={nav.audio} onChange={e=>nav.setAudio(e.target.checked)} disabled={nav.joining} />Entrar com o microfone ligado</label><button className="button primary" onClick={()=>nav.joinVoice(channel.id)} disabled={nav.joining}>{nav.joining ? 'Conectando…' : 'Entrar em '+channel.name}<Icon name="arrow" /></button></div>}</section>{nav.activeVoice && <div className="voice-dock"><div className="voice-dock-label"><Icon name="voice" size={16} /><span>{state===ConnectionState.Connected ? 'Call' : 'Reconectando'} · {CHANNELS.find(c=>c.id===nav.activeVoice)?.name}</span></div><VoiceControls /></div>}<StartAudio label="Ativar áudio da sala" /><PersonalAudioRenderer /></main></div>;
}
export default function App() { return <AccountGate><AuthenticatedApp /></AccountGate>; }
function AuthenticatedApp() {
  const {user}=useAccount();
  const name=user.name;
  const [selectedText,setSelectedText]=useState('general');
  const [room] = useState(() => new Room({ adaptiveStream: true, dynacast: true, audioCaptureDefaults: microphoneOptions(readNoisePreference()) }));
  const [view, setView] = useState<'text' | 'voice'>('text');
  const [callChatOpen, setCallChatOpen] = useState(false);
  const [selectedVoice, setSelectedVoice] = useState<VoiceId>('geral');
  const [activeVoice, setActiveVoice] = useState<VoiceId | null>(null);
  const [audio, setAudio] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState('');
  const switching = useRef(false);
  useEffect(() => {
    const disconnected = () => setActiveVoice(null);
    room.on(RoomEvent.Disconnected, disconnected);
    return () => { room.off(RoomEvent.Disconnected, disconnected); void room.disconnect(); };
  }, [room]);
  async function joinVoice(id: VoiceId) {
    if (switching.current || activeVoice===id) return;
    switching.current=true; setJoining(true); setError(''); setView('voice'); setSelectedVoice(id);
    const enableAudio = activeVoice ? room.localParticipant.isMicrophoneEnabled : audio;
    try {
      const response=await api('/api/token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,room:id}),signal:AbortSignal.timeout(15000)});
      if(!response.ok) throw Error('Não foi possível entrar nesse canal. Tente novamente.');
      const data=await response.json() as Session;
      if(!data.token || !data.serverUrl) throw Error('O servidor não retornou o acesso à sala.');
      await room.disconnect();
      await room.connect(data.serverUrl,data.token);
      setActiveVoice(id);
      if(enableAudio) { try { await room.localParticipant.setMicrophoneEnabled(true, microphoneOptions(readNoisePreference())); } catch { setError('Você entrou no canal, mas o microfone não pôde ser ligado. Confira as permissões.'); } }
    } catch { setError('Não foi possível conectar à voz. Confira o Tailscale e tente novamente.'); }
    finally { switching.current=false; setJoining(false); }
  }
  function selectVoice(id:VoiceId) { setSelectedVoice(id); setView('voice'); if(activeVoice && activeVoice!==id) void joinVoice(id); }
  const navigation:Navigation={selectedText,selectText:id=>{setSelectedText(id);setView('text');},name,view,setView,selectedVoice,selectVoice,activeVoice,joinVoice:id=>void joinVoice(id),joining,audio,setAudio,error,setError,callChatOpen,setCallChatOpen};
  return <div data-lk-theme="default" className="progresso-app"><RoomContext.Provider value={room}><div className="live-room lk-room-container"><CallPreferencesProvider><NavigationContext.Provider value={navigation}><PresenceProvider><Community /></PresenceProvider></NavigationContext.Provider></CallPreferencesProvider></div></RoomContext.Provider></div>;
}
