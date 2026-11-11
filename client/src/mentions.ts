export function hasMention(text:string, name:string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('(?:^|\\s)@' + escaped + '(?=$|[\\s.,!?;:])', 'iu').test(text);
}
