import type { AudioCaptureOptions, LocalAudioTrack } from 'livekit-client';

export type AudioSource = 'microphone' | 'screen';
export type ListenerPreferences = Record<string, Partial<Record<AudioSource, boolean>>>;
export function toggleListenerMute(previous: ListenerPreferences, identity: string, source: AudioSource): ListenerPreferences {
  return { ...previous, [identity]: { ...previous[identity], [source]: !previous[identity]?.[source] } };
}
export function isListenerMuted(preferences: ListenerPreferences, identity: string, source: AudioSource) {
  return preferences[identity]?.[source] === true;
}
export function microphoneOptions(enabled: boolean): AudioCaptureOptions {
  return { noiseSuppression: enabled, echoCancellation: true, autoGainControl: true };
}
export function readNoisePreference() {
  try { return localStorage.getItem('pg-noise-suppression') !== 'false'; } catch { return true; }
}
export async function applyNoiseSuppression(track: Pick<LocalAudioTrack, 'applyConstraints' | 'mediaStreamTrack'>, enabled: boolean) {
  await track.applyConstraints(microphoneOptions(enabled));
  return track.mediaStreamTrack.getSettings().noiseSuppression;
}
