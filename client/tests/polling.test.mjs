import test from 'node:test';
import assert from 'node:assert/strict';
import { activityPollDelay, chatPollDelay } from '../src/polling.ts';

test('consultas ficam mais espaçadas em segundo plano sem atrasar o chat aberto',()=>{
  assert.equal(chatPollDelay(true,true),2000);
  assert.equal(chatPollDelay(true,false),12000);
  assert.equal(chatPollDelay(false,true),20000);
  assert.equal(activityPollDelay(true),6000);
  assert.equal(activityPollDelay(false),20000);
});
