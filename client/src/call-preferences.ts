import { createContext, useContext } from 'react';
import type { AudioSource, ListenerPreferences } from './call-settings';
export type CallPreferences = {
  muted: ListenerPreferences;
  toggleMute: (identity: string, source: AudioSource) => void;
  noiseSuppression: boolean;
  noiseSupported: boolean;
  noiseBusy: boolean;
  noiseStatus: string;
  toggleNoise: () => void;
};
export const PreferencesContext = createContext<CallPreferences | null>(null);
export function useCallPreferences() {
  const preferences = useContext(PreferencesContext);
  if (!preferences) throw Error('Call preferences provider is missing');
  return preferences;
}
