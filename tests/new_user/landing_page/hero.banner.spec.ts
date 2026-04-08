import { test } from '@playwright/test';
import { readSheet, getPPVDataByVariant } from '../../../utils/excelReader';
import { handleCookies } from '../../../utils/helpers';
import { detectVariant } from '../../../flows/detectVariant';
import { validateVariant } from '../../../flows/validateVariant';
import { validateDaznPlan } from '../../../config/daznPlan';
import { writeResults } from '../../../utils/excelWriter';
import { validateField } from '../../../utils/validator';
import { saveCookieState, loadCookieState } from '../../../utils/cookieManager';
import { createTestUser } from '../../../utils/testDataBuilder';
import { scrollIntoViewSmart, smartClick, removeOverlays } from '../../../utils/browserHelpers';
import { displayResultsTable } from '../../../utils/resultsDisplay';
import { LandingPage } from '../../../pages/LandingPage';
import { PPVPage } from '../../../pages/PPVPage';
import { DAZNPlanPage } from '../../../pages/DAZNPlanPage';
import { SignupPage } from '../../../pages/SignupPage';
import { PaymentPage } from '../../../pages/PaymentPage';
import selectors from '../../../config/selectors.json';

test('Landing → PPV → Plan → Signup → Payment flow', async ({ browser }) => {
  test.setTimeout(240000);

  const results: any[] = [];
  let variant = 'unknown'

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    ignoreHTTPSErrors: true,
    storageState: loadCookieState() || undefined
  });

  const page = await context.newPage();

  try {
    // ───────── Landing ─────────
    console.log('Opening landing page...');
    await page.goto('https://www.dazn.com/en-AU/welcome', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load');

    await removeOverlays(page);
    await handleCookies(page);
    await saveCookieState(page);

    const landingPage = new LandingPage(page);
    const banner = await landingPage.findPPVBanner();

    if (!banner) throw new Error('PPV banner not found');

    const landingDataArr = readSheet('Landing page');
    const landingData: Record<string, string> = {};
    landingDataArr.forEach((r: any) => (landingData[r.Field] = r.Value));

    for (const [field, expected] of Object.entries(landingData)) {
      let actual = 'N/A';

      if (/banner/i.test(field)) {
        actual = (await banner.isVisible()) ? 'Yes' : 'No';
      } else if (/name/i.test(field)) {
        actual = await landingPage.getEventName(banner);
      } else if (/date/i.test(field)) {
        actual = await landingPage.getEventDate([selectors.landingPage.eventDate]);
      } else if (/description/i.test(field)) {
        actual = await landingPage.getEventDescription(banner);
      } else if (/buy/i.test(field)) {
        actual = await landingPage.hasBuyButton(['button:has-text("Buy now")']) ? 'Yes' : 'No';
      }

      validateField(results, 'Landing page', field, expected, actual?.trim(), 'landing');
    }

    const buyBtn = await landingPage.findBuyNowButton(banner, ['button:has-text("Buy now")']);
    if (!buyBtn) throw new Error('Buy Now CTA not found');

    await scrollIntoViewSmart(page, buyBtn, 'Buy Now');
    await smartClick(page, buyBtn, 'Buy Now', { waitForNav: true });

    await page.waitForLoadState('domcontentloaded');

    // ───────── PPV ─────────
    const ppvPage = new PPVPage(page);
    variant = await detectVariant(page).catch(() => 'unknown');

    if (variant === 'unknown') {
      variant = await ppvPage.detectVariant();
    }

    console.log(`Variant detected: ${variant}`);

    const ppvData = getPPVDataByVariant(variant);
    await validateVariant(page, variant, ppvData, results);

    const continueBtn = page.getByRole('button', { name: /continue|next/i }).first();
    if (await continueBtn.isVisible().catch(() => false)) {
      await smartClick(page, continueBtn, 'PPV Continue', { waitForNav: true });
    }

    await page.waitForLoadState('domcontentloaded');

    // ───────── Plan ─────────
    const daznPlanPage = new DAZNPlanPage(page);

    if (await daznPlanPage.isPlanPage()) {
      const planData = readSheet('Dazn Plan page');

      if (planData?.length) {
        await validateDaznPlan(page, planData, results);
      }

      // ensure trial selected
      const trial = page.locator('label:has-text("7-day free trial")');
      if (await trial.isVisible().catch(() => false)) {
        await trial.click();
      }

      const btn = await daznPlanPage.findContinueButton();
      if (!btn) throw new Error('Plan continue not found');

      await btn.scrollIntoViewIfNeeded();
      await btn.click();

      await page.waitForLoadState('domcontentloaded');
    }

    // ───────── Signup ─────────
    const signupPage = new SignupPage(page);
    const emailInput = await signupPage.findEmailInput();

    if (!emailInput) throw new Error('Email input not found');

    const user = createTestUser();

    await signupPage.enterEmail(user.email);
    await signupPage.clickContinue();

    const firstName = page.locator('[data-test-id="FIRST_NAME"]');

    if (await firstName.isVisible({ timeout: 5000 }).catch(() => false)) {
      await signupPage.fillPersonalDetails(user);
      await signupPage.clickPersonalDetailsContinue();

      validateField(results, 'Signup Page', 'Personal Details', 'Completed', 'Completed', 'signup');
    }

    // ───────── Payment ─────────
    const paymentPage = new PaymentPage(page);

    await page.locator('[data-test-id="summary_next_payment_header_value_refined"]')
      .waitFor({ timeout: 15000 });

    if (await paymentPage.isPaymentPage()) {
      const paymentData = readSheet('Monthly Payment page ');

      if (paymentData?.length) {
        await paymentPage.validate(paymentData, results);
      }
    } else {
      console.log('Payment page not reached');
    }

  } catch (err) {
    console.error('Test failed:', err);
    throw err;
  } finally {
    await writeResults(results);
    displayResultsTable(results, variant);
    await context.close();
  }
});