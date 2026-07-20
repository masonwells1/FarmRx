import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e/season',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: 'list',
  grep: /@february-write/,
  use: {
    baseURL: 'http://127.0.0.1:4174',
    serviceWorkers: 'block',
    trace: 'off',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4174',
    url: 'http://127.0.0.1:4174/login',
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
