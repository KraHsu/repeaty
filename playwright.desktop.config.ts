import { defineConfig, devices } from '@playwright/test'
export default defineConfig({
  testDir: './tests/desktop',
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI
    ? [['dot'], ['html', { open: 'never', outputFolder: 'playwright-report-desktop' }]]
    : 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:4179/',
    locale: 'zh-CN',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npx vite preview --mode desktop --host 127.0.0.1 --port 4179 --strictPort',
    url: 'http://127.0.0.1:4179/',
    reuseExistingServer: false,
  },
})
