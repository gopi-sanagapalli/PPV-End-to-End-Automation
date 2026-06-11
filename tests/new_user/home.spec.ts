import { test, expect, Page, Locator } from '@playwright/test';
import { sleep } from '../../utils/helpers';
import { getHomePageData } from '../../utils/excelReader';
import { resolveExpected } from '../../utils/resolveExpected';
import { compare } from '../../utils/compare';

// ─────────────────────────────────────────────────────────────────
// Per-field actual-value getters for the signup-paywall popup
// (popup container class is "signup-paywall__modal___...")
// ─────────────────────────────────────────────────────────────────
const popupRoot = (page: Page): Locator =>
  page.locator('[class*="signup-paywall__modal___"]').first();

async function getActualPopupValue(
  page:  Page,
  field: string,
): Promise<string> {
  const root = popupRoot(page);
  const exists = (await root.count()) > 0;
  if (!exists) return 'No';

  switch (field) {
    case 'Popup Visible':
      return (await root.isVisible().catch(() => false)) ? 'Yes' : 'No';

    case 'Popup Hero Image': {
      const img = root.locator('img[alt*="Signup Paywall" i], [class*="signup-paywall__image"] img').first();
      return (await img.count()) > 0 && (await img.isVisible().catch(() => false))
        ? 'Yes' : 'No';
    }

    case 'Popup Date Time': {
      const label = root.locator('[class*="signup-paywall__label"]').first();
      return (await label.count()) ? (await label.innerText()).trim() : '';
    }

    case 'Popup Title': {
      const h2 = root.locator('h2[class*="signup-paywall__title"]').first();
      return (await h2.count()) ? (await h2.innerText()).trim() : '';
    }

    case 'Popup Subtitle': {
      const h3 = root.locator('h3[class*="signup-paywall__sub-title"]').first();
      return (await h3.count()) ? (await h3.innerText()).trim() : '';
    }

    case 'Popup Description': {
      const p = root.locator('p[class*="signup-paywall__description"]').first();
      return (await p.count()) ? (await p.innerText()).trim() : '';
    }

    case 'Buy Now CTA': {
      const btn = root.locator('button[class*="signup-paywall__button"]').first();
      return (await btn.count()) ? (await btn.innerText()).trim() : '';
    }

    case 'Close Button': {
      const close = root.locator('button[class*="signup-paywall__modal-close"]').first();
      return (await close.count()) > 0 && (await close.isVisible().catch(() => false))
        ? 'Yes' : 'No';
    }

    default:
      return 'N/A';
  }
}

// ─────────────────────────────────────────────────────────────────
// Helper: accept cookies before any scrolling
// ─────────────────────────────────────────────────────────────────
async function acceptCookies(page: Page): Promise<void> {
  const acceptBtn = page.locator('#onetrust-accept-btn-handler').first();
  const banner    = page.locator('#onetrust-banner-sdk, #onetrust-consent-sdk').first();
  const shown = await acceptBtn.waitFor({ state: 'visible', timeout: 30_000 })
    .then(() => true).catch(() => false);
  if (shown) {
    await acceptBtn.click({ force: true });
    await banner.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});
    await page.waitForFunction(
      () => !document.querySelector('#onetrust-banner-sdk, #onetrust-consent-sdk'),
      null, { timeout: 10_000 }
    ).catch(() => {});
    console.log('✓ Cookies accepted');
  }
}

// ─────────────────────────────────────────────────────────────────
test("Home page: click PPV tile in Don't Miss and validate popup", async ({ browser }) => {
  test.setTimeout(240_000);

  const context = await browser.newContext({
    viewport:    null,
    colorScheme: 'dark',
    locale:      'en-IN',
    timezoneId:  'Asia/Kolkata',
  });
  await context.clearCookies();
  const page = await context.newPage();

  await page.goto('https://www.dazn.com/en-IN/home', { waitUntil: 'domcontentloaded' });
  await acceptCookies(page);
  await sleep(1500);

  // ── Find Don't Miss rail (jump-scroll to trigger lazy load) ──
  await page.evaluate(() => window.scrollTo({ top: 1800, behavior: 'instant' as ScrollBehavior }));
  await sleep(1200);

  const railHeader = page.getByText(/don'?t miss/i).first();
  await railHeader.waitFor({ state: 'attached', timeout: 30_000 });
  await railHeader.scrollIntoViewIfNeeded({ timeout: 15_000 });
  await expect(railHeader).toBeVisible();
  console.log("✓ Don't Miss rail visible");

  const railWrapper = railHeader.locator(
    'xpath=ancestor::*[contains(@class,"rail__rail-wrapper")][1]'
  );
  const furyImg = railWrapper.locator(
    'img[alt*="Fury" i][alt*="Hall" i]:not(.swiper-slide-duplicate img)'
  ).first();
  const nextBtn = railWrapper.locator('button[aria-label="Next slide"]').first();

  // Click Next until the Fury vs Hall tile is on screen
  for (let i = 0; i < 8; i++) {
    if ((await furyImg.count()) > 0) {
      const inView = await furyImg.evaluate((el: HTMLElement) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.right > 0 && r.left < window.innerWidth;
      }).catch(() => false);
      if (inView) break;
    }
    if (!(await nextBtn.isVisible().catch(() => false))) break;
    const disabled = await nextBtn.evaluate(
      (el: any) => el.classList.contains('swiper-button-disabled') || el.hasAttribute('disabled')
    ).catch(() => false);
    if (disabled) break;
    await nextBtn.click({ force: true }).catch(() => {});
    await sleep(700);
  }
  await furyImg.scrollIntoViewIfNeeded({ timeout: 8_000 }).catch(() => {});

  const furyTile = furyImg.locator('xpath=ancestor::a[contains(@class,"tile__link")][1]');
  await expect(furyTile).toBeVisible();
  await furyTile.click({ timeout: 10_000 });
  console.log('✓ Clicked Fury vs Hall tile');

  // ── Wait for popup ──
  const popup = popupRoot(page);
  await popup.waitFor({ state: 'visible', timeout: 15_000 });
  console.log('✓ Popup is visible');

  // ── eventData: values used to resolve {{PLACEHOLDERS}} in the sheet ──
  const eventData: Record<string, string> = {
    PPV_NAME:         'Fury vs. Hall',
    POPUP_SUBTITLE:   'Misfits Boxing',
    POPUP_DATE_TIME:  '13 JUN 22:30',
  };

  // ── Read sheet & validate each row ──
  const rows = getHomePageData();
  const results: Array<{ field: string; expected: string; actual: string; status: 'PASS' | 'FAIL' }> = [];

  for (const row of rows as any[]) {
    const field = String(row.Field || '').trim();
    if (!field) continue;
    const expected = resolveExpected(row, eventData);
    const actual   = await getActualPopupValue(page, field).catch(() => 'N/A');
    const status   = compare(actual, expected, (row as any).Type) ? 'PASS' : 'FAIL';
    results.push({ field, expected, actual, status });
    console.log(`  ${status === 'PASS' ? '✅' : '❌'} [${field}]  expected="${expected}"  actual="${actual}"`);
  }

  const failed = results.filter(r => r.status === 'FAIL');
  console.log(`\nTotal: ${results.length}  PASS: ${results.length - failed.length}  FAIL: ${failed.length}`);

  await sleep(2000);
  await context.close();

  expect(failed, `Failures:\n${failed.map(f => `  ${f.field}: expected="${f.expected}", actual="${f.actual}"`).join('\n')}`).toEqual([]);
});
