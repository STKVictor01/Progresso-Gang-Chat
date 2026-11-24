import test from 'node:test';
import assert from 'node:assert/strict';
import { api, jsonApi } from '../src/api.ts';

test('falha de conexão mostra instrução útil sem mencionar o computador do servidor', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('Failed to fetch'); });
  await assert.rejects(jsonApi('/api/auth/me'), {message:'Não foi possível conectar ao chat. Verifique sua internet e tente novamente.'});
});

test('indisponibilidade e rota de entrada ausente têm mensagens apropriadas ao site', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('{}', {status:503}));
  await assert.rejects(jsonApi('/api/auth/login', 'POST', {}), /indisponível no momento/);
  globalThis.fetch.mock.mockImplementation(async () => new Response('{}', {status:404}));
  await assert.rejects(jsonApi('/api/auth/login', 'POST', {}), /serviço de entrada/);
});

test('cancelamentos de chamadas diretas continuam identificáveis', async (t) => {
  const aborted = new DOMException('Cancelled', 'AbortError');
  t.mock.method(globalThis, 'fetch', async () => { throw aborted; });
  await assert.rejects(api('/api/messages'), error => error === aborted);
});
