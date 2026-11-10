import { appendFileSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';

const events=new Set(['server-start','server-stop','login','logout','voice-join','voice-leave','server-error','message-send','message-delete','user-register','user-update','channel-create','channel-update','site-update','sound-delete']);
const clean=value=>typeof value==='string'?value.replace(/[\r\n\u0000-\u001f]/g,' ').slice(0,120):undefined;

export function createActivityLog(file) {
  let entries=[];
  if(file && existsSync(file)) {
    try { entries=readFileSync(file,'utf8').split('\n').filter(Boolean).slice(-500).map(line=>JSON.parse(line)).filter(entry=>events.has(entry.event)); }
    catch { entries=[]; }
  }
  function record(event,details={}) {
    if(!events.has(event))return;
    const entry={time:Date.now(),event,actor:clean(details.actor),channel:clean(details.channel),route:clean(details.route),status:Number.isInteger(details.status)?details.status:undefined};
    entries.push(entry);if(entries.length>500)entries.shift();
    if(file)try {
      if(existsSync(file)&&statSync(file).size>1024*1024)writeFileSync(file,entries.slice(0,-1).map(item=>JSON.stringify(item)).join('\n')+'\n');
      appendFileSync(file,JSON.stringify(entry)+'\n');
    } catch { /* Logging must not interrupt the chat. */ }
  }
  return {record,list:()=>entries.slice().reverse()};
}
