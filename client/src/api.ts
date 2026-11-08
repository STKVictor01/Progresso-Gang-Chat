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
  const data = await response.json();
  if (!response.ok) throw Error(data.error || 'Não foi possível concluir. Tente novamente.');
  return data;
}
