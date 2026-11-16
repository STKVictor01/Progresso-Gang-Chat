// Executar apenas em Auth e PostgreSQL descartáveis, sem dados ou credenciais reais.
import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {createApp} from '../server/app.js';
import argon2 from 'argon2';

const host='http://127.0.0.1:9999';
const testKey='senha-ficticia-exclusiva-de-teste-nao-usar-em-producao';
const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
const now=Math.floor(Date.now()/1000);
const data=encode({alg:'HS256',typ:'JWT'})+'.'+encode({role:'service_role',aud:'authenticated',iat:now,exp:now+300});
const adminToken=data+'.'+createHmac('sha256',testKey).update(data).digest('base64url');
const originalId=randomUUID(),password='senha-ficticia-conta-local-123';
const hash=await argon2.hash(password,{type:argon2.argon2id,memoryCost:19456,timeCost:2,parallelism:1});
const email='pessoa-'+randomUUID()+'@example.com';
async function post(path,body,token){
  const headers={'Content-Type':'application/json'};if(token)headers.Authorization='Bearer '+token;
  const response=await fetch(host+path,{method:'POST',headers,body:JSON.stringify(body)});
  return {status:response.status,body:await response.json()};
}
const created=await post('/admin/users',{id:originalId,email,password_hash:hash,email_confirm:true},adminToken);
assert.equal(created.status,200,'Auth de teste recusou a importação');
assert.equal(created.body.id,originalId);
const login=await post('/token?grant_type=password',{email,password});
assert.equal(login.status,200,'Senha fictícia importada não autenticou');
assert.equal(login.body.user.id,originalId);
const wrong=await post('/token?grant_type=password',{email,password:'senha-ficticia-incorreta'});
assert.notEqual(wrong.status,200,'Senha errada foi aceita');
const longPassword='x'.repeat(100),longId=randomUUID(),longEmail='longa-'+randomUUID()+'@example.com';
const longHash=await argon2.hash(longPassword,{type:argon2.argon2id,memoryCost:19456,timeCost:2,parallelism:1});
const importedLong=await post('/admin/users',{id:longId,email:longEmail,password_hash:longHash,email_confirm:true},adminToken);
assert.equal(importedLong.status,200,'Importação da senha longa falhou');
const longLogin=await post('/token?grant_type=password',{email:longEmail,password:longPassword});
assert.equal(longLogin.status,200,'Conta Argon2 com senha longa não autenticou');
const signupLong=await post('/signup',{email:'nova-'+randomUUID()+'@example.com',password:longPassword});
assert.notEqual(signupLong.status,200,'Cadastro aceitou senha maior que o limite de bcrypt');
const pendingEmail='pendente-'+randomUUID()+'@example.com';
const pending=await post('/admin/users',{id:randomUUID(),email:pendingEmail,password_hash:hash,email_confirm:false},adminToken);
assert.equal(pending.status,200,'Criação de conta pendente falhou');
const pendingLogin=await post('/token?grant_type=password',{email:pendingEmail,password});
assert.notEqual(pendingLogin.status,200,'E-mail sem confirmação não deveria autenticar');
console.log('Auth isolado importou um hash Argon2id e preservou o identificador fictício.');
console.log('Senha longa importada autenticou; cadastro novo com mais de 72 bytes foi recusado.');
console.log('Conta fictícia sem e-mail confirmado foi impedida de entrar.');

// Utiliza a API real do projeto e um SQLite efêmero, sem contato com dados reais.
const dbPath='/tmp/auth-qa-'+randomUUID()+'.sqlite';
const setupToken=randomUUID()+randomUUID();
const app=await createApp({dbPath,ownerSetupToken:setupToken,apiKey:'testkey',apiSecret:'segredo-ficticio-apenas-para-teste',serverUrl:'ws://localhost:7880',logger:false,secureCookies:false,allowedOrigins:['http://localhost:5173'],roomService:{listRooms:async()=>[]}});
try{
  const owner=await app.inject({method:'POST',url:'/auth/setup',headers:{origin:'http://localhost:5173'},payload:{token:setupToken,password}});
  assert.equal(owner.statusCode,200);
  assert.equal(owner.json().user.owner,true);
  const auth={origin:'http://localhost:5173',cookie:'pg_session='+owner.cookies[0].value,'x-csrf-token':owner.json().csrf};
  const msg=await app.inject({method:'POST',url:'/messages',headers:auth,payload:{text:'Mensagem fictícia',clientId:randomUUID()}});
  assert.equal(msg.statusCode,201);
  const sqlite=new DatabaseSync(dbPath,{readOnly:true});
  let storedHash;
  try{storedHash=sqlite.prepare('SELECT password_hash FROM users WHERE id=?').get(owner.json().user.id).password_hash;}finally{sqlite.close();}
  const migratedEmail='conta-'+randomUUID()+'@example.com';
  const imported=await post('/admin/users',{id:owner.json().user.id,email:migratedEmail,password_hash:storedHash,email_confirm:true},adminToken);
  assert.equal(imported.status,200);
  const authenticated=await post('/token?grant_type=password',{email:migratedEmail,password});
  assert.equal(authenticated.status,200);
  assert.equal(authenticated.body.user.id,owner.json().user.id);
  assert.equal(msg.json().user_id,authenticated.body.user.id);
  console.log('Conta proprietária e autoria fictícias preservaram o mesmo ID após importação.');
}finally{await app.close();}
