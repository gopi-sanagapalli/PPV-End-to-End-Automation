import { defineConfig } from '@playwright/test';
import * as dotenv from 'dotenv';
dotenv.config();

const isHeadless = process.env.HEADLESS === 'true';
const defaultViewport = process.env.CI || isHeadless
  ? { width: 1920, height: 1080 }
  : { width: 1366, height: 768 };
const viewport = {
  width: Number(process.env.VIEWPORT_WIDTH || defaultViewport.width),
  height: Number(process.env.VIEWPORT_HEIGHT || defaultViewport.height),
};

export default defineConfig({
  testDir: './tests',
  timeout: 300_000,
  retries: 0,
  workers: process.env.CI ? 4 : 4,
  outputDir: 'test-results',

  use: {
    headless: isHeadless,

    // Keep desktop mode, but make local headed runs fit common laptop screens.
    viewport,
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,

    timezoneId: 'Asia/Kolkata',
    locale: 'en-IN',

    launchOptions: {
      args: [
        `--window-size=${viewport.width},${viewport.height}`,
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
