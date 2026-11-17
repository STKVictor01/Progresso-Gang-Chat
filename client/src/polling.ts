// A aba visível mantém respostas rápidas; ao voltar, os chamadores atualizam imediatamente.
export function chatPollDelay(pageVisible:boolean,channelVisible:boolean) {
  return !pageVisible ? 20_000 : channelVisible ? 2_000 : 12_000;
}
export function activityPollDelay(pageVisible:boolean) { return pageVisible ? 6_000 : 20_000; }
