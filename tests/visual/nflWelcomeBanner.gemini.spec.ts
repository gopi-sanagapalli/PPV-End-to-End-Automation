import { expect, test } from '@playwright/test';
import { validateBannerImage } from '../../utils/geminiBannerValidator';

const nflWelcomeUrl = 'https://stag.dazn.com/en-GB/welcome/nfl';

test('Gemini rejects degraded NFL welcome banner artwork on staging', async ({ page }) => {
  if (!process.env.GEMINI_API_KEY) {
    if (process.env.GITHUB_ACTIONS === 'true') {
      throw new Error('GEMINI_API_KEY is required for the staging NFL visual assessment');
    }
    test.skip(true, 'GEMINI_API_KEY is required for the local visual assessment');
  }

  await page.goto(nflWelcomeUrl, { waitUntil: 'domcontentloaded' });
  await page.locator('main').waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForTimeout(5_000);

  const result = await validateBannerImage(page, {
    region: 'GB',
    flow: 'stag-nfl-welcome',
    url: nflWelcomeUrl,
  });

  expect(result, 'Gemini did not return a banner assessment').not.toBeNull();
  expect(result?.passed, result?.assessment.findings.join(' | ')).toBe(true);
});
