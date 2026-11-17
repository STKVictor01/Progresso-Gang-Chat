import { spawn, execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { AccessToken } from 'livekit-server-sdk';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const python = process.env.PG_CHAT_PYTHON || (process.platform==='win32' ? join(root, '.tools', 'music-venv', 'Scripts', 'python.exe') : '/usr/bin/python3');
const worker = join(root, 'server', 'music_worker.py');
// Capas só de hosts conhecidos do YouTube e do SoundCloud; o servidor as repassa ao site.
export function coverUrl(value) {
  if (typeof value !== 'string' || value.length > 500) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    return /^(i\d?\.ytimg\.com|yt\d\.ggpht\.com|i\d\.sndcdn\.com)$/.test(url.hostname) ? url.href : null;
  } catch { return null; }
}
function videoId(value) {
  if (typeof value !== 'string' || value.length > 1000) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    let id;
    if (url.hostname === 'youtu.be') id = url.pathname.slice(1);
    else if (['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com'].includes(url.hostname)) {
      if (url.pathname === '/watch') id = url.searchParams.get('v');
      else id = url.pathname.match(/^\/(?:shorts|live)\/([^/]+)$/)?.[1];
    }
    return /^[a-zA-Z0-9_-]{11}$/.test(id || '') ? id : null;
  } catch { return null; }
}
export function parseMusicInput(value) {
  if (typeof value !== 'string') return null;
  const text=value.trim();
  if (!text || text.length>1000 || /[\u0000-\u001f\u007f]/.test(text)) return null;
  const id=videoId(text);
  if (id) return {url:'https://www.youtube.com/watch?v='+id};
  if (text.length>200 || /^[a-z][a-z0-9+.-]*:\/\//i.test(text) || /^(?:https?|file|data|javascript):/i.test(text) || /^www\./i.test(text) || /^\S+\.\S+\//.test(text)) return null;
  return {query:text};
}
export function musicRoomAvailable(rooms, room, limit) {
  return Boolean(rooms.get(room)?.process || rooms.get(room)?.starting) || [...rooms.values()].filter(player=>player.process || player.starting).length<limit;
}
function terminateMusicProcess(child) {
  if(!child || !child.pid || child.exitCode!==null)return;
  if(process.platform==='win32') execFile('taskkill',['/pid',String(child.pid),'/T','/F'],{windowsHide:true},()=>{});
  else { try { process.kill(-child.pid,'SIGTERM'); } catch { child.kill(); } }
}
export function installMusic(app, { log = app.log, accounts, roomService, apiKey, apiSecret, serverUrl, maxConcurrentRooms=Infinity, fetchImpl=globalThis.fetch, spawnWorker=spawn, terminateWorker=terminateMusicProcess, pythonPath=python, idleMs=300000 }) {
  const rooms = new Map();
  function state(room) { if(!rooms.has(room)) rooms.set(room,{queue:[],current:null,process:null,starting:false,ready:false,startupFailures:0,idleTimer:null,error:'',serial:0}); return rooms.get(room); }
  async function authorize(request,reply) {
    const room=request.params.room;
    if (!(await accounts.voiceExists(room))) { reply.code(400).send({error:'Canal inválido.'});return false; }
    try {
      const members=await roomService.listParticipants(room);
      if (!members.some(member=>member.identity.startsWith(request.user.id+':'))) { reply.code(403).send({error:'Entre nesta call para controlar a música.'});return false; }
      return true;
    } catch { reply.code(503).send({error:'Não foi possível verificar quem está na call.'});return false; }
  }
  function stopProcess(player) {
    const child=player.process; player.serial++; player.process=null; player.starting=false; player.ready=false;
    clearTimeout(player.idleTimer); player.idleTimer=null;
    terminateWorker(child);
  }
  async function next(room) {
    const player=state(room);
    if(player.current || player.starting) return;
    if(!player.queue.length) {
      if(player.process && player.ready && !player.idleTimer) {
        player.idleTimer=setTimeout(()=>{if(!player.current && !player.queue.length)stopProcess(player);},idleMs);
        player.idleTimer.unref();
      }
      return;
    }
    clearTimeout(player.idleTimer); player.idleTimer=null;
    if(player.process) {
      if(!player.ready)return;
      const item=player.queue.shift(); player.current={...item,title:'Carregando…'}; player.error='';
      player.process.stdin.write(JSON.stringify({command:'play',...item})+'\n');
      return;
    }
    player.starting=true;
    const serial=++player.serial;
    try {
      const token=new AccessToken(apiKey,apiSecret,{identity:'music-bot:'+randomUUID(),name:'Música',ttl:'24h'});
      token.addGrant({roomJoin:true,room,canPublish:true,canSubscribe:false});
      const jwt=await token.toJwt();
      if(player.serial!==serial)return;
      if(!player.queue.length){player.starting=false;return;}
      const child=spawnWorker(pythonPath,['-u',worker],{stdio:['pipe','pipe','pipe'],windowsHide:true,detached:process.platform!=='win32'});
      // Os detalhes das falhas do bot ficam nos registros do servidor (docker compose logs api).
      let errors='';child.stderr?.on('data',chunk=>{errors=(errors+chunk.toString()).slice(-4000);const lines=errors.split('\n');errors=lines.pop();for(const line of lines)if(line.trim())log.warn({room},'música: '+line.slice(0,500));});
      player.process=child; player.starting=false; child.stdin.on('error',()=>{});
      child.stdin.write(JSON.stringify({serverUrl,token:jwt})+'\n');
      let buffer='';
      child.stdout.on('data',chunk=>{buffer+=chunk.toString();if(buffer.length>8192)buffer=buffer.slice(-8192);const lines=buffer.split('\n');buffer=lines.pop();for(const line of lines)try{const event=JSON.parse(line);if(player.serial!==serial)continue;if(event.event==='ready'){player.ready=true;player.startupFailures=0;void next(room);}if(event.event==='playing'&&player.current){player.current.title=String(event.title).slice(0,200);player.current.artist=typeof event.artist==='string'?event.artist.slice(0,120):'';player.current.cover=coverUrl(event.cover)||undefined;const id=videoId(event.url);if(id)player.current.url='https://www.youtube.com/watch?v='+id;}if(event.event==='error')player.error=String(event.message).slice(0,200);if(event.event==='disconnected')terminateWorker(child);if(event.event==='finished'){player.current=null;void next(room);}}catch{}});
      child.on('error',()=>{if(player.serial===serial)player.error='O serviço de música não iniciou.';});
      child.on('close',code=>{if(player.serial!==serial)return;if(!player.ready)player.startupFailures++;player.process=null;player.ready=false;clearTimeout(player.idleTimer);player.idleTimer=null;if(player.current){const {title:_title,...item}=player.current;if(!item.retried)player.queue.unshift({...item,retried:true});player.current=null;}if(code && !player.error)player.error='O serviço de música foi interrompido.';if(player.queue.length && child.pid && player.startupFailures<2)void next(room);});
    } catch { if(player.serial===serial){player.starting=false;player.error='Não foi possível iniciar a música.';} }
  }
  // O endereço externo da capa fica no servidor; o site recebe um endereço próprio.
  const publicCurrent = (room, current) => { if (!current) return null; const {cover, ...rest} = current; return cover ? {...rest, cover:'/api/music/'+encodeURIComponent(room)+'/cover?v='+createHash('sha256').update(cover).digest('hex').slice(0,12)} : rest; };
  function snapshot(room) {const p=state(room);return {current:publicCurrent(room,p.current),queue:p.queue,error:p.error,available:existsSync(pythonPath)};}
  // Qualquer pessoa da comunidade vê o que toca em cada call, mesmo fora dela.
  app.get('/music-status',async()=>({rooms:Object.fromEntries([...rooms].filter(([,player])=>player.current&&player.current.title!=='Carregando…').map(([room,player])=>{const {title,artist,cover}=publicCurrent(room,player.current);return [room,{title,artist:artist||'',cover}];}))}));
  const covers = new Map();
  app.get('/music/:room/cover',async(request,reply)=>{
    const source=rooms.get(request.params.room)?.current?.cover;
    if(!source)return reply.code(404).send({error:'Sem capa.'});
    let image=covers.get(source);
    if(!image){
      try {
        const response=await fetchImpl(source,{signal:AbortSignal.timeout(8000),redirect:'error'});
        const type=String(response.headers.get('content-type')||'').split(';')[0];
        if(!response.ok||!['image/jpeg','image/png','image/webp'].includes(type)||Number(response.headers.get('content-length')||0)>2*1024*1024)throw Error('capa');
        const body=Buffer.from(await response.arrayBuffer());if(body.length>2*1024*1024)throw Error('capa');
        image={type,body};covers.set(source,image);while(covers.size>20)covers.delete(covers.keys().next().value);
      } catch { return reply.code(502).send({error:'Capa indisponível.'}); }
    }
    return reply.header('Content-Type',image.type).header('X-Content-Type-Options','nosniff').header('Content-Security-Policy',"default-src 'none'; sandbox").header('Cache-Control','private, max-age=3600').send(image.body);
  });
  app.get('/music/:room',async(request,reply)=>{if(!await authorize(request,reply))return;return snapshot(request.params.room);});
  app.post('/music/:room',{config:{rateLimit:{max:30,timeWindow:'1 minute'}}},async(request,reply)=>{
    if(!await authorize(request,reply))return;
    const item=parseMusicInput(request.body?.url);if(!item)return reply.code(400).send({error:'Digite o nome da música ou um link válido do YouTube.'});
    if(!existsSync(pythonPath))return reply.code(503).send({error:'O serviço de música não está instalado neste computador.'});
    if(!musicRoomAvailable(rooms,request.params.room,maxConcurrentRooms))return reply.code(429).send({error:'O limite de calls com música foi atingido. Tente novamente mais tarde.'});
    const player=state(request.params.room);if(player.queue.length>=20)return reply.code(429).send({error:'A fila está cheia.'});
    player.queue.push(item);void next(request.params.room);return reply.code(202).send(snapshot(request.params.room));
  });
  app.post('/music/:room/:action',async(request,reply)=>{
    if(!await authorize(request,reply))return;
    const player=state(request.params.room),action=request.params.action;
    if(!['skip','stop'].includes(action))return reply.code(400).send({error:'Comando inválido.'});
    if(action==='stop')player.queue=[];
    else if(!player.current)player.queue.shift();
    if(player.current && player.process && player.ready)player.process.stdin.write(JSON.stringify({command:'skip'})+'\n');
    else void next(request.params.room);
    return snapshot(request.params.room);
  });
  app.addHook('onClose',async()=>{for(const player of rooms.values())stopProcess(player);});
}
