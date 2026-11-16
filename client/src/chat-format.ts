// Regras compartilhadas pelo chat: cor do nick e agrupamento de mensagens seguidas.

// Mesma regra do servidor: #RRGGBB com contraste mínimo de 3:1 no fundo escuro.
export function readableNameColor(value:string) {
  if (!/^#[0-9a-f]{6}$/i.test(value)) return false;
  const [r,g,b] = [1,3,5].map(index => parseInt(value.slice(index,index+2),16)/255).map(c => c <= 0.03928 ? c/12.92 : ((c+0.055)/1.055)**2.4);
  return 0.2126*r + 0.7152*g + 0.0722*b >= 0.13;
}

// Aceita "ff8800", "#FF8800" ou "#f80" e devolve "#ff8800", ou null se não for uma cor.
export function normalizeHexColor(value:string) {
  const hex = value.trim().replace(/^#/,'').toLowerCase();
  if (/^[0-9a-f]{3}$/.test(hex)) return '#'+[...hex].map(char => char+char).join('');
  return /^[0-9a-f]{6}$/.test(hex) ? '#'+hex : null;
}

export const GROUP_WINDOW_MS = 5 * 60 * 1000;
type Groupable = { user_id: string | null; name: string; timestamp: number; reply?: unknown };

// Uma mensagem continua o balão anterior quando vem da mesma conta, em até 5 minutos e sem ser resposta.
export function continuesGroup(previous: Groupable | undefined, message: Groupable) {
  if (!previous || message.reply) return false;
  const sameAuthor = message.user_id ? previous.user_id === message.user_id : !previous.user_id && previous.name === message.name;
  const elapsed = message.timestamp - previous.timestamp;
  return sameAuthor && elapsed >= 0 && elapsed <= GROUP_WINDOW_MS;
}
