import { useEffect, useId, useRef, useState } from 'react';
import { api } from './api';
import { searchGiphy } from './giphy';
import type { GifResult } from './giphy';

export type { GifResult } from './giphy';

async function readError(response: Response, fallback: string) {
  try { const data = await response.json(); return typeof data.error === 'string' && data.error !== 'Not Found' ? data.error : fallback; } catch { return fallback; }
}

// Biblioteca de GIFs: abre com os populares e busca enquanto a pessoa digita.
export function GifPicker({ onPick, onClose, busy }: { onPick: (gif: GifResult) => void; onClose: () => void; busy: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const searchId = useId();
  const [query, setQuery] = useState('');
  const [gifs, setGifs] = useState<GifResult[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [apiKey, setApiKey] = useState('');
  useEffect(() => { if (dialog.current && !dialog.current.open) dialog.current.showModal(); }, []);
  useEffect(() => {
    const controller=new AbortController();
    void (async()=>{try{const response=await api('/api/gifs/config',{signal:controller.signal});if(!response.ok)throw Error(await readError(response,'Biblioteca de GIFs indisponível.'));const data=await response.json();if(typeof data.apiKey!=='string'||!data.apiKey)throw Error('Biblioteca de GIFs indisponível.');setApiKey(data.apiKey);}catch(cause){if(!controller.signal.aborted){setError(cause instanceof Error?cause.message:'Biblioteca de GIFs indisponível.');setLoading(false);}}})();
    return()=>controller.abort();
  }, []);
  useEffect(() => {
    if (!apiKey) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true); setError('');
      try {
        const page = await searchGiphy(apiKey,query,0,AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]));
        setGifs(page.gifs); setNextOffset(page.nextOffset);
      } catch (cause) { if (!controller.signal.aborted) { setGifs([]); setNextOffset(null); setError(cause instanceof Error && cause.name === 'Error' ? cause.message : 'Não foi possível buscar GIFs agora.'); } }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }, query ? 900 : 0);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [apiKey,query]);
  async function more() {
    if (nextOffset === null || loading) return;
    setLoading(true); setError('');
    try {
      const page = await searchGiphy(apiKey,query,nextOffset,AbortSignal.timeout(12000));
      setGifs(previous => [...new Map([...previous, ...page.gifs].map(gif => [gif.id, gif])).values()]); setNextOffset(page.nextOffset);
    } catch (cause) { setError(cause instanceof Error && cause.name === 'Error' ? cause.message : 'Não foi possível carregar mais GIFs.'); }
    finally { setLoading(false); }
  }
  return <dialog className="gif-dialog" ref={dialog} onCancel={onClose} onClose={onClose} onClick={event => { if (event.target === event.currentTarget) onClose(); }} aria-label="Biblioteca de GIFs">
    <header className="gif-dialog-header">
      <label className="sr-only" htmlFor={searchId}>Buscar GIF</label>
      <input id={searchId} type="search" autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar GIF…" maxLength={50} enterKeyHint="search" autoComplete="off"/>
      <button type="button" className="button subtle" onClick={onClose}>Fechar</button>
    </header>
    <p className="gif-dialog-status" role="status">{busy ? 'Enviando GIF…' : loading && !gifs.length ? 'Carregando GIFs…' : !error && !gifs.length ? 'Nenhum GIF encontrado.' : query.trim() ? '' : 'Em alta agora'}</p>
    {error && <p className="error-message" role="alert">{error}</p>}
    <div className="gif-grid" aria-busy={loading}>
      {gifs.map(gif => <button type="button" key={gif.id} className="gif-choice" disabled={busy} onClick={() => onPick(gif)} aria-label={'Enviar GIF: ' + gif.title} title={gif.title} style={{ aspectRatio: gif.width + ' / ' + gif.height }}>
        <img src={gif.previewUrl} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" width={gif.width} height={gif.height}/>
      </button>)}
    </div>
    {nextOffset !== null && <button type="button" className="button subtle gif-more" disabled={loading} onClick={() => void more()}>{loading ? 'Carregando…' : 'Carregar mais'}</button>}
    <footer className="gif-attribution"><img src="/giphy-attribution.png" alt="Powered by GIPHY" /></footer>
  </dialog>;
}
