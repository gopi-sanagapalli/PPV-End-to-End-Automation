import { test, expect } from '@playwright/test';
import { sleep } from '../utils/helpers';

test('Home: accept cookies, find "The Biggest Fights" rail, click Misfits Boxing tile', async ({ browser }) => {
  test.setTimeout(240_000);

  const context = await browser.newContext({
    viewport:    null,
    colorScheme: 'dark',
    locale:      'en-IN',
    timezoneId:  'Asia/Kolkata',
  });
  await context.clearCookies();
  const page = await context.newPage();
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) console.log('NAV ->', f.url()); });

  await page.goto('https://www.dazn.com/en-IN/home', { waitUntil: 'domcontentloaded' });

  // ── STEP 1: STRICT cookie handling — nothing else first ──
  const acceptBtn = page.locator('#onetrust-accept-btn-handler').first();
  const banner    = page.locator('#onetrust-banner-sdk, #onetrust-consent-sdk').first();
  console.log('Waiting up to 30s for cookie banner...');
  const shown = await acceptBtn.waitFor({ state: 'visible', timeout: 30_000 }).then(() => true).catch(() => false);
  if (shown) {
    await acceptBtn.click({ force: true });
    await banner.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});
    await page.waitForFunction(
      () => !document.querySelector('#onetrust-banner-sdk, #onetrust-consent-sdk'),
      null, { timeout: 10_000 }
    ).catch(() => {});
    console.log('✓ Cookies accepted + banner gone');
  } else {
    console.log('⚠️ No cookie banner appeared within 30s');
  }
  await sleep(1500);

  // ── STEP 2: scroll to "The Biggest Fights" rail header ──
  // This rail is further down — jump-scroll progressively until it's attached
  const railHeader = page.getByText(/^The Biggest Fights$/i).first();

  for (let y = 1200; y <= 6000; y += 1200) {
    if ((await railHeader.count()) > 0) break;
    await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' as ScrollBehavior }), y);
    await sleep(900);
  }

  await railHeader.waitFor({ state: 'attached', timeout: 30_000 });
  await railHeader.scrollIntoViewIfNeeded({ timeout: 15_000 });
  await expect(railHeader).toBeVisible();
  console.log('✓ "The Biggest Fights" rail visible');
  await sleep(1200);

  // ── STEP 3: locate the Misfits Boxing tile inside this rail ──
  const railWrapper = railHeader.locator(
    'xpath=ancestor::*[contains(@class,"rail__rail-wrapper")][1]'
  );

  // Tile structure: <a class="tile__link..."><img/><...><h3>Misfits Boxing</h3></a>
  // Pick the non-duplicate tile (Swiper duplicates slides in loop mode)
  const misfitsTile = railWrapper.locator(
    'a[class*="tile__link"]:not(.swiper-slide-duplicate a):has(h3:has-text("Misfits Boxing"))'
  ).first();

  const nextBtn = railWrapper.locator('button[aria-label="Next slide"]').first();

  // Click Next until the Misfits Boxing tile is on-screen (or end of rail)
  let clicks = 0;
  for (; clicks < 10; clicks++) {
    if ((await misfitsTile.count()) > 0) {
      const inView = await misfitsTile.evaluate((el: HTMLElement) => {
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
    await nextBtn.click({ force: true }).catch((e) => console.log('next click err:', e.message));
    await sleep(700);
  }
  console.log(`Next-arrow clicks performed: ${clicks}`);

  // Fallback: if not visible, just scroll the tile into view directly
  await misfitsTile.scrollIntoViewIfNeeded({ timeout: 8_000 }).catch(() => {});
  await expect(misfitsTile).toBeVisible();

  // ── STEP 4: click the tile ──
  const href = await misfitsTile.getAttribute('href');
  console.log('Misfits Boxing tile href =', href);
  await misfitsTile.click({ timeout: 10_000 });
  console.log('✓ Clicked Misfits Boxing tile');

  // ── STEP 5: confirm popup or navigation ──
  await sleep(3500);
  const after = await page.evaluate(() => {
    const modal = document.querySelector('[class*="signup-paywall__modal"]') as HTMLElement | null;
    return {
      url: location.href,
      popupOpen: !!modal,
      popupTitle: (modal?.querySelector('h2')?.innerText || '').trim(),
      popupSub:   (modal?.querySelector('h3')?.innerText || '').trim(),
      popupLabel: (modal?.querySelector('[class*="signup-paywall__label"]') as HTMLElement | null)?.innerText.trim() || '',
    };
  });
  console.log('→ Post-click state:', JSON.stringify(after, null, 2));

  await page.screenshot({ path: 'test-results/biggest-fights-popup.png' }).catch(() => {});
  await sleep(3000);
  await context.close();
});
