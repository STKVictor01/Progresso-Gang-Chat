import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { PreferencesContext, useCallPreferences } from './call-preferences';
import { AudioTrack, useLocalParticipant, useTracks } from '@livekit/components-react';
import { LocalAudioTrack, Track } from 'livekit-client';
import type { Participant } from 'livekit-client';
import { applyNoiseSuppression, isListenerMuted, listenerVolume, readNoisePreference, toggleListenerMute } from './call-settings';
import type { ListenerPreferences } from './call-settings';
import { createVoiceProcessor } from './voice-effects';
import type { VoiceEffect } from './voice-effects';

export function CallPreferencesProvider({ children }: { children: ReactNode }) {
  const { microphoneTrack, isMicrophoneEnabled } = useLocalParticipant();
  const [muted, setMuted] = useState<ListenerPreferences>({});
  const [volumes, setVolumes] = useState<Record<string, number>>({});
  const [screenVolumes, setScreenVolumes] = useState<Record<string, number>>({});
  const [noiseSuppression, setNoiseSuppression] = useState(readNoisePreference);
  const [noiseBusy, setNoiseBusy] = useState(false);
  const [applied, setApplied] = useState<boolean | undefined>();
  const [error, setError] = useState('');
  const [voiceEffect, setVoiceEffect] = useState<VoiceEffect>('natural');
  const [voiceEffectStatus, setVoiceEffectStatus] = useState('Voz natural.');
  const [voiceEffectBusy, setVoiceEffectBusy] = useState(false);
  const voiceEffectQueue = useRef<Promise<void>>(Promise.resolve());
  const noiseSupported = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getSupportedConstraints().noiseSuppression;
  const track = microphoneTrack?.track;
  useEffect(() => {
    let cancelled = false;
    if (!(track instanceof LocalAudioTrack) || !isMicrophoneEnabled || track.mediaStreamTrack.readyState === 'ended') {
      const timer = setTimeout(() => {
        setVoiceEffectBusy(false);
        setVoiceEffectStatus(voiceEffect === 'natural' ? 'Voz natural.' : 'O efeito será aplicado ao ligar o microfone.');
      }, 0);
      return () => { cancelled = true; clearTimeout(timer); };
    }
    const audioTrack = track;
    voiceEffectQueue.current = voiceEffectQueue.current.catch(() => {}).then(async () => {
      if (cancelled) return;
      setVoiceEffectBusy(true);
      try {
        if (voiceEffect === 'natural') {
          if (audioTrack.getProcessor()?.name === 'pg-voice-effect') await audioTrack.stopProcessor();
        } else {
          const processor = createVoiceProcessor(voiceEffect);
          await audioTrack.setProcessor(processor);
          if (cancelled && audioTrack.getProcessor() === processor) await audioTrack.stopProcessor();
        }
        if (!cancelled) setVoiceEffectStatus(voiceEffect === 'natural' ? 'Voz natural.' : 'Efeito ativo no seu microfone.');
      } catch {
        if (!cancelled) setVoiceEffectStatus('Não foi possível aplicar o efeito. Selecione voz natural ou tente novamente.');
      } finally {
        if (!cancelled) setVoiceEffectBusy(false);
      }
    });
    return () => { cancelled = true; };
  }, [track, isMicrophoneEnabled, voiceEffect]);
  useEffect(() => {
    if (!(track instanceof LocalAudioTrack) || track.mediaStreamTrack.readyState === 'ended') return;
    let cancelled = false;
    void applyNoiseSuppression(track, noiseSupported && noiseSuppression)
      .then(actual => { if (!cancelled) { setApplied(actual); setError(''); } })
      .catch(() => { if (!cancelled) setError('Não foi possível aplicar o filtro. Tente desligar e ligar a opção novamente.'); })
      .finally(() => { setNoiseBusy(false); });
    return () => { cancelled = true; };
  }, [track, isMicrophoneEnabled, noiseSupported, noiseSuppression]);
  function toggleNoise() {
    if (!noiseSupported || noiseBusy) return;
    const next = !noiseSuppression;
    setNoiseSuppression(next); setError(''); setNoiseBusy(track instanceof LocalAudioTrack && track.mediaStreamTrack.readyState !== 'ended');
    try { localStorage.setItem('pg-noise-suppression', String(next)); } catch { /* Storage is optional. */ }
  }
  const noiseStatus = !noiseSupported ? 'Este navegador não oferece esse filtro.' : error || (noiseBusy ? 'Ajustando filtro…' : !track || track.mediaStreamTrack.readyState === 'ended' ? 'A opção será aplicada ao ligar o microfone.' : !noiseSuppression ? 'Supressão de ruído desligada.' : applied === true ? 'Redução de ruído ativa no microfone.' : applied === false ? 'O navegador não ativou a redução de ruído.' : 'Redução de ruído solicitada ao navegador.');
  return <PreferencesContext.Provider value={{ muted, volumes, screenVolumes, setScreenVolume: (identity, volume) => setScreenVolumes(previous => ({...previous, [identity]: volume})), setVolume: (identity, volume) => setVolumes(previous => ({...previous, [identity]: volume})), toggleMute: (identity, source) => setMuted(previous => toggleListenerMute(previous, identity, source)), noiseSuppression, noiseSupported, noiseBusy, noiseStatus, toggleNoise, voiceEffect, setVoiceEffect, voiceEffectStatus, voiceEffectBusy }}>{children}</PreferencesContext.Provider>;
}
export function PersonalAudioRenderer() {
  const { muted, volumes, screenVolumes } = useCallPreferences();
  const audio = useTracks([Track.Source.Microphone, Track.Source.ScreenShareAudio, Track.Source.Unknown], { onlySubscribed: false }).filter(ref => !ref.participant.isLocal && ref.publication.kind === Track.Kind.Audio);
  return <div hidden aria-hidden="true">{audio.map(ref => {
    const source = ref.source === Track.Source.ScreenShareAudio ? 'screen' : 'microphone';
    const silenced = isListenerMuted(muted, ref.participant.identity, source);
    return <AudioTrack key={ref.publication.trackSid} trackRef={ref} volume={listenerVolume(muted, volumes, ref.participant.identity, source, screenVolumes)} muted={silenced} data-audio-owner={ref.participant.name || ref.participant.identity} data-audio-kind={source} data-locally-muted={silenced} />;
  })}</div>;
}
export function QuickParticipantMute({ participant }: { participant: Participant }) {
  const { muted, toggleMute } = useCallPreferences();
  if (participant.isLocal) return null;
  const silenced = isListenerMuted(muted, participant.identity, 'microphone');
  const label = participant.name || 'participante';
  return <button className={'quick-mute ' + (silenced ? 'is-muted' : '')} aria-pressed={silenced} aria-label={(silenced ? 'Ouvir voz de ' : 'Silenciar voz de ') + label + ' só para mim'} title={silenced ? 'Ouvir este amigo' : 'Silenciar este amigo só para você'} onClick={() => toggleMute(participant.identity, 'microphone')}><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m11 5-5 4H3v6h3l5 4V5Z" />{silenced ? <path d="m16 9 6 6m-6 0 6-6" /> : <path d="M16 8a6 6 0 0 1 0 8" />}</svg></button>;
}
export function ParticipantAudioControls({ participant }: { participant: Participant }) {
  const { muted, toggleMute, volumes, setVolume, screenVolumes, setScreenVolume } = useCallPreferences();
  const name = participant.name || 'Participante';
  const volume = Math.round((volumes[participant.identity] ?? 1) * 100);
  return <div className="participant-audio-controls">
    <label>Volume da voz de {name} <output>{volume}%</output>
      <input type="range" min="0" max="100" value={volume} onChange={event => setVolume(participant.identity, Number(event.target.value) / 100)} />
    </label>
    <label>Volume da transmissão de {name} <output>{Math.round((screenVolumes[participant.identity] ?? 1) * 100)}%</output>
      <input type="range" min="0" max="100" value={Math.round((screenVolumes[participant.identity] ?? 1) * 100)} onChange={event => setScreenVolume(participant.identity, Number(event.target.value) / 100)} />
    </label>
    {(['microphone', 'screen'] as const).map(source => {
      const silenced = isListenerMuted(muted, participant.identity, source);
      const label = source === 'microphone' ? 'voz' : 'transmissão';
      return <button key={source} className={'button subtle ' + (silenced ? 'is-muted' : '')} aria-pressed={silenced} onClick={() => toggleMute(participant.identity, source)}>{silenced ? 'Reativar' : 'Silenciar'} {label}</button>;
    })}
    <small>Esses ajustes afetam apenas o que você ouve.</small>
  </div>;
}
export function NoiseSuppressionControl() {
  const preferences = useCallPreferences();
  const label = preferences.noiseSupported ? (preferences.noiseSuppression ? 'Desligar redução de ruídos' : 'Ligar redução de ruídos') : 'Redução de ruídos indisponível';
  return <div className="noise-control"><button className="button noise-toggle" aria-label={label} title={label + ' — ' + preferences.noiseStatus} aria-pressed={preferences.noiseSupported && preferences.noiseSuppression} disabled={!preferences.noiseSupported || preferences.noiseBusy} onClick={preferences.toggleNoise} aria-describedby="noise-status"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M3 10v4M7 7v10M11 4v16M15 8v8M19 10v4M22 11v2"/>{!preferences.noiseSuppression && <path d="M3 3l18 18"/>}</svg></button><span id="noise-status" className="sr-only" role="status">{preferences.noiseStatus}</span></div>;
}

export function VoiceEffectControl() {
  const preferences = useCallPreferences();
  const [open,setOpen] = useState(false);
  const choices: {id:VoiceEffect;name:string;description:string}[] = [
    {id:'natural',name:'Natural',description:'Sua voz sem efeito'},
    {id:'robo',name:'Robô',description:'Voz eletrônica'},
    {id:'radio',name:'Rádio',description:'Som de comunicação pelo rádio'},
    {id:'bebe',name:'Bebê',description:'Voz bem mais aguda'},
    {id:'anime',name:'Anime',description:'Voz aguda de desenho'},
  ];
  return <><button className="button voice-effect-trigger" title="Efeitos de voz" aria-label="Abrir efeitos de voz" onClick={()=>setOpen(true)}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v4M9 22h6M19 2l1 2 2 1-2 1-1 2-1-2-2-1 2-1z"/></svg></button>{open && <dialog className="admin-dialog voice-effects-dialog" ref={element=>{if(element&&!element.open)element.showModal();}} onCancel={()=>setOpen(false)} onClose={()=>setOpen(false)} aria-label="Efeitos de voz"><header><h2>Efeitos de voz</h2><button className="button subtle" onClick={()=>setOpen(false)}>Fechar</button></header><p>Escolha como sua voz será ouvida na chamada.</p><fieldset disabled={preferences.voiceEffectBusy}><legend>Seu microfone</legend><div className="voice-effects-grid">{choices.map(choice=><label key={choice.id} className="voice-effect-choice"><input type="radio" name="voice-effect" checked={preferences.voiceEffect===choice.id} onChange={()=>preferences.setVoiceEffect(choice.id)}/><span><strong>{choice.name}</strong><small>{choice.description}</small></span></label>)}</div></fieldset><p role="status">{preferences.voiceEffectBusy ? 'Aplicando efeito…' : preferences.voiceEffectStatus}</p></dialog>}</>;
}
