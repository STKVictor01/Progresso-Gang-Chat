// Laboratório descartável. Não importa index.js, dotenv nem configurações reais.
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';

const secret = () => randomBytes(32).toString('base64url');

export async function createSecurityLab(origin = 'http://127.0.0.1:4311') {
  const setupToken = secret();
  const app = await createApp({
    dbPath: ':memory:',
    apiKey: 'security-lab',
    apiSecret: secret(),
    serverUrl: 'ws://127.0.0.1:1',
    roomService: { listRooms: async () => [], listParticipants: async () => [] },
    ownerSetupToken: setupToken,
    ownerSetupExpiresAt: Date.now() + 60_000,
    allowedOrigins: [origin],
    secureCookies: false, // Somente HTTP em loopback, nesta instância em memória.
    logger: false,
    musicMaxRooms: 1,
  });
  const users = [];
  const credentials = { origin, users };
  async function request(method, url, payload, actor) {
    const response = await app.inject({ method, url, payload, headers: {
      origin,
      ...(actor ? { cookie: actor.cookie, 'x-csrf-token': actor.csrf } : {}),
    } });
    if (response.statusCode >= 400) throw Error(`Falha ao preparar laboratório: ${method} ${url} (${response.statusCode}).`);
    return response;
  }
  function actor(response) {
    return {
      cookie: response.cookies.map(item => `${item.name}=${item.value}`).join('; '),
      csrf: response.json().csrf,
    };
  }
  try {
    const ownerPassword = secret();
    const ownerResponse = await request('POST', '/auth/setup', { token: setupToken, password: ownerPassword });
    const owner = actor(ownerResponse);
    const renamed = await request('PATCH', '/auth/username', { username: 'Admin Laboratório' }, owner);
    users.push({ ...renamed.json().user, password: ownerPassword });
    for (const username of ['Membro Laboratório A', 'Membro Laboratório B']) {
      const invite = await request('POST', '/admin/invites', {}, owner);
      const password = secret();
      const response = await request('POST', '/auth/register', { username, password, token: invite.json().token });
      users.push({ ...response.json().user, password });
      await request('POST', '/messages', {
        channel: 'general', text: 'Mensagem fictícia para testes de autorização.', clientId: randomUUID(),
      }, actor(response));
    }
    return { app, credentials };
  } catch (error) {
    await app.close();
    throw error;
  }
}

async function main() {
  const port = Number(process.env.PG_SECURITY_LAB_PORT || 4311);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('Porta de laboratório inválida.');
  const { app, credentials } = await createSecurityLab(`http://127.0.0.1:${port}`);
  try {
    await app.listen({ host: '127.0.0.1', port });
    const reports = resolve(dirname(fileURLToPath(import.meta.url)), '../security-reports');
    await mkdir(reports, { recursive: true, mode: 0o700 });
    const directory = await mkdtemp(join(reports, 'lab-'));
    const file = join(directory, 'credentials.json');
    await writeFile(file, JSON.stringify(credentials, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    console.log(`Laboratório descartável: ${credentials.origin}`);
    console.log(`Contas fictícias salvas em: ${file}`);
    console.log('Banco em memória; LiveKit simulado; Ctrl+C encerra e descarta os dados.');
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
      app.close().then(() => { process.exitCode = 0; });
    });
  } catch (error) {
    await app.close();
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    console.error('Não foi possível iniciar o laboratório. Confira dependências e porta; nenhuma configuração real é necessária.');
    process.exitCode = 1;
  });
}
