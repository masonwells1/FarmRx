import { defineConfig, devices } from '@playwright/test'

const state = process.env.FARMRX_PH_STATE_IN
const phone = process.env.FARMRX_PH_VIEWPORT === 'phone'

export default defineConfig({
  testDir: './tests/e2e/season',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: 'list',
  grep: /@pine-hill/,
  use: {
    baseURL: 'http://127.0.0.1:4181',
    serviceWorkers: 'block',
    trace: 'off',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
    viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    ...(state ? { storageState: state } : {}),
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4181',
    url: 'http://127.0.0.1:4181/login',
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
