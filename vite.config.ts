import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { offlinePlugin } from './build/offline.ts'

export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [vue(), offlinePlugin()],
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
