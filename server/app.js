import Fastify from 'fastify';
import cors from '@fastify/cors';
import { AccessToken } from 'livekit-server-sdk';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import sharp from 'sharp';
import { installAccounts } from './accounts.js';
import { normalizeSoundboardWav } from './soundboard-audio.js';

export const VOICE_CHANNELS = [{ id: 'geral', name: 'Geral' }, { id: 'jogatina', name: 'Jogatina' }];
export const MESSAGE_CHANNELS = ['general', 'voice:geral', 'voice:jogatina'];
export const HEALTH_VERSION = 10;
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const MAX_PIXELS = 20_000_000;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const validName = name => typeof name === 'string' && name.trim().length >= 2 && name.trim().length <= 32;
function imageSignature(buffer) {
  if (buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'png';
  if (buffer[0]===255 && buffer[1]===216 && buffer[2]===255) return 'jpeg';
  if (['GIF87a','GIF89a'].includes(buffer.subarray(0,6).toString('ascii'))) return 'gif';
  if (buffer.subarray(0,4).toString('ascii')==='RIFF' && buffer.subarray(8,12).toString('ascii')==='WEBP') return 'webp';
  return null;
}
export async function createApp({ dbPath, apiKey, apiSecret, serverUrl, logger = true, maxMediaStorageBytes = 512 * 1024 * 1024, ownerSetupToken, ownerSetupExpiresAt, secureCookies = true, allowedOrigins = ['http://localhost:5173', 'https://' + new URL(serverUrl).hostname], onOwnerReady }) {
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT, client_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL, text TEXT NOT NULL, timestamp INTEGER NOT NULL
    );`);
  if (!db.prepare('PRAGMA table_info(messages)').all().some(column=>column.name==='channel')) db.exec("ALTER TABLE messages ADD COLUMN channel TEXT NOT NULL DEFAULT 'general'");
  db.exec(`CREATE INDEX IF NOT EXISTS messages_channel_id ON messages(channel,id);
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
    CREATE TABLE IF NOT EXISTS soundboard (id TEXT PRIMARY KEY, channel TEXT NOT NULL, name TEXT NOT NULL, owner_id TEXT NOT NULL, data BLOB NOT NULL, created_at INTEGER NOT NULL);`);
  const mediaFields = 'a.id,a.mime,a.width,a.height,a.size,a.animated';
  const messageMedia = db.prepare(`SELECT ${mediaFields} FROM attachments a JOIN message_attachments ma ON ma.attachment_id=a.id WHERE ma.message_id=? ORDER BY ma.position`);
  const serializeMedia = media => ({ ...media, animated: Boolean(media.animated), url: '/api/media/'+media.id, posterUrl: media.animated ? '/api/media/'+media.id+'?still=1' : undefined });
  const serializeMessage = (message,user) => ({ ...message, canDelete: user.role==='admin'||message.user_id===user.id, attachments: messageMedia.all(message.id).map(serializeMedia) });
  const cleanAbandoned = () => db.prepare('DELETE FROM attachments WHERE created_at < ? AND id NOT IN (SELECT attachment_id FROM message_attachments) AND id NOT IN (SELECT avatar_id FROM profiles WHERE avatar_id IS NOT NULL)').run(Date.now()-86400000);
  cleanAbandoned();
  const app = Fastify({ logger, bodyLimit: 16384 });
  app.addContentTypeParser('application/octet-stream', { parseAs:'buffer', bodyLimit:MAX_UPLOAD_BYTES }, (_request,body,done)=>done(null,body));
  app.addHook('onClose', async () => db.close());
  await app.register(cors, { origin: 'http://localhost:5173' });
  const accounts = await installAccounts(app,db,{ownerSetupToken,ownerSetupExpiresAt,secureCookies,allowedOrigins,onOwnerReady});
  const columns = db.prepare('PRAGMA table_info(messages)').all();
  if (!columns.some(c=>c.name==='user_id')) db.exec('ALTER TABLE messages ADD COLUMN user_id TEXT REFERENCES users(id)');
  if (!columns.some(c=>c.name==='deleted_at')) db.exec('ALTER TABLE messages ADD COLUMN deleted_at INTEGER');
  if (!db.prepare('PRAGMA table_info(attachments)').all().some(c=>c.name==='owner_id')) db.exec('ALTER TABLE attachments ADD COLUMN owner_id TEXT REFERENCES users(id)');
  db.exec(`CREATE TABLE IF NOT EXISTS message_events (seq INTEGER PRIMARY KEY AUTOINCREMENT,message_id INTEGER NOT NULL,channel TEXT NOT NULL,kind TEXT NOT NULL,UNIQUE(message_id,kind));
    CREATE INDEX IF NOT EXISTS message_events_channel_seq ON message_events(channel,seq);
    INSERT OR IGNORE INTO message_events(message_id,channel,kind) SELECT id,channel,'created' FROM messages;`);
  // The launcher compares this version to restart a backend left running from before an update.
  app.get('/health', async () => ({ status:'online', application:'progresso-gang-chat', version:HEALTH_VERSION, features:['accounts'], pid:process.pid }));
  app.get('/soundboard', async (request,reply) => {
    const {channel}=request.query;
    if (typeof channel!=='string'||!accounts.voiceExists(channel)) return reply.code(400).send({error:'Canal inválido.'});
    return {sounds:db.prepare('SELECT id,name,owner_id FROM soundboard WHERE channel=? ORDER BY created_at,id').all(channel).map(sound=>({id:sound.id,name:sound.name,canDelete:request.user.role==='admin'||sound.owner_id===request.user.id}))};
  });
  app.post('/soundboard', {bodyLimit:441044}, async (request,reply) => {
    const channel=request.headers['x-sound-channel'], encodedName=request.headers['x-sound-name'];
    let name; try { name=decodeURIComponent(encodedName || '').trim(); } catch { return reply.code(400).send({error:'Nome inválido.'}); }
    if(typeof channel!=='string'||!accounts.voiceExists(channel)||name.length<1||name.length>40) return reply.code(400).send({error:'Informe o nome e o canal do áudio.'});
    const b=request.body;
    if(!Buffer.isBuffer(b)||b.length<46||b.length>441044||b.toString('ascii',0,4)!=='RIFF'||b.readUInt32LE(4)!==b.length-8||b.toString('ascii',8,16)!=='WAVEfmt '||b.readUInt32LE(16)!==16||b.readUInt16LE(20)!==1||b.readUInt16LE(22)!==1||b.readUInt32LE(24)!==22050||b.readUInt32LE(28)!==44100||b.readUInt16LE(32)!==2||b.readUInt16LE(34)!==16||b.toString('ascii',36,40)!=='data'||b.readUInt32LE(40)!==b.length-44||(b.length-44)%2!==0) return reply.code(400).send({error:'Áudio inválido ou com mais de 10 segundos.'});
    if(db.prepare('SELECT COUNT(*) n FROM soundboard WHERE channel=?').get(channel).n>=50) return reply.code(409).send({error:'Este canal já tem 50 sons.'});
    const id=randomUUID(); db.prepare('INSERT INTO soundboard VALUES(?,?,?,?,?,?)').run(id,channel,name,request.user.id,b,Date.now());
    return reply.code(201).send({id,name,canDelete:true});
  });
  app.get('/soundboard/:id', async (request,reply) => {
    const {id}=request.params, {channel}=request.query;
    if(!UUID.test(id)||typeof channel!=='string'||!accounts.voiceExists(channel)) return reply.code(404).send({error:'Som não encontrado.'});
    const sound=db.prepare('SELECT data FROM soundboard WHERE id=? AND channel=?').get(id,channel);
    if(!sound)return reply.code(404).send({error:'Som não encontrado.'});
    return reply.header('Content-Type','audio/wav').header('Content-Security-Policy',"default-src 'none'; sandbox").send(normalizeSoundboardWav(sound.data));
  });
  app.delete('/soundboard/:id', async (request,reply) => {
    const sound=db.prepare('SELECT owner_id FROM soundboard WHERE id=?').get(request.params.id);
    if(!sound)return reply.code(404).send({error:'Som não encontrado.'});
    if(sound.owner_id!==request.user.id&&request.user.role!=='admin')return reply.code(403).send({error:'Você só pode excluir os próprios sons.'});
    db.prepare('DELETE FROM soundboard WHERE id=?').run(request.params.id); return {ok:true};
  });
  app.post('/token', async (request,reply) => {
    const {room='geral'}=request.body??{};
    if(typeof room!=='string'||!accounts.voiceExists(room)) return reply.code(400).send({error:'Canal de voz inválido.'});
    const token=new AccessToken(apiKey,apiSecret,{identity:request.user.id+':'+randomUUID(),name:request.user.username,metadata:JSON.stringify({userId:request.user.id}),ttl:'10m'});
    token.addGrant({roomJoin:true,room,canPublish:true,canSubscribe:true});
    return {token:await token.toJwt(),serverUrl,room};
  });
  app.post('/uploads', {bodyLimit:MAX_UPLOAD_BYTES}, async (request,reply) => {
    const id=request.headers['x-upload-id'];
    const buffer=request.body;
    if(typeof id!=='string'||!UUID.test(id)||!Buffer.isBuffer(buffer)||!buffer.length) return reply.code(400).send({error:'Selecione uma imagem ou GIF válido.'});
    const format=imageSignature(buffer);
    if(!format) return reply.code(415).send({error:'Use PNG, JPG, WebP ou GIF. Outros arquivos não são aceitos.'});
    const requestHash=createHash('sha256').update(buffer).digest('hex');
    const previous=db.prepare(`SELECT ${mediaFields},a.request_hash FROM attachments a WHERE id=? AND owner_id=?`).get(id,request.user.id);
    if(previous){
      if(previous.request_hash!==requestHash) return reply.code(409).send({error:'Esse identificador já pertence a outro arquivo.'});
      const {request_hash,...metadata}=previous;return serializeMedia(metadata);
    }
    let normalized, metadata;
    try{
      const input=sharp(buffer,{animated:true,failOn:'error',limitInputPixels:MAX_PIXELS});
      metadata=await input.metadata();
      const height=metadata.pageHeight||metadata.height;
      if(metadata.format!==format||!metadata.width||!height||(metadata.pages||1)>200||metadata.width*height*(metadata.pages||1)>MAX_PIXELS) return reply.code(413).send({error:'Essa imagem ou animação é grande demais. Envie uma versão menor.'});
      const animation={loop:metadata.loop,delay:metadata.delay};
      const pipeline=format==='jpeg'?input.rotate().jpeg({quality:90}):format==='png'?input.png():format==='gif'?input.gif(animation):input.webp({quality:90,...animation});
      normalized=await pipeline.toBuffer();
      metadata=await sharp(normalized,{animated:true,limitInputPixels:MAX_PIXELS}).metadata();
    }catch{return reply.code(415).send({error:'Não foi possível ler essa imagem. O arquivo pode estar incompleto ou inválido.'});}
    if(normalized.length>MAX_UPLOAD_BYTES) return reply.code(413).send({error:'A imagem processada excede 8 MB. Envie uma versão menor.'});
    cleanAbandoned();
    // Image processing is asynchronous: another retry may have finished in the meantime.
    const raced=db.prepare(`SELECT ${mediaFields},a.request_hash FROM attachments a WHERE id=? AND owner_id=?`).get(id,request.user.id);
    if(raced){if(raced.request_hash!==requestHash)return reply.code(409).send({error:'Identificador de arquivo já utilizado.'});const{request_hash,...meta}=raced;return serializeMedia(meta);}
    const used=db.prepare('SELECT COALESCE(SUM(size),0) AS bytes FROM attachments').get().bytes;
    if(used+normalized.length>maxMediaStorageBytes) return reply.code(507).send({error:'O espaço reservado para imagens neste servidor está cheio. Avise o responsável pelo PC.'});
    const media={id,mime:'image/'+format,width:metadata.width,height:metadata.pageHeight||metadata.height,size:normalized.length,animated:(metadata.pages||1)>1};
    if(db.prepare('SELECT id FROM attachments WHERE id=?').get(id))return reply.code(409).send({error:'Identificador de arquivo já utilizado.'});
    db.prepare('INSERT INTO attachments(id,request_hash,mime,width,height,size,animated,data,created_at,owner_id) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,requestHash,media.mime,media.width,media.height,media.size,Number(media.animated),normalized,Date.now(),request.user.id);
    return reply.code(201).send(serializeMedia(media));
  });
  app.get('/media/:id', async (request,reply) => {
    const {id}=request.params;
    if(!UUID.test(id)) return reply.code(404).send({error:'Imagem não encontrada.'});
    const media=db.prepare('SELECT a.mime,a.data,a.animated FROM attachments a WHERE a.id=? AND (EXISTS (SELECT 1 FROM message_attachments ma WHERE ma.attachment_id=a.id) OR EXISTS (SELECT 1 FROM profiles p WHERE p.avatar_id=a.id))').get(id);
    if(!media)return reply.code(404).send({error:'Imagem não encontrada.'});
    let body=Buffer.from(media.data);
    let mime=media.mime;
    if(request.query.still==='1'&&media.animated){body=await sharp(body,{limitInputPixels:MAX_PIXELS}).png().toBuffer();mime='image/png';}
    const extension=mime==='image/jpeg'?'jpg':mime.split('/')[1];
    return reply.header('Content-Type',mime).header('X-Content-Type-Options','nosniff').header('Content-Security-Policy',"default-src 'none'; sandbox").header('Content-Disposition',`inline; filename="imagem.${extension}"`).header('Cache-Control','no-store').send(body);
  });
  const online = new Map();
  app.get('/presence', async request => {
    const now = Date.now();
    online.set(request.user.id, now);
    for (const [id, seen] of online) if (now-seen > 45000) online.delete(id);
    const rows = db.prepare('SELECT u.id,u.username,u.active,p.description,p.avatar_id FROM users u LEFT JOIN profiles p ON p.user_id=u.id').all();
    const serializeProfile = user => ({ id:user.id, name:user.username, description:user.description || '', avatarUrl:user.avatar_id ? '/api/media/'+user.avatar_id : null });
    return { users: rows.filter(user => user.active && online.has(user.id)).map(serializeProfile), profiles: rows.map(serializeProfile) };
  });
  app.patch('/profile', async (request,reply) => {
    const {description,avatarId} = request.body ?? {};
    if (typeof description !== 'string' || description.length > 200 || !(avatarId === null || typeof avatarId === 'string' && UUID.test(avatarId))) return reply.code(400).send({error:'Descrição ou imagem inválida.'});
    if (avatarId && !db.prepare('SELECT id FROM attachments WHERE id=? AND owner_id=? AND id NOT IN (SELECT attachment_id FROM message_attachments)').get(avatarId,request.user.id)) return reply.code(400).send({error:'Envie sua imagem novamente.'});
    db.prepare('INSERT INTO profiles(user_id,description,avatar_id) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET description=excluded.description,avatar_id=excluded.avatar_id').run(request.user.id,description.trim(),avatarId);
    return {ok:true};
  });
  app.get('/messages', async (request,reply) => {
    reply.header('Cache-Control','no-store');
    const {after,before,since,channel='general'}=request.query;
    if(!accounts.conversationExists(channel))return reply.code(400).send({error:'Conversa inválida.'});
    const eventCursor=db.prepare('SELECT COALESCE(MAX(seq),0) AS cursor FROM message_events WHERE channel=?').get(channel).cursor;
    const serialize=row=>serializeMessage(row,request.user);
    if(since!==undefined){
      if(!/^\d+$/.test(since)||!Number.isSafeInteger(Number(since)))return reply.code(400).send({error:'Página inválida.'});
      const events=db.prepare('SELECT * FROM message_events WHERE channel=? AND seq>? ORDER BY seq LIMIT 200').all(channel,Number(since));
      const lookup=db.prepare('SELECT id,name,text,timestamp,channel,user_id FROM messages WHERE id=? AND deleted_at IS NULL');
      return {messages:events.filter(e=>e.kind==='created').map(e=>lookup.get(e.message_id)).filter(Boolean).map(serialize),deletedIds:events.filter(e=>e.kind==='deleted').map(e=>e.message_id),cursor:events.length?events.at(-1).seq:eventCursor};
    }
    if((after!==undefined&&!/^\d+$/.test(after))||(before!==undefined&&!/^\d+$/.test(before))||(after!==undefined&&before!==undefined)) return reply.code(400).send({error:'Página de mensagens inválida.'});
    const cursor=Number(after??before??0);
    if(!Number.isSafeInteger(cursor))return reply.code(400).send({error:'Página de mensagens inválida.'});
    if(after!==undefined) return {messages:db.prepare('SELECT id,name,text,timestamp,channel,user_id FROM messages WHERE channel=? AND id>? AND deleted_at IS NULL ORDER BY id ASC LIMIT 100').all(channel,cursor).map(serialize),cursor:eventCursor};
    const rows=before===undefined?db.prepare('SELECT id,name,text,timestamp,channel,user_id FROM messages WHERE channel=? AND deleted_at IS NULL ORDER BY id DESC LIMIT 101').all(channel):db.prepare('SELECT id,name,text,timestamp,channel,user_id FROM messages WHERE channel=? AND id<? AND deleted_at IS NULL ORDER BY id DESC LIMIT 101').all(channel,cursor);
    return {messages:rows.slice(0,100).reverse().map(serialize),hasMore:rows.length>100,cursor:eventCursor};
  });
  app.post('/messages', async (request,reply) => {
    const {text='',clientId,channel='general',attachmentIds=[]}=request.body??{};
    const name=request.user.username;
    if(typeof text!=='string'||text.trim().length>2000||typeof clientId!=='string'||!UUID.test(clientId)||!accounts.conversationExists(channel)||!Array.isArray(attachmentIds)||attachmentIds.length>4||new Set(attachmentIds).size!==attachmentIds.length||attachmentIds.some(id=>typeof id!=='string'||!UUID.test(id))||(!text.trim()&&!attachmentIds.length))return reply.code(400).send({error:'Escreva uma mensagem ou anexe até quatro imagens/GIFs.'});
    const previous=db.prepare('SELECT id,name,text,timestamp,channel,user_id,deleted_at FROM messages WHERE client_id=?').get(clientId);
    if(previous){
      const previousIds=messageMedia.all(previous.id).map(media=>media.id);
      if(previous.user_id!==request.user.id||previous.deleted_at||previous.text!==text.trim()||previous.channel!==channel||JSON.stringify(previousIds)!==JSON.stringify(attachmentIds))return reply.code(409).send({error:'Identificador de mensagem já utilizado.'});
      return serializeMessage(previous,request.user);
    }
    for(const id of attachmentIds){
      if(!db.prepare('SELECT id FROM attachments WHERE id=? AND owner_id=?').get(id,request.user.id))return reply.code(400).send({error:'Um dos anexos não foi enviado por você. Tente novamente.'});
      if(db.prepare('SELECT user_id FROM profiles WHERE avatar_id=?').get(id))return reply.code(409).send({error:'Escolha outra imagem para a mensagem.'});
      if(db.prepare('SELECT message_id FROM message_attachments WHERE attachment_id=?').get(id))return reply.code(409).send({error:'Um dos anexos já foi publicado. Selecione o arquivo novamente.'});
    }
    const timestamp=Date.now();let messageId;
    db.exec('BEGIN IMMEDIATE');
    try{
      const result=db.prepare('INSERT INTO messages(client_id,name,text,timestamp,channel,user_id) VALUES(?,?,?,?,?,?)').run(clientId,name,text.trim(),timestamp,channel,request.user.id);messageId=Number(result.lastInsertRowid);
      db.prepare("INSERT INTO message_events(message_id,channel,kind) VALUES(?,?,'created')").run(messageId,channel);
      const attach=db.prepare('INSERT INTO message_attachments(message_id,attachment_id,position) VALUES(?,?,?)');
      attachmentIds.forEach((id,index)=>attach.run(messageId,id,index));db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
    return reply.code(201).send(serializeMessage({id:messageId,name,text:text.trim(),timestamp,channel,user_id:request.user.id},request.user));
  });
  app.delete('/messages/:id',async(request,reply)=>{
    const id=Number(request.params.id);
    if(!Number.isSafeInteger(id))return reply.code(404).send({error:'Mensagem não encontrada.'});
    const message=db.prepare('SELECT * FROM messages WHERE id=? AND deleted_at IS NULL').get(id);
    if(!message)return reply.code(404).send({error:'Mensagem não encontrada.'});
    if(request.user.role!=='admin'&&message.user_id!==request.user.id)return reply.code(403).send({error:'Você só pode excluir suas próprias mensagens.'});
    db.exec('BEGIN IMMEDIATE');
    try{
      const media=messageMedia.all(id);
      db.prepare('DELETE FROM message_attachments WHERE message_id=?').run(id);
      for(const attachment of media)db.prepare('DELETE FROM attachments WHERE id=?').run(attachment.id);
      db.prepare("UPDATE messages SET text='',deleted_at=? WHERE id=?").run(Date.now(),id);
      db.prepare("INSERT INTO message_events(message_id,channel,kind) VALUES(?,?,'deleted')").run(id,message.channel);
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
    return {ok:true,id};
  });
  return app;
}
