let csrf = '';
export function setCsrf(value: string) { csrf = value; }
export async function api(path: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers);
  if (options.method && !['GET','HEAD'].includes(options.method.toUpperCase())) headers.set('x-csrf-token',csrf);
  const response = await fetch(path,{signal:typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(15000) : undefined,...options,headers,credentials:'same-origin'});
  if (response.status===401 && !['/api/auth/login','/api/auth/setup','/api/auth/register'].includes(path)) window.dispatchEvent(new Event('pg-session-expired'));
  return response;
}
export async function jsonApi(path: string, method = 'GET', body?: unknown) {
  let response: Response;
  try {
    response = await api(path, body === undefined
      ? { method }
      : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch { throw Error('Não foi possível conectar ao chat. Verifique sua internet e tente novamente.'); }
  const data = await response.json().catch(() => ({}));
  if (response.ok) return data;
  if (response.status === 404 && path.startsWith('/api/auth/')) throw Error('Não foi possível acessar o serviço de entrada. Tente novamente ou avise um administrador.');
  if (response.status >= 502 && response.status <= 504) throw Error('O servidor do chat está indisponível no momento. Tente novamente em instantes.');
  if (!data.error || data.error === 'Not Found') throw Error('Não foi possível concluir. Tente novamente.');
  throw Error(data.error);
}
