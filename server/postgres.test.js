import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import pg from 'pg';
import { createApp } from './app.js';

const schema=process.env.PG_TEST_SCHEMA || '';
const enabled=Boolean(process.env.PG_TEST_DATABASE_URL && process.env.PG_TEST_CA_CERT && /^progresso_gang_qa_[a-f0-9]{16}$/.test(schema));
const origin='http://localhost:5173',password=randomBytes(20).toString('hex');
const setupToken=randomBytes(32).toString('base64url');
const options={databaseUrl:process.env.PG_TEST_DATABASE_URL,certificatePath:process.env.PG_TEST_CA_CERT,schema,apiKey:'test',apiSecret:randomBytes(32).toString('hex'),serverUrl:'ws://localhost:7880',ownerSetupToken:setupToken,secureCookies:false,logger:false,allowedOrigins:[origin],roomService:{listRooms:async()=>[]}};
const headers=response=>({origin,cookie:response.cookies[0].name+'='+response.cookies[0].value,'x-csrf-token':response.json().csrf});
test('Postgres protege contas, mantém anexos e separa permissões',{skip:!enabled},async()=>{
  const app=await createApp(options);
  const call=(credentials,method,url,payload,extra={})=>app.inject({method,url,headers:{...credentials,...extra},payload});
  try {
    const setup=await call({origin},'POST','/auth/setup',{token:setupToken,password});
    assert.equal(setup.statusCode,200);
    const admin=headers(setup);
    const invite=await call(admin,'POST','/admin/invites',{});assert.equal(invite.statusCode,200);
    const member=await call({origin},'POST','/auth/register',{token:invite.json().token,username:'Pessoa teste',password});assert.equal(member.statusCode,201);
    const user=headers(member);
    assert.equal((await call(user,'POST','/admin/invites',{})).statusCode,403);
    const id=randomUUID(), image=await sharp({create:{width:4,height:4,channels:3,background:'red'}}).png().toBuffer();
    assert.equal((await call(user,'POST','/uploads',image,{'content-type':'application/octet-stream','x-upload-id':id})).statusCode,201);
    const message=await call(user,'POST','/messages',{clientId:randomUUID(),text:'Teste isolado',channel:'general',attachmentIds:[id]});assert.equal(message.statusCode,201);
    const history=await call(admin,'GET','/messages?channel=general');assert.equal(history.statusCode,200);assert.equal(history.json().messages[0].attachments[0].id,id);
    assert.equal((await call(admin,'GET','/media/'+id)).statusCode,200);
    assert.equal((await call(admin,'DELETE','/messages/'+message.json().id)).statusCode,200);
    assert.equal((await call(admin,'GET','/media/'+id)).statusCode,404);
    assert.equal((await call({origin},'GET','/messages')).statusCode,401);
    assert.equal((await call(user,'GET','/admin/logs')).statusCode,403);
    const logs=await call(admin,'GET','/admin/logs');assert.ok(logs.json().events.some(event=>event.event==='message-delete'));
    const fileId=randomUUID(),file=Buffer.from('Arquivo de teste');
    const fileUpload=await call(user,'POST','/uploads',file,{'content-type':'application/octet-stream','x-upload-id':fileId,'x-upload-channel':'general','x-upload-name':encodeURIComponent('arquivo.txt')});
    assert.equal(fileUpload.statusCode,201);assert.equal(fileUpload.json().filename,'arquivo.txt');
    assert.equal((await call(user,'POST','/messages',{clientId:randomUUID(),channel:'general',attachmentIds:[fileId]})).statusCode,201);
    const download=await call(user,'GET','/media/'+fileId);assert.equal(download.statusCode,200);assert.match(download.headers['content-disposition'],/^attachment;/);assert.deepEqual(download.rawPayload,file);
    const wav=Buffer.alloc(48);wav.write('RIFF',0);wav.writeUInt32LE(40,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(22050,24);wav.writeUInt32LE(44100,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(4,40);
    const sound=await call(user,'POST','/soundboard',wav,{'content-type':'application/octet-stream','x-sound-channel':'geral','x-sound-name':'Teste'});
    assert.equal(sound.statusCode,201);
    assert.equal((await call(user,'GET','/soundboard/'+sound.json().id+'?channel=geral')).statusCode,200);
    const payload={clientId:randomUUID(),text:'Envio repetido',channel:'general'};
    const duplicate=await Promise.all([call(user,'POST','/messages',payload),call(user,'POST','/messages',payload)]);
    assert.deepEqual(duplicate.map(response=>response.statusCode).sort(),[200,201]);
    assert.equal(duplicate[0].json().id,duplicate[1].json().id);
    const simultaneous=await Promise.all([call(user,'DELETE','/messages/'+duplicate[0].json().id),call(user,'DELETE','/messages/'+duplicate[0].json().id)]);
    assert.deepEqual(simultaneous.map(response=>response.statusCode).sort(),[200,404]);
  } finally {await app.close();}
});
test('esquema mantém contas e mensagens inacessíveis às funções públicas',{skip:!enabled},async()=>{
  const client=new pg.Client({connectionString:process.env.PG_TEST_DATABASE_URL,ssl:{ca:readFileSync(process.env.PG_TEST_CA_CERT,'utf8'),rejectUnauthorized:true}});
  try {
    await client.connect();
    const access=await client.query("SELECT has_schema_privilege('anon',$1,'USAGE') AS anon,has_schema_privilege('authenticated',$1,'USAGE') AS authenticated",[schema]);
    assert.equal(access.rows[0].anon,false);assert.equal(access.rows[0].authenticated,false);
    const tables=await client.query('SELECT bool_and(c.relrowsecurity) AS protected FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relkind=\'r\'',[schema]);
    assert.equal(tables.rows[0].protected,true);
  } finally {await client.end();}
});
test('arquivo de 100 MB é salvo e baixado pelo PostgreSQL',{skip:!enabled||process.env.PG_TEST_LARGE_UPLOAD!=='1'},async()=>{
  const app=await createApp(options);
  try {
    const login=await app.inject({method:'POST',url:'/auth/login',headers:{origin},payload:{username:'Vitão',password}});assert.equal(login.statusCode,200);
    const auth=headers(login),id=randomUUID(),data=Buffer.alloc(100*1024*1024,0x41);
    const upload=await app.inject({method:'POST',url:'/uploads',headers:{...auth,'content-type':'application/octet-stream','x-upload-id':id,'x-upload-channel':'general','x-upload-name':'teste.bin'},payload:data});
    assert.equal(upload.statusCode,201);assert.equal(upload.json().size,data.length);
    assert.equal((await app.inject({method:'POST',url:'/messages',headers:auth,payload:{clientId:randomUUID(),channel:'general',attachmentIds:[id]}})).statusCode,201);
    const result=await app.inject({url:'/media/'+id,headers:auth});assert.equal(result.statusCode,200);
    const hash=value=>createHash('sha256').update(value).digest('hex');assert.equal(hash(result.rawPayload),hash(data));
  } finally {await app.close();}
});
