import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e/season',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4174',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'season-desktop-write',
      grep: /@desktop-write/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'season-phone-read',
      grep: /@phone-read/,
      dependencies: ['season-desktop-write'],
      use: { ...devices['Pixel 5'] },
    },
  ],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4174',
    url: 'http://127.0.0.1:4174/login',
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
