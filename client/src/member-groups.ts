type Person = {id:string;name:string;active?:boolean};
type VoiceChannel = {id:string;name:string};

// A call atual usa o LiveKit; a presença de outras salas pode chegar com atraso.
export function groupMembers<T extends Person,C extends VoiceChannel>({people,profiles,voice,voiceChannels,activeVoice,activeIds}:{people:T[];profiles:T[];voice:C[];voiceChannels:Record<string,string[]>|null;activeVoice:string|null;activeIds:string[]}) {
  const active=new Set(activeIds),seen=new Set(active);
  const otherVoice=voice.filter(channel=>channel.id!==activeVoice);
  const inCall=new Set([...active,...otherVoice.flatMap(channel=>voiceChannels?.[channel.id] ?? [])]);
  const online=new Set(people.map(person=>person.id));
  const otherCalls=otherVoice.map(channel=>({channel,members:(voiceChannels?.[channel.id] ?? []).map(id=>profiles.find(person=>person.id===id)).filter((person):person is T=>{if(!person||seen.has(person.id))return false;seen.add(person.id);return true;})})).filter(group=>group.members.length);
  const available=people;
  const offline=profiles.filter(person=>person.active!==false&&!online.has(person.id)&&!inCall.has(person.id)).sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
  return {otherCalls,available,offline,callTotal:active.size+otherCalls.reduce((sum,group)=>sum+group.members.length,0)};
}
