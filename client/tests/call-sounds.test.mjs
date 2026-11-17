import test from 'node:test';
import assert from 'node:assert/strict';
import { playJoinSound, playLeaveSound } from '../src/call-sounds.ts';

test('som de entrada usa a conta da pessoa e recorre ao padrão quando não existe', () => {
  const previous=globalThis.Audio, players=[];
  globalThis.Audio=class {
    constructor(src){this.src=src;players.push(this);}
    addEventListener(event,callback){if(event==='error')this.onError=callback;}
    play(){return Promise.resolve();}
  };
  try {
    const user='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    playJoinSound(0.25,user);
    assert.equal(players[0].src,'/api/voice-entry/'+user);
    assert.equal(players[0].volume,0.25);
    players[0].onError();
    assert.equal(players[1].src,'/sounds/entrar-na-call.mp3');
    playJoinSound(0.4,'invalid');
    assert.equal(players[2].src,'/sounds/entrar-na-call.mp3');
    playLeaveSound();
    assert.equal(players[3].src,'/sounds/sair-da-call.mp3');
  } finally {globalThis.Audio=previous;}
});
