import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { RoomContext, useRoomContext, TrackToggle, DisconnectButton, MediaDeviceMenu, StartAudio, useParticipants, useConnectionState, useIsSpeaking, useLocalParticipant, useTracks } from '@livekit/components-react';
import { ConnectionState, DisconnectReason, Room, RoomEvent, Track } from 'livekit-client';
import type { Participant } from 'livekit-client';
import '@livekit/components-styles';
import './App.css';
import { CallPreferencesProvider, PersonalAudioRenderer, QuickParticipantMute, NoiseSuppressionControl, VoiceEffectControl } from './call-audio';
import { useParticipantAudioMenu } from './participant-audio-menu';
import { useCallPreferences } from './call-preferences';
import { microphoneOptions } from './call-settings';
import { MediaFocusStage } from './media-focus';
import { ChannelChat } from './channel-chat';
import { AccountGate, AdminPanel, useAccount } from './accounts';
import { api } from './api';
import { Soundboard } from './soundboard';
import { CoverArt, MusicControl, MusicNote } from './music';
import { KeepScreenAwake } from './screen-awake';
import { AudioOutputControl } from './audio-output';
import { playJoinSound, playLeaveSound } from './call-sounds';
import { ActivityProvider, MentionNotifications, useActivity } from './mention-notifications';
import { MemberGroups, ProfileEditor, PresenceProvider, usePresence } from './presence';
import { ProfileMiniCard } from './profile-card';

type Session = { token: string; serverUrl: string };
type IconName = 'voice' | 'voiceQuiet' | 'arrow' | 'link' | 'shield' | 'chat' | 'close' | 'chevron' | 'headphones' | 'menu' | 'users' | 'speaker' | 'leave';
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
    users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14a6.5 6.5 0 0 1 3.5 6" /></>,
    headphones: <><path d="M4 14v-3a8 8 0 0 1 16 0v3" /><rect x="3" y="12" width="4" height="8" rx="2" /><rect x="17" y="12" width="4" height="8" rx="2" /></>,
    speaker: <><rect x="6" y="3" width="12" height="18" rx="2" /><circle cx="12" cy="14" r="3.5" /><path d="M12 7h.01" /></>,
    leave: <><path d="M10 17l5-5-5-5M15 12H3"/><path d="M12 3h7a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-7"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
function Mark() {
  // Logotipo oficial (o mesmo do favicon): cor e forma preservadas.
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
  const {music} = usePresence();
  const nav = useNavigation();
  const isBot = participant.identity.startsWith('music-bot:');
  const label = participant.name || 'Participante';
  const nameColor = profile?.nameColor ? {color:profile.nameColor} : undefined;
  const {handlers,menu,openSettings} = useParticipantAudioMenu(participant);
  if(profile && !isBot) return <li className={'member voice-member-card'+(speaking?' speaking':'')} {...handlers}>
    <ProfileMiniCard profile={profile} calls={[nav.activeVoice ? 'Call ativa' : 'Call']} onOpen={()=>showProfile(profile.id)}/>
    <div className="voice-member-actions"><span>{speaking?'Falando agora':participant.isLocal?'Você':'Na call'}</span>{!participant.isLocal&&<><button className="button subtle" onClick={event=>openSettings(event.currentTarget,true)} aria-label={'Ajustar áudio de '+label} aria-haspopup="dialog">Áudio</button>{menu}</>}<QuickParticipantMute participant={participant}/></div>
  </li>;
  return <li className={`member ${speaking ? 'speaking' : ''}`} {...handlers}>
    <button className="voice-profile-button" disabled={!profile} onClick={()=>profile && showProfile(profile.id)} aria-label={'Ver perfil de '+label}>{isBot ? <CoverArt cover={nav.activeVoice ? music[nav.activeVoice]?.cover : undefined} className="member-avatar music-member-cover"/> : profile?.avatarUrl ? <img className="member-avatar" src={profile.avatarUrl} alt=""/> : <span className="member-avatar">{label.slice(0,2).toLocaleUpperCase('pt-BR')}</span>}</button>
    {participant.isLocal ? <span className="member-name" style={nameColor}>{label}<small>Você</small></span> : <><button className="voice-member-trigger" onClick={event=>openSettings(event.currentTarget,true)} aria-label={'Ajustar áudio de '+label} aria-haspopup="dialog"><span className="member-name" style={nameColor}>{label}<small>{speaking ? 'Falando agora' : 'Ajustar áudio'}</small></span></button>{menu}</>}
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
// A seção (conversa ou voz) cujo primeiro canal tem a menor posição aparece primeiro.
function sectionOrder(text: {position?: number}[], voice: {position?: number}[]): ('text'|'voice')[] {
  const first = (list: {position?: number}[]) => list.length ? Math.min(...list.map(channel => Number(channel.position ?? 0))) : Infinity;
  return first(voice) < first(text) ? ['voice','text'] : ['text','voice'];
}
// Sons ao entrar na call e quando alguém entra ou sai, como no Discord.
function CallSounds() {
  const room = useRoomContext();
  const {deafened} = useCallPreferences();
  const silent = useRef(deafened);
  useEffect(() => { silent.current = deafened; }, [deafened]);
  useEffect(() => {
    const person = (participant: Participant) => !participant.identity.startsWith('music-bot:');
    const connected = () => { if (!silent.current) playJoinSound(0.4,room.localParticipant.identity.split(':')[0]); };
    const joined = (participant: Participant) => { if (!silent.current && person(participant)) playJoinSound(0.25,participant.identity.split(':')[0]); };
    const left = (participant: Participant) => { if (!silent.current && person(participant)) playLeaveSound(0.25); };
    room.on(RoomEvent.Connected, connected).on(RoomEvent.ParticipantConnected, joined).on(RoomEvent.ParticipantDisconnected, left);
    return () => { room.off(RoomEvent.Connected, connected).off(RoomEvent.ParticipantConnected, joined).off(RoomEvent.ParticipantDisconnected, left); };
  }, [room]);
  return null;
}
// Antes de entrar: mostra quem já está na call e um botão direto.
function VoiceWelcome({channel}: {channel: {id: string; name: string}}) {
  const nav = useNavigation();
  const {voiceChannels, profiles, music} = usePresence();
  const nowPlaying = music[channel.id];
  const ids = voiceChannels?.[channel.id] ?? [];
  const people = ids.map(id => profiles.find(person => person.id === id)).filter(person => !!person);
  return <div className="voice-welcome">
    <div className="voice-welcome-people" aria-hidden="true">{people.length ? people.slice(0,5).map(person => person.avatarUrl ? <img key={person.id} className="member-avatar" src={person.avatarUrl} alt="" /> : <span key={person.id} className="member-avatar">{person.name.slice(0,2).toLocaleUpperCase('pt-BR')}</span>) : <span className="join-symbol"><Icon name="headphones" size={28} /></span>}{people.length > 5 && <span className="member-avatar">+{people.length-5}</span>}</div>
    <h2>{people.length ? people.length + (people.length === 1 ? ' pessoa na call' : ' pessoas na call') : 'Ninguém na call ainda'}</h2>
    {people.length > 0 && <p>{people.slice(0,3).map(person => person.name).join(', ')}{people.length > 3 ? ' e mais ' + (people.length-3) : ''}</p>}
    {nowPlaying && <div className="voice-welcome-music"><CoverArt cover={nowPlaying.cover}/><span><small><MusicNote size={14}/> Tocando agora</small><strong>{nowPlaying.title}</strong>{nowPlaying.artist && <span>{nowPlaying.artist}</span>}</span></div>}
    {nav.activeVoice && <p>Você vai sair da call em que está agora.</p>}
    <label className="mic-option"><input type="checkbox" checked={nav.audio} onChange={e=>nav.setAudio(e.target.checked)} disabled={nav.joining} />Entrar com o microfone ligado</label>
    <button className="button primary" onClick={()=>nav.joinVoice(channel.id)} disabled={nav.joining}>{nav.joining ? 'Conectando…' : 'Entrar na call'}<Icon name="arrow" /></button>
  </div>;
}
// @ quando mencionaram você; bolinha vermelha quando há mensagens novas.
function ChannelBadge({mentioned,fresh}:{mentioned:number;fresh:boolean}) {
  return mentioned ? <span className="channel-badge mention-badge" aria-hidden="true">@</span> : fresh ? <span className="channel-badge unread-dot" aria-hidden="true" /> : null;
}
function Sidebar({open, close, manage}: {open: boolean; close: () => void; manage:(kind:'text'|'voice')=>void}) {
  const {voice:CHANNELS,text,site,user}=useAccount();
  const nav = useNavigation();
  const activity = useActivity();
  return <aside id="community-sidebar" className={"sidebar community-sidebar " + (open ? "mobile-open" : "")} aria-label="Canais da comunidade"><div className="mobile-sidebar-header"><Brand /><button className="mobile-menu-close" onClick={close} aria-label="Fechar canais"><Icon name="close" /></button></div><div className="community-label">{site.tagline} <span className="tiny-star">★</span></div><nav className="channel-navigation" aria-label="Canais" onClick={event => { if ((event.target as HTMLElement).closest("button")) close(); }}>{sectionOrder(text,CHANNELS).map(kind => kind==='text' ? <div className="channel-section" key="text"><div className="sidebar-section-label">CONVERSA <span>{text.length}</span>{user.role==='admin'&&<button className="channel-manage" type="button" aria-label="Criar ou gerenciar canais de texto" title="Criar ou gerenciar canais de texto" onClick={()=>manage('text')}>+</button>}</div>{text.map(channel=>{const current=nav.view === 'text' && nav.selectedText === channel.id;const fresh=!current && activity.unread(channel.id);const mentioned=current ? 0 : activity.mentions(channel.id);return <button key={channel.id} className={'channel text-channel ' + (current ? 'active' : '') + (fresh || mentioned ? ' has-unread' : '')} aria-current={current ? 'page' : undefined} aria-label={'#'+channel.name+(mentioned ? ', mencionaram você' : fresh ? ', mensagens novas' : '')} onClick={() => nav.selectText(channel.id)}><Icon name="chat" /><span className="channel-name">#{channel.name}</span><ChannelBadge mentioned={mentioned} fresh={fresh}/></button>;})}</div> : <div className="channel-section" key="voice"><div className="sidebar-section-label voice-label">CANAIS DE VOZ <span>{CHANNELS.length}</span>{user.role==='admin'&&<button className="channel-manage" type="button" aria-label="Criar ou gerenciar canais de voz" title="Criar ou gerenciar canais de voz" onClick={()=>manage('voice')}>+</button>}</div>{CHANNELS.map(channel => <VoiceChannel key={channel.id} channel={channel} />)}</div>)}</nav><div className="sidebar-bottom"><ProfileEditor status={nav.activeVoice ? 'Na call' : 'Online'} /><div className="network-state"><Icon name="shield" size={17} />Rede privada</div></div></aside>;
}
// Painel direito: quem está na call e quem está online.
function MembersPanel({open, close}: {open: boolean; close: () => void}) {
  const {voice:CHANNELS}=useAccount();
  const nav = useNavigation();
  const participants = [...new Map(useParticipants().filter(participant=>!participant.identity.startsWith('music-bot:')).map(participant=>[participant.identity.split(':')[0],participant])).values()];
  // A call em que você está usa a lista do LiveKit, com fala e ajustes de áudio.
  const activeCall = nav.activeVoice ? <div className="member-call"><h3 className="member-call-title"><span>{CHANNELS.find(c => c.id === nav.activeVoice)?.name}</span><span>{participants.length}</span></h3><ul className="members">{participants.map(p => <Member key={p.identity} participant={p} />)}</ul></div> : null;
  return <aside id="members-panel" className={"members-panel " + (open ? "mobile-open" : "")} aria-label="Membros"><div className="members-panel-header"><strong>Membros</strong><button className="members-panel-close" onClick={close} aria-label="Fechar membros"><Icon name="close" /></button></div><MemberGroups activeVoice={nav.activeVoice} activeCall={activeCall} activeIds={nav.activeVoice ? participants.map(participant=>participant.identity.split(':')[0]) : []} /></aside>;
}
function VoiceChannel({channel}:{channel:{id:string;name:string;hint:string}}) {
  const nav = useNavigation();
  const {voiceChannels,profiles,music} = usePresence();
  const activity = useActivity();
  const playing = music[channel.id];
  const chatOpen = nav.activeVoice === channel.id && nav.callChatOpen && nav.view === 'voice';
  const fresh = !chatOpen && activity.unread('voice:'+channel.id);
  const mentioned = chatOpen ? 0 : activity.mentions('voice:'+channel.id);
  const members = voiceChannels?.[channel.id];
  const people = members?.map(id=>profiles.find(profile=>profile.id===id));
  const count = members?.length;
  const status = count === undefined ? 'ocupação indisponível' : `${count} ${count === 1 ? 'pessoa' : 'pessoas'} na voz`;
  const names = people?.map(person=>person?.name || 'Participante').join(', ');
  return <button className={'channel voice-channel ' + (nav.view === 'voice' && nav.selectedVoice === channel.id ? 'active' : '')} aria-current={nav.view === 'voice' && nav.selectedVoice === channel.id ? 'page' : undefined} aria-label={`${channel.name}, ${status}${names ? ': '+names : ''}${playing ? ', tocando '+playing.title : ''}${mentioned ? ', mencionaram você no chat' : fresh ? ', mensagens novas no chat' : ''}`} onClick={() => nav.selectVoice(channel.id)} disabled={nav.joining}>
    <Icon name={count ? 'voice' : 'voiceQuiet'} />
    <span className="voice-channel-info"><span>{channel.name}</span><small>{nav.activeVoice === channel.id ? 'Você está neste canal' : channel.hint}</small>{playing && <span className="voice-channel-music" aria-hidden="true"><span className="mini-eq"><i/><i/><i/></span><span>{playing.title}{playing.artist ? ' · '+playing.artist : ''}</span></span>}{!!count && <span className="voice-channel-avatars" aria-hidden="true">{people?.slice(0,4).map((person,index)=>person?.avatarUrl ? <img key={members![index]} className="member-avatar" src={person.avatarUrl} alt="" title={person.name}/> : <span key={members![index]} className="member-avatar" title={person?.name}>{person?.name.slice(0,2).toLocaleUpperCase('pt-BR') || '?'}</span>)}{count > 4 && <span className="voice-avatar-more">+{count-4}</span>}</span>}</span>
    <ChannelBadge mentioned={mentioned} fresh={fresh}/><span className="voice-channel-count" title={status} aria-hidden="true">{count ?? '—'}</span>
  </button>;
}
function PageHeader({openMenu, menuOpen, openMembers, membersOpen}: {openMenu: () => void; menuOpen: boolean; openMembers: () => void; membersOpen: boolean}) {
  const {voice:CHANNELS,text,site}=useAccount();
  const {voiceChannels,people}=usePresence();
  const nav = useNavigation();
  const activity = useActivity();
  // Bolinha no botão do menu (celular) quando há novidade em outra conversa.
  const viewing = nav.view==='text' ? nav.selectedText : nav.callChatOpen && nav.activeVoice ? 'voice:'+nav.activeVoice : '';
  const somethingNew = [...text.map(item=>item.id),...CHANNELS.map(item=>'voice:'+item.id)].some(id=>id!==viewing && (activity.unread(id) || activity.mentions(id)>0));
  const channel = CHANNELS.find(c => c.id === nav.selectedVoice);
  return <header className="page-header"><button className="mobile-menu-button" onClick={openMenu} aria-label={somethingNew ? 'Abrir canais, há mensagens novas' : 'Abrir canais'} aria-controls="community-sidebar" aria-expanded={menuOpen}><Icon name="menu" />{somethingNew && <span className="menu-unread-dot" aria-hidden="true" />}</button><div className="header-brand"><Brand />{site.tagline && <span className="header-tagline" title={site.tagline}>{site.tagline}</span>}</div><div className="channel-heading"><Icon name={nav.view === 'text' ? 'chat' : voiceChannels?.[nav.selectedVoice]?.length ? 'voice' : 'voiceQuiet'} size={23} /><div><strong>{nav.view === 'text' ? '#'+text.find(c=>c.id===nav.selectedText)?.name : channel?.name}</strong><span>{nav.view === 'text' ? 'O papo continua. Com ou sem microfone.' : channel?.hint}</span></div></div><div className="header-actions"><InviteButton /><button className="members-toggle" onClick={openMembers} aria-label={'Ver membros, '+people.length+' online'} title="Membros" aria-controls="members-panel" aria-expanded={membersOpen}><Icon name="users" /><span aria-hidden="true">{people.length}</span></button><ProfileEditor variant="avatar" /></div></header>;
}

function PublicChat() { const {name,view,selectedText}=useNavigation(); const {text}=useAccount(); return <ChannelChat key={selectedText} name={name} channel={selectedText} title={'#'+text.find(c=>c.id===selectedText)?.name} visible={view==='text'} />; }
function VoiceControls() {
  const preferences = useCallPreferences();
  const navigation = useNavigation();
  const [moreControls, setMoreControls] = useState(false);
  const { isMicrophoneEnabled, isCameraEnabled, isScreenShareEnabled } = useLocalParticipant();
  const audioShares = useTracks([Track.Source.ScreenShareAudio], { onlySubscribed: false });
  const localShareHasAudio = audioShares.some(t => t.participant.isLocal && !t.publication.isMuted);
  const firefox = /\bFirefox\//.test(navigator.userAgent);
  const deviceError = () => navigation.setError('Confira as permissões de câmera, microfone ou transmissão do navegador e tente novamente.');
  return <><div className={"call-controls"+(moreControls?" mobile-controls-expanded":"")} role="toolbar" aria-label="Controles da chamada" onKeyDown={event=>{if(event.key==='Escape'&&moreControls){setMoreControls(false);event.currentTarget.querySelector<HTMLButtonElement>('.call-more-toggle')?.focus();}}}><div className="control-group" role="group" aria-label="Comunicação"><div className="media-control"><TrackToggle source={Track.Source.Microphone} disabled={preferences.deafened || preferences.deafenBusy} captureOptions={microphoneOptions()} onDeviceError={deviceError} title={isMicrophoneEnabled ? 'Desligar microfone' : 'Ligar microfone'} aria-label={isMicrophoneEnabled ? 'Desligar microfone' : 'Ligar microfone'} /><MediaDeviceMenu kind="audioinput" aria-label="Escolher microfone" /></div><button className="button deafen-toggle" aria-pressed={preferences.deafened} disabled={preferences.deafenBusy} title={preferences.deafened ? "Voltar a ouvir a call" : "Silenciar toda a call"} aria-label={preferences.deafened ? "Voltar a ouvir a call" : "Silenciar toda a call e o microfone"} onClick={() => void preferences.toggleDeafen()}><Icon name="voice" />{preferences.deafened && <svg className="deafen-slash" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18" /></svg>}</button><span className="sr-only" role="status">{preferences.deafenError || (preferences.deafened ? "Call silenciada. O microfone permanecerá desligado ao voltar a ouvir." : "")}</span><button className="button call-more-toggle" type="button" aria-expanded={moreControls} onClick={()=>setMoreControls(!moreControls)}>{moreControls?'Menos opções':'Mais opções'}</button><AudioOutputControl icon={<Icon name="speaker" />} onUnsupported={() => navigation.setError('Seu navegador não permite escolher a saída de áudio aqui. Troque o dispositivo nas configurações de som do sistema.')} /></div><div className="control-group" role="group" aria-label="Transmissão"><div className="media-control"><TrackToggle source={Track.Source.Camera} onDeviceError={deviceError} title={isCameraEnabled ? 'Desligar câmera' : 'Ligar câmera'} aria-label={isCameraEnabled ? 'Desligar câmera' : 'Ligar câmera'} /><MediaDeviceMenu kind="videoinput" aria-label="Escolher câmera" /></div>{typeof navigator !== 'undefined' && navigator.mediaDevices && 'getDisplayMedia' in navigator.mediaDevices && <TrackToggle source={Track.Source.ScreenShare} captureOptions={{ audio: true, systemAudio: "include", suppressLocalAudioPlayback: false }} onDeviceError={deviceError} title={isScreenShareEnabled ? 'Parar transmissão' : 'Compartilhar tela'} aria-label={isScreenShareEnabled ? 'Parar transmissão' : 'Compartilhar tela'} />}</div><div className="control-group" role="group" aria-label="Recursos"><button className="button chat-toggle" title="Chat da call" aria-label="Chat da call" aria-expanded={navigation.callChatOpen && navigation.view === "voice"} onClick={() => { if(navigation.activeVoice){ navigation.selectVoice(navigation.activeVoice); navigation.setCallChatOpen(navigation.view !== "voice" || !navigation.callChatOpen); } }}><Icon name="chat" /></button><NoiseSuppressionControl /><VoiceEffectControl /><KeepScreenAwake />{navigation.activeVoice && <><MusicControl key={navigation.activeVoice} channel={navigation.activeVoice} /><Soundboard key={navigation.activeVoice} channel={navigation.activeVoice} /></>}</div></div>{isScreenShareEnabled && !localShareHasAudio && <p className="share-audio-notice" role="status">{firefox ? 'O Firefox está compartilhando a imagem, mas não captura o som da tela. Para transmitir som, abra o chat no Chrome ou Edge e compartilhe uma aba com áudio.' : 'Esta transmissão está sem áudio. Compartilhe novamente e marque a opção de áudio no seletor do navegador, se disponível.'}</p>}</>;
}
// Sair fica no cabeçalho do bloco da call, junto do nome do canal.
function LeaveCallButton() {
  const preferences = useCallPreferences();
  return <span className="leave-button-wrap" onClickCapture={() => { if (!preferences.deafened) playLeaveSound(0.4); }}><DisconnectButton className="leave-button" title="Sair da call" aria-label="Sair da call"><Icon name="leave" /><span>Sair</span></DisconnectButton></span>;
}
function Community() {
  const {voice:CHANNELS}=useAccount();
  const nav = useNavigation();
  const state = useConnectionState();
  const [menuOpen, setMenuOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [channelAdmin,setChannelAdmin]=useState<'text'|'voice'|null>(null);
  const drawerOpen = menuOpen || membersOpen;
  useEffect(() => {
    if (!drawerOpen) return;
    if (!window.matchMedia(menuOpen ? '(max-width:767px)' : '(max-width:1099px)').matches) return;
    const drawer=document.getElementById(menuOpen ? 'community-sidebar' : 'members-panel');
    const trigger=document.querySelector<HTMLButtonElement>(menuOpen ? '.mobile-menu-button' : '.members-toggle');
    const blocked=[...document.querySelectorAll<HTMLElement>('.community-shell > .page-header, .community-shell > .main-panel, .community-shell > .community-sidebar, .community-shell > .members-panel, .community-shell > .mention-notice')].filter(element=>element!==drawer).map(element=>({element,wasInert:element.inert}));
    drawer?.querySelector<HTMLButtonElement>(menuOpen ? '.mobile-menu-close' : '.members-panel-close')?.focus();
    blocked.forEach(({element})=>{element.inert=true;});
    const focusTimer=window.setTimeout(()=>{if(!drawer?.contains(document.activeElement))drawer?.querySelector<HTMLButtonElement>(menuOpen ? '.mobile-menu-close' : '.members-panel-close')?.focus();},220);
    const onKeyDown = (event: KeyboardEvent) => {
      if(document.querySelector('dialog:modal'))return;
      if (event.key === 'Escape') {event.preventDefault();setMenuOpen(false);setMembersOpen(false);return;}
      if(event.key!=='Tab'||!drawer)return;
      const controls=[...drawer.querySelectorAll<HTMLElement>('a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])')].filter(element=>element.getClientRects().length>0);
      if(!controls.length)return;
      const first=controls[0],last=controls[controls.length-1];
      if(event.shiftKey && (document.activeElement===first || !drawer.contains(document.activeElement))){event.preventDefault();last.focus();}
      else if(!event.shiftKey && (document.activeElement===last || !drawer.contains(document.activeElement))){event.preventDefault();first.focus();}
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {window.clearTimeout(focusTimer);window.removeEventListener('keydown', onKeyDown);blocked.forEach(({element,wasInert})=>{element.inert=wasInert;});trigger?.focus();};
  }, [drawerOpen, menuOpen]);
  const closeMenu = () => { if (menuOpen) setMenuOpen(false); };
  const closeMembers = () => { if (membersOpen) setMembersOpen(false); };
  const channel = CHANNELS.find(c=>c.id===nav.selectedVoice)!;
  return <div className="app-shell room-shell community-shell"><MentionNotifications onOpen={channel=>{if(channel.startsWith("voice:")){const id=channel.slice(6);nav.selectVoice(id);if(nav.activeVoice===id)nav.setCallChatOpen(true);}else nav.selectText(channel);}} /><PageHeader openMenu={() => { setMembersOpen(false); setMenuOpen(true); }} menuOpen={menuOpen} openMembers={() => { setMenuOpen(false); setMembersOpen(true); }} membersOpen={membersOpen} /><Sidebar open={menuOpen} close={closeMenu} manage={kind=>{closeMenu();setChannelAdmin(kind);}} />{drawerOpen && <button className={'mobile-menu-backdrop' + (membersOpen ? ' for-members' : '')} aria-label={menuOpen ? 'Fechar canais' : 'Fechar membros'} onClick={menuOpen ? closeMenu : closeMembers} />}<main className="main-panel" id="principal">{nav.error && <div className="room-error" role="alert">{nav.error}<button className="icon-button" onClick={()=>nav.setError('')} aria-label="Fechar aviso"><Icon name="close" /></button></div>}<PublicChat /><CallSounds /><section className="voice-view" hidden={nav.view !== 'voice'} aria-label={'Canal de voz '+channel.name}><span className="sr-only" role="status">{nav.joining ? 'Entrando na call…' : state===ConnectionState.Reconnecting || state===ConnectionState.SignalReconnecting ? 'Reconectando…' : ''}</span>{nav.activeVoice===channel.id ? <div className={"voice-content-row " + (nav.callChatOpen ? "call-chat-open" : "")}><MediaFocusStage channel={nav.activeVoice} /><aside className="call-chat-side" hidden={!nav.callChatOpen}><ChannelChat key={nav.activeVoice} name={nav.name} channel={"voice:"+nav.activeVoice} title={channel.name} compact visible={nav.callChatOpen && nav.view === "voice"} onClose={() => nav.setCallChatOpen(false)} /></aside></div> : <VoiceWelcome channel={channel} />}</section>{nav.activeVoice && <div className="voice-dock"><div className="voice-dock-label"><span className={'voice-dock-status' + (state===ConnectionState.Connected ? ' connected' : '')}><Icon name="voice" size={16} /><span><strong>{state===ConnectionState.Connected ? 'Conectado à call' : 'Reconectando…'}</strong><small>{CHANNELS.find(c=>c.id===nav.activeVoice)?.name}</small></span></span><LeaveCallButton /></div><VoiceControls /></div>}<StartAudio label="Ativar áudio da sala" /><PersonalAudioRenderer /></main><MembersPanel open={membersOpen} close={closeMembers} />{channelAdmin&&<AdminPanel initialTab="channels" initialKind={channelAdmin} onClose={()=>setChannelAdmin(null)}/>}</div>;
}
export default function App() { return <AccountGate><AuthenticatedApp /></AccountGate>; }
function AuthenticatedApp() {
  const {user,text,voice}=useAccount();
  const name=user.name;
  const [selectedText,setSelectedText]=useState('general');
  const [room] = useState(() => new Room({ adaptiveStream: true, dynacast: true, audioCaptureDefaults: microphoneOptions() }));
  const [view, setView] = useState<'text' | 'voice'>('text');
  const [callChatOpen, setCallChatOpen] = useState(false);
  const [selectedVoice, setSelectedVoice] = useState<VoiceId>('geral');
  const [activeVoice, setActiveVoice] = useState<VoiceId | null>(null);
  const [audio, setAudio] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState('');
  const switching = useRef(false);
  useEffect(() => {
    const disconnected = (reason?: DisconnectReason) => { setActiveVoice(null); if (reason===DisconnectReason.PARTICIPANT_REMOVED) setError('Você foi removido desta call por um administrador.'); };
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
      if(enableAudio) { try { await room.localParticipant.setMicrophoneEnabled(true, microphoneOptions()); } catch { setError('Você entrou no canal, mas o microfone não pôde ser ligado. Confira as permissões.'); } }
    } catch { setError('Não foi possível entrar na call. Confira sua internet e tente novamente.'); }
    finally { switching.current=false; setJoining(false); }
  }
  function selectVoice(id:VoiceId) { setSelectedVoice(id); setView('voice'); }
  const currentText=text.some(channel=>channel.id===selectedText)?selectedText:text[0]?.id || 'general';
  const currentVoice=voice.some(channel=>channel.id===selectedVoice)?selectedVoice:voice[0]?.id || 'geral';
  const navigation:Navigation={selectedText:currentText,selectText:id=>{setSelectedText(id);setView('text');},name,view,setView,selectedVoice:currentVoice,selectVoice,activeVoice,joinVoice:id=>void joinVoice(id),joining,audio,setAudio,error,setError,callChatOpen,setCallChatOpen};
  return <div data-lk-theme="default" className="progresso-app"><RoomContext.Provider value={room}><div className="live-room lk-room-container"><CallPreferencesProvider><NavigationContext.Provider value={navigation}><PresenceProvider><ActivityProvider><Community /></ActivityProvider></PresenceProvider></NavigationContext.Provider></CallPreferencesProvider></div></RoomContext.Provider></div>;
}
