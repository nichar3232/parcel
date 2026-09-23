import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        // The browser journeys run on the stored replay: deterministic
        // prices and a clock the tests can advance, with no network.
        command:
          'CHAIN_ENABLED=false PARCEL_LIVE=false PORT=3027 STRATA_STATE_DIR=.state/e2e npm start',
        url: 'http://127.0.0.1:3027/api/health',
        reuseExistingServer: false,
        timeout: 30000,
      },
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  expect: { timeout: 10000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:3027',
    viewport: { width: 1440, height: 1000 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {},
  },
});
