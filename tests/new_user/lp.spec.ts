import { test } from '@playwright/test';

import { LandingPage } from '../../pages/LandingPage';
import { DAZNPlanPage } from '../../pages/DAZNPlanPage';
import { SignupPage } from '../../pages/SignupPage';
import { PaymentPage } from '../../pages/PaymentPage';

import { getPPVDataByVariant, readSheet } from '../../utils/excelReader';
import { detectVariant } from '../../flows/detectVariant';
import { validateVariant } from '../../flows/validateVariant';
import { buildEventData } from '../../utils/buildEventData';
import { smartClick } from '../../utils/browserHelpers';
import { displayResultsTable } from '../../utils/resultsDisplay';
import { writeResults } from '../../utils/excelWriter';
import { createTestUser } from '../../utils/testDataBuilder';
const TEST_EMAIL = `test_${Date.now()}@mail.com`;

test('PPV...', async ({ browser }) => {

  // 🔥 CLEAN CONTEXT (fixes variant stickiness + cookies)
  const context = await browser.newContext();
  const page = await context.newPage();

  // 🔥 BLOCK COOKIE SYSTEM COMPLETELY (single strategy only)
  await page.addInitScript(() => {
    Object.defineProperty(window, 'OneTrust', {
      value: {
        OnConsentChanged: () => {},
        IsAlertBoxClosed: () => true,
        Close: () => {},
      },
      writable: false,
    });

    window.localStorage.setItem('OptanonAlertBoxClosed', 'true');
    window.localStorage.setItem(
      'OptanonConsent',
      'isIABGlobal=false&datestamp=1&version=1&groups=C0001:1'
    );

    const removeBanner = () => {
      const el = document.getElementById('onetrust-consent-sdk');
      if (el) el.remove();
    };

    setInterval(removeBanner, 500);
  });

  const results: any[] = [];

  // ─────────────────────────────
  // STEP 1: TEST DATA
  // ─────────────────────────────
  const json = require('../../config/Chisora.json');
  const eventData = buildEventData(json, 'AU');

  // ─────────────────────────────
  // STEP 2: LANDING PAGE
  // ─────────────────────────────
  const landing = new LandingPage(page);

  await landing.navigate();

  const container = await landing.findPPVContainer(eventData);

  const landingData = readSheet('Landing page');
  await validateVariant(page, 'landing', landingData, results, eventData);

  await landing.clickBuyNow(eventData);

  // ─────────────────────────────
  // STEP 3: DETECT VARIANT
  // ─────────────────────────────
  const variant = await detectVariant(page);

  // ─────────────────────────────
  // STEP 4: VALIDATE PPV PAGE
  // ─────────────────────────────
  const ppvData = getPPVDataByVariant(variant);
  await validateVariant(page, variant, ppvData, results, eventData);

  // ─────────────────────────────
  // STEP 5: CONTINUE
  // ─────────────────────────────
  const continueBtn = page.getByRole('button', {
    name: /continue|next|proceed/i
  }).first();

  if (await continueBtn.isVisible().catch(() => false)) {
    await smartClick(page, continueBtn, 'PPV Continue', {
      waitForNav: true
    });
  }

  await page.waitForLoadState('domcontentloaded');

  // ─────────────────────────────
  // STEP 6: PLAN PAGE
  // ─────────────────────────────
  const daznPlanPage = new DAZNPlanPage(page);

  if (await daznPlanPage.isPlanPage()) {
    await daznPlanPage.clickContinue();
  }

 // ─────────────────────────────
// STEP 7: SIGNUP (FIXED)
// ─────────────────────────────

const signup = new SignupPage(page);
const user = createTestUser();

// STEP 1: EMAIL
const emailInput = await signup.findEmailInput();

if (emailInput) {
  await signup.enterEmail(user.email);
  await signup.clickContinue();
}

// STEP 2: WAIT + DETECT (CRITICAL FIX)
const nextStep = await signup.waitForNextStep();

// STEP 3: PERSONAL DETAILS (ONLY IF PRESENT)
if (nextStep === 'personalDetails') {
  await signup.fillPersonalDetails(user);
  await signup.clickPersonalDetailsContinue();
}

  // ─────────────────────────────
  // STEP 8: PAYMENT
  // ─────────────────────────────
 await page.waitForLoadState('domcontentloaded');

// 🔥 wait for something payment-specific
await page.waitForTimeout(2000); // temporary stabilizer

console.log('📍 Current URL:', page.url());

const payment = new PaymentPage(page);

if (await payment.isPaymentPage()) {
const paymentData = readSheet('Monthly Payment page');  await payment.validate(paymentData, results);
} else {
  throw new Error('❌ Payment page NOT detected');
}

  // ─────────────────────────────
  // FINAL OUTPUT
  // ─────────────────────────────
displayResultsTable(results, variant);

const filePath = await writeResults(results);

console.log(`
═══════════════════════════════════════
🎯 Variant: ${variant}
📊 Total: ${results.length}
✅ Passed: ${results.filter(r => r.status === 'PASS').length}
❌ Failed: ${results.filter(r => r.status === 'FAIL').length}
📁 Excel: ${filePath}
═══════════════════════════════════════
`);
});