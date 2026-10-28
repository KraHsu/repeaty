import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import nuxtUI from '@nuxt/ui/vite'
import { ui } from './ui.ts'
import { offlinePlugin } from '../build/offline.ts'
import { externalPlugins } from '../build/external-plugins.ts'
import { fileURLToPath } from 'node:url'

export default defineConfig(({ mode }) => {
  const server = mode === 'server'
  const desktop = mode === 'desktop'
  const edition = desktop ? 'desktop' : server ? 'server' : 'static'
  return {
    root: fileURLToPath(new URL('..', import.meta.url)),
    base: server || desktop ? '/' : process.env.VITE_BASE_PATH || '/',
    define: { __REPEATY_EDITION__: JSON.stringify(edition) },
    server: { watch: { ignored: ['**/target/**'] } },
    resolve: {
      alias: {
        '@repeaty-plugin-host': fileURLToPath(
          new URL(`../src/plugins/platform-${desktop ? 'desktop' : 'browser'}.ts`, import.meta.url),
        ),
        '@repeaty-platform': fileURLToPath(
          new URL(`../src/platform/${edition}.ts`, import.meta.url),
        ),
      },
    },
    build: {
      outDir: desktop ? 'dist-desktop' : server ? 'dist-server' : 'dist',
      target: 'esnext',
      manifest: true,
    },
    worker: { format: 'es' },
    plugins: [
      vue(),
      nuxtUI({
        ui,
        router: false,
        colorMode: false,
        autoImport: false,
        components: false,
        icon: { clientBundle: { scan: true } },
      }),
      externalPlugins(desktop),
      ...(server || desktop ? [] : [offlinePlugin()]),
    ],
    test: {
      include: ['src/**/*.test.ts'],
      environment: 'node',
      setupFiles: ['tests/setup-ui.ts', 'tests/setup-external-plugins.ts'],
    },
  }
})
