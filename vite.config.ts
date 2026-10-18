import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { offlinePlugin } from './build/offline.ts'
import { fileURLToPath } from 'node:url'

export default defineConfig(({ mode }) => {
  const server = mode === 'server'
  const desktop = mode === 'desktop'
  const edition = desktop ? 'desktop' : server ? 'server' : 'static'
  return {
    base: server || desktop ? '/' : process.env.VITE_BASE_PATH || '/',
    define: { __REPEATY_EDITION__: JSON.stringify(edition) },
    server: { watch: { ignored: ['**/target/**'] } },
    resolve: {
      alias: {
        '@repeaty-platform': fileURLToPath(
          new URL(`./src/platform/${edition}.ts`, import.meta.url),
        ),
        '@repeaty-plugins': fileURLToPath(
          new URL(`./repeaty.plugins.${edition}.ts`, import.meta.url),
        ),
      },
    },
    build: {
      outDir: desktop ? 'dist-desktop' : server ? 'dist-server' : 'dist',
      target: 'esnext',
      manifest: true,
    },
    plugins: [vue(), ...(server || desktop ? [] : [offlinePlugin()])],
    test: { include: ['src/**/*.test.ts'], environment: 'node' },
  }
})
