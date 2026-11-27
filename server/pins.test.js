import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { createApp } from './app.js';
import { createPinStore, MAX_PINS_PER_CHANNEL } from './pins.js';

const origin = 'http://localhost:5173';
const password = randomBytes(24).toString('base64url');
const base = { apiKey:'testkey', apiSecret:randomBytes(32).toString('hex'), serverUrl:'ws://localhost:7880', logger:false, secureCookies:false, allowedOrigins:[origin] };
const auth = result => ({ origin, cookie:'pg_session=' + result.cookies.find(cookie => cookie.name === 'pg_session').value, 'x-csrf-token':result.json().csrf });

test('arquivo de fixadas ignora dados inválidos, limita por canal e grava sem corromper', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gang-pins-store-'));
  try {
    const file = join(dir, 'pins.json');
    writeFileSync(file, JSON.stringify({ channels:{ general:[{id:1,pinnedBy:'u1',pinnedAt:5},{id:1,pinnedBy:'u1',pinnedAt:6},{id:'x'},null], '../fora':[{id:2,pinnedBy:'u',pinnedAt:1}] } }));
    const store = createPinStore(file);
    assert.deepEqual(store.list('general'), [{ id:1, pinnedBy:'u1', pinnedAt:5 }]);
    assert.deepEqual(store.list('../fora'), []);
    for (let id = 2; id <= MAX_PINS_PER_CHANNEL; id++) assert.equal(store.add('general', id, 'u1'), 'added');
    assert.equal(store.add('general', 999, 'u1'), 'full');
    assert.equal(store.add('general', 1, 'u1'), 'exists');
    assert.equal(createPinStore(file).list('general').length, MAX_PINS_PER_CHANNEL);
    assert.equal(store.remove(1), true);
    assert.equal(store.find(1), null);
    writeFileSync(file, '{quebrado');
    assert.deepEqual(createPinStore(file).list('general'), []);
  } finally { rmSync(dir, { recursive:true, force:true }); }
});

test('fixar mensagens: qualquer membro fixa; só quem fixou, o autor ou admin desafixa', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gang-pins-')), pinsPath = join(dir, 'pins.json'), activityLogPath = join(dir, 'activity.jsonl');
  const token = randomBytes(32).toString('base64url');
  let app = await createApp({ ...base, dbPath:join(dir, 'chat.sqlite'), pinsPath, activityLogPath, ownerSetupToken:token });
  const call = (headers, method, url, payload) => app.inject({ headers, method, url, payload });
  try {
    const admin = auth(await call({ origin }, 'POST', '/auth/setup', { token, password }));
    const register = async name => auth(await call({ origin }, 'POST', '/auth/register', { token:(await call(admin, 'POST', '/admin/invites', {})).json().token, username:name, password }));
    const a = await register('Pessoa A'), b = await register('Pessoa B'), c = await register('Pessoa C');
    const secret = 'conteúdo que não pode ir para o arquivo';
    const id = (await call(a, 'POST', '/messages', { text:secret, clientId:randomUUID() })).json().id;

    assert.equal((await app.inject({ method:'GET', url:'/pins?channel=general' })).statusCode, 401);
    assert.equal((await call({ ...b, 'x-csrf-token':'errado' }, 'POST', '/messages/' + id + '/pin', {})).statusCode, 403);
    assert.equal((await call(b, 'GET', '/pins?channel=inexistente')).statusCode, 400);
    assert.equal((await call(b, 'POST', '/messages/999999/pin', {})).statusCode, 404);
    assert.equal((await call(b, 'POST', '/messages/' + id + '/pin', {})).statusCode, 200);
    assert.equal((await call(b, 'POST', '/messages/' + id + '/pin', {})).statusCode, 200, 'fixar de novo não duplica');

    const listed = (await call(c, 'GET', '/pins?channel=general')).json();
    assert.equal(listed.pins.length, 1);
    assert.equal(listed.pins[0].message.text, secret);
    assert.equal(listed.pins[0].pinnedBy, 'Pessoa B');
    assert.equal(listed.pins[0].canUnpin, false);
    assert.equal((await call(c, 'DELETE', '/messages/' + id + '/pin')).statusCode, 403);
    assert.equal((await call(a, 'GET', '/pins?channel=general')).json().pins[0].canUnpin, true, 'o autor pode desafixar');
    assert.equal((await call(admin, 'GET', '/pins?channel=general')).json().pins[0].canUnpin, true);

    const stored = readFileSync(pinsPath, 'utf8');
    assert.ok(!stored.includes(secret) && !stored.includes('Pessoa'), 'o arquivo guarda só referências');
    assert.ok(readFileSync(activityLogPath, 'utf8').includes('"message-pin"'));
    assert.ok(!readFileSync(activityLogPath, 'utf8').includes(secret));

    // Persiste após reiniciar o servidor.
    await app.close();
    app = await createApp({ ...base, dbPath:join(dir, 'chat.sqlite'), pinsPath, activityLogPath });
    assert.equal((await call(c, 'GET', '/pins?channel=general')).json().pins.length, 1);

    assert.equal((await call(b, 'DELETE', '/messages/' + id + '/pin')).statusCode, 200);
    assert.equal((await call(b, 'DELETE', '/messages/' + id + '/pin')).statusCode, 404);
    assert.equal((await call(c, 'GET', '/pins?channel=general')).json().pins.length, 0);

    // Mensagem excluída sai das fixadas.
    assert.equal((await call(c, 'POST', '/messages/' + id + '/pin', {})).statusCode, 200);
    assert.equal((await call(a, 'DELETE', '/messages/' + id)).statusCode, 200);
    assert.equal((await call(c, 'GET', '/pins?channel=general')).json().pins.length, 0);
    assert.equal((await call(c, 'POST', '/messages/' + id + '/pin', {})).statusCode, 404);
  } finally { await app.close(); rmSync(dir, { recursive:true, force:true }); }
});
