import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { TokenVerifier } from 'livekit-server-sdk';
import { createApp } from './app.js';
const options = { apiKey: 'testkey', apiSecret: 'test-secret-for-isolated-tests-0123456789', serverUrl: 'ws://localhost:7880', logger: false };
test('voice grants isolate the two allowed rooms and reject unknown rooms', async () => {
  const app = await createApp({ ...options, dbPath: ':memory:' });
  try {
    const verifier = new TokenVerifier(options.apiKey, options.apiSecret);
    const identities = [];
    for (const room of ['geral', 'jogatina']) {
      const response = await app.inject({ method: 'POST', url: '/token', payload: { name: 'Teste', room } });
      assert.equal(response.statusCode, 200);
      const claims = await verifier.verify(response.json().token);
      assert.equal(claims.video.room, room);
      assert.equal(claims.video.roomJoin, true);
      identities.push(claims.sub);
    }
    assert.notEqual(identities[0], identities[1]);
    assert.equal((await app.inject({ method: 'POST', url: '/token', payload: { name: 'Teste', room: 'desconhecido' } })).statusCode, 400);
    assert.equal((await app.inject({ method: 'POST', url: '/token', payload: { name: 'a' } })).statusCode, 400);
  } finally { await app.close(); }
});
test('text works without a voice token, survives restart, and retries do not duplicate', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'pg-chat-test-'));
  const dbPath = join(directory, 'chat.sqlite');
  let app = await createApp({ ...options, dbPath });
  try {
    const payload = { name: 'Teste local', text: '<script>texto seguro</script>', clientId: randomUUID() };
    const first = await app.inject({ method: 'POST', url: '/messages', payload });
    assert.equal(first.statusCode, 201);
    const retry = await app.inject({ method: 'POST', url: '/messages', payload });
    assert.equal(retry.json().id, first.json().id);
    assert.equal((await app.inject({ method: 'POST', url: '/messages', payload: { ...payload, text: 'outro texto' } })).statusCode, 409);
    assert.equal((await app.inject({ method: 'POST', url: '/messages', payload: { ...payload, text: ' ' } })).statusCode, 400);
    assert.equal((await app.inject('/messages?after=invalid')).statusCode, 400);
    await app.close(); app = await createApp({ ...options, dbPath });
    const saved = (await app.inject('/messages')).json().messages;
    assert.equal(saved.length, 1); assert.equal(saved[0].text, payload.text);
    assert.equal((await app.inject('/messages?after=' + saved[0].id)).json().messages.length, 0);
    for (let i = 0; i < 104; i++) await app.inject({ method: 'POST', url: '/messages', payload: { name: 'Teste', text: 'Mensagem ' + i, clientId: randomUUID() } });
    const latest = (await app.inject('/messages')).json();
    assert.equal(latest.messages.length, 100); assert.equal(latest.hasMore, true);
    const older = (await app.inject('/messages?before=' + latest.messages[0].id)).json();
    assert.equal(older.messages.length, 5); assert.equal(older.hasMore, false);
    assert.ok(older.messages.at(-1).id < latest.messages[0].id);
  } finally { await app.close(); for (const name of ['chat.sqlite', 'chat.sqlite-wal', 'chat.sqlite-shm']) rmSync(join(directory, name), { force: true }); rmdirSync(directory); }
});
