// Local Vite fixture. No microphone permission, connection, account, or real API data.
import React, { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { RoomContext } from '@livekit/components-react';
import { LocalAudioTrack, LocalTrackPublication, ParticipantEvent, Room, Track } from 'livekit-client';
import { AccountGate } from '../src/accounts';
import { CallPreferencesProvider, NoiseSuppressionControl, VoiceEffectControl } from '../src/call-audio';
import { useCallPreferences } from '../src/call-preferences';
import { createMicrophoneProcessor } from '../src/microphone-processor';
import { createRnnoiseEngine, SpeechAttenuator } from '../src/rnnoise-core';
import '@fontsource-variable/inter';
import '../src/index.css';
import '../src/App.css';

const nativeFetch = window.fetch.bind(window);
let blockModel = new URLSearchParams(location.search).has('fail');
window.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input.url, location.href);
  if (blockModel && url.pathname.endsWith('.wasm')) return new Response('', { status: 503 });
  if (url.pathname.startsWith('/api/')) {
    const data = {
      '/api/auth/me': { user: { id: '00000000-0000-0000-0000-000000000000', name: 'Teste local', role: 'member' } },
      '/api/site': { name: 'Verificação de áudio', tagline: 'Dados simulados' },
      '/api/channels': { voice: [], text: [] },
    }[url.pathname];
    if (!data) throw Error('A fixture não permite chamadas à API real.');
    return Response.json(data);
  }
  return nativeFetch(input, init);
};
const room = new Room();
let context, track, publication;
const connections = [];
const sources = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function syntheticTrack(audioContext) {
  const output = audioContext.createMediaStreamDestination();
  const oscillator = audioContext.createOscillator();
  oscillator.type = 'sawtooth';
  oscillator.frequency.value = 170;
  const gain = audioContext.createGain();
  gain.gain.value = 0.12;
  oscillator.connect(gain).connect(output);
  oscillator.start();
  sources.push({ oscillator, output, gain });
  const raw = output.stream.getAudioTracks()[0];
  // MediaStreamDestination is not a physical microphone and rejects capture DSP
  // constraints. Unit tests check those options; this fixture checks the graph/UI.
  raw.applyConstraints = async () => {};
  return raw;
}

function localTrack(raw, audioContext) {
  const local = new LocalAudioTrack(raw, {}, true, audioContext);
  // A local sender exercises LiveKit replacement without connecting to a peer.
  const peer = new RTCPeerConnection({ iceServers: [] });
  connections.push(peer);
  local.sender = peer.addTrack(raw);
  return local;
}

function Probe() {
  const preferences = useCallPreferences();
  const [signal, setSignal] = useState('');
  useEffect(() => {
    let cancelled = false;
    const timer = setInterval(async () => {
      if (!track || !context || context.state !== 'running') return;
      const source = context.createMediaStreamSource(new MediaStream([track.mediaStreamTrack]));
      const analyser = context.createAnalyser();
      source.connect(analyser);
      await pause(100);
      const samples = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(samples);
      const rms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
      source.disconnect(); analyser.disconnect();
      if (!cancelled) setSignal(`Saída ${track.mediaStreamTrack.readyState}; RMS ${rms.toFixed(6)}; processador ${track.getProcessor()?.name ?? 'desligado'}`);
    }, 500);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);
  return <><div className="call-controls"><NoiseSuppressionControl /><VoiceEffectControl /></div><p role="status">{signal}</p><pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify({ noise: preferences.noiseSuppression, active: preferences.noiseActive, busy: preferences.noiseBusy, effect: preferences.voiceEffect, effectStatus: preferences.voiceEffectStatus }, null, 2)}</pre></>;
}

async function checkProcessing(report) {
  for (const sampleRate of [48000, 44100]) {
    const audioContext = new AudioContext({ sampleRate });
    await audioContext.resume();
    const raw = syntheticTrack(audioContext);
    const local = localTrack(raw, audioContext);
    try {
      for (const effect of ['natural', 'robo', 'radio', 'bebe', 'anime']) {
        await local.setProcessor(createMicrophoneProcessor(true, effect));
        const source = audioContext.createMediaStreamSource(new MediaStream([local.mediaStreamTrack]));
        const analyser = audioContext.createAnalyser();
        source.connect(analyser);
        await pause(350);
        const samples = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(samples);
        source.disconnect(); analyser.disconnect();
        if (!samples.every(Number.isFinite) || !samples.some(sample => Math.abs(sample) > 1e-7)) throw Error(`Saída inválida: ${sampleRate}, ${effect}`);
        await local.replaceTrack(syntheticTrack(audioContext), true);
        if (local.mediaStreamTrack.readyState !== 'live') throw Error('Troca de entrada encerrou a saída.');
        await local.stopProcessor();
        if (local.mediaStreamTrack.readyState !== 'live' || local.getProcessor()) throw Error('Desativação interrompeu a captura.');
        report(`PASSOU: ${sampleRate} Hz + ${effect}; saída válida, troca de entrada e desativação.`);
      }
    } finally { local.stop(); await audioContext.close(); }
  }
}

async function compareKeyboard(report) {
  const { default: wasmUrl } = await import('@sapphi-red/web-noise-suppressor/rnnoise.wasm?url');
  const response = await fetch(wasmUrl);
  if (!response.ok) throw Error('Modelo indisponível.');
  const engine = await createRnnoiseEngine(await response.arrayBuffer());
  const speech = new SpeechAttenuator();
  const baseline = [], filtered = [];
  const output = new Float32Array(480);
  let seed = 123;
  try {
    for (let frame = 0; frame < 500; frame++) {
      const input = Float32Array.from({ length: 480 }, (_, i) => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        const noise = seed / 0x100000000 * 2 - 1;
        const phase = (frame * 480 + i) % 5760;
        return noise * (0.001 + (phase < 960 ? 0.3 * Math.exp(-phase / 80) : 0));
      });
      const probability = engine.processFrame(input);
      baseline.push(...input);
      speech.processFrame(input, probability, output);
      filtered.push(...output);
    }
    // Align the 20 ms look-ahead and omit initial model warm-up.
    let originalPower = 0, filteredPower = 0;
    for (let i = 48000; i < baseline.length - 960; i++) {
      originalPower += baseline[i] ** 2;
      filteredPower += filtered[i + 960] ** 2;
    }
    const reduction = 10 * Math.log10(originalPower / Math.max(filteredPower, 1e-20));
    if (!Number.isFinite(reduction) || reduction < 3) throw Error('A atenuação dos cliques simulados foi insuficiente.');
    report(`PASSOU: cliques simulados ${reduction.toFixed(1)} dB abaixo do RNNoise anterior, neste sinal sintético sem fala.`);
  } finally { engine.destroy(); }
}

function Fixture() {
  const [started, setStarted] = useState(false), [results, setResults] = useState([]), [busy, setBusy] = useState(false);
  const report = message => setResults(previous => [...previous, message]);
  async function start(sampleRate) {
    context = new AudioContext({ sampleRate });
    await context.resume();
    track = localTrack(syntheticTrack(context), context);
    const initProcessor = track.setProcessor.bind(track);
    track.setProcessor = async processor => {
      try { return await initProcessor(processor); }
      catch (error) { report(`DIAGNÓSTICO: ${error.message}`); throw error; }
    };
    track.source = Track.Source.Microphone;
    publication = new LocalTrackPublication(Track.Kind.Audio, { sid: 'simulated-microphone', name: 'Entrada simulada', source: 2, type: 0 }, track);
    room.localParticipant.trackPublications.set(publication.trackSid, publication);
    room.localParticipant.audioTrackPublications.set(publication.trackSid, publication);
    room.localParticipant.emit(ParticipantEvent.LocalTrackPublished, publication);
    setStarted(true);
  }
  async function mute() {
    if (track.isMuted) { await track.unmute(); room.localParticipant.emit(ParticipantEvent.TrackUnmuted, publication); }
    else { await track.mute(); room.localParticipant.emit(ParticipantEvent.TrackMuted, publication); }
  }
  return <main className="progresso-app" style={{ maxWidth: 1000, margin: 'auto', padding: 16 }}>
    <h1>Verificação de áudio do chat</h1><p>Som sintético, sem transmissão e sem usar o microfone.</p>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      <button className="button" disabled={started} onClick={() => void start(48000)}>Iniciar em 48 kHz</button>
      <button className="button" disabled={started} onClick={() => void start(44100)}>Iniciar em 44,1 kHz</button>
      <button className="button" disabled={!started} onClick={() => void mute()}>Alternar mudo</button>
      <button className="button" disabled={!started} onClick={() => void track.replaceTrack(syntheticTrack(context), true)}>Trocar entrada simulada</button>
      <button className="button" onClick={() => { blockModel = !blockModel; report(`Bloqueio do modelo: ${blockModel}. Recarregue a página para limpar o cache do filtro.`); }}>Alternar falha de download</button>
      <button className="button" disabled={busy} onClick={async () => { setBusy(true); try { await checkProcessing(report); report('VERIFICAÇÃO CONCLUÍDA: 10 combinações aprovadas.'); } catch (error) { report(`FALHOU: ${error.message}`); } finally { setBusy(false); } }}>Verificar 10 combinações</button>
      <button className="button" disabled={busy} onClick={async () => { setBusy(true); try { await compareKeyboard(report); } catch (error) { report(`FALHOU: ${error.message}`); } finally { setBusy(false); } }}>Comparar cliques simulados</button>
    </div>
    <AccountGate><RoomContext.Provider value={room}><CallPreferencesProvider><Probe /></CallPreferencesProvider></RoomContext.Provider></AccountGate>
    <ol>{results.map((result, index) => <li key={index}>{result}</li>)}</ol>
  </main>;
}
createRoot(document.getElementById('root')).render(<StrictMode><Fixture /></StrictMode>);
window.addEventListener('pagehide', () => {
  track?.stop(); void context?.close();
  connections.forEach(peer => peer.close());
  for (const { oscillator, output, gain } of sources) {
    oscillator.stop(); oscillator.disconnect(); gain.disconnect();
    output.stream.getTracks().forEach(track => track.stop()); output.disconnect();
  }
});
