import test from 'node:test';
import assert from 'node:assert/strict';
import { hasMention, mentionQuery, mentionRanges } from '../src/mentions.ts';

test('menção identifica a conta exata com espaços e pontuação', () => {
  assert.equal(hasMention('Oi @Vitão, venha!', 'Vitão'), true);
  assert.equal(hasMention('Oi @Vitão 2', 'Vitão'), true);
  assert.equal(hasMention('Oi @Vitãozinho', 'Vitão'), false);
  assert.equal(hasMention('Oi @Ana Maria!', 'Ana Maria'), true);
  assert.equal(hasMention('Oi @AnaX', 'Ana.'), false);
  assert.equal(hasMention('Oi @Ana.', 'Ana.'), true);
});
test('localiza menções antigas e escolhe o nome mais longo',()=>{
  const text='Olá @Ana Maria e @Ana!';
  const ranges=mentionRanges(text,['Ana','Ana Maria']);
  assert.deepEqual(ranges.map(item=>text.slice(item.start,item.end)),['@Ana Maria','@Ana']);
  assert.equal(mentionRanges('email@Ana.com',['Ana']).length,0);
});
test('sugere ao digitar @ na posição do cursor',()=>{
  assert.deepEqual(mentionQuery('Oi @Ana resto',7),{start:3,end:7,query:'Ana'});
  assert.deepEqual(mentionQuery('@',1),{start:0,end:1,query:''});
  assert.equal(mentionQuery('email@Ana',9),null);
  assert.equal(mentionQuery('sem menção',10),null);
});
