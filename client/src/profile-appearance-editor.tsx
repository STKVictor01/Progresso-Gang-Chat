import { useState } from 'react';
import { ProfileCard } from './profile-card';
import type { ProfileData } from './profile-card';
import { contrast, DEFAULT_PROFILE_PALETTE, isHex, paletteVars, PROFILE_COLOR_SUGGESTIONS } from './profile-appearance';
import type { BannerCrop, ProfilePalette } from './profile-appearance';

// Reduz o banner antes do envio (até 1360 px de largura, o dobro da referência de 680 × 240).
// GIFs seguem como estão para manter a animação.
// eslint-disable-next-line react-refresh/only-export-components
export async function prepareBanner(file:File):Promise<Blob> {
  if (file.type==='image/gif') return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1,1360/bitmap.width,1360/bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1,Math.round(bitmap.width*scale)); canvas.height = Math.max(1,Math.round(bitmap.height*scale));
    canvas.getContext('2d')?.drawImage(bitmap,0,0,canvas.width,canvas.height); bitmap.close();
    const blob = await new Promise<Blob|null>(resolve => canvas.toBlob(resolve,'image/webp',0.86));
    return blob && blob.size < file.size ? blob : file;
  } catch { return file; }
}

function ColorField({label,value,onChange,disabled}:{label:string;value:string;onChange:(color:string)=>void;disabled:boolean}) {
  const [draft,setDraft] = useState(value);
  const [shown,setShown] = useState(value);
  if (shown!==value) { setShown(value); setDraft(value); }
  const invalid = draft!==value && !isHex(draft.trim());
  return <div className="profile-color-field">
    <span>{label}</span>
    <input type="color" aria-label={'Escolher '+label.toLocaleLowerCase('pt-BR')} value={value} onChange={event => onChange(event.target.value)} disabled={disabled}/>
    <input aria-label={'Código da '+label.toLocaleLowerCase('pt-BR')} value={draft} maxLength={7} spellCheck={false} autoCapitalize="off" autoComplete="off" disabled={disabled} aria-invalid={invalid}
      onChange={event => { const next=event.target.value; setDraft(next); const hex=(next.startsWith('#')?next:'#'+next).trim(); if (isHex(hex)) onChange(hex.toLowerCase()); }}/>
  </div>;
}

type Props = {
  preview:ProfileData; hasBanner:boolean; newBanner:boolean; removing:boolean; canRemove:boolean; disabled:boolean;
  onPickBanner:(file:File|null)=>void; onToggleRemove:()=>void;
  crop:BannerCrop; setCrop:(crop:BannerCrop)=>void;
  mode:'auto'|'custom'; setMode:(mode:'auto'|'custom')=>void;
  custom:ProfilePalette|null; setCustom:(palette:ProfilePalette|null)=>void;
  autoStatus:'none'|'loading'|'ready'|'failed'; onCancel:()=>void; changed:boolean;
};
export function AppearanceSettings(props:Props) {
  const {preview,hasBanner,crop,setCrop,mode,setMode,custom,setCustom,disabled} = props;
  const slider = (key:keyof BannerCrop,label:string,min:number,max:number) => <label className="profile-crop-slider">{label}<input type="range" min={min} max={max} value={crop[key]} onChange={event => setCrop({...crop,[key]:Number(event.target.value)})} disabled={disabled || !hasBanner}/></label>;
  return <section className="profile-appearance" aria-labelledby="profile-appearance-title">
    <h3 id="profile-appearance-title">Banner e aparência do perfil</h3>
    <div className="profile-appearance-preview">
      <ProfileCard profile={preview} onBannerPan={disabled ? undefined : setCrop}/>
      <small>Prévia de como as outras pessoas veem seu perfil.{hasBanner ? ' Arraste o banner para posicionar.' : ''}</small>
    </div>
    <div className="profile-banner-actions">
      <label className="button subtle profile-photo-pick">{hasBanner ? 'Trocar banner' : 'Escolher banner'}<input className="sr-only" type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={event => { const file=event.target.files?.[0]; if (file) props.onPickBanner(file); event.target.value=''; }} disabled={disabled}/></label>
      {props.newBanner && <button type="button" className="button subtle" onClick={() => props.onPickBanner(null)} disabled={disabled}>Descartar novo banner</button>}
      {!props.newBanner && props.canRemove && <button type="button" className="button subtle" onClick={props.onToggleRemove} disabled={disabled}>{props.removing ? 'Manter banner' : 'Remover banner'}</button>}
    </div>
    <small className="field-help">Referência de 680 × 240 px. PNG, JPG, WebP ou GIF, até 8 MB.</small>
    {hasBanner && <div className="profile-crop" role="group" aria-label="Posição do banner">
      {slider('x','Horizontal',0,100)}{slider('y','Vertical',0,100)}{slider('zoom','Zoom',100,300)}
    </div>}
    <AppearanceColors mode={mode} setMode={setMode} custom={custom} setCustom={setCustom} hasBanner={hasBanner} autoStatus={props.autoStatus} disabled={disabled}/>
    {props.changed && <button type="button" className="button subtle" onClick={props.onCancel} disabled={disabled}>Cancelar alterações de aparência</button>}
  </section>;
}

type ColorProps = {mode:'auto'|'custom'; setMode:(mode:'auto'|'custom')=>void; custom:ProfilePalette|null; setCustom:(palette:ProfilePalette|null)=>void; hasBanner:boolean; autoStatus:'none'|'loading'|'ready'|'failed'; disabled:boolean};
// Modo automático (cores do banner) ou personalizado (três cores escolhidas).
export function AppearanceColors({mode,setMode,custom,setCustom,hasBanner,autoStatus,disabled}:ColorProps) {
  const colors = custom ?? DEFAULT_PROFILE_PALETTE;
  const vars = paletteVars(colors);
  const adjusted = mode==='custom' && (vars['--pf-primary']!==colors.primary || vars['--pf-secondary']!==colors.secondary || vars['--pf-accent']!==colors.accent || contrast(colors.accent,colors.primary)<3);
  const props = {autoStatus};
  return <>
      <fieldset className="profile-color-mode">
        <legend>Aparência do perfil</legend>
        <label className="profile-mode-option"><input type="radio" name="profile-color-mode" checked={mode==='auto'} onChange={() => setMode('auto')} disabled={disabled}/><span><strong>Automático</strong><small>Cores tiradas do banner</small></span></label>
        <label className="profile-mode-option"><input type="radio" name="profile-color-mode" checked={mode==='custom'} onChange={() => setMode('custom')} disabled={disabled}/><span><strong>Personalizado</strong><small>Você escolhe as cores</small></span></label>
      </fieldset>
      {mode==='auto' ? <p className="field-help" role="status">{!hasBanner ? 'Sem banner, o perfil usa as cores padrão do Progresso Gang.' : props.autoStatus==='loading' ? 'Lendo as cores do banner…' : props.autoStatus==='failed' ? 'Não foi possível ler as cores do banner. O perfil usa as cores padrão.' : 'As cores acompanham o banner e mudam quando você trocar a imagem.'}{custom ? ' Suas cores personalizadas continuam guardadas.' : ''}</p>
      : <div className="profile-custom-colors">
        <ColorField label="Cor principal" value={colors.primary} onChange={primary => setCustom({...colors,primary})} disabled={disabled}/>
        <ColorField label="Cor secundária" value={colors.secondary} onChange={secondary => setCustom({...colors,secondary})} disabled={disabled}/>
        <ColorField label="Cor de destaque" value={colors.accent} onChange={accent => setCustom({...colors,accent})} disabled={disabled}/>
        <div className="profile-palette-swatches" role="group" aria-label="Combinações sugeridas">{PROFILE_COLOR_SUGGESTIONS.map((palette,index) => <button type="button" key={index} aria-label={'Usar combinação sugerida '+(index+1)} aria-pressed={!!custom && custom.primary===palette.primary && custom.secondary===palette.secondary && custom.accent===palette.accent} onClick={() => setCustom(palette)} disabled={disabled}><i style={{background:palette.primary}}/><i style={{background:palette.secondary}}/><i style={{background:palette.accent}}/></button>)}</div>
        {adjusted && <p className="field-help" role="status">Ajustamos o texto e os detalhes para manter a leitura com essas cores.</p>}
        <button type="button" className="button subtle" onClick={() => setCustom(null)} disabled={disabled || !custom}>Restaurar cores padrão</button>
      </div>}
  </>;
}

// Controles do banner no editor do computador: imagem, posição e zoom. A prévia só fica arrastável neste modo.
export function BannerControls({crop,setCrop,hasBanner,disabled,onPickBanner,onDone}:{crop:BannerCrop;setCrop:(crop:BannerCrop)=>void;hasBanner:boolean;disabled:boolean;onPickBanner:()=>void;onDone:()=>void}) {
  const slider = (key:keyof BannerCrop,label:string,min:number,max:number,unit:string) => <label className="profile-crop-slider"><span>{label}<output>{crop[key]}{unit}</output></span><input type="range" min={min} max={max} value={crop[key]} onChange={event => setCrop({...crop,[key]:Number(event.target.value)})} disabled={disabled || !hasBanner}/></label>;
  return <section className="banner-controls" aria-labelledby="banner-controls-title">
    <div className="banner-controls-heading"><h3 id="banner-controls-title">Editar banner</h3><button type="button" className="button subtle" onClick={onDone}>Concluir</button></div>
    <button type="button" className="button subtle" onClick={onPickBanner} disabled={disabled}>{hasBanner ? 'Trocar imagem do banner' : 'Escolher imagem do banner'}</button>
    <small className="field-help">Referência de 680 × 240 px. PNG, JPG ou WebP até 25 MB (reduzidos antes do envio) e GIF até 8 MB.</small>
    {hasBanner ? <><div className="profile-crop" role="group" aria-label="Posição do banner">{slider('x','Horizontal',0,100,'%')}{slider('y','Vertical',0,100,'%')}{slider('zoom','Zoom',100,300,'%')}</div><small className="field-help">Você também pode arrastar o banner na prévia.</small></> : <p className="field-help">Sem banner, o topo do perfil usa as cores do perfil.</p>}
  </section>;
}
