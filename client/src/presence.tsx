import { createContext, useContext, useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { api, jsonApi } from './api';
import { AdminPanel, PasswordPanel, useAccount } from './accounts';
import { normalizeHexColor, readableNameColor } from './chat-format';
import { convertAudio } from './audio-file';
import { bannerPalette, ProfileCard, ProfileMiniCard } from './profile-card';
import type { ProfileData } from './profile-card';
import { AppearanceSettings, prepareBanner } from './profile-appearance-editor';
import { DEFAULT_CROP, paletteToTriple, tripleToPalette, validCrop } from './profile-appearance';
import type { BannerCrop, ProfilePalette } from './profile-appearance';

const COLOR_SUGGESTIONS = ['#ff8b7f','#e6c48b','#f5d76e','#8fd694','#6ed3cf','#7fb2ff','#b79cff','#ff9ad5'];

type OnlineUser = ProfileData;

export type NowPlaying = {title:string;artist:string;cover?:string};
type PresenceState = { music:Record<string,NowPlaying>; people:OnlineUser[]; profiles:OnlineUser[]; voiceChannels:Record<string,string[]> | null; refresh:()=>Promise<void>; showProfile:(id:string)=>void; nameColors:boolean; statuses:boolean; appearance:boolean };
const PresenceContext = createContext<PresenceState | null>(null);
// eslint-disable-next-line react-refresh/only-export-components
export function usePresence() {
  const value = useContext(PresenceContext);
  if (!value) throw Error('Presença não carregada');
  return value;
}
// No próprio perfil, a descrição pode ser escrita ali mesmo.
function OwnDescription({profile,onSaved}:{profile:OnlineUser;onSaved:()=>Promise<void>}) {
  const [text,setText] = useState(profile.description);
  const [saving,setSaving] = useState(false);
  const [message,setMessage] = useState('');
  async function save(event:FormEvent) {
    event.preventDefault(); setSaving(true); setMessage('');
    try { await jsonApi('/api/profile','PATCH',{description:text,avatarId:profile.avatarUrl?.split('/').pop() ?? null}); await onSaved(); setMessage('Descrição salva.'); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Não foi possível salvar.'); }
    finally { setSaving(false); }
  }
  return <form className="own-description" onSubmit={save}><label>Sua descrição<textarea maxLength={200} value={text} onChange={event => setText(event.target.value)} placeholder="Conta um pouco sobre você" disabled={saving}/></label><div className="own-description-actions"><small>{text.length}/200</small><button className="button primary" disabled={saving || text === profile.description}>{saving ? 'Salvando…' : 'Salvar descrição'}</button></div>{message && <p role="status">{message}</p>}</form>;
}
export function PresenceProvider({children}:{children:ReactNode}) {
  const {user} = useAccount();
  const [people,setPeople] = useState<OnlineUser[]>([]);
  const [profiles,setProfiles] = useState<OnlineUser[]>([]);
  const [nameColors,setNameColors] = useState(false);
  const [statuses,setStatuses] = useState(false);
  const [appearance,setAppearance] = useState(false);
  const [voiceChannels,setVoiceChannels] = useState<Record<string,string[]> | null>(null);
  const [music,setMusic] = useState<Record<string,NowPlaying>>({});
  const [selected,setSelected] = useState<string | null>(null);
  async function refresh() {
    const data = await jsonApi('/api/presence');
    setPeople(data.users); setProfiles(data.profiles ?? data.users); setNameColors(data.nameColors === true); setStatuses(data.statuses === true); setAppearance(data.appearance === true);
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
      // O que toca em cada call, para quem está fora dela também ver.
      try { const data = await jsonApi('/api/music-status'); if (active) setMusic(data.rooms && typeof data.rooms === 'object' ? data.rooms : {}); }
      catch { if (active) setMusic({}); }
    }
    void updateVoice();
    const timer = setInterval(() => void updateVoice(), 5000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  const profile=profiles.find(person=>person.id===selected);
  return <PresenceContext.Provider value={{music,people,profiles,voiceChannels,refresh,showProfile:setSelected,nameColors,statuses,appearance}}>{children}{profile && <dialog className="admin-dialog profile-dialog" ref={element=>{if(element&&!element.open)element.showModal();}} onCancel={()=>setSelected(null)} onClose={()=>setSelected(null)} aria-labelledby="profile-dialog-name"><ProfileCard profile={profile} headingId="profile-dialog-name" actions={<button className="button subtle profile-close" onClick={()=>setSelected(null)} aria-label="Fechar perfil">×</button>}>{profile.id === user.id ? <OwnDescription key={profile.description} profile={profile} onSaved={refresh} /> : undefined}</ProfileCard></dialog>}</PresenceContext.Provider>;
}
function Avatar({person,className='member-avatar'}:{person:{name:string;avatarUrl:string|null};className?:string}) {
  return person.avatarUrl ? <img className={className} src={person.avatarUrl} alt=""/> : <span className={className}>{person.name.slice(0,2).toLocaleUpperCase('pt-BR')}</span>;
}
function GearIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/></svg>;
}
function EntrySoundSettings() {
  const {user}=useAccount();
  const [configured,setConfigured]=useState(false),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
  const [file,setFile]=useState<File|null>(null),[message,setMessage]=useState(''),[revision,setRevision]=useState(0);
  useEffect(()=>{let active=true;jsonApi('/api/voice-entry').then(data=>{if(active)setConfigured(data.configured===true);}).catch(()=>{if(active)setMessage('Não foi possível carregar seu som de entrada.');}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[]);
  async function save(event:FormEvent) {
    event.preventDefault();if(!file||busy)return;setBusy(true);setMessage('');
    try {
      const wav=await convertAudio(file);
      const response=await api('/api/voice-entry',{method:'PUT',headers:{'Content-Type':'application/octet-stream'},body:wav});
      if(!response.ok){const data=await response.json().catch(()=>({}));throw Error(data.error||'Não foi possível salvar o som.');}
      setConfigured(true);setFile(null);setRevision(Date.now());setMessage('Som de entrada salvo.');
    }catch(cause){setMessage(cause instanceof Error?cause.message:'Não foi possível ler o áudio.');}finally{setBusy(false);}
  }
  async function remove() {
    setBusy(true);setMessage('');try{await jsonApi('/api/voice-entry','DELETE');setConfigured(false);setMessage('Som removido. O som padrão será usado.');}catch{setMessage('Não foi possível remover o som.');}finally{setBusy(false);}
  }
  return <section className="profile-account entry-sound-settings" aria-labelledby="entry-sound-title"><h3 id="entry-sound-title">Som de entrada na call</h3><p>As pessoas na call ouvirão seu som quando você entrar. Até 10 segundos e 8 MB.</p>{loading?<p role="status">Carregando…</p>:<><form onSubmit={save}><label>Escolher áudio<input key={revision} type="file" accept="audio/*" onChange={event=>setFile(event.target.files?.[0]||null)} disabled={busy}/></label><button className="button subtle" disabled={busy||!file}>{busy?'Salvando…':'Salvar som de entrada'}</button></form>{configured&&<div className="entry-sound-preview"><audio controls preload="none" src={'/api/voice-entry/'+user.id+'?v='+revision} aria-label="Ouvir seu som de entrada"/><button type="button" className="button subtle" disabled={busy} onClick={()=>void remove()}>Usar som padrão</button></div>}</>}{message&&<p role="status">{message}</p>}</section>;
}
// Um único painel reúne foto, apelido, descrição e as opções da conta.
export function ProfileEditor({status,variant='card'}:{status?:string;variant?:'card'|'avatar'}) {
  const {user,renameSelf,authMode,logout} = useAccount();
  const {profiles,refresh,nameColors,statuses,appearance} = usePresence();
  const [statusText,setStatusText] = useState('');
  const [editing,setEditing] = useState(false);
  const [color,setColor] = useState('');
  const [panel,setPanel] = useState<'password'|'admin'|null>(null);
  const [name,setName] = useState('');
  const [description,setDescription] = useState('');
  const [file,setFile] = useState<File|null>(null);
  const [preview,setPreview] = useState<string|null>(null);
  const [removeAvatar,setRemoveAvatar] = useState(false);
  const [error,setError] = useState('');
  const [message,setMessage] = useState('');
  const [saving,setSaving] = useState(false);
  // Banner e cores do perfil.
  const [bannerFile,setBannerFile] = useState<File|null>(null);
  const [bannerPreview,setBannerPreview] = useState<string|null>(null);
  const [removeBanner,setRemoveBanner] = useState(false);
  const [crop,setCrop] = useState<BannerCrop>(DEFAULT_CROP);
  const [mode,setMode] = useState<'auto'|'custom'>('auto');
  const [custom,setCustom] = useState<ProfilePalette|null>(null);
  const [newPalette,setNewPalette] = useState<{url:string;palette?:ProfilePalette|null}|null>(null);
  const own = profiles.find(person => person.id === user.id);
  const me = {name:user.name,avatarUrl:own?.avatarUrl ?? null};
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  useEffect(() => () => { if (bannerPreview) URL.revokeObjectURL(bannerPreview); }, [bannerPreview]);
  function resetAppearance() { setBannerFile(null); setBannerPreview(null); setRemoveBanner(false); setCrop(validCrop(own?.bannerCrop)); setMode(own?.appearanceMode==='custom' ? 'custom' : 'auto'); setCustom(tripleToPalette(own?.customColors)); setNewPalette(null); }
  function chooseBanner(next:File|null) {
    setError('');
    if (next && !/^image\/(png|jpeg|webp|gif)$/.test(next.type)) { setError('Escolha um banner em PNG, JPG, WebP ou GIF.'); return; }
    if (next && next.size > (next.type==='image/gif' ? 8 : 25)*1024*1024) { setError(next.type==='image/gif' ? 'O banner em GIF deve ter até 8 MB.' : 'Escolha uma imagem de até 25 MB.'); return; }
    const url = next ? URL.createObjectURL(next) : null;
    setBannerFile(next); setBannerPreview(url); setRemoveBanner(false); setCrop(next ? DEFAULT_CROP : validCrop(own?.bannerCrop));
    setNewPalette(url ? {url} : null);
    if (url) bannerPalette(url).then(palette => setNewPalette(current => current?.url===url ? {url,palette} : current)).catch(() => setNewPalette(current => current?.url===url ? {url,palette:null} : current));
  }
  function open() { setName(user.name); setDescription(own?.description || ''); setColor(own?.nameColor || ''); setStatusText(own?.status || ''); setFile(null); setPreview(null); setRemoveAvatar(false); resetAppearance(); setError(''); setMessage(''); setEditing(true); }
  function closeEditor() { setEditing(false); setFile(null); setPreview(null); setBannerFile(null); setBannerPreview(null); setRemoveAvatar(false); setError(''); setMessage(''); }
  function choose(next:File|null) {
    setError('');
    if (next && next.size > 8*1024*1024) { setError('A imagem deve ter até 8 MB.'); return; }
    setFile(next); setRemoveAvatar(false); setPreview(next ? URL.createObjectURL(next) : null);
  }
  async function save(event:FormEvent) {
    event.preventDefault();
    if (colorProblem) { setError(colorProblem); return; }
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
      // O banner é reduzido no navegador; a paleta automática é salva junto para não recalcular a cada visita.
      let bannerId = removeBanner ? null : own?.bannerUrl?.split('/').pop() ?? null;
      let autoPalette = bannerId ? own?.autoPalette ?? null : null;
      if (appearance && bannerFile) {
        const blob = await prepareBanner(bannerFile);
        if (blob.size > 8*1024*1024) throw Error('O banner deve ter até 8 MB.');
        bannerId = crypto.randomUUID();
        const result = await api('/api/uploads',{method:'POST',headers:{'Content-Type':'application/octet-stream','x-upload-id':bannerId},body:blob});
        if (!result.ok) { const data=await result.json().catch(()=>({})); throw Error(data.error || 'Não foi possível enviar o banner.'); }
        const palette = newPalette?.palette !== undefined ? newPalette.palette : bannerPreview ? await bannerPalette(bannerPreview).catch(() => null) : null;
        autoPalette = palette ? paletteToTriple(palette) : null;
      } else if (appearance && bannerId && !autoPalette && own?.bannerUrl) autoPalette = await bannerPalette(own.bannerUrl).then(paletteToTriple).catch(() => null);
      await jsonApi('/api/profile','PATCH',{description,avatarId,...(nameColors?{nameColor:chosenColor}:{}),...(statuses?{status:statusText}:{}),...(appearance?{bannerId,bannerCrop:crop,appearanceMode:mode,customColors:custom?paletteToTriple(custom):null,autoPalette}:{})});
      await refresh(); setFile(null); setPreview(null); setRemoveAvatar(false); setBannerFile(null); setBannerPreview(null); setRemoveBanner(false); setNewPalette(null); setMessage('Perfil salvo.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível salvar.'); }
    finally { setSaving(false); }
  }
  const chosenColor = color.trim() ? normalizeHexColor(color) : null;
  const colorProblem = color.trim() && !chosenColor ? 'Digite a cor no formato #RRGGBB, por exemplo #FF8800.' : chosenColor && !readableNameColor(chosenColor) ? 'Essa cor é escura demais para ler no fundo do chat. Escolha uma mais clara.' : '';
  const shown = {name:name.trim() || user.name, avatarUrl:removeAvatar ? null : preview || me.avatarUrl};
  const shownBanner = removeBanner ? null : bannerPreview || own?.bannerUrl || null;
  const previewProfile:ProfileData = {...(own ?? {id:user.id,description:''}), name:shown.name, avatarUrl:shown.avatarUrl, nameColor:chosenColor && !colorProblem ? chosenColor : null, status:statusText.trim(), description, bannerUrl:shownBanner, bannerCrop:crop, appearanceMode:mode, customColors:custom ? paletteToTriple(custom) : null, autoPalette:bannerFile || removeBanner ? null : own?.autoPalette ?? null};
  const savedCrop = validCrop(own?.bannerCrop), savedCustom = own?.customColors?.join() ?? '';
  const appearanceChanged = Boolean(bannerFile) || removeBanner || crop.x!==savedCrop.x || crop.y!==savedCrop.y || crop.zoom!==savedCrop.zoom || mode!==(own?.appearanceMode==='custom' ? 'custom' : 'auto') || (custom ? paletteToTriple(custom).join() : '')!==savedCustom;
  const autoStatus = !shownBanner ? 'none' : bannerFile ? newPalette?.palette===undefined ? 'loading' : newPalette.palette ? 'ready' : 'failed' : 'ready';
  const trigger = variant==='avatar'
    ? <button className="header-avatar-button" disabled={!own} onClick={open} aria-label="Meu perfil e conta" title="Meu perfil e conta"><Avatar person={me}/></button>
    : <button className="identity-card profile-edit-trigger" disabled={!own} onClick={open} aria-label="Meu perfil e conta"><Avatar person={me}/><span><strong style={own?.nameColor ? {color:own.nameColor} : undefined}>{user.name}</strong><small className={own?.status ? 'custom-status' : undefined}>{own?.status || (statuses && status === 'Online' ? 'Definir um status' : status)}</small></span><span className="profile-edit-hint" title="Meu perfil e conta"><GearIcon/></span></button>;
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
        {appearance && <AppearanceSettings preview={previewProfile} hasBanner={Boolean(shownBanner)} newBanner={Boolean(bannerFile)} removing={removeBanner} canRemove={Boolean(own?.bannerUrl)} disabled={saving} onPickBanner={chooseBanner} onToggleRemove={() => setRemoveBanner(!removeBanner)} crop={crop} setCrop={setCrop} mode={mode} setMode={setMode} custom={custom} setCustom={setCustom} autoStatus={autoStatus} onCancel={resetAppearance} changed={appearanceChanged}/>}
        {statuses && <><label>Status<input value={statusText} onChange={event => setStatusText(event.target.value)} maxLength={60} placeholder="Ex.: jogando Valorant 🎮" enterKeyHint="done" disabled={saving}/></label>
        <small className="field-help">Aparece embaixo do seu nome para todo mundo. {statusText.length}/60</small></>}
        <label>Apelido<input value={name} onChange={event => setName(event.target.value)} minLength={2} maxLength={32} required autoComplete="nickname" disabled={saving}/></label>
        <small className="field-help">{authMode==='supabase' ? 'É como você aparece no chat. Seu e-mail de acesso continua o mesmo.' : 'É como você aparece no chat e também o usuário para entrar. A senha continua a mesma.'}</small>
        {nameColors && <fieldset className="name-color-field">
          <legend>Cor do nick</legend>
          <div className="name-color-inputs">
            <input type="color" aria-label="Escolher cor do nick" value={chosenColor || '#eee8dc'} onChange={event => setColor(event.target.value)} disabled={saving}/>
            <input aria-label="Código da cor em hexadecimal" value={color} onChange={event => setColor(event.target.value)} placeholder="#FF8800" maxLength={7} spellCheck={false} autoCapitalize="off" autoComplete="off" disabled={saving} aria-invalid={Boolean(colorProblem)} aria-describedby="name-color-help"/>
            <button type="button" className="button subtle" onClick={() => setColor('')} disabled={saving || !color}>Sem cor</button>
          </div>
          <div className="name-color-swatches" role="group" aria-label="Sugestões de cor">{COLOR_SUGGESTIONS.map(value => <button type="button" key={value} style={{background:value}} aria-label={'Usar a cor '+value} aria-pressed={chosenColor===value} onClick={() => setColor(value)} disabled={saving}/>)}</div>
          <div className="name-color-preview" aria-hidden="true"><Avatar person={shown}/><span><strong style={chosenColor && !colorProblem ? {color:chosenColor} : undefined}>{shown.name}</strong><small>Assim seu nick aparece no chat</small></span></div>
          <small id="name-color-help" className={colorProblem ? 'field-help field-error' : 'field-help'}>{colorProblem || 'Toque no quadrado colorido ou digite o código, como #FF8800.'}</small>
        </fieldset>}
        <label>Descrição<textarea maxLength={200} value={description} onChange={event => setDescription(event.target.value)} placeholder="Conta um pouco sobre você" disabled={saving}/></label>
        <small className="field-help">{description.length}/200</small>
        <button className="button primary" disabled={saving}>{saving?'Salvando…':'Salvar perfil'}</button>
        {message && <p className="profile-saved" role="status">{message}</p>}
        {error && <p className="error-message" role="alert">{error}</p>}
      </form>
      <EntrySoundSettings />
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
  return <section className="online-members" aria-labelledby="online-members-title"><h2 className="sidebar-section-label" id="online-members-title">ONLINE <span>{people.length}</span></h2>{people.length ? <ul>{people.map(person => { const calls=voice.filter(channel=>voiceChannels?.[channel.id]?.includes(person.id)).map(channel=>channel.name); return <li key={person.id}><ProfileMiniCard profile={person} calls={calls} onOpen={()=>showProfile(person.id)}/></li>; })}</ul> : <p className="sidebar-empty">Ninguém online agora.</p>}</section>;
}
