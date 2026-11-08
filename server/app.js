import Fastify from 'fastify';
import cors from '@fastify/cors';
import { AccessToken } from 'livekit-server-sdk';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import sharp from 'sharp';

export const VOICE_CHANNELS = [{ id: 'geral', name: 'Geral' }, { id: 'jogatina', name: 'Jogatina' }];
export const MESSAGE_CHANNELS = ['general', 'voice:geral', 'voice:jogatina'];
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
export async function createApp({ dbPath, apiKey, apiSecret, serverUrl, logger = true, maxMediaStorageBytes = 512 * 1024 * 1024 }) {
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
    );`);
  const mediaFields = 'a.id,a.mime,a.width,a.height,a.size,a.animated';
  const messageMedia = db.prepare(`SELECT ${mediaFields} FROM attachments a JOIN message_attachments ma ON ma.attachment_id=a.id WHERE ma.message_id=? ORDER BY ma.position`);
  const serializeMedia = media => ({ ...media, animated: Boolean(media.animated), url: '/api/media/'+media.id, posterUrl: media.animated ? '/api/media/'+media.id+'?still=1' : undefined });
  const serializeMessage = message => ({ ...message, attachments: messageMedia.all(message.id).map(serializeMedia) });
  const cleanAbandoned = () => db.prepare('DELETE FROM attachments WHERE created_at < ? AND id NOT IN (SELECT attachment_id FROM message_attachments)').run(Date.now()-86400000);
  cleanAbandoned();
  const app = Fastify({ logger, bodyLimit: 16384 });
  app.addContentTypeParser('application/octet-stream', { parseAs:'buffer', bodyLimit:MAX_UPLOAD_BYTES }, (_request,body,done)=>done(null,body));
  app.addHook('onClose', async () => db.close());
  await app.register(cors, { origin: 'http://localhost:5173' });
  app.get('/health', async () => ({ status:'online', application:'progresso-gang-chat', version:3 }));
  app.get('/channels', async () => ({ voice:VOICE_CHANNELS, text:[{id:'general',name:'geral'}] }));
  app.post('/token', async (request,reply) => {
    const {name,room='geral'}=request.body??{};
    if(!validName(name)) return reply.code(400).send({error:'Escolha um apelido de 2 a 32 caracteres.'});
    if(!VOICE_CHANNELS.some(channel=>channel.id===room)) return reply.code(400).send({error:'Canal de voz inválido.'});
    const token=new AccessToken(apiKey,apiSecret,{identity:randomUUID(),name:name.trim(),ttl:'2h'});
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
    const previous=db.prepare(`SELECT ${mediaFields},a.request_hash FROM attachments a WHERE id=?`).get(id);
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
    }catch{return reply.code(415).send({error:'Não foi possível ler essa imagem. O arquivo pode estar incompleto ou inválido.'});}
    if(normalized.length>MAX_UPLOAD_BYTES) return reply.code(413).send({error:'A imagem processada excede 8 MB. Envie uma versão menor.'});
    cleanAbandoned();
    const used=db.prepare('SELECT COALESCE(SUM(size),0) AS bytes FROM attachments').get().bytes;
    if(used+normalized.length>maxMediaStorageBytes) return reply.code(507).send({error:'O espaço reservado para imagens neste servidor está cheio. Avise o responsável pelo PC.'});
    // Image processing is asynchronous: another retry may have finished in the meantime.
    const raced=db.prepare(`SELECT ${mediaFields},a.request_hash FROM attachments a WHERE id=?`).get(id);
    if(raced){if(raced.request_hash!==requestHash)return reply.code(409).send({error:'Identificador de arquivo já utilizado.'});const{request_hash,...meta}=raced;return serializeMedia(meta);}
    const media={id,mime:'image/'+format,width:metadata.width,height:metadata.pageHeight||metadata.height,size:normalized.length,animated:(metadata.pages||1)>1};
    db.prepare('INSERT INTO attachments(id,request_hash,mime,width,height,size,animated,data,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id,requestHash,media.mime,media.width,media.height,media.size,Number(media.animated),normalized,Date.now());
    return reply.code(201).send(serializeMedia(media));
  });
  app.get('/media/:id', async (request,reply) => {
    const {id}=request.params;
    if(!UUID.test(id)) return reply.code(404).send({error:'Imagem não encontrada.'});
    const media=db.prepare('SELECT a.mime,a.data,a.animated FROM attachments a JOIN message_attachments ma ON ma.attachment_id=a.id WHERE a.id=?').get(id);
    if(!media)return reply.code(404).send({error:'Imagem não encontrada.'});
    let body=Buffer.from(media.data);
    let mime=media.mime;
    if(request.query.still==='1'&&media.animated){body=await sharp(body,{limitInputPixels:MAX_PIXELS}).png().toBuffer();mime='image/png';}
    const extension=mime==='image/jpeg'?'jpg':mime.split('/')[1];
    return reply.header('Content-Type',mime).header('X-Content-Type-Options','nosniff').header('Content-Security-Policy',"default-src 'none'; sandbox").header('Content-Disposition',`inline; filename="imagem.${extension}"`).header('Cache-Control','private, max-age=86400, immutable').send(body);
  });
  app.get('/messages', async (request,reply) => {
    reply.header('Cache-Control','no-store');
    const {after,before,channel='general'}=request.query;
    if(!MESSAGE_CHANNELS.includes(channel))return reply.code(400).send({error:'Conversa inválida.'});
    if((after!==undefined&&!/^\d+$/.test(after))||(before!==undefined&&!/^\d+$/.test(before))||(after!==undefined&&before!==undefined)) return reply.code(400).send({error:'Página de mensagens inválida.'});
    const cursor=Number(after??before??0);
    if(!Number.isSafeInteger(cursor))return reply.code(400).send({error:'Página de mensagens inválida.'});
    if(after!==undefined) return {messages:db.prepare('SELECT id,name,text,timestamp,channel FROM messages WHERE channel=? AND id>? ORDER BY id ASC LIMIT 100').all(channel,cursor).map(serializeMessage)};
    const rows=before===undefined?db.prepare('SELECT id,name,text,timestamp,channel FROM messages WHERE channel=? ORDER BY id DESC LIMIT 101').all(channel):db.prepare('SELECT id,name,text,timestamp,channel FROM messages WHERE channel=? AND id<? ORDER BY id DESC LIMIT 101').all(channel,cursor);
    return {messages:rows.slice(0,100).reverse().map(serializeMessage),hasMore:rows.length>100};
  });
  app.post('/messages', async (request,reply) => {
    const {name,text='',clientId,channel='general',attachmentIds=[]}=request.body??{};
    if(!validName(name)||typeof text!=='string'||text.trim().length>2000||typeof clientId!=='string'||!UUID.test(clientId)||!MESSAGE_CHANNELS.includes(channel)||!Array.isArray(attachmentIds)||attachmentIds.length>4||new Set(attachmentIds).size!==attachmentIds.length||attachmentIds.some(id=>typeof id!=='string'||!UUID.test(id))||(!text.trim()&&!attachmentIds.length))return reply.code(400).send({error:'Escreva uma mensagem ou anexe até quatro imagens/GIFs.'});
    const previous=db.prepare('SELECT id,name,text,timestamp,channel FROM messages WHERE client_id=?').get(clientId);
    if(previous){
      const previousIds=messageMedia.all(previous.id).map(media=>media.id);
      if(previous.name!==name.trim()||previous.text!==text.trim()||previous.channel!==channel||JSON.stringify(previousIds)!==JSON.stringify(attachmentIds))return reply.code(409).send({error:'Identificador de mensagem já utilizado.'});
      return serializeMessage(previous);
    }
    for(const id of attachmentIds){
      if(!db.prepare('SELECT id FROM attachments WHERE id=?').get(id))return reply.code(400).send({error:'Um dos anexos não foi enviado. Tente novamente.'});
      if(db.prepare('SELECT message_id FROM message_attachments WHERE attachment_id=?').get(id))return reply.code(409).send({error:'Um dos anexos já foi publicado. Selecione o arquivo novamente.'});
    }
    const timestamp=Date.now();let messageId;
    db.exec('BEGIN IMMEDIATE');
    try{
      const result=db.prepare('INSERT INTO messages(client_id,name,text,timestamp,channel) VALUES(?,?,?,?,?)').run(clientId,name.trim(),text.trim(),timestamp,channel);messageId=Number(result.lastInsertRowid);
      const attach=db.prepare('INSERT INTO message_attachments(message_id,attachment_id,position) VALUES(?,?,?)');
      attachmentIds.forEach((id,index)=>attach.run(messageId,id,index));db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
    return reply.code(201).send(serializeMessage({id:messageId,name:name.trim(),text:text.trim(),timestamp,channel}));
  });
  return app;
}
