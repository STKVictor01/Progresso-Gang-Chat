import test from 'node:test';
import assert from 'node:assert/strict';
import {groupMembers} from '../src/member-groups.ts';

test('presença antiga da própria call não faz membro online desaparecer',()=>{
  const people=[{id:'a',name:'Ana'},{id:'b',name:'Bia'}];
  const result=groupMembers({people,profiles:people,voice:[{id:'v',name:'Voz'}],voiceChannels:{v:['a','b']},activeVoice:'v',activeIds:['a']});
  assert.deepEqual(result.available.map(person=>person.id),['a','b']);
  assert.equal(result.callTotal,1);assert.deepEqual(result.offline,[]);
});
test('contas em calls diferentes não aparecem duplicadas nem como offline',()=>{
  const profiles=[{id:'a',name:'Ana'},{id:'b',name:'Bia'},{id:'c',name:'Caio'},{id:'d',name:'Duda'}];
  const result=groupMembers({people:profiles.slice(0,2),profiles,voice:[{id:'v1',name:'Voz 1'},{id:'v2',name:'Voz 2'},{id:'v3',name:'Voz 3'}],voiceChannels:{v1:['a'],v2:['a','c'],v3:['c']},activeVoice:'v1',activeIds:['a','a']});
  assert.equal(result.callTotal,2);assert.deepEqual(result.otherCalls.map(group=>group.members.map(person=>person.id)),[['c']]);
  assert.deepEqual(result.available.map(person=>person.id),['a','b']);assert.deepEqual(result.offline.map(person=>person.id),['d']);
});
