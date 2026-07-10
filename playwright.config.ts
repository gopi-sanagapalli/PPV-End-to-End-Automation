import { defineConfig } from '@playwright/test';

const isHeadless = process.env.HEADLESS === 'true';

const REGION = (process.env.DAZN_REGION || 'GB').toUpperCase();
const regionLocaleMap: Record<string, { locale: string; timezoneId: string }> = {
  GB: { locale: 'en-GB', timezoneId: 'Europe/London' },
  US: { locale: 'en-US', timezoneId: 'America/New_York' },
  AE: { locale: 'en-AE', timezoneId: 'Asia/Dubai' },
  AU: { locale: 'en-AU', timezoneId: 'Australia/Sydney' },
  BR: { locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' },
};
const { locale: regionLocale, timezoneId: regionTimezone } =
  regionLocaleMap[REGION] ?? { locale: 'en-GB', timezoneId: 'Europe/London' };

export default defineConfig({
  testDir: './tests',
  timeout: 300_000,
  retries: 0,
  workers: process.env.CI ? 4 : 4,
  outputDir: 'test-results',

  use: {
    headless: isHeadless,

    // Headless (CI): fix at 1920×1080 for consistent layout.
    // Headed (laptop/desktop): null = use actual maximised window size so the
    // browser is never larger than the physical screen.
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,

    timezoneId: regionTimezone,
    locale: regionLocale,

    launchOptions: {
      args: [
        // Headless: set a virtual 1920×1080 display. Headed: maximise to the
        // real screen size so it is never clipped on smaller laptop displays.
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
      mode: 'retain-on-failure',
      // In headless/CI mode pin recordings to 1920×1080.
      // In headed mode omit size so Playwright inherits the window dimensions.
      size: { width: 1920, height: 1080 },
    },

    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
      },
    },
  ],

  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'always' }],
  ],
});
