import { spawn, execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { AccessToken } from 'livekit-server-sdk';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const python = join(root, '.tools', 'music-venv', 'Scripts', 'python.exe');
const worker = join(root, 'server', 'music_worker.py');
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
export function installMusic(app, { accounts, roomService, apiKey, apiSecret, serverUrl }) {
  const rooms = new Map();
  function state(room) { if(!rooms.has(room)) rooms.set(room,{queue:[],current:null,process:null,starting:false,error:'',serial:0}); return rooms.get(room); }
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
    const child=player.process; player.serial++; player.process=null; player.starting=false;
    if(child && child.pid && child.exitCode===null) {
      if(process.platform==='win32') execFile('taskkill',['/pid',String(child.pid),'/T','/F'],{windowsHide:true},()=>{});
      else { try { process.kill(-child.pid,'SIGTERM'); } catch { child.kill(); } }
    }
  }
  async function next(room) {
    const player=state(room);
    if(player.process || player.starting || !player.queue.length) { if (!player.process && !player.starting) player.current=null;return; }
    player.starting=true; const item=player.queue.shift(); player.current={...item,title:'Carregando…'}; player.error='';
    const serial=++player.serial;
    try {
      const token=new AccessToken(apiKey,apiSecret,{identity:'music-bot:'+randomUUID(),name:'Música',ttl:'12h'});
      token.addGrant({roomJoin:true,room,canPublish:true,canSubscribe:false});
      const jwt=await token.toJwt();
      if(player.serial!==serial)return;
      const child=spawn(python,['-u',worker],{stdio:['pipe','pipe','ignore'],windowsHide:true,detached:process.platform!=='win32'});
      player.process=child; player.starting=false; child.stdin.on('error',()=>{});
      child.stdin.end(JSON.stringify({...item,serverUrl,token:jwt})+'\n');
      let buffer='';
      child.stdout.on('data',chunk=>{buffer+=chunk.toString();if(buffer.length>8192)buffer=buffer.slice(-8192);const lines=buffer.split('\n');buffer=lines.pop();for(const line of lines)try{const event=JSON.parse(line);if(player.serial!==serial)continue;if(event.event==='playing'&&player.current){player.current.title=String(event.title).slice(0,200);const id=videoId(event.url);if(id)player.current.url='https://www.youtube.com/watch?v='+id;}if(event.event==='error')player.error=event.message;}catch{}});
      child.on('error',()=>{if(player.serial===serial)player.error='O serviço de música não iniciou.';});
      child.on('close',code=>{if(player.serial!==serial)return;player.process=null;player.current=null;if(code && !player.error)player.error='Não foi possível reproduzir esse link.';void next(room);});
    } catch { if(player.serial===serial){player.starting=false;player.current=null;player.error='Não foi possível iniciar a música.';void next(room);} }
  }
  function snapshot(room) {const p=state(room);return {current:p.current,queue:p.queue,error:p.error,available:existsSync(python)};}
  app.get('/music/:room',async(request,reply)=>{if(!await authorize(request,reply))return;return snapshot(request.params.room);});
  app.post('/music/:room',async(request,reply)=>{
    if(!await authorize(request,reply))return;
    const item=parseMusicInput(request.body?.url);if(!item)return reply.code(400).send({error:'Digite o nome da música ou um link válido do YouTube.'});
    if(!existsSync(python))return reply.code(503).send({error:'O serviço de música não está instalado neste computador.'});
    const player=state(request.params.room);if(player.queue.length>=20)return reply.code(429).send({error:'A fila está cheia.'});
    player.queue.push(item);void next(request.params.room);return reply.code(202).send(snapshot(request.params.room));
  });
  app.post('/music/:room/:action',async(request,reply)=>{
    if(!await authorize(request,reply))return;
    const player=state(request.params.room),action=request.params.action;
    if(!['skip','stop'].includes(action))return reply.code(400).send({error:'Comando inválido.'});
    if(action==='stop')player.queue=[];
    stopProcess(player);player.current=null;
    if(action==='skip')void next(request.params.room);
    return snapshot(request.params.room);
  });
  const idleCheck=setInterval(()=>{for(const [room,player] of rooms) {
    if (!player.process && !player.starting) continue;
    void roomService.listParticipants(room).then(members=>{
      if (!members.some(member=>!member.identity.startsWith('music-bot:'))) { player.queue=[];stopProcess(player);player.current=null; }
    }).catch(()=>{});
  }},15000);
  idleCheck.unref();
  app.addHook('onClose',async()=>{clearInterval(idleCheck);for(const player of rooms.values())stopProcess(player);});
}
