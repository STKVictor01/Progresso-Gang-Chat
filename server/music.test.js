import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { installMusic, parseMusicInput, musicRoomAvailable } from './music.js';

test('limite de salas de música preserva filas das calls já em reprodução',()=>{
  const rooms=new Map([['a',{process:{},starting:false}],['b',{process:null,starting:true}]]);
  assert.equal(Boolean(musicRoomAvailable(rooms,'a',2)),true);
  assert.equal(Boolean(musicRoomAvailable(rooms,'c',2)),false);
  rooms.get('b').starting=false;
  assert.equal(Boolean(musicRoomAvailable(rooms,'c',2)),true);
});

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

test('o bot mantém a conexão entre músicas e sai apenas depois de ficar ocioso', async () => {
  const app=Fastify(), children=[];
  app.addHook('onRequest',async request=>{request.user={id:'user-1'};});
  function spawnWorker(){
    const child=new EventEmitter();child.pid=2147483647;child.exitCode=null;child.stdout=new PassThrough();child.commands=[];child.killed=false;
    child.stdin=new Writable({write(chunk,_encoding,callback){child.commands.push(JSON.parse(chunk.toString()));callback();}});
    child.kill=()=>{child.killed=true;};children.push(child);return child;
  }
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const send=(child,event)=>child.stdout.write(JSON.stringify(event)+'\n');
  const post=url=>app.inject({method:'POST',url:'/music/room',payload:{url}});
  installMusic(app,{accounts:{voiceExists:async()=>true},roomService:{listParticipants:async()=>[{identity:'user-1:session'}]},apiKey:'test',apiSecret:'secret',serverUrl:'ws://localhost:7880',spawnWorker,terminateWorker:child=>{if(child)child.killed=true;},pythonPath:process.execPath,idleMs:120});
  try {
    assert.equal((await post('Primeira')).statusCode,202);
    for(let i=0;i<50&&!children.length;i++)await wait(5);
    assert.equal(children.length,1);
    const child=children[0];send(child,{event:'ready'});await wait(10);
    assert.equal(child.commands[1].query,'Primeira');
    await post('Segunda');
    send(child,{event:'finished'});await wait(10);
    assert.equal(children.length,1);assert.equal(child.commands[2].query,'Segunda');
    await wait(150);assert.equal(child.killed,false);
    send(child,{event:'finished'});await wait(60);assert.equal(child.killed,false);
    await post('Terceira');await wait(10);assert.equal(child.commands[3].query,'Terceira');
    await wait(150);assert.equal(child.killed,false);
    send(child,{event:'finished'});await wait(160);assert.equal(child.killed,true);
  } finally {await app.close();}
});
