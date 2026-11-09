import { api } from './api';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ClipboardEvent, FormEvent } from 'react';
import { usePresence } from './presence';

type Attachment = { id: string; url: string; posterUrl?: string; mime: string; width: number; height: number; size: number; animated: boolean };
type TextMessage = { id: number; name: string; text: string; timestamp: number; channel: string; user_id: string | null; canDelete: boolean; attachments?: Attachment[] };
type PendingFile = { id: string; file: File; preview: string };
const LIMIT = 8 * 1024 * 1024;
const ACCEPT = ['image/png','image/jpeg','image/gif','image/webp'];
function ClipIcon() { return <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="m8 13 7-7a3 3 0 0 1 4 4L9 20a5 5 0 0 1-7-7L13 2" /><path d="m6 15 9-9" /></svg>; }
function MessageAvatar({message}:{message:TextMessage}) {
  const {profiles,showProfile}=usePresence();
  const profile=profiles.find(person=>person.id===message.user_id);
  const [failedUrl,setFailedUrl]=useState<string | null>(null);
  const initials=message.name.slice(0,2).toLocaleUpperCase('pt-BR');
  if (!profile) return <span className="member-avatar" aria-hidden="true">{initials}</span>;
  return <button className="member-avatar message-avatar" onClick={()=>showProfile(profile.id)} aria-label={'Ver perfil de '+message.name} title={'Ver perfil de '+message.name}>{profile.avatarUrl && failedUrl!==profile.avatarUrl ? <img src={profile.avatarUrl} alt="" onError={()=>setFailedUrl(profile.avatarUrl)} /> : initials}</button>;
}
function MessageOptions({message, onDelete}:{message:TextMessage; onDelete:()=>void}) {
  const menu=useRef<HTMLDivElement>(null);
  function toggle(event:React.MouseEvent<HTMLButtonElement>) {
    const panel=menu.current;
    if(!panel)return;
    if(panel.matches(':popover-open')) {panel.hidePopover();return;}
    const rect=event.currentTarget.getBoundingClientRect();
    panel.style.left=Math.max(8,Math.min(rect.right-180,window.innerWidth-188))+'px';
    panel.style.top=Math.max(8,Math.min(rect.bottom+4,window.innerHeight-60))+'px';
    panel.showPopover();
  }
  return <><button className="message-options-trigger" onClick={toggle} aria-label={'Mais opções para mensagem de '+message.name} title="Mais opções" aria-haspopup="dialog"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg></button>{createPortal(<div className="message-options-popover" ref={menu} popover="auto" role="dialog" aria-label="Opções da mensagem"><button onClick={()=>{menu.current?.hidePopover();onDelete();}}>Excluir mensagem</button></div>,document.body)}</>;
}
function ImageAttachment({ attachment, author, reducedMotion, onOpen }: { attachment: Attachment; author: string; reducedMotion: boolean; onOpen: (source: string, attachment: Attachment) => void }) {
  const [playing, setPlaying] = useState<boolean | null>(null);
  const animate = playing ?? !reducedMotion;
  const source = attachment.animated && !animate ? attachment.posterUrl || attachment.url : attachment.url;
  return <figure className="message-attachment"><button className="attachment-open" onClick={() => onOpen(source, attachment)} aria-label={'Ampliar '+(attachment.animated?'GIF':'imagem')+' de '+author}><img src={source} alt={(attachment.animated?'GIF enviado por ':'Imagem enviada por ')+author} width={attachment.width} height={attachment.height} loading="lazy" decoding="async" />{attachment.animated && <span className="gif-badge">GIF</span>}</button>{attachment.animated && <button className="gif-play-toggle" aria-pressed={animate} onClick={() => setPlaying(!animate)}>{animate?'Pausar GIF':'Reproduzir GIF'}</button>}</figure>;
}
async function requestError(response: Response, fallback: string) {
  try { const body = await response.json(); return typeof body.error === 'string' ? body.error : fallback; } catch { return fallback; }
}
export function ChannelChat({ name, channel, title, compact = false, visible = true, onClose }: { name: string; channel: string; title: string; compact?: boolean; visible?: boolean; onClose?: () => void }) {
  const inputId = useId();
  const [messages, setMessages] = useState<TextMessage[]>([]);
  const [draft, setDraft] = useState(() => { try { return sessionStorage.getItem('pg-draft-'+channel) || ''; } catch { return ''; } });
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('Carregando conversa…');
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [viewer, setViewer] = useState<{source: string; attachment: Attachment} | null>(null);
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const cursor = useRef(0);
  const hydrated = useRef(false);
  const pending = useRef<{signature: string; id: string} | null>(null);
  const uploaded = useRef(new Map<string, Attachment>());
  const fileInput = useRef<HTMLInputElement>(null);
  const fileCache = useRef<PendingFile[]>([]);
  const sendController = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { try { sessionStorage.setItem('pg-draft-'+channel, draft); } catch { /* Draft storage is optional. */ } }, [draft, channel]);
  useEffect(() => { fileCache.current = files; }, [files]);
  useEffect(() => () => { sendController.current?.abort(); fileCache.current.forEach(item => URL.revokeObjectURL(item.preview)); }, []);
  useEffect(() => { const query = window.matchMedia('(prefers-reduced-motion: reduce)'); const changed = () => setReducedMotion(query.matches); query.addEventListener('change',changed); return () => query.removeEventListener('change',changed); }, []);
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
        if(data.messages.length || data.deletedIds?.length) setMessages(previous => [...new Map([...previous.filter(message=>!data.deletedIds?.includes(message.id)),...data.messages].map(message => [message.id,message])).values()].sort((a,b)=>a.id-b.id));
        setStatus('Histórico salvo');
      } catch { if (!controller.signal.aborted) setStatus('Sem conexão. Tentando reconectar…'); }
      finally { if (!controller.signal.aborted) timer=setTimeout(refresh,2000); }
    }
    void refresh(); return () => {controller.abort();clearTimeout(timer);};
  }, [channel]);
  useEffect(() => { if (visible && atBottom.current) bottom.current?.scrollIntoView({block:'nearest'}); }, [messages.length,visible]);
  function addFiles(incoming: File[]) {
    if (sending) return;
    const accepted: PendingFile[] = []; const errors: string[] = [];
    for (const file of incoming) {
      if (!ACCEPT.includes(file.type) && !/\.(png|jpe?g|webp|gif)$/i.test(file.name)) { errors.push('Use imagens PNG, JPG, WebP ou GIF.'); continue; }
      if (file.size>LIMIT) {errors.push('Cada arquivo pode ter até 8 MB.');continue;}
      if (files.length+accepted.length>=4) {errors.push('Envie até quatro anexos por mensagem.');break;}
      accepted.push({id:crypto.randomUUID(),file,preview:URL.createObjectURL(file)});
    }
    setError([...new Set(errors)].join(' ')); setFiles(previous=>[...previous,...accepted]);
  }
  function pasted(event: ClipboardEvent<HTMLTextAreaElement>) { const images=Array.from(event.clipboardData.files).filter(file=>file.type.startsWith('image/')); if(images.length){event.preventDefault();addFiles(images);} }
  function removeFile(id:string) { const item=files.find(file=>file.id===id);if(item)URL.revokeObjectURL(item.preview);uploaded.current.delete(id);setFiles(previous=>previous.filter(file=>file.id!==id)); }
  async function send(event: FormEvent) {
    event.preventDefault();const text=draft.trim();if((!text&&!files.length)||sending)return;
    setSending(true);setError('');const controller=new AbortController();sendController.current=controller;
    const signature=JSON.stringify({channel,text,ids:files.map(item=>item.id)});
    if(pending.current?.signature!==signature)pending.current={signature,id:crypto.randomUUID()};
    try{
      const attachmentIds:string[]=[];
      for(let index=0;index<files.length;index++){
        const item=files[index];setProgress('Enviando anexo '+(index+1)+' de '+files.length+'…');
        if(!uploaded.current.has(item.id)){
          const response=await api('/api/uploads',{method:'POST',headers:{'Content-Type':'application/octet-stream','x-upload-id':item.id},body:item.file,signal:AbortSignal.any([controller.signal,AbortSignal.timeout(60000)])});
          if(!response.ok)throw Error(await requestError(response,'Não foi possível enviar o anexo.'));
          uploaded.current.set(item.id,await response.json() as Attachment);
        }
        attachmentIds.push(item.id);
      }
      setProgress('Enviando mensagem…');
      const response=await api('/api/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,channel,text,clientId:pending.current.id,attachmentIds}),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])});
      if(!response.ok)throw Error(await requestError(response,'Não foi possível enviar. Tente novamente.'));
      const sent=await response.json() as TextMessage;
      setMessages(previous=>[...new Map([...previous,sent].map(message=>[message.id,message])).values()].sort((a,b)=>a.id-b.id));
      files.forEach(item=>URL.revokeObjectURL(item.preview));setFiles([]);uploaded.current.clear();setDraft('');pending.current=null;atBottom.current=true;
    }catch(cause){if(!controller.signal.aborted)setError(cause instanceof Error && cause.name!=='TypeError' && cause.name!=='TimeoutError' ? cause.message : 'A conexão falhou. Sua mensagem continua aqui para tentar novamente.');}
    finally{setSending(false);setProgress('');sendController.current=null;}
  }
  async function older() {
    if(!messages.length||loadingOlder)return;setLoadingOlder(true);setError('');const previousHeight=scroller.current?.scrollHeight??0;
    try{const query=new URLSearchParams({channel,before:String(messages[0].id)});const response=await api('/api/messages?'+query);if(!response.ok)throw Error('Histórico indisponível');const data=await response.json() as {messages:TextMessage[];hasMore:boolean};atBottom.current=false;setMessages(previous=>[...new Map([...data.messages,...previous].map(message=>[message.id,message])).values()].sort((a,b)=>a.id-b.id));setHasMore(data.hasMore);requestAnimationFrame(()=>{if(scroller.current)scroller.current.scrollTop+=scroller.current.scrollHeight-previousHeight;});}
    catch{setError('Não foi possível carregar mensagens anteriores. Tente novamente.');}finally{setLoadingOlder(false);}
  }
  async function removeMessage(message:TextMessage) {
    if(!window.confirm('Excluir esta mensagem e seus anexos? Ela será removida para todos.'))return;
    try{const response=await api('/api/messages/'+message.id,{method:'DELETE'});if(!response.ok)throw Error(await requestError(response,'Não foi possível excluir.'));setMessages(previous=>previous.filter(item=>item.id!==message.id));}
    catch(cause){setError(cause instanceof Error?cause.message:'Não foi possível excluir.');}
  }
  return <section className={'public-chat channel-chat '+(compact?'compact-chat':'')} hidden={!visible} aria-label={compact?'Chat da call '+title:'Chat '+title}>
    {compact && <div className="text-chat-heading"><div className="call-chat-title"><h2>Chat · {title}</h2><button className="icon-button" onClick={onClose} aria-label="Fechar chat da call">×</button></div><p>Conversa deste canal, separada do #geral.</p></div>}
    <div className="public-messages" ref={scroller} onScroll={()=>{const element=scroller.current;if(element)atBottom.current=element.scrollHeight-element.scrollTop-element.clientHeight<100;}} role="log" aria-label={compact?'Mensagens da call '+title:'Mensagens do canal geral'} aria-live="polite">
      {hasMore&&<button className="button subtle load-history" disabled={loadingOlder} onClick={older}>{loadingOlder?'Carregando…':'Carregar mensagens anteriores'}</button>}
      {!messages.length&&<div className="public-chat-empty"><h2>{compact?'O papo desta call começa aqui.':'A resenha começa aqui.'}</h2><p>Mande um salve, uma imagem ou um GIF.</p></div>}
      {messages.map(message=><article key={message.id} className="public-message"><MessageAvatar message={message}/><div><header><strong>{message.name}</strong><time dateTime={new Date(message.timestamp).toISOString()}>{new Date(message.timestamp).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</time>{message.canDelete&&<MessageOptions message={message} onDelete={()=>void removeMessage(message)} />}</header>{message.text&&<p>{message.text}</p>}{!!message.attachments?.length&&<div className="message-media">{message.attachments.map(attachment=><ImageAttachment key={attachment.id} attachment={attachment} author={message.name} reducedMotion={reducedMotion} onOpen={(source,item)=>setViewer({source,attachment:item})}/>)}</div>}</div></article>)}<div ref={bottom}/>
    </div>
    <div className="public-compose"><p className="chat-sync" role="status">{sending?progress:status}</p>{files.length>0&&<div className="pending-attachments" aria-label="Anexos antes do envio">{files.map(item=><div className="pending-attachment" key={item.id}><img src={item.preview} alt={'Prévia de '+item.file.name}/><span>{item.file.name}</span><button className="icon-button" disabled={sending} aria-label={'Remover anexo '+item.file.name} onClick={()=>removeFile(item.id)}>×</button></div>)}</div>}
      <form onSubmit={send} onDragOver={event=>{if(event.dataTransfer.types.includes('Files'))event.preventDefault();}} onDrop={event=>{event.preventDefault();addFiles(Array.from(event.dataTransfer.files));}}><label className="sr-only" htmlFor={inputId}>{compact?'Mensagem para a call '+title:'Mensagem para '+title}</label><textarea id={inputId} value={draft} onChange={event=>setDraft(event.target.value)} maxLength={2000} placeholder={compact?'Mensagem nesta call…':'Manda a boa no '+title+'…'} rows={compact?2:1} disabled={sending} onPaste={pasted} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();event.currentTarget.form?.requestSubmit();}}}/><button className="button primary" disabled={sending||(!draft.trim()&&!files.length)} type="submit" aria-label={compact?'Enviar mensagem na call':'Enviar mensagem'}>{sending?'…':'Enviar'}</button></form>
      <div className="compose-extras"><input ref={fileInput} type="file" accept={ACCEPT.join(',')} multiple hidden onChange={event=>{addFiles(Array.from(event.target.files||[]));event.target.value='';}}/><button type="button" className="attach-button" disabled={sending||files.length>=4} onClick={()=>fileInput.current?.click()} aria-label={compact?'Anexar imagem ou GIF na call':'Anexar imagem ou GIF'}><ClipIcon/>Imagem / GIF</button><small>Até 8 MB por arquivo · cole ou arraste aqui</small></div>{error&&<p className="error-message" role="alert">{error}</p>}
    </div>
    <dialog className="image-dialog" ref={dialog} onCancel={()=>setViewer(null)} onClose={()=>setViewer(null)} onClick={event=>{if(event.target===event.currentTarget)setViewer(null);}} aria-label="Imagem ampliada">{viewer&&<><button className="button subtle image-dialog-close" onClick={()=>setViewer(null)}>Fechar imagem</button><img src={viewer.source} alt={viewer.attachment.animated?'GIF ampliado':'Imagem ampliada'}/></>}</dialog>
  </section>;
}
