import { defineConfig } from '@playwright/test';

// Map DAZN region to browser timezone + locale so event times match the region
const regionTimezoneMap: Record<string, { timezoneId: string; locale: string }> = {
  GB:  { timezoneId: 'Europe/London',       locale: 'en-GB' },
  IE:  { timezoneId: 'Europe/Dublin',       locale: 'en-IE' },
  DE:  { timezoneId: 'Europe/Berlin',       locale: 'de-DE' },
  IT:  { timezoneId: 'Europe/Rome',         locale: 'it-IT' },
  ES:  { timezoneId: 'Europe/Madrid',       locale: 'es-ES' },
  AT:  { timezoneId: 'Europe/Vienna',       locale: 'de-AT' },
  CH:  { timezoneId: 'Europe/Zurich',       locale: 'de-CH' },
  CA:  { timezoneId: 'America/Toronto',     locale: 'en-CA' },
  US:  { timezoneId: 'America/New_York',    locale: 'en-US' },
  AU:  { timezoneId: 'Australia/Sydney',    locale: 'en-AU' },
  JP:  { timezoneId: 'Asia/Tokyo',          locale: 'ja-JP' },
  BR:  { timezoneId: 'America/Sao_Paulo',   locale: 'pt-BR' },
};

const region = (process.env.DAZN_REGION || 'GB').toUpperCase();
const { timezoneId, locale } = regionTimezoneMap[region] || regionTimezoneMap['GB'];

export default defineConfig({
  testDir:   './tests',
  timeout:   300_000,
  retries:   0,
  workers:   process.env.CI ? 4 : 1,
  outputDir: 'test-results',

  use: {
    headless:  process.env.HEADLESS === 'true',
    viewport:  null,
    timezoneId,
    locale,

    launchOptions: {
      args: [
        '--start-maximized',
        '--disable-infobars',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        '--password-store=basic',
        '--use-mock-keychain',
      ],
    },

    actionTimeout:     15_000,
    navigationTimeout: 30_000,

    video: {
      mode: process.env.CI ? 'on' : 'retain-on-failure',
      size: { width: 1920, height: 1080 },
    },

    screenshot: 'only-on-failure',
    trace:      'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        channel:  'chrome',
        headless: process.env.HEADLESS === 'true',
        viewport: null,

        launchOptions: {
          args: [
            '--start-maximized',
            '--disable-infobars',
            '--no-sandbox',
            '--disable-dev-shm-usage',
            '--disable-blink-features=AutomationControlled',
            '--password-store=basic',
            '--use-mock-keychain',
          ],
        },
      },
    },
  ],

  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'always' }],
  ],
});