import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir:   './tests',
  timeout:   300_000,
  retries:   0,
  workers:   1,
  outputDir: 'test-results',

 use: {
  headless:  false,
  viewport:  null,               // null = --start-maximized works

  launchOptions: {
    args: [
      '--start-maximized',
      '--disable-infobars',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
    ],
  },

  // deviceScaleFactor: 1,       // ← REMOVE — incompatible with viewport: null

  actionTimeout:     15_000,
  navigationTimeout: 30_000,

  video: {
    mode: 'on',
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
        headless: false,
        viewport: null,          // null = --start-maximized works correctly

        launchOptions: {
          args: [
            '--start-maximized',
            '--disable-infobars',
            '--no-sandbox',
            '--disable-dev-shm-usage',
            '--disable-blink-features=AutomationControlled',
          ],
        },
      },
    },
  ],

  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],
});