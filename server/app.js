import Fastify from 'fastify';
import cors from '@fastify/cors';
import { AccessToken } from 'livekit-server-sdk';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const VOICE_CHANNELS = [{ id: 'geral', name: 'Geral' }, { id: 'jogatina', name: 'Jogatina' }];
const validName = name => typeof name === 'string' && name.trim().length >= 2 && name.trim().length <= 32;

export async function createApp({ dbPath, apiKey, apiSecret, serverUrl, logger = true }) {
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      text TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    );`);
  const app = Fastify({ logger, bodyLimit: 16384 });
  app.addHook('onClose', async () => db.close());
  await app.register(cors, { origin: 'http://localhost:5173' });
  app.get('/health', async () => ({ status: 'online', application: 'progresso-gang-chat', version: 2 }));
  app.get('/channels', async () => ({ voice: VOICE_CHANNELS, text: [{ id: 'geral', name: 'geral' }] }));
  app.post('/token', async (request, reply) => {
    const { name, room = 'geral' } = request.body ?? {};
    if (!validName(name)) return reply.code(400).send({ error: 'Escolha um apelido de 2 a 32 caracteres.' });
    if (!VOICE_CHANNELS.some(channel => channel.id === room)) return reply.code(400).send({ error: 'Canal de voz inválido.' });
    const token = new AccessToken(apiKey, apiSecret, { identity: randomUUID(), name: name.trim(), ttl: '2h' });
    token.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true });
    return { token: await token.toJwt(), serverUrl, room };
  });
  app.get('/messages', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const { after, before } = request.query;
    if ((after !== undefined && !/^\d+$/.test(after)) || (before !== undefined && !/^\d+$/.test(before)) || (after !== undefined && before !== undefined)) {
      return reply.code(400).send({ error: 'Página de mensagens inválida.' });
    }
    const cursor = Number(after ?? before ?? 0);
    if (!Number.isSafeInteger(cursor)) return reply.code(400).send({ error: 'Página de mensagens inválida.' });
    if (after !== undefined) {
      const messages = db.prepare('SELECT id, name, text, timestamp FROM messages WHERE id > ? ORDER BY id ASC LIMIT 100').all(cursor);
      return { messages };
    }
    const rows = before === undefined
      ? db.prepare('SELECT id, name, text, timestamp FROM messages ORDER BY id DESC LIMIT 101').all()
      : db.prepare('SELECT id, name, text, timestamp FROM messages WHERE id < ? ORDER BY id DESC LIMIT 101').all(cursor);
    return { messages: rows.slice(0, 100).reverse(), hasMore: rows.length > 100 };
  });
  app.post('/messages', async (request, reply) => {
    const { name, text, clientId } = request.body ?? {};
    if (!validName(name) || typeof text !== 'string' || !text.trim() || text.trim().length > 2000 || typeof clientId !== 'string' || !/^[a-f0-9-]{36}$/i.test(clientId)) {
      return reply.code(400).send({ error: 'Confira o apelido e escreva uma mensagem de até 2.000 caracteres.' });
    }
    const previous = db.prepare('SELECT id, name, text, timestamp FROM messages WHERE client_id = ?').get(clientId);
    if (previous) {
      if (previous.name !== name.trim() || previous.text !== text.trim()) return reply.code(409).send({ error: 'Identificador de mensagem já utilizado.' });
      return previous;
    }
    const timestamp = Date.now();
    const result = db.prepare('INSERT INTO messages (client_id, name, text, timestamp) VALUES (?, ?, ?, ?)').run(clientId, name.trim(), text.trim(), timestamp);
    return reply.code(201).send({ id: Number(result.lastInsertRowid), name: name.trim(), text: text.trim(), timestamp });
  });
  return app;
}
