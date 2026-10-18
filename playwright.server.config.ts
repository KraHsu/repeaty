import { defineConfig, devices } from '@playwright/test'
export default defineConfig({
  testDir: './tests/server',
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI
    ? [['dot'], ['html', { open: 'never', outputFolder: 'playwright-report-server' }]]
    : 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:4176/',
    locale: 'zh-CN',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'node scripts/start-test-server.mjs',
      url: 'http://127.0.0.1:4176/',
      reuseExistingServer: false,
      timeout: 180000,
    },
    {
      command: 'npm run preview -- --port 4177 --strictPort',
      url: `http://127.0.0.1:4177${process.env.VITE_BASE_PATH || '/'}`,
      reuseExistingServer: false,
    },
  ],
})
