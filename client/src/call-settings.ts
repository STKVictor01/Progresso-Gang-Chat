import type { AudioCaptureOptions } from 'livekit-client';

export type AudioSource = 'microphone' | 'screen';
export type ListenerPreferences = Record<string, Partial<Record<AudioSource, boolean>>>;
export function listenerId(identity: string) {
  return identity.startsWith('music-bot:') ? 'music-bot' : identity.split(':')[0];
}
export function readVolumePreferences(accountId: string): { volumes: Record<string, number>; screenVolumes: Record<string, number> } {
  try {
    const saved = JSON.parse(localStorage.getItem('pg-call-volumes:' + accountId) || '{}');
    const valid = (value: unknown): Record<string, number> => Object.fromEntries(
      Object.entries(value && typeof value === 'object' && !Array.isArray(value) ? value : {})
        .filter(([id, volume]) => /^(?:music-bot|[a-f0-9-]{36})$/i.test(id) && typeof volume === 'number' && Number.isFinite(volume) && volume >= 0 && volume <= 1));
    return {volumes:valid(saved?.volumes),screenVolumes:valid(saved?.screenVolumes)};
  } catch { return {volumes:{},screenVolumes:{}}; }
}
export function toggleListenerMute(previous: ListenerPreferences, identity: string, source: AudioSource): ListenerPreferences {
  return { ...previous, [identity]: { ...previous[identity], [source]: !previous[identity]?.[source] } };
}
export function isListenerMuted(preferences: ListenerPreferences, identity: string, source: AudioSource) {
  return preferences[identity]?.[source] === true;
}
export function listenerVolume(preferences: ListenerPreferences, volumes: Record<string, number>, identity: string, source: AudioSource, screenVolumes: Record<string, number> = {}) {
  if (isListenerMuted(preferences, identity, source)) return 0;
  return (source === 'microphone' ? volumes : screenVolumes)[identity] ?? 1;
}
export function microphoneOptions(): AudioCaptureOptions {
  // Suppression belongs to the app. Keep browser echo cancellation and gain control.
  return { noiseSuppression: false, echoCancellation: true, autoGainControl: true };
}
export function readNoisePreference() {
  try { return localStorage.getItem('pg-noise-suppression') !== 'false'; } catch { return true; }
}
export function isNoiseSuppressionSupported() {
  return globalThis.isSecureContext === true && typeof AudioContext !== 'undefined'
    && typeof AudioWorkletNode !== 'undefined' && typeof WebAssembly !== 'undefined';
}
