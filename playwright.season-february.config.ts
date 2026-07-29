import { defineConfig, devices } from '@playwright/test'
import { seasonLoopbackOrigin } from './tests/e2e/season/season-loopback-port'

const seasonOrigin = seasonLoopbackOrigin('FARMRX_SEASON_JANUARY_PORT', 4174)

export default defineConfig({
  testDir: './tests/e2e/season',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: 'list',
  grep: /@february-write/,
  use: {
    baseURL: seasonOrigin,
    serviceWorkers: 'block',
    trace: 'off',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${new URL(seasonOrigin).port}`,
    url: `${seasonOrigin}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
