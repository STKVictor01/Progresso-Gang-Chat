import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { PreferencesContext, useCallPreferences } from './call-preferences';
import { AudioTrack, useLocalParticipant, useRoomContext, useTracks } from '@livekit/components-react';
import { LocalAudioTrack, RoomEvent, Track } from 'livekit-client';
import type { Participant } from 'livekit-client';
import { isListenerMuted, isNoiseSuppressionSupported, listenerId, listenerVolume, microphoneOptions, readNoisePreference, readVolumePreferences, toggleListenerMute } from './call-settings';
import { useAccount } from './accounts';
import type { ListenerPreferences } from './call-settings';
import { createMicrophoneProcessor } from './microphone-processor';
import type { VoiceEffect } from './voice-effects';

export function CallPreferencesProvider({ children }: { children: ReactNode }) {
  const { microphoneTrack, isMicrophoneEnabled, localParticipant } = useLocalParticipant();
  const room = useRoomContext();
  const {user} = useAccount();
  const [saved] = useState(() => readVolumePreferences(user.id));
  const [muted, setMuted] = useState<ListenerPreferences>({});
  const [volumes, setVolumes] = useState<Record<string, number>>(saved.volumes);
  const [screenVolumes, setScreenVolumes] = useState<Record<string, number>>(saved.screenVolumes);
  const [deafened, setDeafened] = useState(false);
  const [deafenBusy, setDeafenBusy] = useState(false);
  const [deafenError, setDeafenError] = useState('');
  useEffect(() => {
    const reset = () => { setDeafened(false); setDeafenError(''); };
    room.on(RoomEvent.Disconnected, reset);
    return () => { room.off(RoomEvent.Disconnected, reset); };
  }, [room]);
  useEffect(() => {
    try { localStorage.setItem('pg-call-volumes:' + user.id, JSON.stringify({volumes,screenVolumes})); } catch { /* Storage is optional. */ }
  }, [user.id,volumes,screenVolumes]);
  async function toggleDeafen() {
    if (deafenBusy) return;
    setDeafenError('');
    if (deafened) { setDeafened(false); return; }
    setDeafened(true); setDeafenBusy(true);
    try { await localParticipant.setMicrophoneEnabled(false); }
    catch { setDeafened(false); setDeafenError('Não foi possível silenciar o microfone. Tente novamente.'); }
    finally { setDeafenBusy(false); }
  }
  const [noiseSuppression, setNoiseSuppression] = useState(readNoisePreference);
  const [noiseBusy, setNoiseBusy] = useState(false);
  const [noiseActive, setNoiseActive] = useState(false);
  const [error, setError] = useState('');
  const [voiceEffect, setVoiceEffect] = useState<VoiceEffect>('natural');
  const [voiceEffectStatus, setVoiceEffectStatus] = useState('Voz natural.');
  const [voiceEffectBusy, setVoiceEffectBusy] = useState(false);
  const processingQueue = useRef<Promise<void>>(Promise.resolve());
  const noiseSupported = isNoiseSuppressionSupported();
  const track = microphoneTrack?.track;
  useEffect(() => {
    let cancelled = false;
    if (!(track instanceof LocalAudioTrack) || !isMicrophoneEnabled || track.mediaStreamTrack.readyState === 'ended') {
      const timer = setTimeout(() => {
        setNoiseBusy(false);
        setNoiseActive(false);
        setError('');
        setVoiceEffectBusy(false);
        setVoiceEffectStatus(voiceEffect === 'natural' ? 'Voz natural.' : 'O efeito será aplicado ao ligar o microfone.');
      }, 0);
      return () => { cancelled = true; clearTimeout(timer); };
    }
    const audioTrack = track;
    let processor: ReturnType<typeof createMicrophoneProcessor> | undefined;
    processingQueue.current = processingQueue.current.catch(() => {}).then(async () => {
      if (cancelled) return;
      setNoiseBusy(true);
      setNoiseActive(false);
      setError('');
      setVoiceEffectBusy(true);
      try {
        await audioTrack.applyConstraints(microphoneOptions());
        if (cancelled) return;
        if ((noiseSupported && noiseSuppression) || voiceEffect !== 'natural') {
          processor = createMicrophoneProcessor(noiseSupported && noiseSuppression, voiceEffect, () => {
            if (cancelled) return;
            setNoiseActive(false);
            setError('O filtro de áudio parou. Desligue e ligue a redução de ruído para tentar novamente.');
            setVoiceEffectStatus('O processamento de áudio parou. Selecione o efeito novamente.');
            processingQueue.current = processingQueue.current.catch(() => {}).then(async () => {
              if (audioTrack.getProcessor() === processor) await audioTrack.stopProcessor();
            }).catch(() => { /* The visible error remains until the user retries. */ });
          });
          await audioTrack.setProcessor(processor);
          if (cancelled && audioTrack.getProcessor() === processor) await audioTrack.stopProcessor();
        } else if (audioTrack.getProcessor()?.name === 'pg-microphone') {
          await audioTrack.stopProcessor();
        }
        if (!cancelled) {
          setNoiseActive(noiseSupported && noiseSuppression);
          setVoiceEffectStatus(voiceEffect === 'natural' ? 'Voz natural.' : 'Efeito ativo no seu microfone.');
        }
      } catch {
        // A failed graph must never leave the sender attached to a stopped track.
        if (audioTrack.getProcessor()?.name === 'pg-microphone') {
          await audioTrack.stopProcessor().catch(() => { /* Report the processing failure below. */ });
        }
        if (!cancelled) {
          setNoiseActive(false);
          setError('Não foi possível aplicar o filtro de áudio. Desligue e ligue a redução de ruído para tentar novamente.');
          setVoiceEffectStatus('Não foi possível aplicar o efeito. Selecione voz natural ou tente novamente.');
        }
      } finally {
        if (!cancelled) { setNoiseBusy(false); setVoiceEffectBusy(false); }
      }
    });
    return () => {
      cancelled = true;
      processingQueue.current = processingQueue.current.catch(() => {}).then(async () => {
        if (processor && audioTrack.getProcessor() === processor) await audioTrack.stopProcessor();
      }).catch(() => { /* Disconnected tracks may already be stopped. */ });
    };
  }, [track, isMicrophoneEnabled, voiceEffect, noiseSupported, noiseSuppression]);
  function toggleNoise() {
    if (!noiseSupported || noiseBusy) return;
    const next = !noiseSuppression;
    setNoiseSuppression(next); setError('');
    try { localStorage.setItem('pg-noise-suppression', String(next)); } catch { /* Storage is optional. */ }
  }
  const noiseStatus = !noiseSupported ? 'Redução de ruído indisponível neste navegador. Use um navegador atualizado com acesso seguro ao chat.' : error || (noiseBusy ? 'Ajustando redução de ruído…' : !noiseSuppression ? 'Redução de ruído desligada.' : !isMicrophoneEnabled || !track || track.mediaStreamTrack.readyState === 'ended' ? 'A redução de ruído será aplicada ao ligar o microfone.' : noiseActive ? 'Redução de ruído ativa no seu microfone.' : 'Aguardando redução de ruído.');
  return <PreferencesContext.Provider value={{ deafened, deafenBusy, deafenError, toggleDeafen, muted, volumes, screenVolumes, setScreenVolume: (identity, volume) => setScreenVolumes(previous => ({...previous, [listenerId(identity)]: volume})), setVolume: (identity, volume) => setVolumes(previous => ({...previous, [listenerId(identity)]: volume})), toggleMute: (identity, source) => setMuted(previous => toggleListenerMute(previous, listenerId(identity), source)), noiseSuppression, noiseActive, noiseSupported, noiseBusy, noiseStatus, toggleNoise, voiceEffect, setVoiceEffect, voiceEffectStatus, voiceEffectBusy }}>{children}</PreferencesContext.Provider>;
}
export function PersonalAudioRenderer() {
  const { muted, volumes, screenVolumes, deafened } = useCallPreferences();
  const audio = useTracks([Track.Source.Microphone, Track.Source.ScreenShareAudio, Track.Source.Unknown], { onlySubscribed: false }).filter(ref => !ref.participant.isLocal && ref.publication.kind === Track.Kind.Audio);
  return <div hidden aria-hidden="true">{audio.map(ref => {
    const source = ref.source === Track.Source.ScreenShareAudio ? 'screen' : 'microphone';
    const id = listenerId(ref.participant.identity);
    const silenced = deafened || isListenerMuted(muted, id, source);
    return <AudioTrack key={ref.publication.trackSid} trackRef={ref} volume={deafened ? 0 : listenerVolume(muted, volumes, id, source, screenVolumes)} muted={silenced} data-audio-owner={ref.participant.name || ref.participant.identity} data-audio-kind={source} data-locally-muted={silenced} />;
  })}</div>;
}
export function QuickParticipantMute({ participant }: { participant: Participant }) {
  const { muted, toggleMute } = useCallPreferences();
  if (participant.isLocal) return null;
  const silenced = isListenerMuted(muted, listenerId(participant.identity), 'microphone');
  const label = participant.name || 'participante';
  return <button className={'quick-mute ' + (silenced ? 'is-muted' : '')} aria-pressed={silenced} aria-label={(silenced ? 'Ouvir voz de ' : 'Silenciar voz de ') + label + ' só para mim'} title={silenced ? 'Ouvir este amigo' : 'Silenciar este amigo só para você'} onClick={() => toggleMute(participant.identity, 'microphone')}><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m11 5-5 4H3v6h3l5 4V5Z" />{silenced ? <path d="m16 9 6 6m-6 0 6-6" /> : <path d="M16 8a6 6 0 0 1 0 8" />}</svg></button>;
}
export function ParticipantAudioControls({ participant }: { participant: Participant }) {
  const { muted, toggleMute, volumes, setVolume, screenVolumes, setScreenVolume } = useCallPreferences();
  const name = participant.name || 'Participante';
  const id = listenerId(participant.identity);
  const volume = Math.round((volumes[id] ?? 1) * 100);
  return <div className="participant-audio-controls">
    <label>Volume da voz de {name} <output>{volume}%</output>
      <input type="range" min="0" max="100" value={volume} onChange={event => setVolume(participant.identity, Number(event.target.value) / 100)} />
    </label>
    <label>Volume da transmissão de {name} <output>{Math.round((screenVolumes[id] ?? 1) * 100)}%</output>
      <input type="range" min="0" max="100" value={Math.round((screenVolumes[id] ?? 1) * 100)} onChange={event => setScreenVolume(participant.identity, Number(event.target.value) / 100)} />
    </label>
    {(['microphone', 'screen'] as const).map(source => {
      const silenced = isListenerMuted(muted, id, source);
      const label = source === 'microphone' ? 'voz' : 'transmissão';
      return <button key={source} className={'button subtle ' + (silenced ? 'is-muted' : '')} aria-pressed={silenced} onClick={() => toggleMute(participant.identity, source)}>{silenced ? 'Reativar' : 'Silenciar'} {label}</button>;
    })}
    <small>Esses ajustes afetam apenas o que você ouve.</small>
  </div>;
}
export function NoiseSuppressionControl() {
  const preferences = useCallPreferences();
  const label = preferences.noiseSupported ? (preferences.noiseSuppression ? 'Desligar redução de ruídos' : 'Ligar redução de ruídos') : 'Redução de ruídos indisponível';
  return <div className="noise-control"><button className="button noise-toggle" aria-label={label} title={label + ' — ' + preferences.noiseStatus} aria-pressed={preferences.noiseSupported && preferences.noiseSuppression} data-active={preferences.noiseActive} disabled={!preferences.noiseSupported || preferences.noiseBusy} onClick={preferences.toggleNoise} aria-describedby="noise-status"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M3 10v4M7 7v10M11 4v16M15 8v8M19 10v4M22 11v2"/>{!preferences.noiseSuppression && <path d="M3 3l18 18"/>}</svg></button><span id="noise-status" className="sr-only" role="status">{preferences.noiseStatus}</span></div>;
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
