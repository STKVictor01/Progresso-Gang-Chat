import { LinkifyIt } from 'linkify-it';
import tlds from 'tlds/index.json' with {type:'json'};

const finder = new LinkifyIt({ fuzzyLink:true, fuzzyEmail:false, tlds }).add('ftp:', null).add('mailto:', null);
export type MessageLink = {start:number; end:number; href:string; label:string};

export function messageLinks(text:string): MessageLink[] {
  const links: MessageLink[] = [];
  for (const match of finder.match(text) ?? []) {
    const raw = match.raw;
    if (raw.startsWith('//')) continue;
    let url: URL;
    try { url = new URL(match.schema ? raw : 'https://' + raw); } catch { continue; }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) continue;
    let start = match.index, end = match.lastIndex, label = raw;
    const caption = /\[([^[\]\n]{1,250})\]\($/.exec(text.slice(links.at(-1)?.end ?? 0, start));
    if (caption && text[end] === ')') {
      start -= caption[0].length;
      end++;
      label = caption[1];
    }
    links.push({start, end, href:url.href, label});
  }
  return links;
}

// Preserve the clipboard's plain text, including paragraph breaks. Only name a
// link when its caption can be matched unambiguously in the copied selection.
export function formattedPaste(html:string, plain:string):string|null {
  if (!html || !plain || plain.length>2000 || html.length>128000) return null;
  const template=document.createElement('template');
  template.innerHTML=html;
  let offset=0, result='';
  for (const anchor of template.content.querySelectorAll('a[href]')) {
    const label=anchor.textContent?.trim();
    if (!label || label.length>250 || /[[\]\r\n]/.test(label)) continue;
    const raw=anchor.getAttribute('href')!;
    let url:URL;
    try { url=new URL(raw); } catch { continue; }
    if (!['http:','https:'].includes(url.protocol) || url.username || url.password || label===raw) continue;
    const start=plain.indexOf(label,offset);
    if (start<0 || plain.indexOf(label)!==plain.lastIndexOf(label)) continue;
    const markup='['+label+']('+url.href+')';
    const [parsed]=messageLinks(markup);
    if (!parsed || parsed.label!==label || parsed.href!==url.href || parsed.end!==markup.length) continue;
    result+=plain.slice(offset,start)+markup;
    offset=start+label.length;
  }
  return offset ? result+plain.slice(offset) : null;
}
