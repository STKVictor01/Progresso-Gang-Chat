import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import {createVoiceProcessor} from '../src/voice-effects.ts';

function fakeContext() {
  const nodes=[];
  const node=()=>{const value={connected:[],disconnected:false,connect(target){this.connected.push(target);},disconnect(){this.disconnected=true;}};nodes.push(value);return value;};
  const outputTrack={stopped:false,stop(){this.stopped=true;}};
  const context={state:'running',createMediaStreamSource:()=>node(),createBiquadFilter:()=>Object.assign(node(),{frequency:{value:0},Q:{value:0},gain:{value:0}}),createMediaStreamDestination:()=>Object.assign(node(),{stream:{getAudioTracks:()=>[outputTrack]}}),createGain:()=>Object.assign(node(),{gain:{value:0}}),createOscillator:()=>Object.assign(node(),{frequency:{value:0},start(){this.started=true;},stop(){this.stopped=true;}}),createDynamicsCompressor:()=>Object.assign(node(),{threshold:{value:0},knee:{value:0},ratio:{value:0}})};
  return {context,nodes,outputTrack};
}

test('efeitos criam e limpam o áudio processado sem parar o microfone',async()=>{
  const saved=globalThis.MediaStream;
  globalThis.MediaStream=class {constructor(tracks){this.tracks=tracks;}};
  try {
    for(const effect of ['robo','radio']){
      const {context,nodes,outputTrack}=fakeContext();
      const input={stopped:false,stop(){this.stopped=true;}};
      const processor=createVoiceProcessor(effect);
      await processor.init({track:input,audioContext:context});
      assert.equal(processor.processedTrack,outputTrack);
      assert.ok(nodes.some(node=>node.connected.length>0));
      await processor.destroy();
      assert.equal(outputTrack.stopped,true);
      assert.equal(input.stopped,false);
      assert.ok(nodes.every(node=>node.disconnected));
      assert.equal(processor.processedTrack,undefined);
    }
  } finally {globalThis.MediaStream=saved;}
});

test('erro ao iniciar libera os nós já criados',async()=>{
  const saved=globalThis.MediaStream;
  globalThis.MediaStream=class {};
  const {context,nodes}=fakeContext();
  context.createDynamicsCompressor=()=>{throw Error('falha de áudio');};
  const processor=createVoiceProcessor('radio');
  try {await assert.rejects(processor.init({track:{},audioContext:context}),/falha de áudio/);assert.ok(nodes.every(node=>node.disconnected));}
  finally {globalThis.MediaStream=saved;}
});

test('troca de dispositivo recria o processamento sem encerrar os microfones',async()=>{
  const saved=globalThis.MediaStream;
  globalThis.MediaStream=class {};
  const first=fakeContext(),second=fakeContext();
  const microphoneA={stopped:false,stop(){this.stopped=true;}};
  const microphoneB={stopped:false,stop(){this.stopped=true;}};
  const processor=createVoiceProcessor('robo');
  try {
    await processor.init({track:microphoneA,audioContext:first.context});
    await processor.restart({track:microphoneB,audioContext:second.context});
    assert.equal(first.outputTrack.stopped,true);
    assert.equal(processor.processedTrack,second.outputTrack);
    assert.equal(microphoneA.stopped,false);
    assert.equal(microphoneB.stopped,false);
    await processor.destroy();
    assert.equal(second.outputTrack.stopped,true);
  } finally {globalThis.MediaStream=saved;}
});

test('efeitos infantis alteram a frequência sem interromper o áudio',()=>{
  let Processor;
  const sandbox={AudioWorkletProcessor:class {},sampleRate:48000,registerProcessor:(_name,processor)=>{Processor=processor;},Float32Array,Math};
  vm.runInNewContext(readFileSync(new URL('../public/voice-pitch-worklet.js',import.meta.url),'utf8'),sandbox);
  for(const ratio of [1.4,1.55]){
    const processor=new Processor({processorOptions:{ratio}});
    const samples=[];
    for(let block=0;block<300;block++){
      const input=Float32Array.from({length:128},(_,i)=>Math.sin(2*Math.PI*440*(block*128+i)/48000));
      const output=new Float32Array(128);
      assert.equal(processor.process([[input]],[[output]]),true);
      if(block>=100)samples.push(...output);
    }
    function strength(frequency){
      let real=0,imaginary=0;
      for(let i=0;i<samples.length;i++){
        const phase=2*Math.PI*frequency*i/48000;
        real+=samples[i]*Math.cos(phase);imaginary+=samples[i]*Math.sin(phase);
      }
      return Math.hypot(real,imaginary);
    }
    assert.ok(samples.every(Number.isFinite));
    const shifted=Math.max(...[-8,-6,-4,-2,0,2,4,6,8].map(offset=>strength(440*ratio+offset)));
    assert.ok(shifted>strength(440)*3,`ratio ${ratio} deve alterar a frequência`);
  }
});

test('navegador sem AudioWorklet informa falha e libera recursos',async()=>{
  const saved=globalThis.MediaStream;
  globalThis.MediaStream=class {};
  const {context,nodes}=fakeContext();
  const processor=createVoiceProcessor('bebe');
  try {
    await assert.rejects(processor.init({track:{},audioContext:context}),/indisponíveis/);
    assert.ok(nodes.every(node=>node.disconnected));
  } finally {globalThis.MediaStream=saved;}
});
