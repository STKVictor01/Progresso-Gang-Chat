import test from 'node:test';
import assert from 'node:assert/strict';
import { createLongPress } from '../src/long-press.ts';

test('toque prolongado abre uma vez e impede o clique acidental', async () => {
  const hold=createLongPress(20);let opened=0;
  hold.start(10,10,()=>opened++);
  await new Promise(resolve=>setTimeout(resolve,40));
  assert.equal(opened,1);
  hold.cancel();
  assert.equal(hold.consumeClick(),true);
  assert.equal(hold.consumeClick(),false);
});

test('rolagem e toque curto não abrem o menu', async () => {
  const hold=createLongPress(20);let opened=0;
  hold.start(10,10,()=>opened++);hold.move(10,25);
  await new Promise(resolve=>setTimeout(resolve,30));
  hold.start(10,10,()=>opened++);hold.cancel();
  await new Promise(resolve=>setTimeout(resolve,30));
  assert.equal(opened,0);
  assert.equal(hold.consumeClick(),false);
});

test('menu de contexto durante o toque cancela o temporizador', async () => {
  const hold=createLongPress(20);let opened=0;
  hold.start(1,1,()=>opened++);hold.contextMenu();
  await new Promise(resolve=>setTimeout(resolve,30));
  assert.equal(opened,0);
  assert.equal(hold.consumeClick(),true);
});
