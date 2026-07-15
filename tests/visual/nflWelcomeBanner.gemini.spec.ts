import { expect, test } from '@playwright/test';
import { validatePpvBannerImage } from '../../utils/geminiBannerValidator';

const nflWelcomeUrl = 'https://stag.dazn.com/en-GB/welcome/nfl';

test('Gemini rejects degraded NFL welcome banner artwork on staging', async ({ page }) => {
  test.skip(!process.env.GEMINI_API_KEY, 'GEMINI_API_KEY is required for the visual assessment');

  await page.goto(nflWelcomeUrl, { waitUntil: 'domcontentloaded' });
  await page.locator('main').waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForTimeout(5_000);

  const result = await validatePpvBannerImage(page, {
    region: 'GB',
    flow: 'stag-nfl-welcome',
  });

  expect(result, 'Gemini did not return a banner assessment').not.toBeNull();
  expect(result?.passed, result?.assessment.findings.join(' | ')).toBe(true);
});
