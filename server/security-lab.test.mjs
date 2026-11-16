import test from 'node:test';
import assert from 'node:assert/strict';
import { createSecurityLab } from './security-lab.mjs';

test('laboratório usa SQLite em memória, contas distintas e autorização real da API', async () => {
  const { app, credentials } = await createSecurityLab();
  try {
    assert.equal((await app.inject('/health')).json().database, 'sqlite');
    assert.equal((await app.inject('/messages?channel=general')).statusCode, 401);
    assert.equal(credentials.users.length, 3);
    assert.equal(new Set(credentials.users.map(user => user.id)).size, 3);
    const member = credentials.users.find(user => user.role === 'member');
    const login = await app.inject({ method: 'POST', url: '/auth/login',
      headers: { origin: credentials.origin }, payload: { username: member.name, password: member.password } });
    assert.equal(login.statusCode, 200);
    const headers = { origin: credentials.origin,
      cookie: login.cookies.map(item => `${item.name}=${item.value}`).join('; '),
      'x-csrf-token': login.json().csrf };
    assert.equal((await app.inject({ url: '/admin/users', headers })).statusCode, 403);
    const messages = (await app.inject({ url: '/messages?channel=general', headers })).json().messages;
    assert.equal(messages.length, 2);
    const other = messages.find(message => message.user_id !== member.id);
    assert.equal((await app.inject({ method: 'DELETE', url: `/messages/${other.id}`, headers })).statusCode, 403);
    assert.equal((await app.inject({ method: 'POST', url: '/messages', headers: { ...headers, 'x-csrf-token': '' },
      payload: { channel: 'general', text: 'teste' } })).statusCode, 403);
  } finally { await app.close(); }
});

test('duas instâncias do laboratório não compartilham contas, senhas nem mensagens', async () => {
  const first = await createSecurityLab();
  const second = await createSecurityLab();
  try {
    const user = first.credentials.users[0];
    assert.notEqual(user.id, second.credentials.users[0].id);
    const response = await second.app.inject({ method: 'POST', url: '/auth/login',
      headers: { origin: second.credentials.origin }, payload: { username: user.name, password: user.password } });
    assert.equal(response.statusCode, 401);
  } finally { await Promise.all([first.app.close(), second.app.close()]); }
});
