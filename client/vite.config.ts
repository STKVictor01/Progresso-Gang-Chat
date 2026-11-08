import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    fs: { deny: ['**/.env', '**/.env.*', '**/.git/**', '**/server/**', '**/*.sqlite*', '**/owner-setup.json', '**/livekit*.yaml'] },
    allowedHosts: process.env.PG_CHAT_HOST ? [process.env.PG_CHAT_HOST] : [],
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
