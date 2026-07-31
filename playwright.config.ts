import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  use: { baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3001', screenshot: 'only-on-failure', trace: 'on-first-retry' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 5'] } },
  ],
  webServer: {
    command: 'npm run dev -- --port 3001',
    url: 'http://localhost:3001',
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      AUTH_USERNAME: 'e2e-admin',
      AUTH_PASSWORD: 'e2e-password',
      AUTH_SECRET: 'e2e-only-secret-with-at-least-thirty-two-characters',
    },
  },
});
