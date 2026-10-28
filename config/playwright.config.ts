import { defineConfig, devices } from '@playwright/test'

const baseURL = `http://127.0.0.1:4175${process.env.VITE_BASE_PATH || '/'}`

export default defineConfig({
  testDir: '../tests',
  outputDir: '../test-results/web',
  testIgnore: ['**/server/**', '**/desktop/**', '**/workspace-native/**'],
  forbidOnly: Boolean(process.env.CI),
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI
    ? [['dot'], ['html', { open: 'never', outputFolder: '../playwright-report' }]]
    : 'list',
  use: {
    baseURL,
    ...devices['Desktop Chrome'],
    locale: 'zh-CN',
    trace: 'retain-on-failure',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : undefined,
  },
  webServer: {
    cwd: '..',
    command: 'npm run preview -- --port 4175 --strictPort',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
  },
})
