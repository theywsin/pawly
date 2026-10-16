import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  outputDir: '../.local/e2e-results',
  use: {
    baseURL: 'http://127.0.0.1:3200',
    locale: 'fa-IR',
    timezoneId: 'Asia/Tehran',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
  webServer: {
    command: 'bash e2e/start-server.sh',
    cwd: '..',
    url: 'http://127.0.0.1:3200/api/health/ready',
    timeout: 180_000,
    reuseExistingServer: false,
    stdout: 'pipe',
  },
});
