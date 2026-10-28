import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
export default defineConfig({
  plugins: [vue()],
  base: './',
  resolve: { dedupe: ['vue'] },
  build: { outDir: 'site' },
  server: { host: '127.0.0.1', port: 4194, strictPort: true },
})
