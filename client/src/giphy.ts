export type GifResult = { id:string; title:string; previewUrl:string; width:number; height:number };
export type GifPage = { gifs:GifResult[]; nextOffset:number|null };

export function gifMessage(id:string) {
  if (!/^[A-Za-z0-9]{1,64}$/.test(id)) throw Error('GIF inválido.');
  return `[[giphy:${id}]]`;
}
export function gifId(text:string) { return /^\[\[giphy:([A-Za-z0-9]{1,64})\]\]$/.exec(text)?.[1] ?? null; }

export async function searchGiphy(key:string, query:string, offset:number, signal?:AbortSignal):Promise<GifPage> {
  const search = query.trim().length > 0;
  const url = new URL(search ? 'https://api.giphy.com/v1/gifs/search' : 'https://api.giphy.com/v1/gifs/trending');
  url.searchParams.set('api_key',key);
  url.searchParams.set('limit','24');
  url.searchParams.set('offset',String(offset));
  url.searchParams.set('rating','pg-13');
  if (search) { url.searchParams.set('q',query); url.searchParams.set('lang','pt'); }
  const response = await fetch(url,{signal,cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer'});
  if (response.status===429) throw Error('O limite de buscas do GIPHY foi atingido. Tente novamente mais tarde.');
  if (!response.ok) throw Error('Não foi possível buscar GIFs no GIPHY. Tente novamente.');
  const data = await response.json();
  if (!Array.isArray(data?.data)) throw Error('O GIPHY retornou uma resposta inválida.');
  const gifs:GifResult[] = [];
  for (const item of data.data) {
    const preview=item?.images?.fixed_width_downsampled || item?.images?.fixed_width;
    try {
      const mediaUrl = preview?.webp || preview?.url;
      const source = new URL(mediaUrl);
      if (!/^[A-Za-z0-9]{1,64}$/.test(item?.id) || source.protocol !== 'https:' || !/(^|\.)giphy\.com$/i.test(source.hostname) || source.username || source.password) continue;
      gifs.push({id:item.id,title:typeof item.title==='string' && item.title.trim() ? item.title.trim().slice(0,120) : 'GIF',previewUrl:mediaUrl,width:Number(preview.width)||200,height:Number(preview.height)||200});
    } catch { /* Ignore malformed URLs. */ }
  }
  const count=Number(data?.pagination?.count)||0, total=Number(data?.pagination?.total_count)||0;
  return {gifs,nextOffset:count && offset+count<Math.min(total,search?4999:499) ? offset+count : null};
}
