import { api } from './api';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ClipboardEvent, FormEvent } from 'react';
import { usePresence } from './presence';
import { useAccount } from './accounts';
import { hasMention, mentionQuery, mentionRanges } from './mentions';
import { useActivity } from './mention-notifications';
import { continuesGroup } from './chat-format';
import { GifPicker } from './gif-picker';
import type { GifResult } from './gif-picker';
import { gifId, gifMessage } from './giphy';

type Attachment = { id: string; url: string; posterUrl?: string; mime: string; width: number; height: number; size: number; animated: boolean; filename?: string };
type Reply = {id:number;name?:string;text?:string;user_id?:string|null;deleted:boolean};
type TextMessage = { reply?:Reply|null; id: number; name: string; text: string; timestamp: number; channel: string; user_id: string | null; canDelete: boolean; attachments?: Attachment[]; pending?: 'sending' | 'failed'; clientId?: string };
// Mensagens confirmadas seguem a ordem do servidor; as que ainda estão saindo ficam no fim.
function ordered(list: TextMessage[]) { const real=list.filter(message=>!message.pending).sort((a,b)=>a.id-b.id); return [...real,...list.filter(message=>message.pending)]; }
const now = () => Date.now();
const dedupe = (list: TextMessage[]) => [...new Map(list.map(message=>[message.id,message])).values()];
// Quando a própria mensagem chega pela atualização antes da resposta do envio, a cópia provisória sai da lista.
function absorb(previous: TextMessage[], incoming: TextMessage[], userId: string) {
  let rest = previous;
  for (const message of incoming) {
    if (message.user_id !== userId || message.attachments?.length) continue;
    const index = rest.findIndex(item => item.pending === 'sending' && item.text === message.text && (item.reply?.id ?? null) === (message.reply?.id ?? null));
    if (index >= 0) rest = rest.filter((_, position) => position !== index);
  }
  return rest;
}
function pendingMessage(id: number, user: {id: string; name: string}, channel: string, text: string, replyTo: TextMessage | null): TextMessage {
  return {id,name:user.name,text,timestamp:Date.now(),channel,user_id:user.id,canDelete:false,attachments:[],reply:replyTo?{id:replyTo.id,name:replyTo.name,text:replyTo.text,user_id:replyTo.user_id,deleted:false}:null,pending:'sending',clientId:crypto.randomUUID()};
}
type PendingFile = { id: string; file: File; preview: string | null };
const MB = 1024 * 1024;
const ACCEPT = ['image/png','image/jpeg','image/gif','image/webp'];
function isImageFile(file: File) { return ACCEPT.includes(file.type) || /\.(png|jpe?g|webp|gif)$/i.test(file.name); }
function ClipIcon() { return <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="m8 13 7-7a3 3 0 0 1 4 4L9 20a5 5 0 0 1-7-7L13 2" /><path d="m6 15 9-9" /></svg>; }
function MessageAvatar({message}:{message:TextMessage}) {
  const {profiles,showProfile}=usePresence();
  const profile=profiles.find(person=>person.id===message.user_id);
  const [failedUrl,setFailedUrl]=useState<string | null>(null);
  const name=profile?.name || message.name;
  const initials=name.slice(0,2).toLocaleUpperCase('pt-BR');
  if (!profile) return <span className="member-avatar" aria-hidden="true">{initials}</span>;
  return <button className="member-avatar message-avatar" onClick={()=>showProfile(profile.id)} aria-label={'Ver perfil de '+name} title={'Ver perfil de '+name}>{profile.avatarUrl && failedUrl!==profile.avatarUrl ? <img src={profile.avatarUrl} alt="" onError={()=>setFailedUrl(profile.avatarUrl)} /> : initials}</button>;
}
function MessageOptionsButton({message, onOpen}:{message:TextMessage; onOpen:(x:number,y:number)=>void}) {
  return <button className="message-options-trigger" onClick={event=>{const rect=event.currentTarget.getBoundingClientRect();onOpen(rect.right-190,rect.bottom+4);}} aria-label={'Mais opções para mensagem de '+message.name} title="Mais opções" aria-haspopup="menu"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg></button>;
}
function ImageAttachment({ attachment, author, reducedMotion, onOpen }: { attachment: Attachment; author: string; reducedMotion: boolean; onOpen: (source: string, attachment: Attachment) => void }) {
  const [playing, setPlaying] = useState<boolean | null>(null);
  const animate = playing ?? !reducedMotion;
  const source = attachment.animated && !animate ? attachment.posterUrl || attachment.url : attachment.url;
  return <figure className="message-attachment"><button className="attachment-open" onClick={() => onOpen(source, attachment)} aria-label={'Ampliar '+(attachment.animated?'GIF':'imagem')+' de '+author}><img src={source} alt={(attachment.animated?'GIF enviado por ':'Imagem enviada por ')+author} width={attachment.width} height={attachment.height} loading="lazy" decoding="async" />{attachment.animated && <span className="gif-badge">GIF</span>}</button>{attachment.animated && <button className="gif-play-toggle" aria-pressed={animate} onClick={() => setPlaying(!animate)}>{animate?'Pausar GIF':'Reproduzir GIF'}</button>}</figure>;
}
function FileAttachment({attachment}:{attachment:Attachment}) {
  const filename=attachment.filename || 'Arquivo';
  const size=attachment.size >= MB ? (attachment.size/MB).toFixed(1)+' MB' : Math.max(1,Math.ceil(attachment.size/1024))+' KB';
  return <a className="file-attachment" href={attachment.url} download={filename} aria-label={'Baixar '+filename}><span className="file-attachment-icon" aria-hidden="true"><ClipIcon /></span><span><strong>{filename}</strong><small>{size} · Baixar arquivo</small></span><span aria-hidden="true">↓</span></a>;
}
function GiphyMessage({id,reducedMotion}:{id:string;reducedMotion:boolean}) {
  const [playing,setPlaying]=useState(!reducedMotion);
  return <div className="giphy-message">{playing ? <iframe src={'https://giphy.com/embed/'+id} title="GIF do GIPHY" loading="lazy" referrerPolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-popups" /> : <button className="button subtle" onClick={()=>setPlaying(true)}>Reproduzir GIF do GIPHY</button>}</div>;
}
async function requestError(response: Response, fallback: string) {
  try { const body = await response.json(); return typeof body.error === 'string' ? body.error : fallback; } catch { return fallback; }
}
export function ChannelChat({ name, channel, title, compact = false, visible = true, onClose }: { name: string; channel: string; title: string; compact?: boolean; visible?: boolean; onClose?: () => void }) {
  const limitMb = 100;
  const {profiles} = usePresence();
  const {user} = useAccount();
  const {markRead} = useActivity();
  const userId = user.id;
  const inputId = useId();
  const [messages, setMessages] = useState<TextMessage[]>([]);
  const [caret,setCaret] = useState(0);
  const [suggestionIndex,setSuggestionIndex] = useState(0);
  const [dismissedAt,setDismissedAt] = useState(-1);
  const [draft, setDraft] = useState(() => { try { return sessionStorage.getItem('pg-draft-'+channel) || ''; } catch { return ''; } });
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [replyTo,setReplyTo] = useState<TextMessage|null>(null);
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('Carregando conversa…');
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [viewer, setViewer] = useState<{source: string; attachment: Attachment} | null>(null);
  const [gifOpen, setGifOpen] = useState(false);
  const [sendingGif, setSendingGif] = useState(false);
  const [menu, setMenu] = useState<{message: TextMessage; x: number; y: number} | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const press = useRef<{timer: number; x: number; y: number} | null>(null);
  const held = useRef<{message: TextMessage; x: number; y: number} | null>(null);
  const [heldId, setHeldId] = useState<number | null>(null);
  const pressedAt = useRef(0);
  const tempId = useRef(-1);
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const cursor = useRef(0);
  const hydrated = useRef(false);
  const pending = useRef<{signature: string; id: string} | null>(null);
  const uploaded = useRef(new Map<string, Attachment>());
  const fileInput = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileCache = useRef<PendingFile[]>([]);
  const sendController = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const dialog = useRef<HTMLDialogElement>(null);
  const query=mentionQuery(draft,caret);
  const suggestions=query && dismissedAt!==caret ? profiles.filter(profile=>profile.id!==user.id && profile.name.toLocaleLowerCase('pt-BR').includes(query.query.trim().toLocaleLowerCase('pt-BR'))).slice(0,8) : [];
  function insertMention(person:{name:string}) {
    if(!query)return;const value=draft.slice(0,query.start)+'@'+person.name+' '+draft.slice(query.end);
    const next=query.start+person.name.length+2;setDraft(value);setCaret(next);setDismissedAt(next);setSuggestionIndex(0);
    requestAnimationFrame(()=>{textarea.current?.focus();textarea.current?.setSelectionRange(next,next);});
  }
  function displayName(id:string|null|undefined,fallback:string) {return profiles.find(person=>person.id===id)?.name || fallback;}
  function nameStyle(id:string|null|undefined) {const color=id?profiles.find(person=>person.id===id)?.nameColor:null;return color?{color}:undefined;}
  function markedText(value:string) {
    const ranges=mentionRanges(value,profiles.map(person=>person.name));let position=0;
    return <>{ranges.map((range,index)=>{const before=value.slice(position,range.start);position=range.end;return <span key={index}>{before}<mark className={'chat-mention '+(range.name.toLocaleLowerCase('pt-BR')===user.name.toLocaleLowerCase('pt-BR')?'is-mine':'')}>{value.slice(range.start,range.end)}</mark></span>;})}{value.slice(position)}</>;
  }
  useEffect(() => { try { sessionStorage.setItem('pg-draft-'+channel, draft); } catch { /* Draft storage is optional. */ } }, [draft, channel]);
  useEffect(() => { fileCache.current = files; }, [files]);
  useEffect(() => () => { sendController.current?.abort(); fileCache.current.forEach(item => item.preview && URL.revokeObjectURL(item.preview)); }, []);
  useEffect(() => { const query = window.matchMedia('(prefers-reduced-motion: reduce)'); const changed = () => setReducedMotion(query.matches); query.addEventListener('change',changed); return () => query.removeEventListener('change',changed); }, []);
  useEffect(() => {
    const panel = menuRef.current; if (!panel) return;
    const toggled = (event: Event) => { if ((event as ToggleEvent).newState === 'closed') setMenu(null); };
    panel.addEventListener('toggle', toggled); return () => panel.removeEventListener('toggle', toggled);
  }, []);
  useEffect(() => {
    const panel = menuRef.current; if (!panel || !menu) return;
    panel.style.left = Math.max(8, Math.min(menu.x, window.innerWidth - 208)) + 'px';
    panel.style.top = Math.max(8, Math.min(menu.y, window.innerHeight - 200)) + 'px';
    if (!panel.matches(':popover-open')) panel.showPopover();
    if (!window.matchMedia('(pointer:coarse)').matches) panel.querySelector<HTMLButtonElement>('.message-menu-actions button')?.focus({preventScroll:true});
  }, [menu]);
  useEffect(() => {
    if (viewer && dialog.current && !dialog.current.open) dialog.current.showModal();
    if (!viewer && dialog.current?.open) dialog.current.close();
  }, [viewer]);
  useEffect(() => {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const query = new URLSearchParams({channel}); if (hydrated.current) query.set('since',String(cursor.current));
        const response = await api('/api/messages?'+query, {signal:controller.signal,cache:'no-store'});
        if (!response.ok) throw Error('Conversa indisponível');
        const data = await response.json() as {messages:TextMessage[];hasMore?:boolean;deletedIds?:number[];cursor:number};
        if (controller.signal.aborted) return;
        if (!hydrated.current) setHasMore(Boolean(data.hasMore)); hydrated.current = true;
        cursor.current = data.cursor;
        if(data.messages.length || data.deletedIds?.length) setMessages(previous => ordered(dedupe([...absorb(previous,data.messages,userId).filter(message=>!data.deletedIds?.includes(message.id)).map(message=>message.reply&&data.deletedIds?.includes(message.reply.id)?{...message,reply:{id:message.reply.id,deleted:true}}:message),...data.messages])));
        setStatus('Histórico salvo');
      } catch { if (!controller.signal.aborted) setStatus('Sem conexão. Tentando reconectar…'); }
      finally { if (!controller.signal.aborted) timer=setTimeout(refresh,2000); }
    }
    void refresh(); return () => {controller.abort();clearTimeout(timer);};
  }, [channel, userId]);
  useEffect(() => { if (visible && atBottom.current) bottom.current?.scrollIntoView({block:'nearest'}); }, [messages.length,visible]);
  // Conversa aberta e visível na tela: tudo o que chegou conta como lido.
  useEffect(() => {
    if (!visible) return;
    const newest = Math.max(0, ...messages.filter(message => !message.pending).map(message => message.id));
    const mark = () => { if (document.visibilityState === 'visible' && newest) markRead(channel, newest); };
    mark(); document.addEventListener('visibilitychange', mark);
    return () => document.removeEventListener('visibilitychange', mark);
  }, [visible, messages, channel, markRead]);
  // Envio instantâneo: a mensagem aparece na hora e é confirmada quando o servidor responder.
  async function deliver(temp: TextMessage) {
    setMessages(previous => previous.map(message => message.clientId === temp.clientId ? {...message, pending:'sending'} : message));
    try {
      const response=await api('/api/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,channel,text:temp.text,clientId:temp.clientId,attachmentIds:[],replyTo:temp.reply?.id??null}),signal:AbortSignal.timeout(15000)});
      if(!response.ok)throw Error(await requestError(response,'Não foi possível enviar. Tente novamente.'));
      const sent=await response.json() as TextMessage;
      setMessages(previous => ordered(dedupe([...previous.filter(message => message.clientId !== temp.clientId), sent])));
    } catch (cause) {
      setMessages(previous => previous.map(message => message.clientId === temp.clientId ? {...message, pending:'failed'} : message));
      setError(cause instanceof Error && cause.name==='Error' ? cause.message : 'A conexão falhou. Toque em “Tentar de novo” na mensagem.');
    }
  }
  function openMenu(message: TextMessage, x: number, y: number) { if (!message.pending) setMenu({message, x, y}); }
  function cancelPress() { if (press.current) { clearTimeout(press.current.timer); press.current = null; } }
  // Depois de segurar, o menu abre ao soltar o dedo; abrir antes faria o próprio toque fechá-lo.
  function releasePress() {
    cancelPress();
    const target = held.current; if (!target) return;
    held.current = null; pressedAt.current = now(); setHeldId(null);
    setTimeout(() => openMenu(target.message, target.x, target.y), 0);
  }
  function addFiles(incoming: File[]) {
    if (sending) return;
    const accepted: PendingFile[] = []; const errors: string[] = [];
    for (const file of incoming) {
      if (file.size>limitMb*MB) {errors.push(`Cada arquivo pode ter até ${limitMb} MB.`);continue;}
      if (files.length+accepted.length>=4) {errors.push('Envie até quatro anexos por mensagem.');break;}
      accepted.push({id:crypto.randomUUID(),file,preview:isImageFile(file)?URL.createObjectURL(file):null});
    }
    setError([...new Set(errors)].join(' ')); setFiles(previous=>[...previous,...accepted]);
  }
  function pasted(event: ClipboardEvent<HTMLTextAreaElement>) { const files=Array.from(event.clipboardData.files); if(files.length){event.preventDefault();addFiles(files);} }
  function removeFile(id:string) { const item=files.find(file=>file.id===id);if(item?.preview)URL.revokeObjectURL(item.preview);uploaded.current.delete(id);setFiles(previous=>previous.filter(file=>file.id!==id)); }
  async function send(event: FormEvent) {
    event.preventDefault();const text=draft.trim();if((!text&&!files.length)||sending)return;
    if(!files.length){
      const temp=pendingMessage(tempId.current--,user,channel,text,replyTo);
      setMessages(previous=>[...previous,temp]);setDraft('');setReplyTo(null);setError('');atBottom.current=true;
      void deliver(temp);return;
    }
    setSending(true);setError('');const controller=new AbortController();sendController.current=controller;
    const signature=JSON.stringify({channel,text,replyTo:replyTo?.id??null,ids:files.map(item=>item.id)});
    if(pending.current?.signature!==signature)pending.current={signature,id:crypto.randomUUID()};
    try{
      const attachmentIds:string[]=[];
      for(let index=0;index<files.length;index++){
        const item=files[index];setProgress('Enviando anexo '+(index+1)+' de '+files.length+'…');
        if(!uploaded.current.has(item.id)){
          const response=await api('/api/uploads',{method:'POST',headers:{'Content-Type':'application/octet-stream','x-upload-id':item.id,'x-upload-channel':channel,'x-upload-name':encodeURIComponent(item.file.name)},body:item.file,signal:AbortSignal.any([controller.signal,AbortSignal.timeout(600000)])});
          if(!response.ok)throw Error(await requestError(response,'Não foi possível enviar o anexo.'));
          uploaded.current.set(item.id,await response.json() as Attachment);
        }
        attachmentIds.push(item.id);
      }
      setProgress('Enviando mensagem…');
      const response=await api('/api/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,channel,text,clientId:pending.current.id,attachmentIds,replyTo:replyTo?.id??null}),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])});
      if(!response.ok)throw Error(await requestError(response,'Não foi possível enviar. Tente novamente.'));
      const sent=await response.json() as TextMessage;
      setMessages(previous=>ordered(dedupe([...previous,sent])));
      files.forEach(item=>item.preview && URL.revokeObjectURL(item.preview));setFiles([]);uploaded.current.clear();setDraft('');setReplyTo(null);pending.current=null;atBottom.current=true;
    }catch(cause){if(!controller.signal.aborted)setError(cause instanceof Error && cause.name!=='TypeError' && cause.name!=='TimeoutError' ? cause.message : 'A conexão falhou. Sua mensagem continua aqui para tentar novamente.');}
    finally{setSending(false);setProgress('');sendController.current=null;}
  }
  // O histórico guarda somente a identificação; o navegador carrega o GIF do GIPHY.
  async function sendGif(gif:GifResult) {
    if(sendingGif||sending)return;
    setSendingGif(true);setError('');
    try{
      const response=await api('/api/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,channel,text:gifMessage(gif.id),clientId:crypto.randomUUID(),attachmentIds:[],replyTo:replyTo?.id??null})});
      if(!response.ok)throw Error(await requestError(response,'Não foi possível enviar o GIF. Tente novamente.'));
      const sent=await response.json() as TextMessage;
      setMessages(previous=>ordered(dedupe([...previous,sent])));
      setReplyTo(null);atBottom.current=true;setGifOpen(false);
    }catch(cause){setGifOpen(false);setError(cause instanceof Error && cause.name==='Error'?cause.message:'A conexão falhou ao enviar o GIF. Tente novamente.');}
    finally{setSendingGif(false);}
  }
  async function older() {
    const first=messages.find(message=>!message.pending);if(!first||loadingOlder)return;setLoadingOlder(true);setError('');const previousHeight=scroller.current?.scrollHeight??0;
    try{const query=new URLSearchParams({channel,before:String(first.id)});const response=await api('/api/messages?'+query);if(!response.ok)throw Error('Histórico indisponível');const data=await response.json() as {messages:TextMessage[];hasMore:boolean};atBottom.current=false;setMessages(previous=>ordered(dedupe([...data.messages,...previous])));setHasMore(data.hasMore);requestAnimationFrame(()=>{if(scroller.current)scroller.current.scrollTop+=scroller.current.scrollHeight-previousHeight;});}
    catch{setError('Não foi possível carregar mensagens anteriores. Tente novamente.');}finally{setLoadingOlder(false);}
  }
  async function removeMessage(message:TextMessage) {
    if(!window.confirm('Excluir esta mensagem e seus anexos? Ela será removida para todos.'))return;
    try{const response=await api('/api/messages/'+message.id,{method:'DELETE'});if(!response.ok)throw Error(await requestError(response,'Não foi possível excluir.'));setMessages(previous=>previous.filter(item=>item.id!==message.id).map(item=>item.reply?.id===message.id?{...item,reply:{id:message.id,deleted:true}}:item));}
    catch(cause){setError(cause instanceof Error?cause.message:'Não foi possível excluir.');}
  }
  return <section className={'public-chat channel-chat '+(compact?'compact-chat':'')} hidden={!visible} aria-label={compact?'Chat da call '+title:'Chat '+title}>
    {compact && <div className="text-chat-heading"><div className="call-chat-title"><h2>Chat · {title}</h2><button className="icon-button" onClick={onClose} aria-label="Fechar chat da call">×</button></div><p>Conversa deste canal, separada do #geral.</p></div>}
    <div className="public-messages" ref={scroller} onScroll={()=>{const element=scroller.current;if(element)atBottom.current=element.scrollHeight-element.scrollTop-element.clientHeight<100;}} role="log" aria-label={compact?'Mensagens da call '+title:'Mensagens do canal geral'} aria-live="polite">
      {hasMore&&<button className="button subtle load-history" disabled={loadingOlder} onClick={older}>{loadingOlder?'Carregando…':'Carregar mensagens anteriores'}</button>}
      {!messages.length&&<div className="public-chat-empty"><h2>{compact?'O papo desta call começa aqui.':'A resenha começa aqui.'}</h2><p>Mande um salve, uma imagem ou um GIF.</p></div>}
      {messages.map((message,index)=>{const grouped=continuesGroup(messages[index-1],message);const time=new Date(message.timestamp);const options=message.pending?null:<MessageOptionsButton message={message} onOpen={(x,y)=>openMenu(message,x,y)} />;return <article id={"message-"+message.id} key={message.clientId || message.id} className={'public-message'+(grouped?' is-continuation':'')+(message.user_id!==user.id&&hasMention(message.text,user.name)?' mentions-me':'')+(message.pending?' is-'+message.pending:'')+(menu?.message.id===message.id||heldId===message.id?' menu-open':'')}
        onPointerDown={event=>{if(event.pointerType!=='touch'||message.pending)return;cancelPress();const {clientX:x,clientY:y}=event;press.current={x,y,timer:window.setTimeout(()=>{press.current=null;pressedAt.current=now();held.current={message,x:x-100,y:y+12};setHeldId(message.id);navigator.vibrate?.(12);},450)};}}
        onPointerMove={event=>{const start=press.current;if(start&&Math.hypot(event.clientX-start.x,event.clientY-start.y)>10)cancelPress();}}
        onPointerUp={releasePress} onPointerCancel={releasePress}
        onContextMenu={event=>{if(held.current||now()-pressedAt.current<1500){event.preventDefault();return;}if((event.target as HTMLElement).closest('a,img,textarea'))return;event.preventDefault();openMenu(message,event.clientX,event.clientY);}}
        onClickCapture={event=>{if(now()-pressedAt.current<700){event.preventDefault();event.stopPropagation();}}}>
        {grouped?<span className="message-gutter" aria-hidden="true">{time.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</span>:<MessageAvatar message={message}/>}<div className="message-body">{grouped?<><span className="sr-only">{displayName(message.user_id,message.name)}, {time.toLocaleString('pt-BR')}</span>{options&&<div className="continuation-options">{options}</div>}</>:<header><strong style={nameStyle(message.user_id)}>{displayName(message.user_id,message.name)}</strong><time dateTime={time.toISOString()}>{time.toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</time>{options}</header>}{message.reply&&<button type="button" className="reply-reference" onClick={()=>document.getElementById('message-'+message.reply?.id)?.scrollIntoView({behavior:'smooth',block:'center'})}>{message.reply.deleted?'Mensagem excluída':<><strong style={nameStyle(message.reply.user_id)}>{displayName(message.reply.user_id,message.reply.name || 'Participante')}</strong><span>{gifId(message.reply.text || '') ? 'GIF do GIPHY' : message.reply.text || 'Arquivo ou imagem'}</span></>}</button>}{gifId(message.text) ? <GiphyMessage id={gifId(message.text)!} reducedMotion={reducedMotion}/> : message.text&&<p>{markedText(message.text)}</p>}{!!message.attachments?.length&&<div className="message-media">{message.attachments.map(attachment=>attachment.mime.startsWith('image/')?<ImageAttachment key={attachment.id} attachment={attachment} author={message.name} reducedMotion={reducedMotion} onOpen={(source,item)=>setViewer({source,attachment:item})}/>:<FileAttachment key={attachment.id} attachment={attachment}/>)}</div>}{message.pending==='failed'&&<div className="message-failed" role="alert">Não enviada.<button type="button" onClick={()=>{setError('');void deliver(message);}}>Tentar de novo</button><button type="button" onClick={()=>setMessages(previous=>previous.filter(item=>item.clientId!==message.clientId))}>Descartar</button></div>}</div></article>;})}<div ref={bottom}/>
    </div>
    <div className="public-compose">{replyTo&&<div className="reply-compose"><span>Respondendo a <strong>{displayName(replyTo.user_id,replyTo.name)}</strong><small>{gifId(replyTo.text) ? 'GIF do GIPHY' : replyTo.text || 'Arquivo ou imagem'}</small></span><button type="button" className="button subtle" onClick={()=>setReplyTo(null)} aria-label="Cancelar resposta">×</button></div>}{suggestions.length>0&&<div className="mention-suggestions" id={inputId+"-mentions"} role="listbox" aria-label="Pessoas para mencionar">{suggestions.map((person,index)=><button key={person.id} type="button" role="option" aria-selected={index===Math.min(suggestionIndex,suggestions.length-1)} onPointerDown={event=>event.preventDefault()} onClick={()=>insertMention(person)}>{person.avatarUrl?<img className="member-avatar" src={person.avatarUrl} alt=""/>:<span className="member-avatar">{person.name.slice(0,2).toLocaleUpperCase('pt-BR')}</span>}<span>{person.name}</span></button>)}</div>}<p className="chat-sync" role="status">{sending?progress:status==='Histórico salvo'?'':status}</p>{files.length>0&&<div className="pending-attachments" aria-label="Anexos antes do envio">{files.map(item=><div className="pending-attachment" key={item.id}>{item.preview?<img src={item.preview} alt={'Prévia de '+item.file.name}/>:<span className="pending-file-icon" aria-hidden="true"><ClipIcon/></span>}<span>{item.file.name}</span><button className="icon-button" disabled={sending} aria-label={'Remover anexo '+item.file.name} onClick={()=>removeFile(item.id)}>×</button></div>)}</div>}
      <form onSubmit={send} onDragOver={event=>{if(event.dataTransfer.types.includes('Files'))event.preventDefault();}} onDrop={event=>{event.preventDefault();addFiles(Array.from(event.dataTransfer.files));}}><label className="sr-only" htmlFor={inputId}>{compact?'Mensagem para a call '+title:'Mensagem para '+title}</label><textarea ref={textarea} id={inputId} aria-autocomplete="list" aria-controls={suggestions.length?inputId+"-mentions":undefined} value={draft} onSelect={event=>setCaret(event.currentTarget.selectionStart)} onChange={event=>{setDraft(event.target.value);setCaret(event.target.selectionStart);setDismissedAt(-1);setSuggestionIndex(0);}} maxLength={2000} placeholder={compact?'Mensagem nesta call…':'Manda a boa no '+title+'…'} rows={compact?2:1} disabled={sending&&files.length>0} onPaste={pasted} onKeyDown={event=>{if(event.nativeEvent.isComposing)return;if(suggestions.length){if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();setSuggestionIndex(current=>(current+(event.key==='ArrowDown'?1:-1)+suggestions.length)%suggestions.length);return;}if(event.key==='Escape'){event.preventDefault();setDismissedAt(caret);return;}if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();insertMention(suggestions[Math.min(suggestionIndex,suggestions.length-1)]);return;}}if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();event.currentTarget.form?.requestSubmit();}}}/><button className="button primary" disabled={sending||(!draft.trim()&&!files.length)} type="submit" aria-label={compact?'Enviar mensagem na call':'Enviar mensagem'}>{sending?'…':'Enviar'}</button></form>
      <div className="compose-extras"><input ref={fileInput} type="file"  multiple hidden onChange={event=>{addFiles(Array.from(event.target.files||[]));event.target.value='';}}/><button type="button" className="attach-button" disabled={sending||files.length>=4} onClick={()=>fileInput.current?.click()} aria-label="Anexar arquivo"><ClipIcon/>Anexar arquivo</button><button type="button" className="attach-button gif-button" disabled={sending||sendingGif} onClick={()=>setGifOpen(true)} aria-label="Enviar GIF da biblioteca" aria-haspopup="dialog"><span className="gif-button-badge" aria-hidden="true">GIF</span></button><small>Até {limitMb} MB por arquivo · cole ou arraste aqui</small></div>{error&&<p className="error-message" role="alert">{error}</p>}
    </div>
    {createPortal(<div className="message-options-popover message-menu" ref={menuRef} popover="auto" role="menu" aria-label="Opções da mensagem">{menu&&<>
      <div className="message-menu-preview" aria-hidden="true"><strong style={nameStyle(menu.message.user_id)}>{displayName(menu.message.user_id,menu.message.name)}</strong><span>{gifId(menu.message.text) ? 'GIF do GIPHY' : menu.message.text || 'Arquivo ou imagem'}</span></div>
      <div className="message-menu-actions">
        <button role="menuitem" onClick={()=>{const message=menu.message;menuRef.current?.hidePopover();setReplyTo(message);textarea.current?.focus();}}>Responder</button>
        {menu.message.text&&<button role="menuitem" onClick={()=>{const text=menu.message.text;menuRef.current?.hidePopover();void navigator.clipboard?.writeText(text).catch(()=>setError('Não foi possível copiar o texto.'));}}>Copiar texto</button>}
        {menu.message.canDelete&&<button role="menuitem" className="danger" onClick={()=>{const message=menu.message;menuRef.current?.hidePopover();void removeMessage(message);}}>Excluir mensagem</button>}
      </div></>}</div>,document.body)}
    {gifOpen&&<GifPicker busy={sendingGif} onPick={gif=>void sendGif(gif)} onClose={()=>{if(!sendingGif)setGifOpen(false);}}/>}
    <dialog className="image-dialog" ref={dialog} onCancel={()=>setViewer(null)} onClose={()=>setViewer(null)} onClick={event=>{if(event.target===event.currentTarget)setViewer(null);}} aria-label="Imagem ampliada">{viewer&&<><button className="button subtle image-dialog-close" onClick={()=>setViewer(null)}>Fechar imagem</button><img src={viewer.source} alt={viewer.attachment.animated?'GIF ampliado':'Imagem ampliada'}/></>}</dialog>
  </section>;
}
