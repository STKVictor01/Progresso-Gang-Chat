import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { installMusic } from './music.js';

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
