import { test } from '@playwright/test';
import path from 'path';

import { SchedulePage } from '../../pages/schedulepage';
import { SignupPage } from '../../pages/SignupPage';
import { PaymentPage } from '../../pages/PaymentPage';
import { DAZNPlanPage } from '../../pages/DAZNPlanPage';

import { getPPVDataByVariant, readSheet } from '../../utils/excelReader';
import { detectVariant } from '../../flows/detectVariant';
import { validateVariant } from '../../flows/validateVariant';
import { buildEventData } from '../../utils/buildEventData';
import { displayResultsTable } from '../../utils/resultsDisplay';
import { writeResults } from '../../utils/excelWriter';
import { createTestUser } from '../../utils/testDataBuilder';
import { smartClick } from '../../utils/browserHelpers';

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

  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  // returns the most recently active non-closed page
  const getLivePage = async () => {
    await sleep(800);
    const pages = context.pages().filter(p => !p.isClosed());
    if (pages.length === 0) throw new Error('No active page found');
    const livePage = pages[pages.length - 1];
    await livePage.bringToFront().catch(() => {});
    return livePage;
  };

  const clickAndWaitForNav = async (p: any, btn: any, label: string) => {
    console.log(`clicking: ${label}`);
    const beforeUrl = p.url();
    await btn.scrollIntoViewIfNeeded().catch(() => {});
    await sleep(300);
    await btn.click({ force: true });
    await p.waitForFunction(
      (url) => window.location.href !== url,
      beforeUrl,
      { timeout: 10000 }
    ).catch(() => console.log(`${label}: no url change`));
    await sleep(2000);
  };

  try {
    const json = loadEventConfig();
    const eventData = buildEventData(json, DEFAULT_REGION);

    // -- schedule --
    const schedule = new SchedulePage(page);
    await schedule.navigate();

    const accept = page.locator('#onetrust-accept-btn-handler');
    const cookieBanner = page.locator('#onetrust-consent-sdk');
    await cookieBanner.waitFor({ state: 'attached', timeout: 10000 }).catch(() => {});
    if (await accept.isVisible().catch(() => false)) {
      await accept.click();
      await cookieBanner.waitFor({ state: 'hidden', timeout: 10000 });
    }

    await schedule.selectSport('Boxing');
    const eventCard = await schedule.findEvent(eventData.PPV_NAME);
    await schedule.clickEvent(eventCard);

    await schedule.clickBuyNow();

    // give DAZN time to navigate -- whether it opens a new tab or navigates in place
    await sleep(3000);

    let activePage = await getLivePage();
    console.log('landed on:', activePage.url());

    // validate
    const variant = await detectVariant(activePage).catch(() => 'unknown');
    console.log('🎯 variant:', variant);

    const landingData = readSheet('Landing page');
    await validateVariant(activePage, 'landing', landingData, results, eventData).catch(() => {});

    const ppvData = getPPVDataByVariant(variant);
    await validateVariant(activePage, variant, ppvData, results, eventData).catch(() => {});

    // -- step through PlanDetails pages --
    for (let i = 0; i < 3; i++) {
  activePage = await getLivePage();

  const isPPV = await activePage
    .getByText(/choose how to buy/i)
    .isVisible()
    .catch(() => false);

const isPlan = await activePage
  .locator('input[type="radio"], [role="radio"]')
  .first()
  .isVisible()
  .catch(() => false);


  console.log(`step ${i + 1}:`, {
    url: activePage.url(),
    isPPV,
    isPlan
  });

  // ───── PPV PAGE ─────
  if (isPPV) {
    console.log('👉 handling PPV page');

    const selectable = activePage.locator(
      'input[type="radio"], input[type="checkbox"], [role="radio"]'
    );

    if (await selectable.count() > 0) {
      await selectable.first().click({ force: true }).catch(() => {});
      await sleep(500);
    }

    const continueBtn = activePage.locator('button')
      .filter({ hasText: /continue/i })
      .last();

    await clickAndWaitForNav(activePage, continueBtn, 'PPV Continue');
    continue;
  }

  // ───── PLAN PAGE ─────
for (let i = 0; i < 3; i++) {
  activePage = await getLivePage();

  const isEmailPage = await activePage
    .locator('input[type="email"]')
    .isVisible()
    .catch(() => false);

  if (isEmailPage) {
    console.log('✅ reached email page — exiting loop');
    break;
  }

  const hasRadios = await activePage
    .locator('input[type="radio"], [role="radio"]')
    .count();

  const hasCheckbox = await activePage
    .locator('input[type="checkbox"]')
    .count();

  const isPPV = hasCheckbox > 0;
  const isPlan = hasRadios > 0 && !isPPV;

  console.log(`step ${i + 1}:`, {
    url: activePage.url(),
    isPPV,
    isPlan
  });

  if (isPPV) {
    console.log('👉 handling PPV page');

    const checkbox = activePage.locator('input[type="checkbox"]').first();

    if (await checkbox.isVisible().catch(() => false)) {
      await checkbox.click({ force: true });
      await sleep(500);
    }

    const continueBtn = activePage.locator('button[type="submit"]');

    await clickAndWaitForNav(activePage, continueBtn, 'PPV Continue');
    continue;
  }

  if (isPlan) {
    console.log('👉 handling DAZN plan page');

    const firstRadio = activePage
      .locator('input[type="radio"], [role="radio"]')
      .first();

    await firstRadio.click({ force: true });
    await sleep(500);

    const continueBtn = activePage.locator('button[type="submit"]');

    await clickAndWaitForNav(activePage, continueBtn, 'Plan Continue');
    continue;
  }

  break;
}
}

    activePage = await getLivePage();
    console.log('after plan pages:', activePage.url());

    // -- signup --
   const signupPage = new SignupPage(activePage);
    const emailInput = await signupPage.findEmailInput();

    if (emailInput) {
      const testUser = createTestUser();
      console.log('📧 email:', testUser.email);

      await signupPage.enterEmail(testUser.email);
      await sleep(500);
      await signupPage.clickContinue();

      const firstNameField = activePage.locator('[data-test-id="FIRST_NAME"]');
      let onPersonalDetails = false;

      for (let attempt = 0; attempt < 3; attempt++) {
        if (await firstNameField.isVisible().catch(() => false)) {
          onPersonalDetails = true;
          break;
        }
        const step = await signupPage.detectPageType();
        if (step === 'password') break;

        console.log(`still on email step, retry ${attempt + 1}`);
        await signupPage.clickContinue();
        await sleep(1500);
      }

      if (onPersonalDetails) {
        await signupPage.fillPersonalDetails(testUser);
        await signupPage.clickPersonalDetailsContinue();
      }
    }

    // -- payment --
    const paymentReady = activePage.locator('[data-test-id="summary_next_payment_header_value_refined"]');
    await paymentReady.waitFor({ state: 'visible', timeout: 15000 })
      .catch(() => console.log('payment summary not visible in time'));

    await sleep(1500);
    activePage = await getLivePage();

    const paymentPage = new PaymentPage(activePage);
    if (await paymentPage.isPaymentPage()) {
      console.log('✅ payment page loaded');
      const paymentData = readSheet('Monthly Payment page');      if (paymentData?.length) {
        await paymentPage.validate(paymentData, results);
      }
    } else {
      throw new Error(`Payment page not detected. URL: ${activePage.url()}`);
    }

   displayResultsTable(results, variant);

const filePath = await writeResults(results);

const passed = results.filter(r => r.status === 'PASS').length;
const failed = results.filter(r => r.status === 'FAIL').length;
const total = results.length;

const passPercent = total > 0
  ? ((passed / total) * 100).toFixed(2)
  : '0';

console.log(`
═══════════════════════════════════════
🎯 Variant: ${variant}
📊 Total: ${total}
✅ Passed: ${passed}
❌ Failed: ${failed}
📈 Pass %: ${passPercent}%
📁 Report: ${filePath}
═══════════════════════════════════════
`);


// 🔴 THROW ONLY AFTER LOGGING
if (failed > 0) {
  throw new Error(`${failed} validation(s) failed`);
}

  } catch (error) {
    console.error('❌ Test failed with error:', error);
    throw error;
  } finally {
    await context.close();
  }
});
