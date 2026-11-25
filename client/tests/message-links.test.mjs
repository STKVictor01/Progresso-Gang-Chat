import test from 'node:test';
import assert from 'node:assert/strict';
import { messageLinks } from '../src/message-links.ts';

test('links no texto preservam pontuação, parênteses, menções e endereços sem protocolo',()=>{
  const text='@Ana leia (https://site.com/wiki/Foo_(bar)). Depois veja g1.globo.com e progressogang.tech.';
  const links=messageLinks(text);
  assert.deepEqual(links.map(link=>text.slice(link.start,link.end)),['https://site.com/wiki/Foo_(bar)','g1.globo.com','progressogang.tech']);
  assert.equal(links[1].href,'https://g1.globo.com/');
});

test('hiperlink nomeado mantém rótulo, destino e texto vizinho',()=>{
  const text='Leia [a notícia](https://example.org/artigo?ref=chat#parte) agora.';
  const [link]=messageLinks(text);
  assert.equal(link.label,'a notícia');
  assert.equal(link.href,'https://example.org/artigo?ref=chat#parte');
  assert.equal(text.slice(link.end),' agora.');
});

test('só transforma endereços web em links',()=>{
  assert.deepEqual(messageLinks('javascript:alert(1) data:text/html,oi @Ana'),[]);
  assert(messageLinks('ftp://example.com/a').every(link=>link.href.startsWith('https:')||link.href.startsWith('http:')));
});
