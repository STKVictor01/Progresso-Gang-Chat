import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { RoomContext, ParticipantTile, RoomAudioRenderer, TrackToggle, DisconnectButton, MediaDeviceMenu, StartAudio, useParticipants, useTracks, useConnectionState, useIsSpeaking, useLocalParticipant } from '@livekit/components-react';
import { ConnectionState, Room, RoomEvent, Track } from 'livekit-client';
import type { Participant } from 'livekit-client';
import '@livekit/components-styles';
import './App.css';

type Session = { token: string; serverUrl: string };
type IconName = 'voice' | 'arrow' | 'link' | 'shield' | 'chat' | 'close' | 'chevron' | 'headphones';
function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, ReactNode> = {
    voice: <><path d="M11 5 6 9H3v6h3l5 4V5Z" /><path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" /></>,
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
    link: <path d="m10 13 4-4m-6 6-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 3 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" transform="translate(1 0)" />,
    shield: <><path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Z" /><path d="m8 12 3 3 5-6" /></>,
    chat: <path d="M21 11a8 8 0 0 1-8 8H7l-4 3V7a4 4 0 0 1 4-4h6a8 8 0 0 1 8 8Z" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    chevron: <path d="m8 10 4 4 4-4" />,
    headphones: <><path d="M4 14v-3a8 8 0 0 1 16 0v3" /><rect x="3" y="12" width="4" height="8" rx="2" /><rect x="17" y="12" width="4" height="8" rx="2" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
function Mark() {
  return <svg className="brand-mark" viewBox="0 0 64 64" aria-hidden="true"><path d="M32 6 58 32 32 58 6 32Z" fill="currentColor" /><circle cx="32" cy="32" r="16" fill="var(--surface)" /><path d="m32 18 3.3 9.7H46l-8.7 6.2 3.4 10.2L32 38l-8.7 6.1 3.4-10.2-8.7-6.2h10.7Z" fill="currentColor" /></svg>;
}
function InviteButton() {
  const [message, setMessage] = useState('Convidar amigos');
  async function copy() {
    try { await navigator.clipboard.writeText(window.location.origin); setMessage('Link copiado!'); }
    catch { setMessage('Copie o endereço do navegador'); }
  }
  return <button className="button subtle invite-button" onClick={copy}><Icon name="link" /><span aria-live="polite">{message}</span></button>;
}
function Member({ participant }: { participant: Participant }) {
  const speaking = useIsSpeaking(participant);
  const label = participant.name || 'Participante';
  return <li className={`member ${speaking ? 'speaking' : ''}`}><span className="member-avatar">{label.slice(0, 2).toLocaleUpperCase('pt-BR')}</span><span className="member-name">{label}<small>{speaking ? 'Falando agora' : participant.isLocal ? 'Você' : 'Na sala'}</small></span><span className="sound-bars" aria-label={speaking ? 'Falando' : 'Em silêncio'}><i /><i /><i /></span></li>;
}
function Poster() {
  return <section className="poster" aria-label="Progresso Gang: de cada canto, no mesmo lugar">
    <div className="poster-meta"><span>BRASIL AFORA. A GANG AQUI.</span><span>EST. 2026</span></div>
    <h1>A DISTÂNCIA<br />É GRANDE.<br /><span>A RESENHA<br />É MAIOR.</span></h1>
    <svg className="poster-art" viewBox="0 0 520 290" aria-hidden="true"><defs><pattern id="poster-grid" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M24 0H0v24" fill="none" stroke="currentColor" strokeWidth=".5" /></pattern></defs><rect width="520" height="290" fill="url(#poster-grid)" opacity=".17" /><path d="M-30 290 390 15 550 290Z" fill="#c6352c" /><path d="m260 44 168 100-168 100L92 144Z" fill="#d6c6a3" /><circle cx="260" cy="144" r="62" fill="#20211c" /><path d="m260 101 10 29h31l-25 18 10 30-26-18-26 18 10-30-25-18h31Z" fill="#d6c6a3" /><path d="M0 261 520 68" stroke="#eee8dc" strokeWidth="9" /><path d="M0 280 520 87" stroke="#eee8dc" strokeWidth="2" /></svg>
    <div className="poster-footer"><span>VOZ. TELA. PRESENÇA.</span><span>PG — 01</span></div>
  </section>;
}
function Lobby({ onJoin, error, loading }: { onJoin: (name: string, audio: boolean) => void; error: string; loading: boolean }) {
  const [name, setName] = useState(() => { try { return localStorage.getItem('pg-name') || ''; } catch { return ''; } });
  const [audio, setAudio] = useState(true);
  function submit(e: FormEvent) { e.preventDefault(); if (name.trim().length >= 2 && !loading) onJoin(name.trim(), audio); }
  return <div className="app-shell lobby-shell"><WelcomeSidebar /><main id="principal" className="main-panel"><header className="page-header"><div className="channel-heading"><Icon name="chat" /><strong>Seu ponto de encontro</strong></div><InviteButton /></header><div className="lobby-content"><div className="section-kicker"><span className="red-line" /> NOSSA COMUNIDADE, NOSSO CANTO.</div><div className="welcome-grid"><Poster /><section className="join-panel" aria-labelledby="join-title"><div className="join-symbol"><Icon name="headphones" size={28} /></div><span className="eyebrow">PUXA UMA CADEIRA</span><h2 id="join-title">Chega junto.</h2><p className="join-description">O próximo papo começa com você.<br />Escolha seu apelido. A voz fica por sua conta.</p><form onSubmit={submit}><label htmlFor="nickname">Como a gang te chama?</label><input id="nickname" name="nickname" value={name} onChange={e => setName(e.target.value)} minLength={2} maxLength={32} required autoComplete="nickname" placeholder="Seu apelido" aria-describedby="nickname-help" disabled={loading} /><small id="nickname-help">De 2 a 32 caracteres. Do seu jeito.</small><label className="mic-option"><input type="checkbox" checked={audio} onChange={e => setAudio(e.target.checked)} disabled={loading} /><span>Ligar o microfone ao entrar na voz</span></label><button className="button primary join-button" disabled={loading || name.trim().length < 2}>{loading ? 'Conectando à gang…' : 'Entrar na comunidade'}<Icon name="arrow" /></button>{error && <p className="error-message" role="alert">{error}</p>}</form><div className="join-footnote"><Icon name="shield" size={17} /><span>Texto primeiro. Voz quando quiser.<br />Só os convidados chegam até aqui.</span></div></section></div><footer className="lobby-footer"><span>PROGRESSO GANG — CHAT</span><span>Um espaço nosso. De verdade.</span><span>FEITO PRA ESTAR JUNTO <span className="tiny-star">★</span></span></footer></div></main></div>;
}

const CHANNELS = [{ id: 'geral', name: 'Geral', hint: 'Conversa e resenha' }, { id: 'jogatina', name: 'Jogatina', hint: 'Fecha o squad' }] as const;
type VoiceId = typeof CHANNELS[number]['id'];
type Navigation = {
  name: string; view: 'text' | 'voice'; setView: (view: 'text' | 'voice') => void;
  selectedVoice: VoiceId; selectVoice: (id: VoiceId) => void; activeVoice: VoiceId | null;
  joinVoice: (id: VoiceId) => void; joining: boolean; audio: boolean; setAudio: (audio: boolean) => void;
  error: string; setError: (error: string) => void;
};
const NavigationContext = createContext<Navigation | null>(null);
function useNavigation() { const value = useContext(NavigationContext); if (!value) throw Error('Missing navigation'); return value; }
function WelcomeSidebar() {
  return <aside className="sidebar welcome-sidebar"><Brand /><div className="community-label">O NOSSO PONTO DE ENCONTRO <span className="tiny-star">★</span></div><div className="welcome-channel"><Icon name="chat" /><span>#geral <small>Texto, sem precisar de voz</small></span></div><div className="welcome-channel"><Icon name="voice" /><span>Geral & Jogatina<small>Dois canais pra juntar a gang</small></span></div><div className="sidebar-bottom"><div className="side-note"><span className="tiny-star">★</span><p>De cada canto.<br /><strong>No mesmo lugar.</strong></p></div><div className="network-state"><Icon name="shield" size={17} />Acesso pela rede privada</div></div></aside>;
}
function Brand() { return <a className="brand" href="#principal" aria-label="Progresso Gang - Chat"><Mark /><span>PROGRESSO<br />GANG<span className="brand-chat"> / CHAT</span></span></a>; }
function Sidebar() {
  const nav = useNavigation();
  const participants = useParticipants();
  return <aside className="sidebar community-sidebar" aria-label="Canais da comunidade"><Brand /><div className="community-label">O NOSSO PONTO DE ENCONTRO <span className="tiny-star">★</span></div><nav className="channel-navigation" aria-label="Canais"><div className="sidebar-section-label">CONVERSA</div><button className={'channel text-channel ' + (nav.view === 'text' ? 'active' : '')} aria-current={nav.view === 'text' ? 'page' : undefined} onClick={() => nav.setView('text')}><Icon name="chat" /><span>#geral<small>O papo continua por aqui</small></span></button><div className="sidebar-section-label voice-label">CANAIS DE VOZ <span>02</span></div>{CHANNELS.map(channel => <button key={channel.id} className={'channel ' + (nav.view === 'voice' && nav.selectedVoice === channel.id ? 'active' : '')} aria-current={nav.view === 'voice' && nav.selectedVoice === channel.id ? 'page' : undefined} onClick={() => nav.selectVoice(channel.id)} disabled={nav.joining}><Icon name="voice" /><span>{channel.name}<small>{nav.activeVoice === channel.id ? 'Você está neste canal' : channel.hint}</small></span>{nav.activeVoice === channel.id && <span className="channel-dot" />}</button>)}</nav>{nav.activeVoice && <><div className="sidebar-section-label participants-label">NA VOZ · {CHANNELS.find(c => c.id === nav.activeVoice)?.name.toUpperCase()} <span>{participants.length}</span></div><ul className="members">{participants.map(p => <Member key={p.identity} participant={p} />)}</ul></>}<div className="sidebar-bottom"><div className="identity-card"><span className="member-avatar">{nav.name.slice(0, 2).toLocaleUpperCase('pt-BR')}</span><div><strong>{nav.name}</strong><small>{nav.activeVoice ? 'Conectado à voz' : 'Só no texto. De boa.'}</small></div></div><div className="network-state"><Icon name="shield" size={17} />Rede privada · Progresso Gang</div></div></aside>;
}
function PageHeader() {
  const nav = useNavigation();
  const channel = CHANNELS.find(c => c.id === nav.selectedVoice);
  return <header className="page-header"><div className="channel-heading"><Icon name={nav.view === 'text' ? 'chat' : 'voice'} size={23} /><div><strong>{nav.view === 'text' ? '#geral' : channel?.name}</strong><span>{nav.view === 'text' ? 'O papo continua. Com ou sem microfone.' : channel?.hint}</span></div></div><InviteButton /></header>;
}

type TextMessage = { id: number; name: string; text: string; timestamp: number };
function PublicChat() {
  const { name, view } = useNavigation();
  const [messages, setMessages] = useState<TextMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('Carregando conversa…');
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const cursor = useRef(0);
  const pending = useRef<{text: string; id: string} | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const bottom = useRef<HTMLDivElement>(null);
  const hydrated = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const url = hydrated.current ? '/api/messages?after=' + cursor.current : '/api/messages';
        const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
        if (!response.ok) throw Error('Servidor indisponível');
        const data = await response.json() as { messages: TextMessage[]; hasMore?: boolean };
        if (controller.signal.aborted) return;
        if (!hydrated.current) setHasMore(Boolean(data.hasMore));
        hydrated.current = true;
        cursor.current = Math.max(cursor.current, ...data.messages.map(m => m.id));
        setMessages(previous => [...new Map([...previous, ...data.messages].map(m => [m.id, m])).values()].sort((a,b) => a.id-b.id));
        setStatus('Mensagens salvas no servidor');
      } catch { if (!controller.signal.aborted) setStatus('Sem conexão. Tentando reconectar…'); }
      finally { if (!controller.signal.aborted) timer = setTimeout(refresh, 2000); }
    }
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, []);
  useEffect(() => { if (view === 'text' && atBottom.current) bottom.current?.scrollIntoView({ block: 'nearest' }); }, [messages.length, view]);
  async function send(e: FormEvent) {
    e.preventDefault(); const text = draft.trim(); if (!text || sending) return;
    setSending(true); setError('');
    if (pending.current?.text !== text) pending.current = { text, id: crypto.randomUUID() };
    try {
      const response = await fetch('/api/messages', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({name, text, clientId: pending.current.id}), signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw Error('Não foi possível enviar. Tente novamente.');
      const sent = await response.json() as TextMessage;
      setMessages(previous => [...new Map([...previous, sent].map(m => [m.id, m])).values()].sort((a,b) => a.id-b.id));
      setDraft(''); pending.current = null; atBottom.current = true;
    } catch { setError('Não foi possível enviar. Sua mensagem continua aqui para tentar de novo.'); }
    finally { setSending(false); }
  }
  async function older() {
    if (!messages.length || loadingOlder) return;
    setLoadingOlder(true); setError('');
    const previousHeight = scroller.current?.scrollHeight ?? 0;
    try {
      const response = await fetch('/api/messages?before=' + messages[0].id);
      if (!response.ok) throw Error('Histórico indisponível');
      const data = await response.json() as {messages:TextMessage[]; hasMore:boolean};
      atBottom.current = false;
      setMessages(previous => [...new Map([...data.messages,...previous].map(m => [m.id,m])).values()].sort((a,b) => a.id-b.id)); setHasMore(data.hasMore);
      requestAnimationFrame(() => { if (scroller.current) scroller.current.scrollTop += scroller.current.scrollHeight - previousHeight; });
    } catch { setError('Não foi possível carregar mensagens anteriores. Tente novamente.'); }
    finally { setLoadingOlder(false); }
  }
  return <section className="public-chat" hidden={view !== 'text'} aria-label="Chat geral"><div className="text-chat-heading"><span className="eyebrow">O PONTO DE ENCONTRO DA GANG</span><h1>O salve é pra todo mundo.</h1><p>Escreva, troque ideia, fique por aqui. Voz é opcional.</p></div><div className="public-messages" ref={scroller} onScroll={() => { const el=scroller.current; if(el) atBottom.current=el.scrollHeight-el.scrollTop-el.clientHeight<90; }} role="log" aria-label="Mensagens do canal geral" aria-live="polite">{hasMore && <button className="button subtle load-history" disabled={loadingOlder} onClick={older}>{loadingOlder ? 'Carregando…' : 'Carregar mensagens anteriores'}</button>}{messages.length === 0 && <div className="public-chat-empty"><Icon name="chat" size={36} /><h2>A resenha começa aqui.</h2><p>Mande o primeiro salve da comunidade.</p></div>}{messages.map(m => <article key={m.id} className="public-message"><span className="member-avatar" aria-hidden="true">{m.name.slice(0,2).toLocaleUpperCase('pt-BR')}</span><div><header><strong>{m.name}</strong><time dateTime={new Date(m.timestamp).toISOString()}>{new Date(m.timestamp).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</time></header><p>{m.text}</p></div></article>)}<div ref={bottom} /></div><div className="public-compose"><p className="chat-sync" role="status">{status}</p><form onSubmit={send}><label className="sr-only" htmlFor="public-message">Mensagem para #geral</label><textarea id="public-message" value={draft} onChange={e => setDraft(e.target.value)} maxLength={2000} placeholder="Manda a boa no #geral…" rows={2} disabled={sending} onKeyDown={e=>{if(e.key==='Enter' && !e.shiftKey && !e.nativeEvent.isComposing){e.preventDefault();e.currentTarget.form?.requestSubmit();}}} /><button className="button primary" disabled={sending || !draft.trim()} type="submit" aria-label="Enviar mensagem"><span>{sending ? 'Enviando…' : 'Enviar'}</span><Icon name="arrow" /></button></form><small>Enter envia · Shift + Enter quebra a linha</small>{error && <p className="error-message" role="alert">{error}</p>}</div></section>;
}
function VoiceStage() {
  const participants = useParticipants();
  const tracks = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }, { source: Track.Source.ScreenShare, withPlaceholder: false }]);
  const shares = tracks.filter(t => t.source === Track.Source.ScreenShare);
  const cameras = tracks.filter(t => t.source === Track.Source.Camera);
  const screenAudioTracks = useTracks([Track.Source.ScreenShareAudio], { onlySubscribed: false });
  const [selectedShare, setSelectedShare] = useState('');
  const focusedShare = shares.find(t => t.participant.identity === selectedShare) ?? shares[0];
  const focusedAudio = screenAudioTracks.find(t => t.participant.identity === focusedShare?.participant.identity);
  const audioStatus = !focusedAudio ? 'Sem áudio compartilhado' : focusedAudio.publication.isMuted ? 'Áudio compartilhado silenciado' : 'Áudio compartilhado';
  const connected = useConnectionState() === ConnectionState.Connected;
  return <section className={`stage ${focusedShare ? 'has-share' : ''}`} aria-label="Participantes e transmissões">{focusedShare && <div className="screen-stage"><div className="screen-caption"><span className="live-label">AO VIVO</span><span>{focusedShare.participant.name || 'Participante'} está compartilhando</span><span className={"share-audio-status " + (focusedAudio && !focusedAudio.publication.isMuted ? 'has-audio' : 'no-audio')} role="status">{audioStatus}</span></div>{shares.length > 1 && <div className="share-tabs" aria-label="Escolher transmissão">{shares.map(t => <button key={t.participant.identity} className="button subtle" aria-pressed={t.participant.identity === focusedShare.participant.identity} onClick={() => setSelectedShare(t.participant.identity)}>{t.participant.name || 'Transmissão'}</button>)}</div>}<ParticipantTile trackRef={focusedShare} /></div>}<div className="people-grid">{cameras.map(t => <ParticipantTile key={t.participant.identity} trackRef={t} data-avatar={(t.participant.name || "PG").slice(0, 2).toLocaleUpperCase("pt-BR")} />)}</div>{connected && participants.length === 1 && <p className="waiting-note"><Icon name="link" size={16} />Por enquanto, só você. Convide a gang pelo botão no topo.</p>}</section>;
}
function VoiceControls() {
  const navigation = useNavigation();
  const { isMicrophoneEnabled, isCameraEnabled, isScreenShareEnabled } = useLocalParticipant();
  const audioShares = useTracks([Track.Source.ScreenShareAudio], { onlySubscribed: false });
  const localShareHasAudio = audioShares.some(t => t.participant.isLocal && !t.publication.isMuted);
  const deviceError = () => navigation.setError('Confira as permissões de câmera, microfone ou transmissão do navegador e tente novamente.');
  return <><div className="call-controls" aria-label="Controles da chamada"><div className="media-control"><TrackToggle source={Track.Source.Microphone} onDeviceError={deviceError} title={isMicrophoneEnabled ? 'Desligar microfone' : 'Ligar microfone'}>{isMicrophoneEnabled ? 'Microfone ligado' : 'Microfone desligado'}</TrackToggle><MediaDeviceMenu kind="audioinput" aria-label="Escolher microfone" /></div><div className="media-control"><TrackToggle source={Track.Source.Camera} onDeviceError={deviceError} title={isCameraEnabled ? 'Desligar câmera' : 'Ligar câmera'}>Câmera</TrackToggle><MediaDeviceMenu kind="videoinput" aria-label="Escolher câmera" /></div>{typeof navigator !== 'undefined' && navigator.mediaDevices && 'getDisplayMedia' in navigator.mediaDevices && <TrackToggle source={Track.Source.ScreenShare} captureOptions={{ audio: true, systemAudio: "include", suppressLocalAudioPlayback: false }} onDeviceError={deviceError}>{isScreenShareEnabled ? 'Parar transmissão' : 'Compartilhar tela'}</TrackToggle>}<button className="button chat-toggle" onClick={() => navigation.setView("text")}><Icon name="chat" /><span>Abrir #geral</span></button><DisconnectButton className="leave-button">Sair do canal</DisconnectButton></div>{isScreenShareEnabled && !localShareHasAudio && <p className="share-audio-notice" role="status">Sua transmissão está sem áudio. Pare e compartilhe novamente, marcando “Compartilhar áudio” na janela do navegador. Para conteúdo de uma aba, use Chrome ou Edge e compartilhe essa aba com áudio.</p>}</>;
}
function Community() {
  const nav = useNavigation();
  const state = useConnectionState();
  const channel = CHANNELS.find(c=>c.id===nav.selectedVoice)!;
  return <div className="app-shell room-shell community-shell"><Sidebar /><main className="main-panel" id="principal"><PageHeader />{nav.error && <div className="room-error" role="alert">{nav.error}<button className="icon-button" onClick={()=>nav.setError('')} aria-label="Fechar aviso"><Icon name="close" /></button></div>}<PublicChat /><section className="voice-view" hidden={nav.view !== 'voice'} aria-label={'Canal de voz '+channel.name}><div className="room-heading"><div><span className="eyebrow">CANAL DE VOZ</span><h1>{channel.name}</h1></div><span className="connection-badge" role="status">{nav.joining ? 'Entrando no canal…' : state===ConnectionState.Reconnecting || state===ConnectionState.SignalReconnecting ? 'Reconectando…' : nav.activeVoice===channel.id ? 'Na mesma sintonia' : 'O próximo papo começa aqui'}</span></div>{nav.activeVoice===channel.id ? <VoiceStage /> : <div className="voice-welcome"><div className="join-symbol"><Icon name="headphones" size={30} /></div><h2>{channel.id==='jogatina' ? 'Fecha o squad.' : 'Puxa uma cadeira.'}</h2><p>{nav.activeVoice ? 'Ao entrar aqui, você sai do outro canal de voz.' : 'Entre quando quiser conversar. Seu microfone só liga com a sua escolha.'}</p><label className="mic-option"><input type="checkbox" checked={nav.audio} onChange={e=>nav.setAudio(e.target.checked)} disabled={nav.joining} />Entrar com o microfone ligado</label><button className="button primary" onClick={()=>nav.joinVoice(channel.id)} disabled={nav.joining}>{nav.joining ? 'Conectando…' : 'Entrar em '+channel.name}<Icon name="arrow" /></button></div>}</section>{nav.activeVoice && <div className="voice-dock"><div className="voice-dock-label"><Icon name="voice" size={16} /><span>{state===ConnectionState.Connected ? 'Na voz' : 'Reconectando'} · {CHANNELS.find(c=>c.id===nav.activeVoice)?.name}</span></div><VoiceControls /></div>}<StartAudio label="Ativar áudio da sala" /><RoomAudioRenderer /></main></div>;
}
export default function App() {
  const [room] = useState(() => new Room({ adaptiveStream: true, dynacast: true }));
  const [name, setName] = useState('');
  const [view, setView] = useState<'text' | 'voice'>('text');
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
      const response=await fetch('/api/token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,room:id}),signal:AbortSignal.timeout(15000)});
      if(!response.ok) throw Error('Não foi possível entrar nesse canal. Tente novamente.');
      const data=await response.json() as Session;
      if(!data.token || !data.serverUrl) throw Error('O servidor não retornou o acesso à sala.');
      await room.disconnect();
      await room.connect(data.serverUrl,data.token);
      setActiveVoice(id);
      if(enableAudio) { try { await room.localParticipant.setMicrophoneEnabled(true); } catch { setError('Você entrou no canal, mas o microfone não pôde ser ligado. Confira as permissões.'); } }
    } catch { setError('Não foi possível conectar à voz. Confira o Tailscale e tente novamente.'); }
    finally { switching.current=false; setJoining(false); }
  }
  function selectVoice(id:VoiceId) { setSelectedVoice(id); setView('voice'); if(activeVoice && activeVoice!==id) void joinVoice(id); }
  function enterCommunity(nickname:string,microphone:boolean) {
    try { localStorage.setItem('pg-name',nickname); } catch { /* Browser storage is optional. */ }
    setName(nickname); setAudio(microphone);
  }
  const navigation:Navigation={name,view,setView,selectedVoice,selectVoice,activeVoice,joinVoice:id=>void joinVoice(id),joining,audio,setAudio,error,setError};
  return <div data-lk-theme="default" className="progresso-app">{!name ? <Lobby onJoin={enterCommunity} loading={false} error="" /> : <RoomContext.Provider value={room}><div className="live-room lk-room-container"><NavigationContext.Provider value={navigation}><Community /></NavigationContext.Provider></div></RoomContext.Provider>}</div>;
}
