import { useState } from 'react';
import { BITRATES, DEFAULT_SHARE_QUALITY, FRAMERATES, PRIORITIES, RESOLUTIONS, formatMbps, saveShareQuality, shareBitrate } from './screen-share-quality';
import type { ShareQuality } from './screen-share-quality';

// Botão ao lado de "Compartilhar tela" que abre as escolhas de qualidade da transmissão.
// A seta vem da classe lk-button-menu, igual à do seletor de câmera.
export function ScreenShareQualityControl({quality,onChange,sharing}:{quality:ShareQuality;onChange:(quality:ShareQuality)=>void;sharing:boolean}) {
  const [open,setOpen] = useState(false);
  const [changedWhileSharing,setChangedWhileSharing] = useState(false);
  function update(next:Partial<ShareQuality>) {
    const value = {...quality,...next};
    onChange(value); saveShareQuality(value);
    if (sharing) setChangedWhileSharing(true);
  }
  function close() { setOpen(false); setChangedWhileSharing(false); }
  return <>
    <button type="button" className="lk-button lk-button-menu share-quality-trigger" title="Qualidade da transmissão" aria-label="Qualidade da transmissão" aria-haspopup="dialog" onClick={() => setOpen(true)}/>
    {open && <dialog className="admin-dialog share-quality-dialog" ref={element => {if(element && !element.open)element.showModal();}} onCancel={close} onClose={close} aria-labelledby="share-quality-title">
      <header><h2 id="share-quality-title">Qualidade da transmissão</h2><button type="button" className="button subtle" onClick={close}>Fechar</button></header>
      <p>Vale para quando você compartilhar a tela. Quem assiste com internet mais fraca recebe automaticamente uma versão menor, nos mesmos quadros por segundo.</p>
      <div className="share-quality-fields">
        <label>Resolução<select value={quality.resolution} onChange={event => update({resolution:event.target.value as ShareQuality['resolution']})}>{RESOLUTIONS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label>Quadros por segundo<select value={quality.framerate} onChange={event => update({framerate:Number(event.target.value) as ShareQuality['framerate']})}>{FRAMERATES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label>Qualidade de envio<select value={quality.bitrate} onChange={event => update({bitrate:event.target.value as ShareQuality['bitrate']})}>{BITRATES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <fieldset className="share-quality-priority"><legend>Se a internet apertar, priorizar</legend>
          {PRIORITIES.map(item => <label key={item.id} className="share-quality-choice"><input type="radio" name="share-priority" checked={quality.priority===item.id} onChange={() => update({priority:item.id})}/><span><strong>{item.label}</strong><small>{item.description}</small></span></label>)}
        </fieldset>
      </div>
      <p className="share-quality-summary" aria-live="polite">Envio de até <strong>{formatMbps(shareBitrate(quality))}</strong> a {quality.framerate} quadros por segundo.{quality.resolution==='2160' || quality.bitrate==='alta' ? ' Use só com internet de envio rápida.' : ''}</p>
      {changedWhileSharing && <p className="share-quality-note" role="status">Você já está transmitindo. Pare e compartilhe a tela de novo para aplicar a nova qualidade.</p>}
      <div className="share-quality-actions"><button type="button" className="button subtle" onClick={() => update(DEFAULT_SHARE_QUALITY)}>Restaurar recomendado</button></div>
    </dialog>}
  </>;
}
