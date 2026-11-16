// Executar somente dentro da API temporária de teste; nunca acessa o banco real.
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {TokenVerifier} from 'livekit-server-sdk';

assert.equal(process.env.PG_CHAT_SITE_ORIGIN,'https://gang.qa.invalid');
assert.match(process.env.DATABASE_URL || '', /^postgresql:\/\/postgres:[^@]+@pg-gang-qa-db-20261113:5432\/postgres$/);
const root='http://127.0.0.1:8080',origin=process.env.PG_CHAT_SITE_ORIGIN;
async function request(path,{method='GET',body,cookie,csrf,from=origin}={}){
  const headers={origin:from};
  if(body!==undefined)headers['content-type']='application/json';
  if(cookie)headers.cookie=cookie;
  if(csrf)headers['x-csrf-token']=csrf;
  const response=await fetch(root+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  const text=await response.text();let data;try{data=JSON.parse(text)}catch{data=text}
  return {response,data,cookie:response.headers.get('set-cookie')?.split(';')[0]};
}
const home=await request('/');assert.equal(home.response.status,200);assert.match(home.data,/<!doctype html>/i);
assert.equal(home.response.headers.get('x-frame-options'),'DENY');assert.equal(home.response.headers.get('x-content-type-options'),'nosniff');
assert.equal((await request('/pagina-inexistente')).response.status,200);
assert.equal((await request('/api/ready')).response.status,404);
assert.equal((await request('/api/health')).response.status,404);
assert.equal((await request('/api/messages')).response.status,401);
const setupPath='/app/server/data/owner-setup.json';
const admin=existsSync(setupPath)
  ? await request('/api/auth/setup',{method:'POST',body:{token:JSON.parse(readFileSync(setupPath,'utf8')).token,password:'senha-ficticia-de-teste'}})
  : await request('/api/auth/login',{method:'POST',body:{username:'Teste',password:'senha-ficticia-de-teste'}});
assert.equal(admin.response.status,200);assert.match(admin.response.headers.get('set-cookie'),/HttpOnly/i);assert.match(admin.response.headers.get('set-cookie'),/Secure/i);
const credentials={cookie:admin.cookie,csrf:admin.data.csrf};
assert.equal((await request('/api/admin/invites',{method:'POST',body:{},...credentials,from:'https://evil.invalid'})).response.status,403);
assert.equal((await request('/api/admin/invites',{method:'POST',body:{},cookie:admin.cookie})).response.status,403);
const invite=await request('/api/admin/invites',{method:'POST',body:{},...credentials});assert.equal(invite.response.status,200);
const member=await request('/api/auth/register',{method:'POST',body:{token:invite.data.token,username:'Pessoa '+randomUUID().slice(0,8),password:'senha-ficticia-de-teste'}});assert.equal(member.response.status,201);
const user={cookie:member.cookie,csrf:member.data.csrf};
assert.equal((await request('/api/admin/invites',{method:'POST',body:{},...user})).response.status,403);
const first=await request('/api/messages',{method:'POST',body:{text:'Mensagem sintética',clientId:randomUUID()},...credentials});assert.equal(first.response.status,201);
const reply=await request('/api/messages',{method:'POST',body:{text:'Resposta sintética',replyTo:first.data.id,clientId:randomUUID()},...user});assert.equal(reply.response.status,201);assert.equal(reply.data.reply.text,'Mensagem sintética');
assert.equal((await request('/api/messages/'+first.data.id,{method:'DELETE',...user})).response.status,403);
const history=(await request('/api/messages',{...user})).data.messages;
assert.ok(history.some(message=>message.id===first.data.id));assert.ok(history.some(message=>message.id===reply.data.id));
const access=await request('/api/token',{method:'POST',body:{room:'geral'},...user});assert.equal(access.response.status,200);
const grant=await new TokenVerifier('testonlykey','abcdefghijklmnopqrstuvwxyz1234567890').verify(access.data.token);
assert.equal(grant.video.room,'geral');assert.equal(grant.video.roomJoin,true);
console.log('Proxy, site, TLS do banco, contas, permissões, chat e token de voz verificados com dados fictícios.');
