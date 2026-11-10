import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes,randomUUID } from 'node:crypto';
import { mkdtempSync,rmSync,rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createApp } from './app.js';
import { migrateBackup } from './migrate-to-supabase.js';

const schema=process.env.PG_TEST_SCHEMA || '';
const enabled=Boolean(process.env.PG_TEST_DATABASE_URL && process.env.PG_TEST_CA_CERT && /^progresso_gang_qa_[a-f0-9]{16}$/.test(schema));
const origin='http://localhost:5173',password=randomBytes(20).toString('hex'),token=randomBytes(32).toString('base64url');
const common={apiKey:'test',apiSecret:randomBytes(32).toString('hex'),serverUrl:'ws://localhost:7880',secureCookies:false,logger:false,allowedOrigins:[origin],roomService:{listRooms:async()=>[]}};
const dbOptions={databaseUrl:process.env.PG_TEST_DATABASE_URL,certificatePath:process.env.PG_TEST_CA_CERT,schema};
const headers=response=>({origin,cookie:response.cookies[0].name+'='+response.cookies[0].value,'x-csrf-token':response.json().csrf});
test('migração preserva conta, mensagens e imagens; não substitui destino ocupado',{skip:!enabled},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'pg-chat-migration-')),path=join(dir,'test.sqlite');
  let sqlite,postgres;
  try {
    sqlite=await createApp({...common,dbPath:path,ownerSetupToken:token});
    const setup=await sqlite.inject({method:'POST',url:'/auth/setup',headers:{origin},payload:{token,password}});assert.equal(setup.statusCode,200);
    const auth=headers(setup), imageId=randomUUID(), image=await sharp({create:{width:4,height:4,channels:3,background:'red'}}).png().toBuffer();
    assert.equal((await sqlite.inject({method:'POST',url:'/uploads',headers:{...auth,'content-type':'application/octet-stream','x-upload-id':imageId},payload:image})).statusCode,201);
    assert.equal((await sqlite.inject({method:'POST',url:'/messages',headers:auth,payload:{clientId:randomUUID(),text:'Mensagem de migração',attachmentIds:[imageId]}})).statusCode,201);
    await sqlite.close();sqlite=undefined;
    await migrateBackup({sqlitePath:path,...dbOptions});
    await assert.rejects(()=>migrateBackup({sqlitePath:path,...dbOptions}),/destino não está vazio/);
    postgres=await createApp({...common,...dbOptions});
    const login=await postgres.inject({method:'POST',url:'/auth/login',headers:{origin},payload:{username:'Vitão',password}});assert.equal(login.statusCode,200);
    const history=await postgres.inject({url:'/messages',headers:headers(login)});assert.equal(history.statusCode,200);assert.equal(history.json().messages[0].text,'Mensagem de migração');assert.equal(history.json().messages[0].attachments[0].id,imageId);
    assert.equal((await postgres.inject({url:'/media/'+imageId,headers:headers(login)})).statusCode,200);
  } finally {if(sqlite)await sqlite.close();if(postgres)await postgres.close();for(const name of ['test.sqlite','test.sqlite-wal','test.sqlite-shm'])rmSync(join(dir,name),{force:true});rmdirSync(dir);}
});
