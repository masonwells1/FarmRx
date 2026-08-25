import { defineConfig, devices } from '@playwright/test'

const reportFile = process.env.FARMRX_PASSWORD_FORM_REPORT
if (!reportFile) throw new Error('FARMRX_PASSWORD_FORM_REPORT is required for the password-form proof.')

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'password-form-isolation.spec.ts',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: reportFile }]],
  use: {
    baseURL: 'http://127.0.0.1:4175',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'password-form-desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'password-form-phone', use: { ...devices['Pixel 5'] } },
  ],
  webServer: {
    command: 'npm run build && npm run preview -- --host 127.0.0.1 --port 4175',
    url: 'http://127.0.0.1:4175/login',
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
