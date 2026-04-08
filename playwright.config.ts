import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: ['**/*.spec.ts', '**/1.ts'],
  timeout: 60000,
  retries: 1,

  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['list']
  ],

  outputDir: 'test-results',

  use: {
    baseURL: 'https://www.dazn.com/welcome',
    headless: false,

    viewport: null,

    launchOptions: {
      slowMo: 0,
      args: ['--start-maximized'],
    },

    screenshot: 'on',
    video: {
      mode: 'on',
      size: { width: 1920, height: 1080 },
    },
    trace: 'on',
  },

  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});