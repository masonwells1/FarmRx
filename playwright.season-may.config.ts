import { defineConfig, devices } from '@playwright/test'
import { seasonLoopbackOrigin, seasonLoopbackPort } from './tests/e2e/season/season-loopback-port'

const seasonPort = seasonLoopbackPort('FARMRX_SEASON_MAY_PORT', 4177)
const seasonOrigin = seasonLoopbackOrigin('FARMRX_SEASON_MAY_PORT', 4177)

export default defineConfig({
  testDir: './tests/e2e/season', fullyParallel: false, forbidOnly: true, retries: 0, workers: 1, reporter: 'list', grep: /@may-write/,
  use: { baseURL: seasonOrigin, serviceWorkers: 'block', trace: 'off', screenshot: 'only-on-failure', ...devices['Desktop Chrome'] },
  webServer: { command: `npm run dev -- --host 127.0.0.1 --port ${seasonPort}`, url: `${seasonOrigin}/login`, reuseExistingServer: false, timeout: 120_000 },
})
