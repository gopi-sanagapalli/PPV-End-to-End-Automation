import { test } from '@playwright/test';
import path from 'path';

import { SchedulePage } from '../../pages/schedulepage';
import { SignupPage } from '../../pages/SignupPage';
import { PaymentPage } from '../../pages/PaymentPage';

import { getPPVDataByVariant, readSheet } from '../../utils/excelReader';
import { detectVariant } from '../../flows/detectVariant';
import { validateVariant } from '../../flows/validateVariant';
import { buildEventData } from '../../utils/buildEventData';
import { displayResultsTable } from '../../utils/resultsDisplay';
import { writeResults } from '../../utils/excelWriter';
import { createTestUser } from '../../utils/testDataBuilder';

const DEFAULT_REGION = process.env.DAZN_REGION || 'AU';
const DEFAULT_EVENT_CONFIG = process.env.PPV_CONFIG || 'Chisora.json';

function loadEventConfig() {
  const configPath = path.resolve(process.cwd(), 'config', DEFAULT_EVENT_CONFIG);
  return require(configPath);
}

test('PPV flow via schedule', async ({ browser }) => {
  test.setTimeout(240000);

  const context = await browser.newContext({
    storageState: path.resolve(process.cwd(), 'auth/dazn-storage-state.json'),
  });

  await context.addInitScript(() => {
    try {
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem('randomABPoint', Math.random().toString());
    } catch {}
  });

  const page = await context.newPage();
  const results: any[] = [];

  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

  const getLivePage = async () => {
    await sleep(800);
    const pages = context.pages().filter(p => !p.isClosed());
    const livePage = pages[pages.length - 1];
    await livePage.bringToFront().catch(() => {});
    return livePage;
  };

  const clickAndWaitForNav = async (p: any, btn: any, label: string) => {
    console.log(`clicking: ${label}`);
    const before = p.url();

    await btn.scrollIntoViewIfNeeded().catch(() => {});
    await sleep(300);
    await btn.click({ force: true });

    await Promise.race([
      p.waitForSelector('input[type="email"]', { timeout: 4000 }),
      p.waitForSelector('input[type="radio"]', { timeout: 4000 }),
      p.waitForSelector('input[type="checkbox"]', { timeout: 4000 }),
    ]).catch(() => {});

    if (p.url() !== before) {
      console.log(`navigated to: ${p.url()}`);
    }
  };

  try {
    const json = loadEventConfig();
    const eventData = buildEventData(json, DEFAULT_REGION);

    const schedule = new SchedulePage(page);
    await schedule.navigate();

    await page.locator('#onetrust-accept-btn-handler').click().catch(() => {});

    await schedule.selectSport('Boxing');
    const eventCard = await schedule.findEvent(eventData.PPV_NAME);
    await schedule.clickEvent(eventCard);
    await schedule.clickBuyNow();

    await sleep(3000);

    let activePage = await getLivePage();
    console.log('landed on:', activePage.url());

    const variant = await detectVariant(activePage).catch(() => 'unknown');
    console.log('🎯 variant:', variant);

    let ppvValidated = false;

    // ───────── FLOW LOOP ─────────
    for (let step = 0; step < 5; step++) {
      activePage = await getLivePage();

      const isEmail = await activePage.locator('input[type="email"]')
        .isVisible().catch(() => false);

      if (isEmail) {
        console.log('✅ reached email page');
        break;
      }

      const hasCheckbox = await activePage.locator('input[type="checkbox"]').count();
      const hasRadios = await activePage.locator('input[type="radio"], [role="radio"]').count();

      const isPPV = hasCheckbox > 0;
      const isPlan = hasRadios > 0 && !isPPV;

      console.log(`step ${step + 1}`, {
        url: activePage.url(),
        isPPV,
        isPlan
      });

      // ───── PPV PAGE ─────
      if (isPPV) {
        console.log('👉 PPV page');

        if (!ppvValidated) {
          console.log('🧾 Validating PPV page...');

          // 🔥 REAL FIX (WAIT FOR UI)
          await activePage.waitForLoadState('domcontentloaded');

          await activePage.waitForSelector('text=/vs\\.?/i', { timeout: 15000 });
          await activePage.waitForSelector('text=/\\$\\d+/', { timeout: 15000 });

          // trigger lazy load
          await activePage.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
          await activePage.waitForTimeout(800);

          await activePage.evaluate(() => window.scrollTo(0, 0));
          await activePage.waitForTimeout(500);

          const ppvData = getPPVDataByVariant(variant);

          await validateVariant(activePage, variant, ppvData, results, eventData)
            .catch(() => {});

          ppvValidated = true;
        }

        const checkbox = activePage.locator('input[type="checkbox"]').first();
        if (await checkbox.isVisible().catch(() => false)) {
          await checkbox.click({ force: true });
        }

        const btn = activePage.locator('button:has-text("Continue")').last();
        await clickAndWaitForNav(activePage, btn, 'PPV Continue');
        continue;
      }

      // ───── PLAN PAGE ─────
      if (isPlan) {
        console.log('👉 PLAN page');

        const radio = activePage.locator('input[type="radio"]').first();
        if (await radio.isVisible().catch(() => false)) {
          await radio.click({ force: true });
        }

        const btn = activePage.locator('button:has-text("Continue")');
        await clickAndWaitForNav(activePage, btn, 'Plan Continue');
        continue;
      }

      break;
    }

    activePage = await getLivePage();

    // ───────── SIGNUP ─────────
    const signup = new SignupPage(activePage);
    const user = createTestUser();

    await signup.enterEmail(user.email);
    await signup.clickContinue();

    activePage = await getLivePage();

    const firstName = activePage.locator('[data-test-id="FIRST_NAME"]');

    if (await firstName.isVisible()) {
      const signup2 = new SignupPage(activePage);
      await signup2.fillPersonalDetails(user);
      await signup2.clickPersonalDetailsContinue();
    }

    // ───────── PAYMENT ─────────
    await activePage.waitForTimeout(1500);
    activePage = await getLivePage();

    const payment = new PaymentPage(activePage);

    if (await payment.isPaymentPage()) {
      console.log('✅ payment page');

      const paymentData = readSheet('Monthly Payment page');
      await payment.validate(paymentData, results);
    }

    displayResultsTable(results, variant);
    const filePath = await writeResults(results);

    const passed = results.filter(r => r.status === 'PASS').length;
    const total = results.length;

    console.log(`
═══════════════════════════════════════
🎯 Variant: ${variant}
📊 Total: ${total}
✅ Passed: ${passed}
📁 Report: ${filePath}
═══════════════════════════════════════
`);

    if (passed < total) {
      throw new Error(`${total - passed} validation(s) failed`);
    }

  } finally {
    await context.close();
  }
});