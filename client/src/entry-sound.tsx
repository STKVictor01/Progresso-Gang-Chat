import { useEffect, useRef, useState } from 'react';
import { api, jsonApi } from './api';
import { useAccount } from './accounts';
import { convertAudio, readAudioDuration } from './audio-file';
import { clampTrim, formatSeconds, initialTrim, MAX_SOURCE_BYTES, needsTrim, trimProblem, TRIM_STEP } from './audio-trim';
import type { TrimRange } from './audio-trim';
import { WAV_RATE } from './wav';

// Player com a duração real. `preload="none"` (versão anterior) não carregava os metadados,
// e o navegador mostrava 0:00 até a pessoa tocar o áudio.
export function AudioPreview({src,label}:{src:string;label:string}) {
  const [duration,setDuration] = useState<number|null>(null);
  const [failed,setFailed] = useState(false);
  const [shown,setShown] = useState(src);
  if (shown !== src) { setShown(src); setDuration(null); setFailed(false); }
  const update = (element:HTMLAudioElement) => { const value = element.duration; if (Number.isFinite(value) && value > 0) setDuration(value); };
  return <div className="audio-preview">
    <audio controls preload="metadata" src={src} aria-label={label} onLoadedMetadata={event => update(event.currentTarget)} onDurationChange={event => update(event.currentTarget)} onError={() => setFailed(true)}/>
    <span className="audio-duration" aria-live="polite">{failed ? 'Não foi possível carregar o áudio.' : duration === null ? 'Duração: carregando…' : 'Duração: ' + formatSeconds(duration)}</span>
  </div>;
}

type Clip = {blob:Blob; url:string; duration:number};
type Selection = {file:File; url:string; duration:number; trim:TrimRange|null; clip:Clip|null};
type Phase = '' | 'reading' | 'exporting' | 'saving' | 'removing';

// Som de entrada no computador: enviar, recortar (até 10 s), ouvir e salvar à parte do perfil.
export function EntrySoundEditor({onPendingChange}:{onPendingChange:(pending:boolean)=>void}) {
  const {user} = useAccount();
  const [loading,setLoading] = useState(true);
  const [configured,setConfigured] = useState(false);
  const [revision,setRevision] = useState(0);
  const [selection,setSelection] = useState<Selection|null>(null);
  const [phase,setPhase] = useState<Phase>('');
  const [message,setMessage] = useState('');
  const [error,setError] = useState('');
  const [playing,setPlaying] = useState(false);
  const player = useRef<HTMLAudioElement>(null);
  const urls = useRef(new Set<string>());
  const busy = phase !== '';
  useEffect(() => {
    let active = true;
    jsonApi('/api/voice-entry').then(data => { if (active) setConfigured(data.configured === true); })
      .catch(() => { if (active) setError('Não foi possível carregar seu som de entrada.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  // Libera as URLs temporárias ao fechar o editor.
  useEffect(() => { const created = urls.current; return () => { for (const url of created) URL.revokeObjectURL(url); created.clear(); }; }, []);
  useEffect(() => { onPendingChange(selection !== null); }, [selection, onPendingChange]);
  const track = (blob:Blob) => { const url = URL.createObjectURL(blob); urls.current.add(url); return url; };
  const release = (...list:(string|undefined)[]) => { for (const url of list) if (url) { URL.revokeObjectURL(url); urls.current.delete(url); } };
  function stop() { player.current?.pause(); setPlaying(false); }
  function discard(current:Selection|null) { stop(); if (current) release(current.url, current.clip?.url); }

  async function choose(file:File|undefined) {
    if (!file) return; // Cancelar o seletor mantém a escolha anterior.
    setError(''); setMessage('');
    if (file.size > MAX_SOURCE_BYTES) { setError('Esse arquivo tem mais de 8 MB. Escolha um arquivo menor.'); return; }
    setPhase('reading');
    try {
      const duration = await readAudioDuration(file);
      discard(selection);
      setSelection({file, url:track(file), duration, trim:needsTrim(duration) ? initialTrim(duration) : null, clip:null});
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível ler esse áudio.'); }
    finally { setPhase(''); }
  }
  function moveTrim(key:'start'|'end', value:number) {
    if (!selection?.trim) return;
    stop(); release(selection.clip?.url);
    setSelection({...selection, trim:clampTrim(selection.duration, {...selection.trim, [key]:value}, key), clip:null});
  }
  // Toca só o trecho escolhido do arquivo original.
  function listen() {
    const audio = player.current, trim = selection?.trim;
    if (!audio || !trim) return;
    if (playing) { stop(); return; }
    audio.currentTime = trim.start;
    void audio.play().then(() => {
      setPlaying(true);
      const tick = () => { if (audio.paused) { setPlaying(false); return; } if (audio.currentTime >= trim.end) { stop(); return; } requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    }).catch(() => setError('Não foi possível tocar o trecho.'));
  }
  async function exportTrim() {
    if (!selection?.trim) return;
    const problem = trimProblem(selection.duration, selection.trim);
    if (problem) { setError(problem); return; }
    stop(); setError(''); setPhase('exporting');
    try {
      const wav = await convertAudio(selection.file, selection.trim);
      const blob = new Blob([wav], {type:'audio/wav'});
      release(selection.clip?.url);
      setSelection({...selection, clip:{blob, url:track(blob), duration:(wav.byteLength - 44) / 2 / WAV_RATE}});
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível recortar o áudio.'); }
    finally { setPhase(''); }
  }
  async function save() {
    if (!selection || busy) return;
    if (selection.trim && !selection.clip) { setError('Confirme o trecho em “Usar este trecho” antes de salvar.'); return; }
    stop(); setError(''); setMessage(''); setPhase('saving');
    try {
      const body = selection.clip ? selection.clip.blob : new Blob([await convertAudio(selection.file)], {type:'audio/wav'});
      const response = await api('/api/voice-entry', {method:'PUT', headers:{'Content-Type':'application/octet-stream'}, body});
      if (!response.ok) { const data = await response.json().catch(() => ({})); throw Error(data.error || 'Não foi possível salvar o som.'); }
      discard(selection); setSelection(null); setConfigured(true); setRevision(Date.now()); setMessage('Som de entrada salvo.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível salvar o som.'); }
    finally { setPhase(''); }
  }
  async function restoreDefault() {
    setError(''); setMessage(''); setPhase('removing');
    try { await jsonApi('/api/voice-entry', 'DELETE'); setConfigured(false); setMessage('Pronto: o som padrão será usado.'); }
    catch (cause) { setError(cause instanceof Error ? 'Não foi possível remover o som: ' + cause.message : 'Não foi possível remover o som.'); }
    finally { setPhase(''); }
  }
  function cancelSelection() { discard(selection); setSelection(null); setError(''); setMessage(''); }

  const trim = selection?.trim ?? null;
  const problem = selection && trim ? trimProblem(selection.duration, trim) : '';
  const ready = selection !== null && (!trim || selection.clip !== null);
  return <section className="entry-sound-editor" aria-labelledby="entry-sound-title" aria-busy={busy || loading}>
    <div className="entry-sound-intro">
      <h3 id="entry-sound-title">Som de entrada na call</h3>
      <p>As pessoas na call ouvem esse som quando você entra. Ele é salvo à parte, em “Salvar som de entrada”, e não depende de “Salvar alterações”.</p>
    </div>
    {loading ? <p role="status">Carregando seu som de entrada…</p> : <>
      {!selection && (configured ? <AudioPreview key={revision} src={'/api/voice-entry/' + user.id + '?v=' + revision} label="Ouvir seu som de entrada"/> : <p className="entry-sound-empty">Nenhum som personalizado. O som padrão será usado.</p>)}
      <div className="entry-sound-pick">
        <label className={'button subtle entry-sound-upload' + (busy ? ' is-disabled' : '')}>Enviar áudio<input className="sr-only" type="file" accept="audio/*" disabled={busy} onChange={event => { void choose(event.target.files?.[0]); event.target.value = ''; }}/></label>
        <small>Até 10 segundos e 8 MB</small>
      </div>
      {phase === 'reading' && <p role="status">Lendo o áudio…</p>}
      {selection && <div className="entry-sound-selection">
        <p className="entry-sound-file"><strong>{selection.file.name}</strong><span>{formatSeconds(selection.duration)}</span></p>
        {trim ? <div className="audio-trim" role="group" aria-labelledby="audio-trim-title">
          <p id="audio-trim-title">Esse áudio tem {formatSeconds(selection.duration)}. Escolha um trecho de até 10 segundos.</p>
          <label><span>Início <output>{formatSeconds(trim.start)}</output></span><input type="range" min={0} max={selection.duration} step={TRIM_STEP} value={trim.start} onChange={event => moveTrim('start', Number(event.target.value))} disabled={busy} aria-valuetext={formatSeconds(trim.start)}/></label>
          <label><span>Fim <output>{formatSeconds(trim.end)}</output></span><input type="range" min={0} max={selection.duration} step={TRIM_STEP} value={trim.end} onChange={event => moveTrim('end', Number(event.target.value))} disabled={busy} aria-valuetext={formatSeconds(trim.end)}/></label>
          <p className="audio-trim-length">Trecho: {formatSeconds(trim.end - trim.start)}</p>
          {problem && <p className="error-message" role="alert">{problem}</p>}
          <audio ref={player} src={selection.url} preload="auto" hidden onPause={() => setPlaying(false)}/>
          <div className="audio-trim-actions">
            <button type="button" className="button subtle" onClick={listen} disabled={busy || !!problem}>{playing ? 'Parar' : 'Ouvir trecho'}</button>
            <button type="button" className="button subtle" onClick={() => void exportTrim()} disabled={busy || !!problem || selection.clip !== null}>{phase === 'exporting' ? 'Recortando…' : selection.clip ? 'Trecho pronto' : 'Usar este trecho'}</button>
          </div>
          {selection.clip && <><p className="audio-trim-length">Trecho recortado: {formatSeconds(selection.clip.duration)}</p><AudioPreview src={selection.clip.url} label="Ouvir o trecho recortado"/></>}
        </div> : <AudioPreview src={selection.url} label="Ouvir o áudio escolhido"/>}
        <button type="button" className="button subtle" onClick={cancelSelection} disabled={busy}>Cancelar seleção</button>
      </div>}
      {error && <p className="error-message" role="alert">{error}</p>}
      {message && <p className="profile-saved" role="status">{message}</p>}
      <div className="entry-sound-actions">
        {configured && <button type="button" className="button subtle" onClick={() => void restoreDefault()} disabled={busy}>{phase === 'removing' ? 'Removendo…' : 'Usar som padrão'}</button>}
        <button type="button" className="button primary" onClick={() => void save()} disabled={busy || !ready}>{phase === 'saving' ? 'Salvando…' : 'Salvar som de entrada'}</button>
      </div>
    </>}
  </section>;
}
