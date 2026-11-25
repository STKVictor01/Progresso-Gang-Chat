import http from 'node:http';
import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { networkInterfaces } from 'node:os';
import ipaddr from 'ipaddr.js';
import { Parser } from 'htmlparser2';
import sharp from 'sharp';

const htmlLimit = 256 * 1024;
const imageLimit = 2 * 1024 * 1024;
const ownAddresses = new Set(Object.values(networkInterfaces()).flat().map(item => item?.address));

export function publicAddress(address) {
  if (!ipaddr.isValid(address) || ownAddresses.has(address) || address === '168.63.129.16') return false;
  const parsed = ipaddr.parse(address);
  // Use globally routable IPv4 only. Never let a second DNS lookup choose the peer.
  return parsed.kind() === 'ipv4' && parsed.range() === 'unicast';
}

function webUrl(value, base) {
  const url = new URL(value, base);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port ||
      !url.hostname.includes('.') || url.href.length > 4096) throw Error('URL indisponível');
  url.hash = '';
  return url;
}

async function download(initial, image, signal) {
  let url = webUrl(initial);
  for (let hop = 0; hop < 4; hop++) {
    signal.throwIfAborted();
    const addresses = isIP(url.hostname) ? [{address:url.hostname}] : await lookup(url.hostname, {family:4, all:true});
    if (!addresses.length || !addresses.every(({address}) => publicAddress(address))) throw Error('Destino indisponível');
    const transport = url.protocol === 'https:' ? https : http;
    const response = await new Promise((resolve, reject) => {
      const req = transport.get(url, {
        agent:false, family:4, autoSelectFamily:false, signal,
        lookup:(_host, _options, done) => done(null, addresses[0].address, 4),
        headers:{Accept:image ? 'image/avif,image/webp,image/jpeg,image/png,image/gif' : 'text/html', 'User-Agent':'ProgressoGang-LinkPreview/1.0'},
      }, resolve);
      req.on('error', reject);
    });
    try {
      if ([301,302,303,307,308].includes(response.statusCode) && response.headers.location) {
        url = webUrl(response.headers.location, url);
        continue;
      }
      const type = (response.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (response.statusCode !== 200 || !(image ? /^image\/(?:jpeg|png|gif|webp|avif)$/.test(type) : type === 'text/html')) throw Error('Formato indisponível');
      const limit = image ? imageLimit : htmlLimit;
      let size = 0;
      const chunks = [];
      for await (const chunk of response) {
        chunks.push(chunk.subarray(0, limit - size));
        size += chunk.length;
        if (size >= limit || (!image && chunk.toString().toLowerCase().includes('</head>'))) break;
      }
      if (image && size >= limit) throw Error('Imagem muito grande');
      return {url, body:Buffer.concat(chunks)};
    } finally { response.destroy(); }
  }
  throw Error('Redirecionamentos demais');
}

export function extractCard(html, base) {
  const fields = new Map();
  let inTitle = false, title = '', inHead = true;
  const parser = new Parser({
    onopentag(tag, attrs) {
      if (tag === 'body') inHead = false;
      if (!inHead) return;
      if (tag === 'title') inTitle = true;
      const key = (attrs.property || attrs.name || '').toLowerCase();
      if (tag === 'meta' && attrs.content && !fields.has(key)) fields.set(key, attrs.content);
    },
    ontext(value) { if (inHead && inTitle) title += value; },
    onclosetag(tag) { if (tag === 'title') inTitle = false; if (tag === 'head') inHead = false; },
  });
  parser.end(html);
  const clean = (s, max) => (s || '').replace(/\s+/g,' ').trim().slice(0,max);
  let image;
  const raw = fields.get('og:image') || fields.get('twitter:image');
  if (raw) { try { image = webUrl(raw, base).href; } catch { /* Optional thumbnail. */ } }
  return {title:clean(fields.get('og:title') || fields.get('twitter:title') || title, 180),
    description:clean(fields.get('og:description') || fields.get('description'), 260), image};
}

async function makeCard(href) {
  const signal = AbortSignal.timeout(5500);
  const page = await download(href, false, signal);
  const {title, description, image} = extractCard(page.body.toString('utf8'), page.url);
  let thumbnail;
  if (image) {
    try {
      const file = await download(image, true, signal);
      // Only raster inputs are decoded; Sharp also accepts vector documents by default.
      const raster = /^(ffd8ff|89504e470d0a1a0a|47494638)/.test(file.body.subarray(0,8).toString('hex')) ||
        (file.body.toString('ascii',0,4)==='RIFF' && file.body.toString('ascii',8,12)==='WEBP') ||
        (file.body.toString('ascii',4,8)==='ftyp' && ['avif','avis'].includes(file.body.toString('ascii',8,12)));
      if (raster) {
        const bytes = await sharp(file.body,{limitInputPixels:16_000_000}).rotate().resize(480,270,{fit:'inside',withoutEnlargement:true}).webp({quality:68}).toBuffer();
        if (bytes.length <= 80*1024) thumbnail = 'data:image/webp;base64,' + bytes.toString('base64');
      }
    } catch { /* A page can still supply a title without a usable image. */ }
  }
  return {title, description, thumbnail};
}

export function registerLinkPreviews(app) {
  const cache = new Map(), pending = new Map();
  app.post('/link-preview', {bodyLimit:8192, config:{rateLimit:{max:90,timeWindow:'1 minute'}}}, async (request, reply) => {
    let href;
    try {
      if (typeof request.body?.url !== 'string') throw Error('URL inválida');
      href = webUrl(request.body.url).href;
    } catch { return reply.code(400).send({error:'Endereço inválido.'}); }
    reply.header('Cache-Control','private, no-store');
    const hit = cache.get(href);
    if (hit?.until > Date.now()) return hit.card;
    if (pending.has(href)) return pending.get(href);
    if (pending.size >= 8) return reply.code(429).send({error:'Tente novamente em instantes.'});
    const work = makeCard(href).catch(() => ({})).then(card => {
      if (cache.size >= 160) cache.delete(cache.keys().next().value);
      cache.set(href,{card,until:Date.now()+(card.title ? 30 : 2)*60000});
      return card;
    }).finally(() => pending.delete(href));
    pending.set(href,work);
    return work;
  });
}
