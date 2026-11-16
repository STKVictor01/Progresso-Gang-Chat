import Fastify from 'fastify';
import cors from '@fastify/cors';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import { createHash, randomUUID } from 'node:crypto';
import { sqliteDatabase, postgresDatabase } from './database.js';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import sharp from 'sharp';
import { installAccounts } from './accounts.js';
import { normalizeSoundboardWav } from './soundboard-audio.js';
import { createActivityLog } from './activity-log.js';
import { installMusic } from './music.js';

export const VOICE_CHANNELS = [{ id: 'geral', name: 'Geral' }, { id: 'jogatina', name: 'Jogatina' }];
export const MESSAGE_CHANNELS = ['general', 'voice:geral', 'voice:jogatina'];
export const HEALTH_VERSION = 22;
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export const MAX_GENERAL_UPLOAD_BYTES = 100 * 1024 * 1024;
const MAX_PIXELS = 20_000_000;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const validName = name => typeof name === 'string' && name.trim().length >= 2 && name.trim().length <= 32;
const GIF_ID = /^[A-Za-z0-9]{1,64}$/;
const GIF_PAGE = 24;
// Cores muito escuras somem no fundo do chat: exige contraste mínimo de 3:1 com o fundo.
export function readableNameColor(value) {
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) return false;
  const [r,g,b] = [1,3,5].map(index => parseInt(value.slice(index,index+2),16)/255).map(c => c <= 0.03928 ? c/12.92 : ((c+0.055)/1.055)**2.4);
  return 0.2126*r + 0.7152*g + 0.0722*b >= 0.13;
}
function imageSignature(buffer) {
  if (buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'png';
  if (buffer[0]===255 && buffer[1]===216 && buffer[2]===255) return 'jpeg';
  if (['GIF87a','GIF89a'].includes(buffer.subarray(0,6).toString('ascii'))) return 'gif';
  if (buffer.subarray(0,4).toString('ascii')==='RIFF' && buffer.subarray(8,12).toString('ascii')==='WEBP') return 'webp';
  return null;
}
function uploadName(value) {
  let name='';try { name=decodeURIComponent(typeof value==='string'?value:''); } catch { return 'arquivo'; }
  return name.replace(/[\x00-\x1f\x7f/\\]/g,'').trim().slice(0,150) || 'arquivo';
}
function dispositionName(name) {
  return encodeURIComponent(name).replace(/[!'()*]/g,char=>'%'+char.charCodeAt(0).toString(16).toUpperCase());
}
export async function createApp({ dbPath, databaseUrl, certificatePath, schema, apiKey, apiSecret, serverUrl, internalServerUrl = serverUrl, logger = true, activityLogPath, maxMediaStorageBytes = 512 * 1024 * 1024, ownerSetupToken, ownerSetupExpiresAt, secureCookies = true, allowedOrigins = ['http://localhost:5173', 'https://' + new URL(serverUrl).hostname], trustProxy = false, requireExistingOwner = false, musicMaxRooms = Infinity, authProvider, onOwnerReady, startupCleanup = true, gifApiKey, fetchImpl = globalThis.fetch, roomService = new RoomServiceClient(internalServerUrl.replace(/^ws/, 'http'), apiKey, apiSecret, { requestTimeout: 3 }) }) {
  if (!databaseUrl && dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
  const db = databaseUrl ? postgresDatabase(databaseUrl,certificatePath,schema) : sqliteDatabase(dbPath);
  if(requireExistingOwner) {
    try {if(db.kind!=='postgres' || !(await db.prepare('SELECT id FROM users WHERE is_owner=1').get()))throw Error('Produção exige o banco existente com a conta proprietária.');}
    catch(error){await db.close();throw error;}
  }
  if (db.kind==='sqlite') {
  (await db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT, client_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL, text TEXT NOT NULL, timestamp INTEGER NOT NULL
    );`));
  if (!(await db.prepare('PRAGMA table_info(messages)').all()).some(column=>column.name==='channel')) (await db.exec("ALTER TABLE messages ADD COLUMN channel TEXT NOT NULL DEFAULT 'general'"));
  (await db.exec(`CREATE INDEX IF NOT EXISTS messages_channel_id ON messages(channel,id);
    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY, request_hash TEXT NOT NULL, mime TEXT NOT NULL,
      width INTEGER NOT NULL, height INTEGER NOT NULL, size INTEGER NOT NULL,
      animated INTEGER NOT NULL, data BLOB NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS message_attachments (
      message_id INTEGER NOT NULL REFERENCES messages(id),
      attachment_id TEXT NOT NULL UNIQUE REFERENCES attachments(id),
      position INTEGER NOT NULL,
      PRIMARY KEY(message_id,attachment_id)
    );
    CREATE TABLE IF NOT EXISTS profiles (user_id TEXT PRIMARY KEY, description TEXT NOT NULL DEFAULT '', avatar_id TEXT REFERENCES attachments(id));
    CREATE TABLE IF NOT EXISTS soundboard (id TEXT PRIMARY KEY, channel TEXT NOT NULL, name TEXT NOT NULL, owner_id TEXT NOT NULL, data BLOB NOT NULL, created_at INTEGER NOT NULL);`));
  }
  const mediaFields = 'a.id,a.mime,a.width,a.height,a.size,a.animated,a.filename';
  const messageMedia = db.prepare(`SELECT ${mediaFields} FROM attachments a JOIN message_attachments ma ON ma.attachment_id=a.id WHERE ma.message_id=? ORDER BY ma.position`);
  const serializeMedia = media => ({ ...media, animated: Boolean(media.animated), url: '/api/media/'+media.id, posterUrl: media.animated ? '/api/media/'+media.id+'?still=1' : undefined });
  const serializeMessage = async (message,user) => (await serializeMessages([message],user))[0];
  async function serializeMessages(messages,user) {
    if (!messages.length) return [];
    const ids=messages.map(message=>message.id), placeholders=ids.map(()=>'?').join(',');
    const media=await db.prepare(`SELECT ma.message_id,${mediaFields} FROM attachments a JOIN message_attachments ma ON ma.attachment_id=a.id WHERE ma.message_id IN (${placeholders}) ORDER BY ma.message_id,ma.position`).all(...ids);
    const grouped=new Map();
    for(const item of media){const {message_id,...data}=item;if(!grouped.has(message_id))grouped.set(message_id,[]);grouped.get(message_id).push(serializeMedia(data));}
    const replyIds=[...new Set(messages.map(message=>message.reply_to_id).filter(id=>id!=null))];
    const replies=replyIds.length?await db.prepare(`SELECT id,name,text,user_id,deleted_at FROM messages WHERE id IN (${replyIds.map(()=>'?').join(',')})`).all(...replyIds):[];
    const byId=new Map(replies.map(reply=>[reply.id,reply]));
    return messages.map(message=>{const reply=byId.get(message.reply_to_id);return {...message,reply:reply?(reply.deleted_at?{id:reply.id,deleted:true}:{id:reply.id,name:reply.name,text:reply.text,user_id:reply.user_id,deleted:false}):null,canDelete:user.role==='admin'||message.user_id===user.id,attachments:grouped.get(message.id)||[]};});
  }
  const cleanAbandoned = async () => (await db.prepare('DELETE FROM attachments WHERE created_at < ? AND id NOT IN (SELECT attachment_id FROM message_attachments) AND id NOT IN (SELECT avatar_id FROM profiles WHERE avatar_id IS NOT NULL)').run(Date.now()-86400000));
  if (startupCleanup) await cleanAbandoned();
  const app = Fastify({ logger, bodyLimit: 16384, trustProxy });
  const activity=createActivityLog(activityLogPath);
  app.addHook('onReady',async()=>activity.record('server-start'));
  app.addHook('onResponse',async(request,reply)=>{if(reply.statusCode>=500)activity.record('server-error',{route:request.routeOptions.url,status:reply.statusCode});});
  app.addHook('onClose',async()=>activity.record('server-stop'));
  app.addContentTypeParser('application/octet-stream', { parseAs:'buffer', bodyLimit:MAX_GENERAL_UPLOAD_BYTES }, (_request,body,done)=>done(null,body));
  app.addHook('onClose', async () => db.close());
  await app.register(cors, { origin: allowedOrigins });
  const accounts = await installAccounts(app,db,{ownerSetupToken,ownerSetupExpiresAt,secureCookies,allowedOrigins,onOwnerReady,recordEvent:activity.record,authProvider,startupCleanup});
  installMusic(app, {accounts, roomService, apiKey, apiSecret, serverUrl:internalServerUrl, maxConcurrentRooms:musicMaxRooms});
  if (db.kind==='sqlite') {
  const columns = (await db.prepare('PRAGMA table_info(messages)').all());
  if (!columns.some(c=>c.name==='user_id')) (await db.exec('ALTER TABLE messages ADD COLUMN user_id TEXT REFERENCES users(id)'));
  if (!columns.some(c=>c.name==='deleted_at')) (await db.exec('ALTER TABLE messages ADD COLUMN deleted_at INTEGER'));
  if (!columns.some(c=>c.name==='reply_to_id')) (await db.exec('ALTER TABLE messages ADD COLUMN reply_to_id INTEGER REFERENCES messages(id)'));
  await db.exec('CREATE INDEX IF NOT EXISTS messages_reply_to_id_idx ON messages(reply_to_id)');
  if (!(await db.prepare('PRAGMA table_info(attachments)').all()).some(c=>c.name==='owner_id')) (await db.exec('ALTER TABLE attachments ADD COLUMN owner_id TEXT REFERENCES users(id)'));
  if (!(await db.prepare('PRAGMA table_info(attachments)').all()).some(c=>c.name==='filename')) (await db.exec("ALTER TABLE attachments ADD COLUMN filename TEXT NOT NULL DEFAULT ''"));
  (await db.exec(`CREATE TABLE IF NOT EXISTS message_events (seq INTEGER PRIMARY KEY AUTOINCREMENT,message_id INTEGER NOT NULL,channel TEXT NOT NULL,kind TEXT NOT NULL,UNIQUE(message_id,kind));
    CREATE INDEX IF NOT EXISTS message_events_channel_seq ON message_events(channel,seq);
    INSERT OR IGNORE INTO message_events(message_id,channel,kind) SELECT id,channel,'created' FROM messages;`));
  const profileColumns=(await db.prepare('PRAGMA table_info(profiles)').all()).map(c=>c.name);
  if (!profileColumns.includes('name_color')) (await db.exec('ALTER TABLE profiles ADD COLUMN name_color TEXT'));
  if (!profileColumns.includes('status_text')) (await db.exec("ALTER TABLE profiles ADD COLUMN status_text TEXT NOT NULL DEFAULT ''"));
  }
  // No PostgreSQL as colunas vêm da migração; até ela ser aplicada, a cor do nick e o status ficam desativados.
  const profileColumn = async name => db.kind==='sqlite' || Boolean(await db.prepare("SELECT 1 AS ok FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='profiles' AND column_name=?").get(name));
  const nameColors = await profileColumn('name_color'), statuses = await profileColumn('status_text');
  // The launcher compares this version to restart a backend left running from before an update.
  app.get('/health', async () => ({ status:'online', application:'progresso-gang-chat', version:HEALTH_VERSION, features:['accounts'], database:db.kind, pid:process.pid }));
  app.get('/ready', async (_request,reply) => {try {await db.prepare('SELECT 1 AS ok').get();return {ready:true};} catch {return reply.code(503).send({ready:false});}});
  app.get('/admin/logs',async()=>({events:activity.list()}));
  app.get('/soundboard', async (request,reply) => {
    const {channel}=request.query;
    if (typeof channel!=='string'||!(await accounts.voiceExists(channel))) return reply.code(400).send({error:'Canal inválido.'});
    return {sounds:(await db.prepare('SELECT id,name,owner_id FROM soundboard WHERE channel=? ORDER BY created_at,id').all(channel)).map(sound=>({id:sound.id,name:sound.name,canDelete:request.user.role==='admin'||sound.owner_id===request.user.id}))};
  });
  app.post('/soundboard', {bodyLimit:441044}, async (request,reply) => {
    const channel=request.headers['x-sound-channel'], encodedName=request.headers['x-sound-name'];
    let name; try { name=decodeURIComponent(encodedName || '').trim(); } catch { return reply.code(400).send({error:'Nome inválido.'}); }
    if(typeof channel!=='string'||!(await accounts.voiceExists(channel))||name.length<1||name.length>40) return reply.code(400).send({error:'Informe o nome e o canal do áudio.'});
    const b=request.body;
    if(!Buffer.isBuffer(b)||b.length<46||b.length>441044||b.toString('ascii',0,4)!=='RIFF'||b.readUInt32LE(4)!==b.length-8||b.toString('ascii',8,16)!=='WAVEfmt '||b.readUInt32LE(16)!==16||b.readUInt16LE(20)!==1||b.readUInt16LE(22)!==1||b.readUInt32LE(24)!==22050||b.readUInt32LE(28)!==44100||b.readUInt16LE(32)!==2||b.readUInt16LE(34)!==16||b.toString('ascii',36,40)!=='data'||b.readUInt32LE(40)!==b.length-44||(b.length-44)%2!==0) return reply.code(400).send({error:'Áudio inválido ou com mais de 10 segundos.'});
    const id=randomUUID();
    const saved=await db.transaction(async()=>{
      await db.lock('soundboard:'+channel);
      if((await db.prepare('SELECT COUNT(*) n FROM soundboard WHERE channel=?').get(channel)).n>=50)return false;
      await db.prepare('INSERT INTO soundboard VALUES(?,?,?,?,?,?)').run(id,channel,name,request.user.id,b,Date.now());return true;
    });
    if(!saved)return reply.code(409).send({error:'Este canal já tem 50 sons.'});
    return reply.code(201).send({id,name,canDelete:true});
  });
  app.get('/soundboard/:id', async (request,reply) => {
    const {id}=request.params, {channel}=request.query;
    if(!UUID.test(id)||typeof channel!=='string'||!(await accounts.voiceExists(channel))) return reply.code(404).send({error:'Som não encontrado.'});
    const sound=(await db.prepare('SELECT data FROM soundboard WHERE id=? AND channel=?').get(id,channel));
    if(!sound)return reply.code(404).send({error:'Som não encontrado.'});
    return reply.header('Content-Type','audio/wav').header('Content-Security-Policy',"default-src 'none'; sandbox").send(normalizeSoundboardWav(sound.data));
  });
  app.delete('/soundboard/:id', async (request,reply) => {
    const sound=(await db.prepare('SELECT owner_id FROM soundboard WHERE id=?').get(request.params.id));
    if(!sound)return reply.code(404).send({error:'Som não encontrado.'});
    if(sound.owner_id!==request.user.id&&request.user.role!=='admin')return reply.code(403).send({error:'Você só pode excluir os próprios sons.'});
    (await db.prepare('DELETE FROM soundboard WHERE id=?').run(request.params.id)); activity.record('sound-delete',{actor:request.user.username});return {ok:true};
  });
  app.post('/token', {config:{rateLimit:{max:30,timeWindow:'1 minute'}}}, async (request,reply) => {
    const {room='geral'}=request.body??{};
    if(typeof room!=='string'||!(await accounts.voiceExists(room))) return reply.code(400).send({error:'Canal de voz inválido.'});
    const token=new AccessToken(apiKey,apiSecret,{identity:request.user.id+':'+randomUUID(),name:request.user.username,metadata:JSON.stringify({userId:request.user.id}),ttl:'10m'});
    token.addGrant({roomJoin:true,room,canPublish:true,canSubscribe:true});
    return {token:await token.toJwt(),serverUrl,room};
  });
  let generalUploadBusy=false;
  app.post('/uploads', {bodyLimit:MAX_GENERAL_UPLOAD_BYTES,config:{rateLimit:{max:30,timeWindow:'1 minute'}},onRequest:async(request,reply)=>{
    if(generalUploadBusy)return reply.code(429).send({error:'Aguarde o envio em andamento e tente novamente.'});
    generalUploadBusy=true;reply.raw.once('close',()=>{generalUploadBusy=false;});
  }}, async (request,reply) => {
    const id=request.headers['x-upload-id'];
    const buffer=request.body;
    if(typeof id!=='string'||!UUID.test(id)||!Buffer.isBuffer(buffer)||!buffer.length) return reply.code(400).send({error:'Selecione uma imagem ou GIF válido.'});
    const uploadChannel=request.headers['x-upload-channel'];
    if(uploadChannel && (typeof uploadChannel !== 'string' || !(await accounts.conversationExists(uploadChannel)))) return reply.code(400).send({error:'Canal inválido.'});
    const limit=uploadChannel?MAX_GENERAL_UPLOAD_BYTES:MAX_UPLOAD_BYTES;
    if(buffer.length>limit)return reply.code(413).send({error:`A imagem deve ter até ${limit===MAX_GENERAL_UPLOAD_BYTES?100:8} MB.`});
    const result=await storeMedia({id,buffer,user:request.user,limit,general:Boolean(uploadChannel),filename:uploadName(request.headers['x-upload-name'])});
    return result.error?reply.code(result.status).send({error:result.error}):reply.code(result.status).send(serializeMedia(result.media));
  });
  // Valida, normaliza e guarda um anexo do usuário. Usado pelos envios e pelos GIFs da biblioteca.
  async function storeMedia({id,buffer,user,limit,general,filename}) {
    const format=imageSignature(buffer);
    if(!format&&!general) return {status:415,error:'Use PNG, JPG, WebP ou GIF. Outros arquivos não são aceitos neste canal.'};
    const requestHash=createHash('sha256').update(buffer).digest('hex');
    const previous=(await db.prepare(`SELECT ${mediaFields},a.request_hash FROM attachments a WHERE id=? AND owner_id=?`).get(id,user.id));
    if(previous){
      if(previous.request_hash!==requestHash) return {status:409,error:'Esse identificador já pertence a outro arquivo.'};
      const {request_hash,...metadata}=previous;return {status:200,media:metadata};
    }
    let normalized=buffer, metadata={width:0,height:0,pages:1};
    if(format)try{
      const input=sharp(buffer,{animated:true,failOn:'error',limitInputPixels:MAX_PIXELS});
      metadata=await input.metadata();
      const height=metadata.pageHeight||metadata.height;
      if(metadata.format!==format||!metadata.width||!height||(metadata.pages||1)>200||metadata.width*height*(metadata.pages||1)>MAX_PIXELS) return {status:413,error:'Essa imagem ou animação é grande demais. Envie uma versão menor.'};
      const animation={loop:metadata.loop,delay:metadata.delay};
      const pipeline=format==='jpeg'?input.rotate().jpeg({quality:90}):format==='png'?input.png():format==='gif'?input.gif(animation):input.webp({quality:90,...animation});
      normalized=await pipeline.toBuffer();
      metadata=await sharp(normalized,{animated:true,limitInputPixels:MAX_PIXELS}).metadata();
    }catch{return {status:415,error:'Não foi possível ler essa imagem. O arquivo pode estar incompleto ou inválido.'};}
    if(normalized.length>limit) return {status:413,error:`A imagem processada excede ${limit===MAX_GENERAL_UPLOAD_BYTES?100:8} MB. Envie uma versão menor.`};
    await cleanAbandoned();
    const media={id,mime:format?'image/'+format:'application/octet-stream',width:metadata.width,height:metadata.pageHeight||metadata.height,size:normalized.length,animated:(metadata.pages||1)>1,filename};
    return db.transaction(async()=>{
      await db.lock('attachments');
      const raced=await db.prepare(`SELECT ${mediaFields},a.request_hash FROM attachments a WHERE id=? AND owner_id=?`).get(id,user.id);
      if(raced){if(raced.request_hash!==requestHash)return {status:409,error:'Identificador de arquivo já utilizado.'};const{request_hash,...meta}=raced;return {status:200,media:meta};}
      const used=Number((await db.prepare('SELECT COALESCE(SUM(size),0) AS bytes FROM attachments').get()).bytes);
      if(used+normalized.length>maxMediaStorageBytes)return {status:507,error:'O espaço reservado para imagens neste servidor está cheio. Avise o responsável pelo PC.'};
      if(await db.prepare('SELECT id FROM attachments WHERE id=?').get(id))return {status:409,error:'Identificador de arquivo já utilizado.'};
      await db.prepare('INSERT INTO attachments(id,request_hash,mime,width,height,size,animated,data,created_at,owner_id,filename) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,requestHash,media.mime,media.width,media.height,media.size,Number(media.animated),normalized,Date.now(),user.id,media.filename);
      return {status:201,media};
    });
  }
  // Biblioteca de GIFs (GIPHY). A chave fica só no servidor; o navegador recebe apenas prévias públicas.
  async function giphy(path,params) {
    const url=new URL('https://api.giphy.com/v1/gifs'+path);
    url.searchParams.set('api_key',gifApiKey);
    for(const [key,value] of Object.entries(params))url.searchParams.set(key,String(value));
    const response=await fetchImpl(url,{signal:AbortSignal.timeout(8000)});
    if(!response.ok)throw Error('GIPHY respondeu '+response.status);
    return response.json();
  }
  const giphyMedia=value=>{try{const url=new URL(value);return url.protocol==='https:'&&/(^|\.)giphy\.com$/.test(url.hostname)&&!url.username&&!url.password?url:null;}catch{return null;}};
  function serializeGif(gif) {
    const preview=gif?.images?.fixed_width_downsampled||gif?.images?.fixed_width;
    const url=giphyMedia(preview?.webp||preview?.url);
    if(typeof gif?.id!=='string'||!GIF_ID.test(gif.id)||!url)return null;
    return {id:gif.id,title:typeof gif.title==='string'&&gif.title.trim()?gif.title.trim().slice(0,120):'GIF',previewUrl:url.href,width:Number(preview.width)||200,height:Number(preview.height)||200};
  }
  app.get('/gifs', {config:{rateLimit:{max:60,timeWindow:'1 minute'}}}, async (request,reply) => {
    if(!gifApiKey)return reply.code(503).send({error:'A biblioteca de GIFs ainda não foi configurada no servidor.'});
    const {q='',offset='0'}=request.query;
    if(typeof q!=='string'||q.length>50||typeof offset!=='string'||!/^\d{1,4}$/.test(offset))return reply.code(400).send({error:'Busca inválida.'});
    const query=q.trim(), start=Number(offset);
    try{
      const data=await giphy(query?'/search':'/trending',{...(query?{q:query,lang:'pt'}:{}),limit:GIF_PAGE,offset:start,rating:'pg-13'});
      const gifs=(Array.isArray(data?.data)?data.data:[]).map(serializeGif).filter(Boolean);
      const count=Number(data?.pagination?.count)||0, total=Number(data?.pagination?.total_count)||0;
      return {gifs,nextOffset:count&&start+count<Math.min(total,4999)?start+count:null};
    }catch{return reply.code(502).send({error:'Não foi possível buscar GIFs agora. Tente novamente.'});}
  });
  app.post('/gifs/:gifId', {config:{rateLimit:{max:20,timeWindow:'1 minute'}}}, async (request,reply) => {
    if(!gifApiKey)return reply.code(503).send({error:'A biblioteca de GIFs ainda não foi configurada no servidor.'});
    const {gifId}=request.params, {id,channel}=request.body??{};
    if(!GIF_ID.test(gifId)||typeof id!=='string'||!UUID.test(id)||typeof channel!=='string'||!(await accounts.conversationExists(channel)))return reply.code(400).send({error:'GIF ou canal inválido.'});
    let buffer;
    try{
      const gif=(await giphy('/'+gifId,{}))?.data;
      const source=giphyMedia(gif?.images?.downsized?.url||gif?.images?.fixed_height?.url);
      if(!source)return reply.code(404).send({error:'GIF não encontrado.'});
      const response=await fetchImpl(source,{signal:AbortSignal.timeout(15000),redirect:'error'});
      if(!response.ok||Number(response.headers.get('content-length')||0)>MAX_UPLOAD_BYTES)throw Error('download');
      buffer=Buffer.from(await response.arrayBuffer());
    }catch{return reply.code(502).send({error:'Não foi possível baixar esse GIF. Tente outro.'});}
    if(buffer.length>MAX_UPLOAD_BYTES)return reply.code(413).send({error:'Esse GIF é grande demais. Tente outro.'});
    const result=await storeMedia({id,buffer,user:request.user,limit:MAX_UPLOAD_BYTES,general:false,filename:'gif.gif'});
    return result.error?reply.code(result.status).send({error:result.error}):reply.code(result.status).send(serializeMedia(result.media));
  });
  let largeDownloads=0;
  app.get('/media/:id', async (request,reply) => {
    const {id}=request.params;
    if(!UUID.test(id)) return reply.code(404).send({error:'Imagem não encontrada.'});
    const size=(await db.prepare('SELECT size FROM attachments WHERE id=?').get(id))?.size;
    if(size>MAX_UPLOAD_BYTES){
      if(largeDownloads>=2)return reply.code(429).send({error:'Muitos downloads em andamento. Tente novamente em instantes.'});
      largeDownloads++;reply.raw.once('close',()=>{largeDownloads--;});
    }
    const media=(await db.prepare('SELECT a.mime,a.data,a.animated,a.filename FROM attachments a WHERE a.id=? AND (EXISTS (SELECT 1 FROM message_attachments ma WHERE ma.attachment_id=a.id) OR EXISTS (SELECT 1 FROM profiles p WHERE p.avatar_id=a.id))').get(id));
    if(!media)return reply.code(404).send({error:'Imagem não encontrada.'});
    let body=Buffer.from(media.data);
    let mime=media.mime;
    if(request.query.still==='1'&&media.animated){body=await sharp(body,{limitInputPixels:MAX_PIXELS}).png().toBuffer();mime='image/png';}
    const extension=mime==='image/jpeg'?'jpg':mime.split('/')[1];
    const disposition=mime.startsWith('image/')?`inline; filename="imagem.${extension}"`:`attachment; filename="arquivo"; filename*=UTF-8''${dispositionName(media.filename || 'arquivo')}`;
    return reply.header('Content-Type',mime).header('X-Content-Type-Options','nosniff').header('Content-Security-Policy',"default-src 'none'; sandbox").header('Content-Disposition',disposition).header('Cache-Control','no-store').send(body);
  });
  const online = new Map();
  let voiceSnapshot, voiceSnapshotAt = 0, voiceRequest, lastVoiceMembers;
  async function getVoicePresence() {
    const voiceChannels = await db.prepare("SELECT id,name FROM channels WHERE kind='voice'").all();
    const channelIds = voiceChannels.map(channel=>channel.id);
      if (!voiceSnapshot || Date.now()-voiceSnapshotAt > 3000) {
        voiceRequest ??= (async () => {
          const rooms = channelIds.length ? await roomService.listRooms(channelIds) : [];
          const entries = await Promise.all(rooms.filter(room=>channelIds.includes(room.name)).map(async room=>[room.name,(await roomService.listParticipants(room.name)).map(participant=>participant.identity.split(':')[0])]));
          voiceSnapshot = Object.fromEntries(entries); voiceSnapshotAt = Date.now();
        })().finally(()=>{voiceRequest=undefined;});
        await voiceRequest;
      }
      const users = new Map((await db.prepare('SELECT id,username FROM users WHERE active=1').all()).map(user=>[user.id,user.username]));
      const channels=Object.fromEntries(channelIds.map(id=>[id,[...new Set((voiceSnapshot[id] || []).filter(userId=>users.has(userId)))]]));
      const current=new Map(voiceChannels.flatMap(channel=>channels[channel.id].map(id=>[channel.id+':'+id,{actor:users.get(id),channel:channel.name}])));
      if(lastVoiceMembers){for(const [key,person] of current)if(!lastVoiceMembers.has(key))activity.record('voice-join',person);for(const [key,person] of lastVoiceMembers)if(!current.has(key))activity.record('voice-leave',person);}
      lastVoiceMembers=current;
      return {channels};
  }
  app.get('/voice-presence', async (_request,reply) => {
    reply.header('Cache-Control','no-store');
    try { return await getVoicePresence(); }
    catch { return reply.code(503).send({error:'Não foi possível consultar os canais de voz.'}); }
  });
  if(activityLogPath){let timer;app.addHook('onReady',async()=>{void getVoicePresence().catch(()=>{});timer=setInterval(()=>void getVoicePresence().catch(()=>{}),5000);timer.unref();});app.addHook('onClose',async()=>clearInterval(timer));}
  app.get('/presence', async request => {
    const now = Date.now();
    online.set(request.user.id, now);
    for (const [id, seen] of online) if (now-seen > 45000) online.delete(id);
    const rows = (await db.prepare(`SELECT u.id,u.username,u.active,p.description,p.avatar_id${nameColors?',p.name_color':''}${statuses?',p.status_text':''} FROM users u LEFT JOIN profiles p ON p.user_id=u.id`).all());
    const serializeProfile = user => ({ id:user.id, name:user.username, description:user.description || '', avatarUrl:user.avatar_id ? '/api/media/'+user.avatar_id : null, nameColor:readableNameColor(user.name_color) ? user.name_color : null, status:user.status_text || '' });
    return { users: rows.filter(user => user.active && online.has(user.id)).map(serializeProfile), profiles: rows.map(serializeProfile), nameColors, statuses };
  });
  app.patch('/profile', async (request,reply) => {
    const {description,avatarId,nameColor,status} = request.body ?? {};
    if (typeof description !== 'string' || description.length > 200 || !(avatarId === null || typeof avatarId === 'string' && UUID.test(avatarId))) return reply.code(400).send({error:'Descrição ou imagem inválida.'});
    if (!(nameColor === undefined || nameColor === null || readableNameColor(nameColor))) return reply.code(400).send({error:'Escolha uma cor no formato #RRGGBB e clara o bastante para ler no fundo escuro.'});
    if (nameColor && !nameColors) return reply.code(503).send({error:'A cor do nick ainda não foi ativada no servidor.'});
    if (!(status === undefined || typeof status === 'string' && status.trim().length <= 60 && !/[ -]/.test(status))) return reply.code(400).send({error:'O status pode ter até 60 caracteres, em uma linha.'});
    if (status?.trim() && !statuses) return reply.code(503).send({error:'O status personalizado ainda não foi ativado no servidor.'});
    if (avatarId && !(await db.prepare("SELECT id FROM attachments WHERE id=? AND owner_id=? AND size<=? AND mime LIKE 'image/%' AND id NOT IN (SELECT attachment_id FROM message_attachments)").get(avatarId,request.user.id,MAX_UPLOAD_BYTES))) return reply.code(400).send({error:'Envie sua imagem novamente. Fotos de perfil têm limite de 8 MB.'});
    // Clientes antigos não enviam a cor nem o status; nesse caso eles são mantidos.
    const fields = { description:description.trim(), avatar_id:avatarId };
    if (nameColors && nameColor !== undefined) fields.name_color = nameColor ? nameColor.toLowerCase() : null;
    if (statuses && status !== undefined) fields.status_text = status.trim();
    const columns = Object.keys(fields);
    (await db.prepare(`INSERT INTO profiles(user_id,${columns.join(',')}) VALUES(?${',?'.repeat(columns.length)}) ON CONFLICT(user_id) DO UPDATE SET ${columns.map(column=>column+'=excluded.'+column).join(',')}`).run(request.user.id,...Object.values(fields)));
    return {ok:true};
  });
  app.get('/messages', async (request,reply) => {
    reply.header('Cache-Control','no-store');
    const {after,before,since,channel='general'}=request.query;
    if(!(await accounts.conversationExists(channel)))return reply.code(400).send({error:'Conversa inválida.'});
    const eventCursor=(await db.prepare('SELECT COALESCE(MAX(seq),0) AS cursor FROM message_events WHERE channel=?').get(channel)).cursor;
    if(since!==undefined){
      if(!/^\d+$/.test(since)||!Number.isSafeInteger(Number(since)))return reply.code(400).send({error:'Página inválida.'});
      const events=(await db.prepare('SELECT * FROM message_events WHERE channel=? AND seq>? ORDER BY seq LIMIT 200').all(channel,Number(since)));
      const ids=events.filter(e=>e.kind==='created').map(e=>e.message_id);
      const rows=ids.length?await db.prepare(`SELECT id,name,text,timestamp,channel,user_id,reply_to_id FROM messages WHERE id IN (${ids.map(()=>'?').join(',')}) AND deleted_at IS NULL`).all(...ids):[];
      const lookup=new Map(rows.map(row=>[row.id,row]));
      return {messages:await serializeMessages(ids.map(id=>lookup.get(id)).filter(Boolean),request.user),deletedIds:events.filter(e=>e.kind==='deleted').map(e=>e.message_id),cursor:events.length?events.at(-1).seq:eventCursor};
    }
    if((after!==undefined&&!/^\d+$/.test(after))||(before!==undefined&&!/^\d+$/.test(before))||(after!==undefined&&before!==undefined)) return reply.code(400).send({error:'Página de mensagens inválida.'});
    const cursor=Number(after??before??0);
    if(!Number.isSafeInteger(cursor))return reply.code(400).send({error:'Página de mensagens inválida.'});
    if(after!==undefined) return {messages:await serializeMessages(await db.prepare('SELECT id,name,text,timestamp,channel,user_id,reply_to_id FROM messages WHERE channel=? AND id>? AND deleted_at IS NULL ORDER BY id ASC LIMIT 100').all(channel,cursor),request.user),cursor:eventCursor};
    const rows=before===undefined?(await db.prepare('SELECT id,name,text,timestamp,channel,user_id,reply_to_id FROM messages WHERE channel=? AND deleted_at IS NULL ORDER BY id DESC LIMIT 101').all(channel)):(await db.prepare('SELECT id,name,text,timestamp,channel,user_id,reply_to_id FROM messages WHERE channel=? AND id<? AND deleted_at IS NULL ORDER BY id DESC LIMIT 101').all(channel,cursor));
    return {messages:await serializeMessages(rows.slice(0,100).reverse(),request.user),hasMore:rows.length>100,cursor:eventCursor};
  });
  app.post('/messages', async (request,reply) => {
    const {text='',clientId,channel='general',attachmentIds=[],replyTo=null}=request.body??{};
    const name=request.user.username;
    if((replyTo!==null&&(!Number.isSafeInteger(replyTo)||replyTo<=0))||typeof text!=='string'||text.trim().length>2000||typeof clientId!=='string'||!UUID.test(clientId)||!(await accounts.conversationExists(channel))||!Array.isArray(attachmentIds)||attachmentIds.length>4||new Set(attachmentIds).size!==attachmentIds.length||attachmentIds.some(id=>typeof id!=='string'||!UUID.test(id))||(!text.trim()&&!attachmentIds.length))return reply.code(400).send({error:'Escreva uma mensagem ou anexe até quatro imagens/GIFs.'});
    const findPrevious=()=>db.prepare('SELECT id,name,text,timestamp,channel,user_id,deleted_at,reply_to_id FROM messages WHERE client_id=?').get(clientId);
    async function retry(previous) {
      const previousIds=(await messageMedia.all(previous.id)).map(media=>media.id);
      if(previous.user_id!==request.user.id||previous.deleted_at||previous.text!==text.trim()||previous.channel!==channel||(previous.reply_to_id??null)!==replyTo||JSON.stringify(previousIds)!==JSON.stringify(attachmentIds))return reply.code(409).send({error:'Identificador de mensagem já utilizado.'});
      return serializeMessage(previous,request.user);
    }
    const previous=await findPrevious();
    if(previous)return retry(previous);
    if(replyTo!==null && !(await db.prepare('SELECT id FROM messages WHERE id=? AND channel=? AND deleted_at IS NULL').get(replyTo,channel))) return reply.code(400).send({error:'A mensagem respondida não está disponível neste canal.'});
    for(const id of attachmentIds){
      const attachment=await db.prepare('SELECT id,size,mime FROM attachments WHERE id=? AND owner_id=?').get(id,request.user.id);
      if(!attachment)return reply.code(400).send({error:'Um dos anexos não foi enviado por você. Tente novamente.'});
      if((await db.prepare('SELECT user_id FROM profiles WHERE avatar_id=?').get(id)))return reply.code(409).send({error:'Escolha outra imagem para a mensagem.'});
      if((await db.prepare('SELECT message_id FROM message_attachments WHERE attachment_id=?').get(id)))return reply.code(409).send({error:'Um dos anexos já foi publicado. Selecione o arquivo novamente.'});
    }
    const timestamp=Date.now();let messageId;
    try { await db.transaction(async()=>{
      const result=(await db.prepare('INSERT INTO messages(client_id,name,text,timestamp,channel,user_id,reply_to_id) VALUES(?,?,?,?,?,?,?)').run(clientId,name,text.trim(),timestamp,channel,request.user.id,replyTo));messageId=Number(result.lastInsertRowid);
      (await db.prepare("INSERT INTO message_events(message_id,channel,kind) VALUES(?,?,'created')").run(messageId,channel));
      const attach=db.prepare('INSERT INTO message_attachments(message_id,attachment_id,position) VALUES(?,?,?)');
      for (const [index,id] of attachmentIds.entries()) await attach.run(messageId,id,index);
    }); } catch(error) {
      const raced=await findPrevious();
      if(raced)return retry(raced);
      if(error.code==='23505'||[19,1555,2067].includes(error.errcode))return reply.code(409).send({error:'Um dos anexos já foi publicado. Selecione o arquivo novamente.'});
      throw error;
    }
    activity.record('message-send',{actor:request.user.username,channel});
    return reply.code(201).send(await serializeMessage({id:messageId,name,text:text.trim(),timestamp,channel,user_id:request.user.id,reply_to_id:replyTo},request.user));
  });
  app.delete('/messages/:id',async(request,reply)=>{
    const id=Number(request.params.id);
    if(!Number.isSafeInteger(id))return reply.code(404).send({error:'Mensagem não encontrada.'});
    const result=await db.transaction(async()=>{
      const message=await db.prepare('SELECT * FROM messages WHERE id=? AND deleted_at IS NULL'+(db.kind==='postgres'?' FOR UPDATE':'')).get(id);
      if(!message)return 404;
      if(request.user.role!=='admin'&&message.user_id!==request.user.id)return 403;
      const media=(await messageMedia.all(id));
      (await db.prepare('DELETE FROM message_attachments WHERE message_id=?').run(id));
      for(const attachment of media)(await db.prepare('DELETE FROM attachments WHERE id=?').run(attachment.id));
      (await db.prepare("UPDATE messages SET text='',deleted_at=? WHERE id=?").run(Date.now(),id));
      (await db.prepare("INSERT INTO message_events(message_id,channel,kind) VALUES(?,?,'deleted')").run(id,message.channel));
      return {channel:message.channel};
    });
    if(result===404)return reply.code(404).send({error:'Mensagem não encontrada.'});
    if(result===403)return reply.code(403).send({error:'Você só pode excluir suas próprias mensagens.'});
    activity.record('message-delete',{actor:request.user.username,channel:result.channel});
    return {ok:true,id};
  });
  return app;
}
