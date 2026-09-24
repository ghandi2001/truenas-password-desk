import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:3100',
    channel: process.env.PLAYWRIGHT_CHANNEL,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  reporter: 'list',
  webServer: {
    command: 'node --import tsx tests/browser/server.ts',
    url: 'http://127.0.0.1:3100',
    reuseExistingServer: false,
    timeout: 120000,
  },
  timeout: 30000,
});
