import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';

const app = await createApp({
  dbPath: fileURLToPath(new URL('./data/chat.sqlite', import.meta.url)),
  apiKey: process.env.LIVEKIT_API_KEY,
  apiSecret: process.env.LIVEKIT_API_SECRET,
  serverUrl: process.env.LIVEKIT_URL,
});
await app.listen({ host: '127.0.0.1', port: 3001 });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => app.close().then(() => process.exit(0)));
