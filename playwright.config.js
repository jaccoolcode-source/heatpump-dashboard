'use strict';

const { defineConfig, devices } = require('@playwright/test');

// Runs against an already deployed dashboard (docker compose up) — nothing is started here.
module.exports = defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/wait-for-server.js',
  timeout: 30_000,
  retries: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:8081',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile',  use: { ...devices['Pixel 7'] } },
  ],
});
