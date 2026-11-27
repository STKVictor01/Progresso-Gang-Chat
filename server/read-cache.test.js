import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from './app.js';

const origin = 'http://localhost:5173';
const password = randomBytes(24).toString('base64url');
const base = { apiKey:'testkey', apiSecret:randomBytes(32).toString('hex'), serverUrl:'ws://localhost:7880', logger:false, secureCookies:false, allowedOrigins:[origin] };
const auth = result => ({ origin, cookie:'pg_session=' + result.cookies.find(cookie => cookie.name === 'pg_session').value, 'x-csrf-token':result.json().csrf });

test('consultas periódicas sem novidade não vão ao banco, e novidades aparecem na hora', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gang-cache-')), token = randomBytes(32).toString('base64url');
  // Conta as consultas preparadas pelo SQLite enquanto o teste roda.
  let queries = 0;
  const original = DatabaseSync.prototype.prepare;
  DatabaseSync.prototype.prepare = function (...args) { queries++; return original.apply(this, args); };
  const app = await createApp({ ...base, dbPath:join(dir, 'chat.sqlite'), ownerSetupToken:token });
  const call = (headers, method, url, payload) => app.inject({ headers, method, url, payload });
  try {
    const admin = auth(await call({ origin }, 'POST', '/auth/setup', { token, password }));
    const member = auth(await call({ origin }, 'POST', '/auth/register', { token:(await call(admin, 'POST', '/admin/invites', {})).json().token, username:'Pessoa', password }));
    const first = (await call(member, 'GET', '/messages?channel=general')).json();
    await call(member, 'GET', '/messages?channel=general&since=' + first.cursor);

    const before = queries;
    for (let i = 0; i < 5; i++) assert.deepEqual((await call(member, 'GET', '/messages?channel=general&since=' + first.cursor)).json().messages, []);
    // Sobram só as consultas da sessão (login), nenhuma de mensagens ou canais.
    const perPoll = (queries - before) / 5;
    assert.ok(perPoll <= 2, 'consultas por verificação sem novidade: ' + perPoll);

    const sent = await call(admin, 'POST', '/messages', { text:'novidade', clientId:randomUUID() });
    const next = (await call(member, 'GET', '/messages?channel=general&since=' + first.cursor)).json();
    assert.deepEqual(next.messages.map(message => message.text), ['novidade'], 'mensagem nova aparece na verificação seguinte');
    assert.equal((await call(admin, 'DELETE', '/messages/' + sent.json().id)).statusCode, 200);
    const after = (await call(member, 'GET', '/messages?channel=general&since=' + next.cursor)).json();
    assert.deepEqual(after.deletedIds, [sent.json().id], 'exclusão aparece na verificação seguinte');

    // Canal criado é encontrado na hora; canal excluído deixa de existir na hora.
    const created = await call(admin, 'POST', '/admin/channels', { name:'novo', kind:'text' });
    const id = created.json().id;
    assert.equal((await call(member, 'GET', '/messages?channel=' + id)).statusCode, 200);
    assert.equal((await call(admin, 'DELETE', '/admin/channels/text/' + id)).statusCode, 200);
    assert.equal((await call(member, 'GET', '/messages?channel=' + id)).statusCode, 400);
    assert.equal((await call(member, 'POST', '/messages', { channel:id, text:'canal apagado', clientId:randomUUID() })).statusCode, 400);
  } finally { DatabaseSync.prototype.prepare = original; await app.close(); rmSync(dir, { recursive:true, force:true }); }
});
