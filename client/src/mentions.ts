export function mentionRanges(text:string, names:string[]) {
  const unique=[...new Set(names.filter(Boolean))].sort((a,b)=>b.length-a.length);
  if(!unique.length)return [];
  const escaped=unique.map(name=>name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));
  const pattern=new RegExp('(^|\\s)@('+escaped.join('|')+')(?=$|[\\s.,!?;:])','giu');
  return Array.from(text.matchAll(pattern),match=>({start:match.index!+match[1].length,end:match.index!+match[0].length,name:match[2]}));
}
export function hasMention(text:string, name:string) { return mentionRanges(text,[name]).length>0; }
export function mentionQuery(text:string, caret:number) {
  const before=text.slice(0,caret);
  const match=/(?:^|\s)@([^@\n]{0,32})$/u.exec(before);
  if(!match)return null;
  return {start:caret-match[1].length-1,end:caret,query:match[1]};
}
