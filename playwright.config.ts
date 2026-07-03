import { defineConfig } from '@playwright/test';
import * as dotenv from 'dotenv';
dotenv.config();

const isHeadless = process.env.HEADLESS === 'true';

export default defineConfig({
  testDir: './tests',
  timeout: 300_000,
  retries: 0,
  workers: process.env.CI ? 4 : 4,
  outputDir: 'test-results',

  use: {
    headless: isHeadless,

    // Keep CI/headless on the same desktop layout as local headed Chrome.
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,

    timezoneId: 'Asia/Kolkata',
    locale: 'en-IN',

    launchOptions: {
      args: [
        '--window-size=1920,1080',
        '--disable-infobars',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        '--password-store=basic',
        '--use-mock-keychain',
        '--disable-popup-blocking',
      ],
    },

    actionTimeout: 15_000,
    navigationTimeout: 30_000,

    video: {
      mode: process.env.CI ? 'on' : 'retain-on-failure',
      size: { width: 1920, height: 1080 },
    },

    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        channel: 'chrome',
      },
    },
  ],

  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'always' }],
  ],
});
