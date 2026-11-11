import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { installMusic, parseMusicInput } from './music.js';

test('aceita pesquisa por nome e valida links antes de acionar o bot', () => {
  assert.deepEqual(parseMusicInput('  Clube da Esquina  '), {query:'Clube da Esquina'});
  assert.deepEqual(parseMusicInput('AC/DC - Thunderstruck'), {query:'AC/DC - Thunderstruck'});
  assert.deepEqual(parseMusicInput('Legião Urbana: Tempo Perdido'), {query:'Legião Urbana: Tempo Perdido'});
  assert.deepEqual(parseMusicInput('https://youtu.be/dQw4w9WgXcQ?t=2'), {url:'https://www.youtube.com/watch?v=dQw4w9WgXcQ'});
  for (const value of ['', 'https://example.com/a', 'http://localhost:8080', 'file:///local', 'https://youtube.com/watch?v=invalid', 'a'.repeat(201)]) assert.equal(parseMusicInput(value),null);
});

test('música exige participante na call e rejeita links fora do YouTube', async () => {
  let members=[];
  const app=Fastify();
  app.addHook('onRequest',async request=>{request.user={id:'user-1'};});
  installMusic(app,{accounts:{voiceExists:async id=>id==='room'},roomService:{listParticipants:async()=>members},apiKey:'test',apiSecret:'secret',serverUrl:'ws://localhost:7880'});
  try {
    assert.equal((await app.inject({method:'POST',url:'/music/room',payload:{url:'https://www.youtube.com/watch?v=dQw4w9WgXcQ'}})).statusCode,403);
    members=[{identity:'user-1:session'}];
    for (const url of ['http://youtube.com/watch?v=dQw4w9WgXcQ','https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ','https://127.0.0.1/','https://youtube.com/watch?v=invalid']) {
      assert.equal((await app.inject({method:'POST',url:'/music/room',payload:{url}})).statusCode,400);
    }
    assert.equal((await app.inject({method:'POST',url:'/music/room/unknown',payload:{}})).statusCode,400);
    assert.equal((await app.inject({method:'GET',url:'/music/outro'})).statusCode,400);
  } finally {await app.close();}
});
