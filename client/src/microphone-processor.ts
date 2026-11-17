import { Track } from 'livekit-client';
import type { AudioProcessorOptions, TrackProcessor } from 'livekit-client';
import { createVoiceProcessor } from './voice-effects.ts';
import type { VoiceEffect } from './voice-effects.ts';

type NoiseNode = AudioNode & { destroy: () => void };
type NoiseNodeFactory = (context: AudioContext) => Promise<NoiseNode>;
const loadNoiseNode: NoiseNodeFactory = async context => (await import('./rnnoise.ts')).createRnnoiseNode(context);

// LiveKit accepts one processor: denoise first, then apply the selected voice effect.
export function createMicrophoneProcessor(
  noiseSuppression: boolean,
  effect: VoiceEffect,
  onFailure: () => void = () => {},
  createNoiseNode: NoiseNodeFactory = loadNoiseNode,
): TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  let input: MediaStreamAudioSourceNode | undefined;
  let output: MediaStreamAudioDestinationNode | undefined;
  let noise: NoiseNode | undefined;
  let voice: ReturnType<typeof createVoiceProcessor> | undefined;
  let ownedContext: AudioContext | undefined;
  let processedTrack: MediaStreamTrack | undefined;
  let resumeTimer: ReturnType<typeof setTimeout> | undefined;
  const failed = () => onFailure();

  const processor: TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> = {
    name: 'pg-microphone',
    get processedTrack() { return processedTrack; },
    async init(options) {
      try {
        let context = options.audioContext;
        // RNNoise requires 48 kHz. Web Audio resamples the captured track for us.
        // A 44.1 kHz room/device must not change the pitch or speed of the call.
        if (noiseSuppression && context.sampleRate !== 48000) {
          ownedContext = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
          context = ownedContext;
        }
        if (context.state === 'closed') throw Error('Áudio indisponível.');
        if (context.state === 'suspended') {
          await Promise.race([context.resume(), new Promise<never>((_, reject) => {
            resumeTimer = setTimeout(() => reject(Error('Áudio não foi ativado.')), 3000);
          })]);
          clearTimeout(resumeTimer);
        }
        let track = options.track;
        if (noiseSuppression) {
          noise = await createNoiseNode(context);
          noise.addEventListener('processorerror', failed);
          input = context.createMediaStreamSource(new MediaStream([track]));
          output = context.createMediaStreamDestination();
          output.channelCount = 1;
          input.connect(noise);
          noise.connect(output);
          track = output.stream.getAudioTracks()[0];
          if (!track) throw Error('Não foi possível criar o áudio filtrado.');
        }
        if (effect !== 'natural') {
          voice = createVoiceProcessor(effect);
          await voice.init({ ...options, track, audioContext: context });
          processedTrack = voice.processedTrack;
        } else processedTrack = track;
        if (!processedTrack) throw Error('Não foi possível processar o microfone.');
      } catch (error) {
        await processor.destroy();
        throw error;
      }
    },
    async restart(options) {
      await processor.destroy();
      try { await processor.init(options); }
      catch (error) { onFailure(); throw error; }
    },
    async destroy() {
      clearTimeout(resumeTimer);
      await voice?.destroy();
      voice = undefined;
      noise?.removeEventListener('processorerror', failed);
      noise?.destroy();
      noise?.disconnect();
      noise = undefined;
      input?.disconnect();
      input = undefined;
      output?.disconnect();
      output?.stream.getTracks().forEach(track => track.stop());
      output = undefined;
      processedTrack = undefined;
      if (ownedContext && ownedContext.state !== 'closed') await ownedContext.close();
      ownedContext = undefined;
    },
  };
  return processor;
}
