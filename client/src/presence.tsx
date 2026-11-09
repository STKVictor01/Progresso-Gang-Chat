import { createContext, useContext, useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { api, jsonApi } from './api';
import { useAccount } from './accounts';

type OnlineUser = {id:string;name:string;description:string;avatarUrl:string|null};

type PresenceState = { people:OnlineUser[]; profiles:OnlineUser[]; refresh:()=>Promise<void>; showProfile:(id:string)=>void };
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
  const profile=profiles.find(person=>person.id===selected);
  return <PresenceContext.Provider value={{people,profiles,refresh,showProfile:setSelected}}>{children}{profile && <dialog className="admin-dialog profile-dialog" ref={element=>{if(element&&!element.open)element.showModal();}} onCancel={()=>setSelected(null)} onClose={()=>setSelected(null)} aria-label={'Perfil de '+profile.name}><header><h2>{profile.name}</h2><button className="button subtle" onClick={()=>setSelected(null)}>Fechar</button></header>{profile.avatarUrl ? <img src={profile.avatarUrl} alt={'Foto de '+profile.name} className="profile-large-avatar"/> : <span className="member-avatar profile-large-avatar">{profile.name.slice(0,2).toLocaleUpperCase('pt-BR')}</span>}<p>{profile.description || 'Sem descrição ainda.'}</p></dialog>}</PresenceContext.Provider>;
}
export function ProfileEditor({status}:{status?:string}) {
  const {user} = useAccount();
  const {profiles,refresh} = usePresence();
  const [editing,setEditing] = useState(false);
  const [description,setDescription] = useState('');
  const [file,setFile] = useState<File|null>(null);
  const [removeAvatar,setRemoveAvatar] = useState(false);
  const [error,setError] = useState('');
  const [saving,setSaving] = useState(false);
  const own = profiles.find(person => person.id === user.id);
  function closeEditor() { setEditing(false); setFile(null); setRemoveAvatar(false); setError(''); }
  async function save(event:FormEvent) {
    event.preventDefault();
    setSaving(true); setError('');
    try {
      let avatarId = removeAvatar ? null : own?.avatarUrl?.split('/').pop() ?? null;
      if (file) {
        if (file.size > 8*1024*1024) throw Error('A imagem deve ter até 8 MB.');
        avatarId = crypto.randomUUID();
        const result = await api('/api/uploads',{method:'POST',headers:{'Content-Type':'application/octet-stream','x-upload-id':avatarId},body:file});
        if (!result.ok) { const data=await result.json(); throw Error(data.error || 'Não foi possível enviar a imagem.'); }
      }
      await jsonApi('/api/profile','PATCH',{description,avatarId});
      await refresh(); setEditing(false); setFile(null); setRemoveAvatar(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível salvar.'); }
    finally { setSaving(false); }
  }
  return <><button className={status ? 'identity-card profile-edit-trigger' : 'button subtle'} disabled={!own} onClick={() => {setDescription(own?.description || '');setEditing(true);}} aria-label="Editar meu perfil">{status ? <>{own?.avatarUrl ? <img className="member-avatar" src={own.avatarUrl} alt=""/> : <span className="member-avatar">{user.name.slice(0,2).toLocaleUpperCase('pt-BR')}</span>}<span><strong>{user.name}</strong><small>{status}</small></span><span className="profile-edit-hint" aria-hidden="true">Editar</span></> : 'Editar meu perfil'}</button>{editing && <dialog className="admin-dialog" ref={element => {if(element && !element.open)element.showModal();}} onCancel={closeEditor}><header><h2>Meu perfil</h2><button className="button subtle" onClick={closeEditor}>Fechar</button></header><form onSubmit={save}><label>Descrição<textarea maxLength={200} value={description} onChange={event => setDescription(event.target.value)} /></label><label>Foto ou GIF<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={event => {setFile(event.target.files?.[0] || null);setRemoveAvatar(false);}} /></label><small>PNG, JPG, WebP ou GIF, até 8 MB.</small>{own?.avatarUrl && <label><input type="checkbox" checked={removeAvatar} onChange={event => {setRemoveAvatar(event.target.checked);if(event.target.checked)setFile(null);}}/> Remover imagem atual</label>}<button className="button primary" disabled={saving}>{saving?'Salvando…':'Salvar perfil'}</button>{error && <p className="error-message" role="alert">{error}</p>}</form></dialog>}</>;
}
export function OnlineMembers() {
  const {people,showProfile} = usePresence();
  return <section className="online-members" aria-label="Membros online"><details className="online-list"><summary>Online · {people.length}</summary><ul>{people.map(person => <li key={person.id}><button className="online-profile-button" onClick={()=>showProfile(person.id)} aria-label={'Ver perfil de '+person.name}>{person.avatarUrl ? <img className="member-avatar" src={person.avatarUrl} alt=""/> : <span className="member-avatar">{person.name.slice(0,2).toLocaleUpperCase('pt-BR')}</span>}<span><strong>{person.name}</strong>{person.description && <small>{person.description}</small>}</span></button></li>)}</ul><ProfileEditor /></details></section>;

}
