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
