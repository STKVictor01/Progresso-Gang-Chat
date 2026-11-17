import test from 'node:test';
import assert from 'node:assert/strict';
import { gifId, gifMessage, searchGiphy } from '../src/giphy.ts';

test('mensagens guardam somente uma identificação segura do GIF',()=>{
  assert.equal(gifMessage('abc123'),'[[giphy:abc123]]');
  assert.equal(gifId('[[giphy:abc123]]'),'abc123');
  for(const text of ['[[giphy:../outro]]','[[giphy:]]','antes [[giphy:abc123]]','[[giphy:abc123]] depois'])assert.equal(gifId(text),null);
  assert.throws(()=>gifMessage('../outro'));
});

test('busca diretamente no GIPHY sem guardar respostas ou alterar URL de mídia',async()=>{
  const original=globalThis.fetch;let request;
  globalThis.fetch=async(url,options)=>{request={url:new URL(url),options};return new Response(JSON.stringify({data:[{id:'abc123',title:'Oi',images:{fixed_width:{url:'https://media.giphy.com/media/abc123/200.gif?token=a%2Fb',width:'200',height:'150'}}}],pagination:{count:1,total_count:2}}));};
  try{
    const page=await searchGiphy('testkey','Olá gang',0);
    assert.equal(request.url.origin,'https://api.giphy.com');
    assert.equal(request.url.pathname,'/v1/gifs/search');
    assert.equal(request.url.searchParams.get('q'),'Olá gang');
    assert.equal(request.options.cache,'no-store');
    assert.equal(page.gifs[0].previewUrl,'https://media.giphy.com/media/abc123/200.gif?token=a%2Fb');
    assert.equal(page.nextOffset,1);
  }finally{globalThis.fetch=original;}
});
