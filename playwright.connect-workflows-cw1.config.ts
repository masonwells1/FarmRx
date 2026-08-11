import { defineConfig, devices } from '@playwright/test'

const phone = process.env.FARMRX_CW1_VIEWPORT === 'phone'

export default defineConfig({
  testDir: './tests/e2e/season',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: 'list',
  grep: /@connect-workflows-cw1/,
  use: {
    baseURL: 'http://127.0.0.1:4187',
    serviceWorkers: 'block',
    trace: 'off',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
    viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 900 },
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4187',
    url: 'http://127.0.0.1:4187/login',
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
