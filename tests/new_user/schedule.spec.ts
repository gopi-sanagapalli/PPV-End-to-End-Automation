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

  const getLivePage = async () => {
    // wait a beat for navigation to settle before checking pages
    await sleep(800);
    const pages = context.pages().filter(p => !p.isClosed());
    if (pages.length === 0) throw new Error('No active page found');
    // just grab the last non-closed page -- the readyState check was too aggressive
    // and was rejecting pages mid-navigation when state briefly hits "unloading"
    const livePage = pages[pages.length - 1];
    await livePage.bringToFront().catch(() => {});
    return livePage;
  };

  // handles both plan page variants:
  //   variant 1: two radio cards (PPV+Standard vs Ultimate)
  //   variant 2: event image + checkbox + subscription radio cards
  // in both cases we ensure the right option is selected then click Continue
  const handlePlanPage = async (p: any, pageNum: number) => {
    console.log(`handling plan page ${pageNum}:`, p.url());

    // variant 2 has a checkbox for the event itself -- make sure it's checked
    const eventCheckbox = p.locator('input[type="checkbox"]').first();
    if (await eventCheckbox.isVisible({ timeout: 2000 }).catch(() => false)) {
      const checked = await eventCheckbox.isChecked().catch(() => false);
      if (!checked) {
        await eventCheckbox.click({ force: true }).catch(() => {});
        await sleep(300);
        console.log('event checkbox checked');
      }
    }

    // select first radio option (top card) -- works for both variants
    const firstRadio = p.locator('input[type="radio"], [role="radio"]').first();
    if (await firstRadio.isVisible({ timeout: 2000 }).catch(() => false)) {
      await firstRadio.scrollIntoViewIfNeeded().catch(() => {});
      await firstRadio.click({ force: true }).catch(() => {});
      await sleep(500);
      console.log('first option selected');
    }

    // two known CTA variants on this page:
    //   upsellTierShown=true  -> button says exactly "Continue"
    //   upsellTierSkipped=true -> button says "Continue with PPV + 7-day free trial"
    // use exact text match (not has-text) so we don't accidentally match partial strings
    // filter by exact text content to avoid grabbing "Subscribe without a pay-per-view" or card buttons
    const continueSelectors = [
      'button:has-text("Continue with PPV + 7-day free trial")',
      'button:has-text("Continue with PPV")',
      'button:has-text("Continue")',
    ];

    let continueBtn = null;
    for (const selector of continueSelectors) {
      // get all matching buttons, pick the one whose trimmed text is an exact match
      const allMatches = p.locator(selector);
      const count = await allMatches.count().catch(() => 0);
      for (let idx = 0; idx < count; idx++) {
        const btn = allMatches.nth(idx);
        const txt = (await btn.textContent().catch(() => '')).trim();
        // exact match only -- prevents "Subscribe without a pay-per-view" slipping through
        if (
          txt === 'Continue with PPV + 7-day free trial' ||
          txt === 'Continue with PPV' ||
          txt === 'Continue'
        ) {
          continueBtn = btn;
          console.log(`plan page ${pageNum} CTA found: "${txt}"`);
          break;
        }
      }
      if (continueBtn) break;
    }

    if (!continueBtn) {
      const allBtns = await p.locator('button').allTextContents();
      console.log('all buttons on plan page:', allBtns);
      throw new Error(`No Continue button found on plan page ${pageNum}. URL: ${p.url()}`);
    }

    await continueBtn.scrollIntoViewIfNeeded().catch(() => {});
    await sleep(500);

    const beforeUrl = p.url();
    await continueBtn.click({ force: true });

    await p.waitForFunction(
      (url) => window.location.href !== url,
      beforeUrl,
      { timeout: 15000 }
    ).catch(() => console.log(`plan page ${pageNum}: no url change after Continue`));

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

    // DAZN sometimes opens the plan page in a new tab and closes the original.
    // wait up to 5s for any new page to appear, then grab the latest one.
    let activePage: any;
    try {
      activePage = await context.waitForEvent('page', { timeout: 5000 });
      await activePage.bringToFront().catch(() => {});
      console.log('new tab opened:', activePage.url());
    } catch {
      // no new tab -- page navigated in place, just grab current
      activePage = await getLivePage();
    }

    await sleep(2000);
    activePage = await getLivePage();

    console.log('landed on:', activePage.url());

    // detect variant + validate (works on plan page too, just logs what's there)
    const variant = await detectVariant(activePage).catch(() => 'unknown');
    console.log('🎯 variant:', variant);

    const landingData = readSheet('Landing page');
    await validateVariant(activePage, 'landing', landingData, results, eventData).catch(() => {});

    const ppvData = getPPVDataByVariant(variant);
    await validateVariant(activePage, variant, ppvData, results, eventData).catch(() => {});

    // -- step through all PlanDetails pages --
    // loop handles: 0 plan pages, 1 plan page, or 2 plan pages
    for (let i = 0; i < 3; i++) {
      activePage = await getLivePage();
      if (!activePage.url().includes('PlanDetails')) break;
      await handlePlanPage(activePage, i + 1);
    }

    activePage = await getLivePage();
    console.log('after plan pages:', activePage.url());

    // -- signup: email --
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
      .catch(() => console.log('⚠️ payment summary not visible in time'));

    await sleep(1500);
    activePage = await getLivePage();

    const paymentPage = new PaymentPage(activePage);
    if (await paymentPage.isPaymentPage()) {
      console.log('✅ payment page loaded');
      const paymentData = readSheet('Monthly Payment page ');
      if (paymentData?.length) {
        await paymentPage.validate(paymentData, results);
      }
    } else {
      throw new Error(`Payment page not detected. URL: ${activePage.url()}`);
    }

    // -- results --
    displayResultsTable(results, variant);
    const filePath = await writeResults(results);
    console.log(`📁 report: ${filePath}`);

    const failed = results.filter(r => r.status === 'FAIL');
    if (failed.length > 0) {
      throw new Error(`${failed.length} validation(s) failed -- see report: ${filePath}`);
    }

  } finally {
    await context.close();
  }
});