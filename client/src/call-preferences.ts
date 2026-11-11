import { createContext, useContext } from 'react';
import type { AudioSource, ListenerPreferences } from './call-settings';
import type { VoiceEffect } from './voice-effects';
export type CallPreferences = {
  muted: ListenerPreferences;
  toggleMute: (identity: string, source: AudioSource) => void;
  volumes: Record<string, number>;
  setVolume: (identity: string, volume: number) => void;
  screenVolumes: Record<string, number>;
  setScreenVolume: (identity: string, volume: number) => void;
  noiseSuppression: boolean;
  noiseSupported: boolean;
  noiseBusy: boolean;
  noiseStatus: string;
  toggleNoise: () => void;
  voiceEffect: VoiceEffect;
  setVoiceEffect: (effect: VoiceEffect) => void;
  voiceEffectStatus: string;
  voiceEffectBusy: boolean;
};
export const PreferencesContext = createContext<CallPreferences | null>(null);
export function useCallPreferences() {
  const preferences = useContext(PreferencesContext);
  if (!preferences) throw Error('Call preferences provider is missing');
  return preferences;
}
