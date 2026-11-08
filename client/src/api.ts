let csrf = '';
export function setCsrf(value: string) { csrf = value; }
export async function api(path: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers);
  if (options.method && !['GET','HEAD'].includes(options.method.toUpperCase())) headers.set('x-csrf-token',csrf);
  const response = await fetch(path,{signal:AbortSignal.timeout(15000),...options,headers,credentials:'same-origin'});
  if (response.status===401 && !path.startsWith('/api/auth/')) window.dispatchEvent(new Event('pg-session-expired'));
  return response;
}
export async function jsonApi(path: string, method = 'GET', body?: unknown) {
  const response = await api(path,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
<<<<<<< HEAD
  const data = await response.json();
  if (!response.ok) throw Error(data.error || 'Não foi possível concluir. Tente novamente.');
=======
  const data = await response.json().catch(() => ({}));
  if (response.ok) return data;
  // Fastify answers unknown routes with {error:'Not Found'}: the backend running on the PC is older than this page.
  if (response.status === 404 && path.startsWith('/api/auth/')) throw Error('O servidor do chat está desatualizado. No PC do Vitão, abra o atalho Progresso Gang Chat novamente para reiniciá-lo.');
  if (response.status >= 502 && response.status <= 504) throw Error('O servidor do chat não está respondendo. Confira se o atalho foi aberto no PC do Vitão.');
  if (!data.error || data.error === 'Not Found') throw Error('Não foi possível concluir. Tente novamente.');
  throw Error(data.error);
>>>>>>> 112d906 (Novas Atualizações)
  return data;
}
