import test from 'node:test';
import assert from 'node:assert/strict';
import { continuesGroup, normalizeHexColor, readableNameColor, GROUP_WINDOW_MS } from '../src/chat-format.ts';

test('cor do nick aceita formatos curtos e recusa cores ilegíveis', () => {
  assert.equal(normalizeHexColor('FF8800'), '#ff8800');
  assert.equal(normalizeHexColor(' #f80 '), '#ff8800');
  assert.equal(normalizeHexColor('#12345'), null);
  assert.equal(normalizeHexColor('vermelho'), null);
  assert.ok(readableNameColor('#ff8800'));
  assert.ok(readableNameColor('#ffffff'));
  assert.ok(!readableNameColor('#000000'));
  assert.ok(!readableNameColor('#1a1a1a'));
});

test('mensagens seguidas da mesma conta formam um balão', () => {
  const base = { user_id: 'a', name: 'Ana', timestamp: 1000 };
  assert.ok(continuesGroup(base, { ...base, timestamp: 1000 + GROUP_WINDOW_MS }));
  assert.ok(!continuesGroup(base, { ...base, timestamp: 1001 + GROUP_WINDOW_MS }));
  assert.ok(!continuesGroup(base, { ...base, user_id: 'b' }));
  assert.ok(!continuesGroup(base, { ...base, reply: { id: 1 } }));
  assert.ok(!continuesGroup(undefined, base));
  // Mensagens antigas sem conta só se juntam entre si, nunca com uma conta pelo apelido.
  assert.ok(continuesGroup({ user_id: null, name: 'Ana', timestamp: 1 }, { user_id: null, name: 'Ana', timestamp: 2 }));
  assert.ok(!continuesGroup({ user_id: null, name: 'Ana', timestamp: 1 }, { user_id: 'a', name: 'Ana', timestamp: 2 }));
});
