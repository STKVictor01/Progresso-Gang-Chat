import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { api, jsonApi } from './api';
import { AdminPanel, PasswordPanel, SettingsPanel, useAccount } from './accounts';
import { normalizeHexColor, readableNameColor } from './chat-format';
import { bannerPalette, ProfileAvatar, ProfileCard, ProfileMiniCard } from './profile-card';
import type { ProfileData } from './profile-card';
import { AppearanceColors, BannerControls, prepareBanner } from './profile-appearance-editor';
import { EntrySoundEditor } from './entry-sound';
import { MenuButton } from './menu';

const EDIT_PROFILE_EVENT = 'pg-edit-profile';
import { groupMembers } from './member-groups';
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
    // A cada 5 s com a aba visível; com a aba em segundo plano, a cada 20 s (atualiza na hora ao voltar).
    let timer: number | undefined;
    const schedule = () => { window.clearTimeout(timer); timer = window.setTimeout(async () => { await updateVoice(); if (active) schedule(); }, document.hidden ? 20000 : 5000); };
    const returned = () => { if (!document.hidden && active) { void updateVoice(); schedule(); } };
    void updateVoice(); schedule();
    document.addEventListener('visibilitychange', returned);
    return () => { active = false; window.clearTimeout(timer); document.removeEventListener('visibilitychange', returned); };
  }, []);
  const profile=profiles.find(person=>person.id===selected);
  // Clicar no próprio cartão abre direto o editor de perfil (o do cabeçalho, que existe no computador e no celular).
  const showProfile = (id:string|null) => { if (id && id === user.id) window.dispatchEvent(new Event(EDIT_PROFILE_EVENT)); else setSelected(id); };
  return <PresenceContext.Provider value={{music,people,profiles,voiceChannels,refresh,showProfile,nameColors,statuses,appearance}}>
    {children}
    {profile && <dialog className="admin-dialog profile-dialog" ref={element=>{if(element&&!element.open)element.showModal();}}
      onCancel={event=>{if(event.target===event.currentTarget)setSelected(null);}} onClose={event=>{if(event.target===event.currentTarget)setSelected(null);}} aria-labelledby="profile-dialog-name">
      <ProfileCard profile={profile} headingId="profile-dialog-name" actions={<>
        {profile.id===user.id && <ProfileEditor variant="button"/>}
        <button className="button subtle profile-close" onClick={()=>setSelected(null)} aria-label="Fechar perfil">×</button>
      </>}>
        {profile.id===user.id ? <OwnDescription key={profile.description} profile={profile} onSaved={refresh} /> : undefined}
      </ProfileCard>
    </dialog>}
  </PresenceContext.Provider>;
}
function Avatar({person,className='member-avatar'}:{person:{name:string;avatarUrl:string|null};className?:string}) {
  return person.avatarUrl ? <img className={className} src={person.avatarUrl} alt=""/> : <span className={className}>{person.name.slice(0,2).toLocaleUpperCase('pt-BR')}</span>;
}
function GearIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/></svg>;
}
// Referência do que está salvo, para saber se há alterações pendentes.
type Baseline = {name:string;status:string;description:string;color:string;crop:BannerCrop;mode:'auto'|'custom';custom:string};
const IMAGE_TYPES = /^image\/(png|jpeg|webp|gif)$/;
function PencilIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/></svg>;
}
// Um único painel reúne foto, apelido, descrição e aparência. No computador, a conta fica no menu do avatar.
export function ProfileEditor({status,variant='card'}:{status?:string;variant?:'card'|'avatar'|'button'}) {
  const {user,renameSelf,authMode,logout} = useAccount();
  const {profiles,refresh,showProfile,nameColors,statuses,appearance} = usePresence();
  const [statusText,setStatusText] = useState('');
  const [editing,setEditing] = useState(false);
  const [color,setColor] = useState('');
  const [panel,setPanel] = useState<'password'|'admin'|'settings'|null>(null);
  const [adminTab,setAdminTab] = useState<'site'|'inbox'>('site');
  const [unreadRequests,setUnreadRequests] = useState(0);
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
  // Editor do computador.
  const [baseline,setBaseline] = useState<Baseline|null>(null);
  const [previewMode,setPreviewMode] = useState<'card'|'member'>('card');
  const [bannerEditing,setBannerEditing] = useState(false);
  const [audioPending,setAudioPending] = useState(false);
  const [accountError,setAccountError] = useState('');
  const avatarInput = useRef<HTMLInputElement>(null), bannerInput = useRef<HTMLInputElement>(null);
  const own = profiles.find(person => person.id === user.id);
  const me = {name:user.name,avatarUrl:own?.avatarUrl ?? null};
  useEffect(()=>{
    if(variant!=='avatar'||user.role!=='admin')return;
    let active=true;
    const refreshRequests=()=>{void jsonApi('/api/admin/invite-requests/count').then(data=>{if(active)setUnreadRequests(data.unread);}).catch(()=>{});};
    refreshRequests();const timer=window.setInterval(refreshRequests,30000);window.addEventListener('pg-invite-requests-changed',refreshRequests);
    return()=>{active=false;window.clearInterval(timer);window.removeEventListener('pg-invite-requests-changed',refreshRequests);};
  },[variant,user.role]);
  const openRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (variant !== 'avatar') return;
    const edit = () => openRef.current();
    window.addEventListener(EDIT_PROFILE_EVENT, edit);
    return () => window.removeEventListener(EDIT_PROFILE_EVENT, edit);
  }, [variant]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  useEffect(() => () => { if (bannerPreview) URL.revokeObjectURL(bannerPreview); }, [bannerPreview]);
  function resetAppearance() { setBannerFile(null); setBannerPreview(null); setRemoveBanner(false); setCrop(validCrop(own?.bannerCrop)); setMode(own?.appearanceMode==='custom' ? 'custom' : 'auto'); setCustom(tripleToPalette(own?.customColors)); setNewPalette(null); }
  function chooseBanner(next:File|null) {
    setError('');
    if (next && !IMAGE_TYPES.test(next.type)) { setError('Escolha um banner em PNG, JPG, WebP ou GIF.'); return; }
    if (next && next.size > (next.type==='image/gif' ? 8 : 25)*1024*1024) { setError(next.type==='image/gif' ? 'O banner em GIF deve ter até 8 MB.' : 'Escolha uma imagem de até 25 MB.'); return; }
    const url = next ? URL.createObjectURL(next) : null;
    setBannerFile(next); setBannerPreview(url); setRemoveBanner(false); setCrop(next ? DEFAULT_CROP : validCrop(own?.bannerCrop));
    setNewPalette(url ? {url} : null);
    if (url) bannerPalette(url).then(palette => setNewPalette(current => current?.url===url ? {url,palette} : current)).catch(() => setNewPalette(current => current?.url===url ? {url,palette:null} : current));
  }
  const savedState = ():Baseline => ({name:user.name,status:own?.status || '',description:own?.description || '',color:own?.nameColor || '',crop:validCrop(own?.bannerCrop),mode:own?.appearanceMode==='custom' ? 'custom' : 'auto',custom:own?.customColors?.join() ?? ''});
  function open() { setName(user.name); setDescription(own?.description || ''); setColor(own?.nameColor || ''); setStatusText(own?.status || ''); setFile(null); setPreview(null); setRemoveAvatar(false); resetAppearance(); setError(''); setMessage(''); setBaseline(savedState()); setPreviewMode('card'); setBannerEditing(false); setAudioPending(false); setEditing(true); }
  useEffect(() => { openRef.current = () => { if (own) open(); }; });
  function closeEditor() { setEditing(false); setFile(null); setPreview(null); setBannerFile(null); setBannerPreview(null); setRemoveAvatar(false); setRemoveBanner(false); setBannerEditing(false); setError(''); setMessage(''); }
  function choose(next:File|null) {
    setError('');
    if (next && !IMAGE_TYPES.test(next.type)) { setError('Escolha uma foto em PNG, JPG, WebP ou GIF.'); return; }
    if (next && next.size > 8*1024*1024) { setError('A imagem deve ter até 8 MB.'); return; }
    setFile(next); setRemoveAvatar(false); setPreview(next ? URL.createObjectURL(next) : null);
  }
  const chosenColor = color.trim() ? normalizeHexColor(color) : null;
  const colorProblem = color.trim() && !chosenColor ? 'Digite a cor no formato #RRGGBB, por exemplo #FF8800.' : chosenColor && !readableNameColor(chosenColor) ? 'Essa cor é escura demais para ler no fundo do chat. Escolha uma mais clara.' : '';
  const trimmedName = name.trim();
  const nameProblem = trimmedName.length < 2 || trimmedName.length > 32 ? 'O apelido precisa ter de 2 a 32 caracteres.' : '';
  const invalid = Boolean(nameProblem || colorProblem || statusText.trim().length > 60 || description.length > 200);
  const sameCrop = (a:BannerCrop,b:BannerCrop) => a.x===b.x && a.y===b.y && a.zoom===b.zoom;
  const dirty = Boolean(baseline) && (trimmedName!==baseline!.name || (statuses && statusText.trim()!==baseline!.status) || description!==baseline!.description
    || (nameColors && (chosenColor ?? color.trim())!==baseline!.color) || Boolean(file) || removeAvatar
    || (appearance && (Boolean(bannerFile) || removeBanner || !sameCrop(crop,baseline!.crop) || mode!==baseline!.mode || (custom ? paletteToTriple(custom).join() : '')!==baseline!.custom)));
  async function save(event?:FormEvent) {
    event?.preventDefault();
    if (saving) return;
    if (colorProblem) { setError(colorProblem); return; }
    if (!dirty || invalid) return;
    setSaving(true); setError(''); setMessage('');
    let renamed = false;
    try {
      // O apelido usa outra rota: se ela der certo e o resto falhar, a mensagem diz exatamente isso.
      if (trimmedName !== user.name) { await renameSelf(trimmedName); renamed = true; setBaseline(current => current && {...current,name:trimmedName}); }
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
      setBaseline({name:trimmedName,status:statusText.trim(),description,color:chosenColor ?? '',crop,mode,custom:custom ? paletteToTriple(custom).join() : ''});
      setFile(null); setPreview(null); setRemoveAvatar(false); setBannerFile(null); setBannerPreview(null); setRemoveBanner(false); setNewPalette(null); setBannerEditing(false);
      setMessage('Alterações salvas.');
      try { await refresh(); } catch { setMessage('Alterações salvas. A lista de membros será atualizada em instantes.'); }
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : 'Tente novamente.';
      setError(renamed ? 'O apelido foi salvo, mas o restante não: ' + reason + ' As outras alterações continuam aqui para você tentar de novo.' : 'Nada foi salvo. ' + reason);
    }
    finally { setSaving(false); }
  }
  // Fechar, cancelar ou Escape descartam o rascunho, pedindo confirmação só quando há algo pendente.
  function requestClose() {
    if (saving) return;
    if ((dirty || audioPending) && !window.confirm('Descartar as alterações que ainda não foram salvas?')) return;
    closeEditor();
  }
  async function leave() {
    setAccountError('');
    try { await logout(); }
    catch (cause) { setAccountError('Não foi possível sair da conta. ' + (cause instanceof Error ? cause.message : 'Tente novamente.')); }
  }
  const shown = {name:name.trim() || user.name, avatarUrl:removeAvatar ? null : preview || me.avatarUrl};
  const shownBanner = removeBanner ? null : bannerPreview || own?.bannerUrl || null;
  const previewProfile:ProfileData = {...(own ?? {id:user.id,description:''}), name:shown.name, avatarUrl:shown.avatarUrl, nameColor:chosenColor && !colorProblem ? chosenColor : null, status:statusText.trim(), description, bannerUrl:shownBanner, bannerCrop:crop, appearanceMode:mode, customColors:custom ? paletteToTriple(custom) : null, autoPalette:bannerFile || removeBanner ? null : own?.autoPalette ?? null};
  const autoStatus = !shownBanner ? 'none' : bannerFile ? newPalette?.palette===undefined ? 'loading' : newPalette.palette ? 'ready' : 'failed' : 'ready';
  const accountPanels = <>
    {panel==='settings' && <SettingsPanel onClose={() => setPanel(null)} onPassword={() => setPanel('password')} onAdmin={() => setPanel('admin')}/>}
    {panel==='password' && <PasswordPanel onClose={() => setPanel(null)}/>}
    {panel==='admin' && <AdminPanel initialTab={adminTab} onClose={() => setPanel(null)}/>}
  </>;
  const trigger = variant==='avatar'
    ? <>{user.role==='admin' && <button type="button" className="admin-shortcut" aria-label="Administração da comunidade" title="Administração da comunidade" onClick={() => {setAdminTab('site');setPanel('admin');}}><GearIcon/><span>Administração</span></button>}<MenuButton label={'Menu da conta'+(unreadRequests?' · '+unreadRequests+(unreadRequests===1?' pedido novo':' pedidos novos'):'')} className="header-avatar-button account-menu-button" items={[{label:'Meu perfil',onSelect:()=>showProfile(user.id),disabled:!own},{label:'Administração da comunidade',onSelect:() => {setAdminTab('site');setPanel('admin');},hidden:user.role!=='admin'},{label:'Correios'+(unreadRequests?' · '+unreadRequests+(unreadRequests===1?' novo':' novos'):''),onSelect:() => {setAdminTab('inbox');setPanel('admin');},hidden:user.role!=='admin'},{label:'Configurações',onSelect:() => setPanel('settings')},{label:'Sair da conta',onSelect:() => void leave(),danger:true}]}><Avatar person={me}/>{unreadRequests>0&&<span className="account-unread" aria-hidden="true">{unreadRequests>99?'99+':unreadRequests}</span>}</MenuButton>

        {accountError && <div className="account-menu-error" role="alert"><span>{accountError}</span><button type="button" className="icon-button" onClick={() => setAccountError('')} aria-label="Fechar aviso">×</button></div>}</>
    : variant==='button' ? <button type="button" className="button subtle profile-card-edit" disabled={!own} onClick={open}><PencilIcon/>Editar perfil</button>
    : <button className="identity-card profile-edit-trigger" disabled={!own} onClick={()=>showProfile(user.id)} aria-label="Meu perfil"><Avatar person={me}/><span><strong style={own?.nameColor ? {color:own.nameColor} : undefined}>{user.name}</strong><small className={own?.status ? 'custom-status' : undefined}>{own?.status || (statuses && status === 'Online' ? 'Definir um status' : status)}</small></span><span className="profile-edit-hint" title="Meu perfil"><GearIcon/></span></button>;

  const hasAvatar = Boolean(shown.avatarUrl), hasBanner = Boolean(shownBanner);
  const editMenu = <MenuButton label="Editar foto e banner" className="profile-media-menu" items={[
    {label:'Trocar foto ou GIF', onSelect:() => avatarInput.current?.click(), disabled:saving},
    {label:'Remover foto', onSelect:() => { choose(null); setRemoveAvatar(Boolean(own?.avatarUrl)); }, hidden:!hasAvatar, disabled:saving},
    {label:'Editar banner', onSelect:() => { setPreviewMode('card'); setBannerEditing(true); }, hidden:!appearance, disabled:saving},
    {label:'Remover banner', onSelect:() => { chooseBanner(null); setRemoveBanner(Boolean(own?.bannerUrl)); setBannerEditing(false); }, hidden:!appearance || !hasBanner, disabled:saving},
  ]}><PencilIcon/></MenuButton>;
  return <>{trigger}
    {editing && <dialog className="admin-dialog profile-settings profile-editor" ref={element => {if(element && !element.open)element.showModal();}} onCancel={event => { event.preventDefault(); requestClose(); }} aria-labelledby="profile-editor-title">
      <header><h2 id="profile-editor-title">Meu perfil</h2><button type="button" className="button subtle profile-editor-close" onClick={requestClose} aria-label="Fechar editor de perfil">×</button></header>
      <div className="profile-editor-body">
        <div className="profile-editor-grid">
          <form id="profile-edit-form" className="profile-editor-fields" onSubmit={event => void save(event)}>
            <div className="profile-field-group">
              <div className="profile-field"><label htmlFor="profile-name">Apelido</label><input id="profile-name" value={name} onChange={event => setName(event.target.value)} minLength={2} maxLength={32} required autoComplete="nickname" disabled={saving} aria-invalid={Boolean(nameProblem)} aria-describedby="profile-name-help"/><small id="profile-name-help" className={nameProblem && name ? 'field-help field-error' : 'field-help'}>{nameProblem && name ? nameProblem : authMode==='supabase' ? 'É como você aparece no chat. Seu e-mail de acesso continua o mesmo.' : 'É como você aparece no chat e também o usuário para entrar. A senha continua a mesma.'}</small></div>
              {statuses && <div className="profile-field"><label htmlFor="profile-status">Status</label><input id="profile-status" value={statusText} onChange={event => setStatusText(event.target.value)} maxLength={60} placeholder="Ex.: jogando Valorant 🎮" enterKeyHint="done" disabled={saving} aria-describedby="profile-status-help"/><small id="profile-status-help" className="field-help">Aparece embaixo do seu nome para todo mundo. {statusText.length}/60</small></div>}
              <div className="profile-field"><label htmlFor="profile-description">Descrição</label><textarea id="profile-description" maxLength={200} value={description} onChange={event => setDescription(event.target.value)} placeholder="Conta um pouco sobre você" disabled={saving} aria-describedby="profile-description-help"/><small id="profile-description-help" className="field-help">{description.length}/200</small></div>
            </div>
            {nameColors && <fieldset className="name-color-field">
              <legend>Cor do nick</legend>
              <div className="name-color-inputs">
                <input type="color" aria-label="Escolher cor do nick" value={chosenColor || '#eee8dc'} onChange={event => setColor(event.target.value)} disabled={saving}/>
                <input aria-label="Código da cor em hexadecimal" value={color} onChange={event => setColor(event.target.value)} placeholder="#FF8800" maxLength={7} spellCheck={false} autoCapitalize="off" autoComplete="off" disabled={saving} aria-invalid={Boolean(colorProblem)} aria-describedby="name-color-help"/>
                <button type="button" className="button subtle" onClick={() => setColor('')} disabled={saving || !color}>Sem cor</button>
              </div>
              <div className="name-color-swatches" role="group" aria-label="Sugestões de cor">{COLOR_SUGGESTIONS.map(value => <button type="button" key={value} style={{background:value}} aria-label={'Usar a cor '+value} aria-pressed={chosenColor===value} onClick={() => setColor(value)} disabled={saving}/>)}</div>
              <small id="name-color-help" className={colorProblem ? 'field-help field-error' : 'field-help'}>{colorProblem || 'Toque no quadrado colorido ou digite o código, como #FF8800.'}</small>
              <button type="button" className="button subtle name-color-check" onClick={() => { setPreviewMode('member'); document.querySelector('.profile-editor-preview')?.scrollIntoView({block:'nearest',behavior:'smooth'}); }} aria-pressed={previewMode==='member'}>Ver no cartão de membros</button>
            </fieldset>}
            {appearance && <section className="profile-colors-section" aria-label="Cores do perfil"><AppearanceColors mode={mode} setMode={setMode} custom={custom} setCustom={setCustom} hasBanner={hasBanner} autoStatus={autoStatus} disabled={saving}/></section>}
          </form>
          <aside className="profile-editor-preview" aria-labelledby="profile-preview-title">
            <div className="profile-preview-head">
              <h3 id="profile-preview-title">Prévia do perfil</h3>
              <div className="preview-switch" role="group" aria-label="Tipo de prévia">
                <button type="button" aria-pressed={previewMode==='card'} onClick={() => setPreviewMode('card')}>Perfil completo</button>
                <button type="button" aria-pressed={previewMode==='member'} onClick={() => { setPreviewMode('member'); setBannerEditing(false); }}>Cartão de membros</button>
              </div>
            </div>
            {previewMode==='card'
              ? <ProfileCard profile={previewProfile} actions={editMenu} onBannerPan={bannerEditing && !saving ? setCrop : undefined}/>
              : <div className="member-card-preview"><div className="member-card-preview-stage"><ProfileMiniCard profile={previewProfile} calls={[]} preview/></div><div className="member-card-preview-edit">{editMenu}</div><small className="field-help">Mesmo cartão, largura e cores da lista de membros.</small></div>}
            {bannerEditing && previewMode==='card' && <BannerControls crop={crop} setCrop={setCrop} hasBanner={hasBanner} disabled={saving} onPickBanner={() => bannerInput.current?.click()} onDone={() => setBannerEditing(false)}/>}
            <input ref={avatarInput} className="sr-only" type="file" accept="image/png,image/jpeg,image/webp,image/gif" tabIndex={-1} aria-hidden="true" onChange={event => { const next = event.target.files?.[0]; if (next) choose(next); event.target.value=''; }}/>
            <input ref={bannerInput} className="sr-only" type="file" accept="image/png,image/jpeg,image/webp,image/gif" tabIndex={-1} aria-hidden="true" onChange={event => { const next = event.target.files?.[0]; if (next) chooseBanner(next); event.target.value=''; }}/>
          </aside>
        </div>
        <EntrySoundEditor onPendingChange={setAudioPending}/>
      </div>
      <footer className="profile-editor-footer">
        <div className="profile-editor-status" aria-live="polite">{error ? <p className="error-message" role="alert">{error}</p> : message && !dirty ? <p className="profile-saved">{message}</p> : dirty ? <p>Alterações não salvas.</p> : null}</div>
        <button type="button" className="button subtle" onClick={requestClose} disabled={saving}>Cancelar</button>
        <button type="submit" form="profile-edit-form" className="button primary" disabled={!dirty || invalid || saving}>{saving ? 'Salvando…' : 'Salvar alterações'}</button>
      </footer>
    </dialog>}
    {accountPanels}
  </>;
}
// Painel de membros: quem está em call, quem está online e quem está offline.
const OFFLINE_KEY='pg-members-offline-open';
function readOfflineOpen(){try{return localStorage.getItem(OFFLINE_KEY)!=='0';}catch{return true;}}
export function MemberGroups({activeVoice,activeCall,activeIds}:{activeVoice:string|null;activeCall:ReactNode;activeIds:string[]}) {
  const {people,profiles,showProfile,voiceChannels} = usePresence();
  const {voice} = useAccount();
  const [offlineOpen,setOfflineOpen] = useState(readOfflineOpen);
  const {otherCalls,available,offline,callTotal}=groupMembers({people,profiles,voice,voiceChannels,activeVoice,activeIds});
  function toggleOffline(open:boolean) { setOfflineOpen(open); try { localStorage.setItem(OFFLINE_KEY,open?'1':'0'); } catch { /* Preferência opcional. */ } }
  return <>
    <section className="member-group call-members" aria-labelledby="members-call-title">
      <h2 className="sidebar-section-label member-group-title" id="members-call-title">NA CALL <span>{callTotal}</span></h2>
      {activeCall}
      {otherCalls.map(group => <div className="member-call" key={group.channel.id}><h3 className="member-call-title"><span>{group.channel.name}</span><span>{group.members.length}</span></h3><ul className="member-list">{group.members.map(person => <li key={person.id}><ProfileMiniCard profile={person} calls={[group.channel.name]} onOpen={()=>showProfile(person.id)}/></li>)}</ul></div>)}
      {!callTotal && <p className="sidebar-empty">Ninguém em call agora.</p>}
    </section>
    <section className="member-group online-members" aria-labelledby="online-members-title">
      <h2 className="sidebar-section-label member-group-title" id="online-members-title">ONLINE <span>{available.length}</span></h2>
      {available.length ? <ul className="member-list">{available.map(person => <li key={person.id}><ProfileMiniCard profile={person} calls={[]} onOpen={()=>showProfile(person.id)}/></li>)}</ul> : <p className="sidebar-empty">Ninguém online agora.</p>}
    </section>
    <details className="member-group offline-members" open={offlineOpen} onToggle={event => toggleOffline(event.currentTarget.open)}>
      <summary className="sidebar-section-label member-group-title"><span>OFFLINE</span><span>{offline.length}</span></summary>
      {offline.length ? <ul className="offline-list">{offline.map(person => <li key={person.id}><button className="offline-member" onClick={()=>showProfile(person.id)} aria-label={'Ver perfil de '+person.name+', offline'}><ProfileAvatar person={person}/><span>{person.name}</span></button></li>)}</ul> : <p className="sidebar-empty">Ninguém offline.</p>}
    </details>
  </>;
}
