import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { PreferencesContext, useCallPreferences } from './call-preferences';
import { AudioTrack, useLocalParticipant, useParticipants, useTracks } from '@livekit/components-react';
import { LocalAudioTrack, Track } from 'livekit-client';
import type { Participant } from 'livekit-client';
import { applyNoiseSuppression, isListenerMuted, readNoisePreference, toggleListenerMute } from './call-settings';
import type { ListenerPreferences } from './call-settings';

export function CallPreferencesProvider({ children }: { children: ReactNode }) {
  const { microphoneTrack, isMicrophoneEnabled } = useLocalParticipant();
  const [muted, setMuted] = useState<ListenerPreferences>({});
  const [noiseSuppression, setNoiseSuppression] = useState(readNoisePreference);
  const [noiseBusy, setNoiseBusy] = useState(false);
  const [applied, setApplied] = useState<boolean | undefined>();
  const [error, setError] = useState('');
  const noiseSupported = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getSupportedConstraints().noiseSuppression;
  const track = microphoneTrack?.track;
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
  return <PreferencesContext.Provider value={{ muted, toggleMute: (identity, source) => setMuted(previous => toggleListenerMute(previous, identity, source)), noiseSuppression, noiseSupported, noiseBusy, noiseStatus, toggleNoise }}>{children}</PreferencesContext.Provider>;
}
export function PersonalAudioRenderer() {
  const { muted } = useCallPreferences();
  const audio = useTracks([Track.Source.Microphone, Track.Source.ScreenShareAudio, Track.Source.Unknown], { onlySubscribed: false }).filter(ref => !ref.participant.isLocal && ref.publication.kind === Track.Kind.Audio);
  return <div hidden aria-hidden="true">{audio.map(ref => {
    const source = ref.source === Track.Source.ScreenShareAudio ? 'screen' : 'microphone';
    const silenced = isListenerMuted(muted, ref.participant.identity, source);
    return <AudioTrack key={ref.publication.trackSid} trackRef={ref} volume={silenced ? 0 : 1} muted={silenced} data-audio-owner={ref.participant.name || ref.participant.identity} data-audio-kind={source} data-locally-muted={silenced} />;
  })}</div>;
}
export function QuickParticipantMute({ participant }: { participant: Participant }) {
  const { muted, toggleMute } = useCallPreferences();
  if (participant.isLocal) return null;
  const silenced = isListenerMuted(muted, participant.identity, 'microphone');
  const label = participant.name || 'participante';
  return <button className={'quick-mute ' + (silenced ? 'is-muted' : '')} aria-pressed={silenced} aria-label={(silenced ? 'Ouvir voz de ' : 'Silenciar voz de ') + label + ' só para mim'} title={silenced ? 'Ouvir este amigo' : 'Silenciar este amigo só para você'} onClick={() => toggleMute(participant.identity, 'microphone')}><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m11 5-5 4H3v6h3l5 4V5Z" />{silenced ? <path d="m16 9 6 6m-6 0 6-6" /> : <path d="M16 8a6 6 0 0 1 0 8" />}</svg></button>;
}
export function ParticipantAudioPanel() {
  const participants = useParticipants().filter(participant => !participant.isLocal);
  const { muted, toggleMute } = useCallPreferences();
  return <details className="participant-audio-panel"><summary>Áudio dos amigos <span>· só para você</span></summary><div className="participant-audio-body"><p>Os controles abaixo mudam apenas o que você ouve.</p>{participants.length === 0 && <p>Nenhum amigo conectado neste canal ainda.</p>}{participants.map(participant => <div className="participant-audio-row" key={participant.identity}><strong>{participant.name || 'Participante'}</strong><div>{(['microphone', 'screen'] as const).map(source => {
    const silenced = isListenerMuted(muted, participant.identity, source);
    const label = source === 'microphone' ? 'Voz' : 'Transmissão';
    return <button key={source} className={'button subtle ' + (silenced ? 'is-muted' : '')} aria-pressed={silenced} aria-label={(silenced ? 'Ouvir ' : 'Silenciar ') + label.toLocaleLowerCase('pt-BR') + ' de ' + (participant.name || 'participante') + ' só para mim'} onClick={() => toggleMute(participant.identity, source)}>{label}: {silenced ? 'silenciada' : 'ouvindo'}</button>;
  })}</div></div>)}</div></details>;
}
export function NoiseSuppressionControl() {
  const preferences = useCallPreferences();
  return <div className="noise-control"><button className="button noise-toggle" aria-pressed={preferences.noiseSupported && preferences.noiseSuppression} disabled={!preferences.noiseSupported || preferences.noiseBusy} onClick={preferences.toggleNoise} aria-describedby="noise-status">Reduzir ruídos: {preferences.noiseSupported ? preferences.noiseSuppression ? 'ligado' : 'desligado' : 'indisponível'}</button><span id="noise-status" role="status">{preferences.noiseStatus}</span></div>;
}
