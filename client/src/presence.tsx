import { createContext, useContext, useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { api, jsonApi } from './api';
import { AdminPanel, PasswordPanel, useAccount } from './accounts';

type OnlineUser = {id:string;name:string;description:string;avatarUrl:string|null};

type PresenceState = { people:OnlineUser[]; profiles:OnlineUser[]; voiceChannels:Record<string,string[]> | null; refresh:()=>Promise<void>; showProfile:(id:string)=>void };
const PresenceContext = createContext<PresenceState | null>(null);
// eslint-disable-next-line react-refresh/only-export-components
export function usePresence() {
  const value = useContext(PresenceContext);
  if (!value) throw Error('Presença não carregada');
  return value;
}
export function PresenceProvider({children}:{children:ReactNode}) {
  const [people,setPeople] = useState<OnlineUser[]>([]);
  const [profiles,setProfiles] = useState<OnlineUser[]>([]);
  const [voiceChannels,setVoiceChannels] = useState<Record<string,string[]> | null>(null);
  const [selected,setSelected] = useState<string | null>(null);
  async function refresh() {
    const data = await jsonApi('/api/presence');
    setPeople(data.users); setProfiles(data.profiles ?? data.users);
  }
  useEffect(() => {
    const initial = setTimeout(() => void refresh().catch(() => {}), 0);
    const timer = setInterval(() => void refresh().catch(() => {}), 15000);
    return () => { clearTimeout(initial); clearInterval(timer); };
  }, []);
  useEffect(() => {
    let active = true;
    async function updateVoice() {
      try { const data = await jsonApi('/api/voice-presence'); if (active) setVoiceChannels(data.channels); }
      catch { if (active) setVoiceChannels(null); }
    }
    void updateVoice();
    const timer = setInterval(() => void updateVoice(), 5000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  const profile=profiles.find(person=>person.id===selected);
  return <PresenceContext.Provider value={{people,profiles,voiceChannels,refresh,showProfile:setSelected}}>{children}{profile && <dialog className="admin-dialog profile-dialog" ref={element=>{if(element&&!element.open)element.showModal();}} onCancel={()=>setSelected(null)} onClose={()=>setSelected(null)} aria-label={'Perfil de '+profile.name}><header><h2>{profile.name}</h2><button className="button subtle" onClick={()=>setSelected(null)}>Fechar</button></header>{profile.avatarUrl ? <img src={profile.avatarUrl} alt={'Foto de '+profile.name} className="profile-large-avatar"/> : <span className="member-avatar profile-large-avatar">{profile.name.slice(0,2).toLocaleUpperCase('pt-BR')}</span>}<p>{profile.description || 'Sem descrição ainda.'}</p></dialog>}</PresenceContext.Provider>;
}
function Avatar({person,className='member-avatar'}:{person:{name:string;avatarUrl:string|null};className?:string}) {
  return person.avatarUrl ? <img className={className} src={person.avatarUrl} alt=""/> : <span className={className}>{person.name.slice(0,2).toLocaleUpperCase('pt-BR')}</span>;
}
function GearIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/></svg>;
}
// Um único painel reúne foto, apelido, descrição e as opções da conta.
export function ProfileEditor({status,variant='card'}:{status?:string;variant?:'card'|'avatar'}) {
  const {user,renameSelf,authMode,logout} = useAccount();
  const {profiles,refresh} = usePresence();
  const [editing,setEditing] = useState(false);
  const [panel,setPanel] = useState<'password'|'admin'|null>(null);
  const [name,setName] = useState('');
  const [description,setDescription] = useState('');
  const [file,setFile] = useState<File|null>(null);
  const [preview,setPreview] = useState<string|null>(null);
  const [removeAvatar,setRemoveAvatar] = useState(false);
  const [error,setError] = useState('');
  const [message,setMessage] = useState('');
  const [saving,setSaving] = useState(false);
  const own = profiles.find(person => person.id === user.id);
  const me = {name:user.name,avatarUrl:own?.avatarUrl ?? null};
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  function open() { setName(user.name); setDescription(own?.description || ''); setFile(null); setPreview(null); setRemoveAvatar(false); setError(''); setMessage(''); setEditing(true); }
  function closeEditor() { setEditing(false); setFile(null); setPreview(null); setRemoveAvatar(false); setError(''); setMessage(''); }
  function choose(next:File|null) {
    setError('');
    if (next && next.size > 8*1024*1024) { setError('A imagem deve ter até 8 MB.'); return; }
    setFile(next); setRemoveAvatar(false); setPreview(next ? URL.createObjectURL(next) : null);
  }
  async function save(event:FormEvent) {
    event.preventDefault();
    setSaving(true); setError(''); setMessage('');
    try {
      const nextName = name.trim();
      if (nextName !== user.name) await renameSelf(nextName);
      let avatarId = removeAvatar ? null : own?.avatarUrl?.split('/').pop() ?? null;
      if (file) {
        avatarId = crypto.randomUUID();
        const result = await api('/api/uploads',{method:'POST',headers:{'Content-Type':'application/octet-stream','x-upload-id':avatarId},body:file});
        if (!result.ok) { const data=await result.json().catch(()=>({})); throw Error(data.error || 'Não foi possível enviar a imagem.'); }
      }
      await jsonApi('/api/profile','PATCH',{description,avatarId});
      await refresh(); setFile(null); setPreview(null); setRemoveAvatar(false); setMessage('Perfil salvo.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível salvar.'); }
    finally { setSaving(false); }
  }
  const shown = {name:name.trim() || user.name, avatarUrl:removeAvatar ? null : preview || me.avatarUrl};
  const trigger = variant==='avatar'
    ? <button className="header-avatar-button" disabled={!own} onClick={open} aria-label="Meu perfil e conta" title="Meu perfil e conta"><Avatar person={me}/></button>
    : <button className="identity-card profile-edit-trigger" disabled={!own} onClick={open} aria-label="Meu perfil e conta"><Avatar person={me}/><span><strong>{user.name}</strong><small>{status}</small></span><span className="profile-edit-hint" title="Meu perfil e conta"><GearIcon/></span></button>;
  return <>{trigger}
    {editing && <dialog className="admin-dialog profile-settings" ref={element => {if(element && !element.open)element.showModal();}} onCancel={closeEditor} aria-label="Meu perfil">
      <header><h2>Meu perfil</h2><button className="button subtle" onClick={closeEditor}>Fechar</button></header>
      <form onSubmit={save}>
        <div className="profile-preview">
          <Avatar person={shown} className="member-avatar profile-preview-avatar"/>
          <div className="profile-photo-actions">
            <label className="button subtle profile-photo-pick">Trocar foto ou GIF<input className="sr-only" type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={event => {choose(event.target.files?.[0] || null); event.target.value='';}} disabled={saving}/></label>
            {(own?.avatarUrl || file) && <button type="button" className="button subtle" disabled={saving} onClick={() => { if (file) choose(null); else setRemoveAvatar(!removeAvatar); }}>{file ? 'Descartar nova foto' : removeAvatar ? 'Manter foto atual' : 'Remover foto'}</button>}
            <small>PNG, JPG, WebP ou GIF, até 8 MB.</small>
          </div>
        </div>
        <label>Apelido<input value={name} onChange={event => setName(event.target.value)} minLength={2} maxLength={32} required autoComplete="nickname" disabled={saving}/></label>
        <small className="field-help">{authMode==='supabase' ? 'É como você aparece no chat. Seu e-mail de acesso continua o mesmo.' : 'É como você aparece no chat e também o usuário para entrar. A senha continua a mesma.'}</small>
        <label>Descrição<textarea maxLength={200} value={description} onChange={event => setDescription(event.target.value)} placeholder="Conta um pouco sobre você" disabled={saving}/></label>
        <small className="field-help">{description.length}/200</small>
        <button className="button primary" disabled={saving}>{saving?'Salvando…':'Salvar perfil'}</button>
        {message && <p className="profile-saved" role="status">{message}</p>}
        {error && <p className="error-message" role="alert">{error}</p>}
      </form>
      <section className="profile-account" aria-label="Conta">
        <h3>Conta</h3>
        <div className="profile-account-actions">
          <button type="button" className="button subtle" onClick={() => {closeEditor(); setPanel('password');}}>Alterar senha</button>
          {user.role==='admin' && <button type="button" className="button subtle" onClick={() => {closeEditor(); setPanel('admin');}}>Administrar comunidade</button>}
          <button type="button" className="button subtle danger" onClick={logout}>Sair da conta</button>
        </div>
      </section>
    </dialog>}
    {panel==='password' && <PasswordPanel onClose={() => setPanel(null)}/>}
    {panel==='admin' && <AdminPanel onClose={() => setPanel(null)}/>}
  </>;
}
export function OnlineMembers() {
  const {people,showProfile,voiceChannels} = usePresence();
  const {voice} = useAccount();
  return <section className="online-members" aria-labelledby="online-members-title"><h2 className="sidebar-section-label" id="online-members-title">ONLINE <span>{people.length}</span></h2>{people.length ? <ul>{people.map(person => { const calls=voice.filter(channel=>voiceChannels?.[channel.id]?.includes(person.id)).map(channel=>channel.name); return <li key={person.id}><button className="online-profile-button" onClick={()=>showProfile(person.id)} aria-label={'Ver perfil de '+person.name}><span className="online-avatar"><Avatar person={person}/><i aria-hidden="true"/></span><span><strong>{person.name}</strong>{calls.length > 0 ? <small className="online-voice-status">Na call · {calls.join(', ')}</small> : person.description ? <small>{person.description}</small> : null}</span></button></li>; })}</ul> : <p className="sidebar-empty">Ninguém online agora.</p>}</section>;
}
