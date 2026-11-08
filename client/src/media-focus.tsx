import { useEffect, useRef, useState } from 'react';
import { ParticipantTile, useParticipants, useTracks } from '@livekit/components-react';
import { Track } from 'livekit-client';

function viewKey(reference: { participant: { identity: string }; source: Track.Source }) { return reference.participant.identity + ':' + reference.source; }
function viewLabel(reference: { participant: { name?: string }; source: Track.Source }) { return (reference.source === Track.Source.ScreenShare ? 'Tela' : 'Câmera') + ' · ' + (reference.participant.name || 'Participante'); }
export function MediaFocusStage() {
  const participants = useParticipants();
  const tracks = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }, { source: Track.Source.ScreenShare, withPlaceholder: false }]);
  const audio = useTracks([Track.Source.ScreenShareAudio], { onlySubscribed: false });
  const active = tracks.filter(reference => reference.publication && !reference.publication.isMuted && (reference.source !== Track.Source.Camera || reference.participant.isCameraEnabled));
  const [selection, setSelection] = useState('auto');
  const automatic = active.find(reference => reference.source === Track.Source.ScreenShare);
  const focused = selection === 'grid' ? undefined : selection === 'auto' ? automatic : active.find(reference => viewKey(reference) === selection) ?? automatic;
  const focusedAudio = audio.find(reference => reference.participant.identity === focused?.participant.identity);
  const screen = focused?.source === Track.Source.ScreenShare;
  const audioStatus = !focusedAudio ? 'Sem áudio compartilhado' : focusedAudio.publication.isMuted ? 'Áudio compartilhado silenciado' : 'Áudio compartilhado';
  const surface = useRef<HTMLDivElement>(null);
  const [nativeFullscreen, setNativeFullscreen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const change = () => setNativeFullscreen(document.fullscreenElement === surface.current && !!surface.current);
    document.addEventListener('fullscreenchange', change);
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setExpanded(false); };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('fullscreenchange', change); document.removeEventListener('keydown', key); };
  }, []);
  async function fullscreen() {
    if (nativeFullscreen) { await document.exitFullscreen(); return; }
    if (expanded) { setExpanded(false); return; }
    if (surface.current?.requestFullscreen) { try { await surface.current.requestFullscreen(); return; } catch { /* Use the in-page expansion if native fullscreen is unavailable. */ } }
    setExpanded(true);
  }
  function step(direction: number) {
    if (!active.length) return;
    const index = focused ? active.findIndex(reference => viewKey(reference) === viewKey(focused)) : -1;
    const next = index < 0 ? direction > 0 ? 0 : active.length - 1 : (index + direction + active.length) % active.length;
    setSelection(viewKey(active[next]));
  }
  return <section className={'stage media-focus-stage ' + (focused ? 'has-focus' : '')} aria-label="Participantes e transmissões">
    <label className="mobile-view-picker">Destaque<select value={selection === "auto" || selection === "grid" ? selection : focused ? viewKey(focused) : "auto"} onChange={event => setSelection(event.target.value)}><option value="auto">Automático</option><option value="grid">Ver em grade</option>{active.map(reference => <option key={viewKey(reference)} value={viewKey(reference)}>{viewLabel(reference)}</option>)}</select></label>
    <div className="view-selector" role="group" aria-label="Escolher câmera ou transmissão"><button className="button subtle" aria-pressed={selection === 'auto'} onClick={() => setSelection('auto')}>Automático</button><button className="button subtle" aria-pressed={selection === 'grid'} onClick={() => setSelection('grid')}>Ver em grade</button>{active.map(reference => <button className="button subtle source-choice" key={viewKey(reference)} aria-pressed={!!focused && viewKey(reference) === viewKey(focused)} onClick={() => setSelection(viewKey(reference))}>{viewLabel(reference)}</button>)}</div>
    {focused && <div className={'focus-surface ' + (expanded ? 'is-expanded' : '')} ref={surface}><div className="focus-toolbar"><div className="focus-title"><span className={screen ? 'live-label' : 'camera-label'}>{screen ? 'AO VIVO' : 'CÂMERA'}</span><strong>{focused.participant.name || 'Participante'}</strong><span className={'share-audio-status ' + (screen && !focusedAudio ? 'no-audio' : 'has-audio')} role="status">{screen ? audioStatus : !focused.publication || focused.publication.isMuted ? 'Câmera desligada' : 'Câmera ligada'}</span></div><div className="focus-actions"><button className="button subtle" onClick={() => step(-1)} disabled={active.length < 2} aria-label="Destaque anterior">←</button><button className="button subtle" onClick={() => step(1)} disabled={active.length < 2} aria-label="Próximo destaque">→</button><button className="button subtle" onClick={() => void fullscreen()} aria-label={nativeFullscreen || expanded ? 'Sair da tela cheia' : 'Expandir destaque em tela cheia'}>{nativeFullscreen || expanded ? 'Reduzir' : 'Tela cheia'}</button></div></div><div className="focused-media"><ParticipantTile trackRef={focused} data-avatar={(focused.participant.name || 'PG').slice(0,2).toLocaleUpperCase('pt-BR')} /></div></div>}
    <div className={'people-grid media-thumbnails ' + (focused ? 'compact-thumbnails' : '')}>{tracks.filter(reference => !focused || viewKey(reference) !== viewKey(focused)).map(reference => <div className="tile-card" key={viewKey(reference)}><div className="tile-label">{reference.source===Track.Source.Camera && !active.some(item=>viewKey(item)===viewKey(reference)) ? (reference.participant.name || 'Participante')+' · câmera desligada' : viewLabel(reference)}</div><ParticipantTile trackRef={reference} data-avatar={(reference.participant.name || 'PG').slice(0,2).toLocaleUpperCase('pt-BR')} />{active.some(item => viewKey(item) === viewKey(reference)) && <button className="button subtle tile-select" onClick={() => setSelection(viewKey(reference))} aria-label={'Destacar ' + (reference.source === Track.Source.ScreenShare ? 'tela' : 'câmera') + ' de ' + (reference.participant.name || 'participante')}>Destacar</button>}</div>)}</div>
    {!active.length && <p className="waiting-note">Nenhuma câmera ou transmissão ativa. Ligue a câmera ou compartilhe uma tela para destacar.</p>}{participants.length === 1 && <p className="waiting-note">Por enquanto, só você. Compartilhe o endereço com quem já tem conta.</p>}
  </section>;
}

