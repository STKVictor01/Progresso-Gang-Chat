import { Track } from 'livekit-client';
import type { AudioProcessorOptions, TrackProcessor } from 'livekit-client';

export type VoiceEffect = 'natural' | 'robo' | 'radio' | 'bebe' | 'anime';

const pitchRatios = { bebe: 1.55, anime: 1.4 } as const;

export function createVoiceProcessor(effect: Exclude<VoiceEffect, 'natural'>): TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  let nodes: AudioNode[] = [];
  let oscillator: OscillatorNode | undefined;
  let processedTrack: MediaStreamTrack | undefined;

  const processor: TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> = {
    name: 'pg-voice-effect',
    get processedTrack() { return processedTrack; },
    async init({track, audioContext}) {
      try {
        if (audioContext.state === 'closed') throw Error('Áudio indisponível.');
        if (audioContext.state === 'suspended') {
          await Promise.race([audioContext.resume(), new Promise<never>((_,reject)=>setTimeout(()=>reject(Error('Áudio não foi ativado.')),3000))]);
        }
        const input = audioContext.createMediaStreamSource(new MediaStream([track]));
        nodes.push(input);
        const filter = audioContext.createBiquadFilter();
        nodes.push(filter);
        const output = audioContext.createMediaStreamDestination();
        nodes.push(output);
        input.connect(filter);

        if (effect === 'robo') {
          filter.type = 'bandpass'; filter.frequency.value = 1500; filter.Q.value = 0.7;
          const modulator = audioContext.createGain();
          nodes.push(modulator);
          modulator.gain.value = 0;
          oscillator = audioContext.createOscillator();
          nodes.push(oscillator);
          oscillator.type = 'sine'; oscillator.frequency.value = 60;
          filter.connect(modulator); oscillator.connect(modulator.gain); modulator.connect(output);
          oscillator.start();
        } else {
          if (effect === 'radio') { filter.type = 'bandpass'; filter.frequency.value = 1600; filter.Q.value = 0.8; }
          else { filter.type = 'highshelf'; filter.frequency.value = 1800; filter.gain.value = 3; }
          // Compression keeps boosted frequencies from clipping the outgoing track.
          const compressor = audioContext.createDynamicsCompressor();
          nodes.push(compressor);
          compressor.threshold.value = -12; compressor.knee.value = 8; compressor.ratio.value = 8;
          if (effect === 'bebe' || effect === 'anime') {
            if (!audioContext.audioWorklet || typeof AudioWorkletNode === 'undefined') throw Error('Efeitos de voz indisponíveis neste navegador.');
            await audioContext.audioWorklet.addModule('/voice-pitch-worklet.js');
            const pitch = new AudioWorkletNode(audioContext, 'pg-voice-pitch', {processorOptions:{ratio:pitchRatios[effect]}, numberOfInputs:1, numberOfOutputs:1, outputChannelCount:[1]});
            nodes.push(pitch);
            filter.connect(pitch); pitch.connect(compressor);
          } else filter.connect(compressor);
          compressor.connect(output);
        }
        processedTrack = output.stream.getAudioTracks()[0];
        if (!processedTrack) throw Error('Não foi possível criar o áudio processado.');
      } catch (error) {
        await processor.destroy();
        throw error;
      }
    },
    async restart(options) { await processor.destroy(); await processor.init(options); },
    async destroy() {
      if (oscillator) { try { oscillator.stop(); } catch { /* Already stopped. */ } oscillator = undefined; }
      for (const node of nodes) node.disconnect();
      nodes = [];
      processedTrack?.stop();
      processedTrack = undefined;
    },
  };
  return processor;
}
