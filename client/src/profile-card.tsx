import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, FocusEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { ensureContrast, memberSinceLabel, paletteFromBannerPixels, paletteVars, resolvePalette, validCrop } from './profile-appearance';
import type { AppearanceSource, BannerCrop, ProfilePalette } from './profile-appearance';

export type ProfileData = AppearanceSource & {
  id:string; name:string; description:string; avatarUrl:string|null; nameColor?:string|null; status?:string;
  bannerUrl?:string|null; bannerCrop?:BannerCrop; badges?:string[]; memberSince?:number|null; active?:boolean;
};

// Paleta do banner calculada uma vez por imagem (24 × 9 pixels bastam para as cores predominantes).
const palettes = new Map<string,Promise<ProfilePalette>>();
// eslint-disable-next-line react-refresh/only-export-components
export function bannerPalette(url:string) {
  let pending = palettes.get(url);
  if (!pending) {
    pending = new Promise<ProfilePalette>((resolve,reject) => {
      const image = new Image();
      image.decoding = 'async';
      image.onload = () => {
        try {
          const canvas = document.createElement('canvas'); canvas.width = 48; canvas.height = 17;
          const context = canvas.getContext('2d', {willReadFrequently:true});
          if (!context) throw Error('Canvas indisponível');
          context.drawImage(image,0,0,canvas.width,canvas.height);
          resolve(paletteFromBannerPixels(context.getImageData(0,0,canvas.width,canvas.height).data));
        } catch (error) { reject(error); }
      };
      image.onerror = () => reject(Error('Banner indisponível'));
      image.src = url;
    });
    pending.catch(() => palettes.delete(url));
    palettes.set(url,pending);
    if (palettes.size > 80) palettes.delete(palettes.keys().next().value!);
  }
  return pending;
}

// Variáveis de cor do perfil. Sem paleta salva, calcula a do banner no navegador (e guarda em cache).
// eslint-disable-next-line react-refresh/only-export-components
export function useProfileVars(profile:ProfileData) {
  const url = profile.appearanceMode!=='custom' && !profile.autoPalette && profile.bannerUrl ? profile.bannerUrl : null;
  const [computed,setComputed] = useState<Record<string,ProfilePalette>>({});
  useEffect(() => {
    if (!url || computed[url]) return;
    let alive = true;
    bannerPalette(url).then(palette => { if (alive) setComputed(previous => ({...previous,[url]:palette})); }).catch(() => {});
    return () => { alive = false; };
  }, [url, computed]);
  const auto = url ? computed[url] : null;
  const key = [profile.appearanceMode, profile.customColors?.join(), profile.autoPalette?.join(), auto?.primary, auto?.secondary, auto?.accent].join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => paletteVars(resolvePalette(profile, auto)), [key]);
}

export function BannerImage({url:source,crop,thumbnail=false}:{url?:string|null;crop?:BannerCrop;thumbnail?:boolean}) {
  const url=thumbnail && source?.startsWith('/api/media/') ? source+(source.includes('?') ? '&' : '?')+'thumb=1' : source;
  const [failed,setFailed] = useState<string|null>(null);
  const [loaded,setLoaded] = useState<string|null>(null);
  if (!url || failed===url) return null;
  const {x,y,zoom} = validCrop(crop);
  return <img className={'profile-banner-image'+(loaded===url?' loaded':'')} src={url} alt="" draggable={false} onLoad={() => setLoaded(url)} onError={() => setFailed(url)} style={{objectPosition:`${x}% ${y}%`,transform:`scale(${zoom/100})`,transformOrigin:`${x}% ${y}%`}}/>;
}

export function ProfileAvatar({person,className='member-avatar'}:{person:{name:string;avatarUrl:string|null};className?:string}) {
  const [failed,setFailed] = useState<string|null>(null);
  return person.avatarUrl && failed!==person.avatarUrl ? <img className={className} src={person.avatarUrl} alt="" onError={() => setFailed(person.avatarUrl)}/> : <span className={className}>{person.name.slice(0,2).toLocaleUpperCase('pt-BR')}</span>;
}

export function FounderBadge({compact=false}:{compact?:boolean}) {
  const star = <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m12 2 2.9 6.6 7.1.7-5.4 4.8 1.6 7L12 17.4 5.8 21.1l1.6-7L2 9.3l7.1-.7Z"/></svg>;
  return compact ? <span className="founder-badge compact" title="Membro Fundador" aria-label="Membro Fundador" role="img">{star}</span> : <span className="founder-badge">{star}Membro Fundador</span>;
}

// O nick mantém a cor escolhida, ajustada só quando ficaria ilegível no fundo do perfil.
const readableName = (color:string|null|undefined,vars:Record<string,string>) => color ? ensureContrast(color,[vars['--pf-primary']],4.5) : undefined;

type CardProps = {profile:ProfileData; actions?:ReactNode; children?:ReactNode; onBannerPan?:(crop:BannerCrop)=>void; headingId?:string};
// Perfil completo: o banner se funde ao fundo do cartão, e o avatar fica parcialmente sobre ele.
export function ProfileCard({profile,actions,children,onBannerPan,headingId}:CardProps) {
  const vars = useProfileVars(profile);
  const crop = validCrop(profile.bannerCrop);
  const [drag,setDrag] = useState<{x:number;y:number;crop:BannerCrop;width:number;height:number}|null>(null);
  const pan = onBannerPan && profile.bannerUrl ? {
    onPointerDown:(event:ReactPointerEvent<HTMLDivElement>) => { if ((event.target as HTMLElement).closest('.profile-card-actions')) return; const rect=event.currentTarget.getBoundingClientRect(); event.currentTarget.setPointerCapture(event.pointerId); setDrag({x:event.clientX,y:event.clientY,crop,width:rect.width,height:rect.height}); },
    onPointerMove:(event:ReactPointerEvent<HTMLDivElement>) => {
      if (!drag) return;
      const factor = 100/(drag.crop.zoom/100);
      const x = Math.round(Math.min(100,Math.max(0,drag.crop.x-(event.clientX-drag.x)/drag.width*factor)));
      const y = Math.round(Math.min(100,Math.max(0,drag.crop.y-(event.clientY-drag.y)/drag.height*factor)));
      if (x!==crop.x || y!==crop.y) onBannerPan({...crop,x,y});
    },
    onPointerUp:() => setDrag(null), onPointerCancel:() => setDrag(null),
  } : {};
  const since = memberSinceLabel(profile.memberSince);
  const founder = profile.badges?.includes('founder');
  return <article className="profile-card" style={vars as CSSProperties} aria-labelledby={headingId}>
    <div className={'profile-card-banner'+(profile.bannerUrl ? '' : ' empty')+(onBannerPan && profile.bannerUrl ? ' pannable' : '')} {...pan}>
      <BannerImage url={profile.bannerUrl} crop={crop}/>
      {actions && <div className="profile-card-actions">{actions}</div>}
    </div>
    <div className="profile-card-body">
      <ProfileAvatar person={profile} className="member-avatar profile-card-avatar"/>
      <h2 id={headingId} style={{color:readableName(profile.nameColor,vars)}}>{profile.name}</h2>
      {profile.status && <p className="profile-card-status">{profile.status}</p>}
      {founder && <div className="profile-card-badges"><FounderBadge/></div>}
      <div className="profile-card-section">
        {children ?? <p className={profile.description ? undefined : 'profile-card-empty'}>{profile.description || 'Sem descrição ainda.'}</p>}
        {since && <p className="profile-card-since">{since}</p>}
      </div>
    </div>
  </article>;
}

// Cartão compacto da lista de membros: miniatura do banner ao fundo e texto sobre o gradiente.
// Com `preview`, é o mesmo cartão sem ação de clique (usado no editor de perfil).
export function ProfileMiniCard({profile,calls,onOpen,preview=false,describedBy}:{profile:ProfileData;calls:string[];onOpen?:()=>void;preview?:boolean;describedBy?:string}) {
  const vars = useProfileVars(profile);
  const callColor = ensureContrast('#ff8b7f',[vars['--pf-primary']],4.5);
  const [hovered,setHovered] = useState(false);
  const [focused,setFocused] = useState(false);
  const [reducedMotion,setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const changed = () => setReducedMotion(query.matches);
    query.addEventListener('change',changed);
    return () => query.removeEventListener('change',changed);
  }, []);
  const animate = !preview && !reducedMotion && (hovered || focused);
  const Tag = preview ? 'div' : 'button';
  const behavior = preview ? {role:'group','aria-label':'Prévia do cartão de membros de '+profile.name} : {onClick:onOpen,'aria-label':'Ver perfil de '+profile.name,'aria-describedby':describedBy,
    onPointerEnter:(event:ReactPointerEvent<HTMLElement>) => { if (event.pointerType!=='touch') setHovered(true); }, onPointerLeave:() => setHovered(false),
    onFocus:(event:FocusEvent<HTMLElement>) => setFocused(event.currentTarget.matches(':focus-visible')), onBlur:() => setFocused(false)};
  return <Tag className={'online-profile-button profile-mini'+(preview ? ' is-preview' : '')+(profile.bannerUrl ? ' has-banner' : '')} style={vars as CSSProperties} {...behavior}>
    {profile.bannerUrl && <span className="profile-mini-banner" aria-hidden="true"><BannerImage url={profile.bannerUrl} crop={profile.bannerCrop} thumbnail/>{animate && <BannerImage url={profile.bannerUrl} crop={profile.bannerCrop}/>}</span>}
    <span className="online-avatar"><ProfileAvatar person={profile}/><i aria-hidden="true"/></span>
    <span className="profile-mini-copy">
      <strong className="profile-mini-name" style={{color:readableName(profile.nameColor,vars)}}><span>{profile.name}</span>{profile.badges?.includes('founder') && <FounderBadge compact/>}</strong>
      {calls.length > 0 && <small className="online-voice-status" style={{color:callColor}}>Na call · {calls.join(', ')}</small>}
      {profile.status ? <small className="custom-status">{profile.status}</small> : !calls.length && profile.description ? <small>{profile.description}</small> : null}
    </span>
  </Tag>;
}
