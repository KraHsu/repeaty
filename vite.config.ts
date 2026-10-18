import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { offlinePlugin } from './build/offline.ts'
import { fileURLToPath } from 'node:url'

export default defineConfig(({ mode }) => {
  const server = mode === 'server'
  return {
    base: server ? '/' : process.env.VITE_BASE_PATH || '/',
    define: { __REPEATY_EDITION__: JSON.stringify(server ? 'server' : 'static') },
    resolve: {
      alias: {
        '@repeaty-plugins': fileURLToPath(
          new URL(
            server ? './repeaty.plugins.server.ts' : './repeaty.plugins.static.ts',
            import.meta.url,
          ),
        ),
      },
    },
    build: { outDir: server ? 'dist-server' : 'dist', manifest: true },
    plugins: [vue(), ...(server ? [] : [offlinePlugin()])],
    test: { include: ['src/**/*.test.ts'], environment: 'node' },
  }
})
