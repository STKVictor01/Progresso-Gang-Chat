import test from 'node:test';
import assert from 'node:assert/strict';
import { hasMention } from '../src/mentions.ts';

test('menção identifica a conta exata com espaços e pontuação', () => {
  assert.equal(hasMention('Oi @Vitão, venha!', 'Vitão'), true);
  assert.equal(hasMention('Oi @Vitão 2', 'Vitão'), true);
  assert.equal(hasMention('Oi @Vitãozinho', 'Vitão'), false);
  assert.equal(hasMention('Oi @Ana Maria!', 'Ana Maria'), true);
  assert.equal(hasMention('Oi @AnaX', 'Ana.'), false);
  assert.equal(hasMention('Oi @Ana.', 'Ana.'), true);
});
