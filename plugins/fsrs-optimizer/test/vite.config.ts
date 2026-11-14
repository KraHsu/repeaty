import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
export default defineConfig({
  root: fileURLToPath(new URL('..', import.meta.url)),
  server: { host: '127.0.0.1', port: 4199, strictPort: true },
  resolve: {
    alias: { '@repeaty/plugin-api': fileURLToPath(new URL('./browser-api.ts', import.meta.url)) },
  },
})
