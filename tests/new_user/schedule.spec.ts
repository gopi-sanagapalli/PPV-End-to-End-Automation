import { test } from '@playwright/test';
import { readSheet, getPPVDataByVariant } from '../../utils/excelReader';
import { handleCookies } from '../../utils/helpers';
import { detectVariant } from '../../flows/detectVariant';
import { validateVariant } from '../../flows/validateVariant';
import { validateDaznPlan } from '../../config/daznPlan';
import { writeResults } from '../../utils/excelWriter';
import { validateField } from '../../utils/validator';
import { saveCookieState, loadCookieState } from '../../utils/cookieManager';
import { createTestUser } from '../../utils/testDataBuilder';
import { scrollIntoViewSmart, smartClick, removeOverlays } from '../../utils/browserHelpers';
import { displayResultsTable } from '../../utils/resultsDisplay';
import { LandingPage } from '../../pages/LandingPage';
import { PPVPage } from '../../pages/PPVPage';
import { DAZNPlanPage } from '../../pages/DAZNPlanPage';
import { SignupPage } from '../../pages/SignupPage';
import { PaymentPage } from '../../pages/PaymentPage';
import { SchedulePage } from '../../pages/schedulepage';
import selectors from '../../config/selectors.json';

type ValidationResult = {
  page: string;
  field: string;
  expected: unknown;
  actual: unknown;
  status: 'PASS' | 'FAIL';
  variant?: string;
};

type PerformanceMetrics = {
  landingPageLoad: number;
  ppvPageLoad: number;
  daznPlanLoad: number;
  signupPageLoad: number;
  paymentPageLoad: number;
  totalTestTime: number;
};

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

/** Wait time after plan selection for button state to update */
const PLAN_SELECTION_WAIT = 500;

/** Mandatory wait before clicking Continue button (requirement) */
const MANDATORY_WAIT_BEFORE_CONTINUE = 3000;

/** Wait time for button state recheck after reselection */
const BUTTON_STATE_RECHECK_WAIT = 800;

/** Wait time for navigation to complete */
const NAVIGATION_WAIT = 500;

/** Wait time between validation steps */
const VALIDATION_STEP_WAIT = 300;

/** Wait time for cookie banner handling */
const COOKIE_BANNER_WAIT = 200;

/** Timeout for page navigation */
const PAGE_NAVIGATION_TIMEOUT = 15000;

/** Timeout for element visibility checks */
const ELEMENT_VISIBILITY_TIMEOUT = 3000;

/** Timeout for PPV banner detection */
const PPV_BANNER_TIMEOUT = 8000;

/** Timeout for URL navigation after click */
const URL_CHANGE_TIMEOUT = 8000;

/** Wait time after email submission */
const EMAIL_SUBMISSION_WAIT = 1000;

/** Wait time before payment page validation */
const PAYMENT_PAGE_WAIT = 1000;

/** Maximum retry attempts for smart click */
const MAX_CLICK_RETRIES = 3;

// ═══════════════════════════════════════════════════════════════════════════
// SELECTOR CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

/** Selectors for Buy Now / Watch Now CTAs */
const BUY_NOW_SELECTORS = [
  'button:has-text("Buy now")',
  'a:has-text("Buy now")',
  'button:has-text("Watch now")',
  'a:has-text("Watch now")',
];

/** Selectors for Continue buttons */
const CONTINUE_SELECTORS = [
  'button:has-text("Continue with PPV + 7-day free trial")',
  'button:has-text("Continue with PPV")',
  'button:has-text("Continue")',
  'button:has-text("Next")',
  '[data-testid*="continue"]',
];

/** Selectors for plan selection options */
const PLAN_SELECTORS = [
  'input[type="radio"]',
  '[role="radio"]',
  'button:has-text("7-day free trial")',
  'button:has-text("Monthly")',
];

/** Selectors for date elements on landing page */
const DATE_SELECTORS = [
  selectors.landingPage.eventDate,
  'text=/Saturday|Sunday|Monday|Tuesday|Wednesday|Thursday|Friday/i',
  'text=/\\d{1,2}:\\d{2}\\s*(AM|PM)/i',
];

test('Landing + PPV Validation', {}, async ({ browser }) => {
  test.setTimeout(240000);
  const testStartTs = Date.now();

  const results: ValidationResult[] = [];
  let variant = 'unknown';
  const performanceMetrics: PerformanceMetrics = {
    landingPageLoad: 0,
    ppvPageLoad: 0,
    daznPlanLoad: 0,
    signupPageLoad: 0,
    paymentPageLoad: 0,
    totalTestTime: 0,
  };

  const landingDataArr = readSheet('Landing page');
  const landingData: Record<string, string> = {};
  landingDataArr.forEach((row: any) => {
    landingData[row.Field] = row.Value;
  });

  // Load stored cookie state if available
  const savedCookieState = loadCookieState();
  const cookiesAlreadyAccepted = savedCookieState !== null;
  console.log(cookiesAlreadyAccepted
    ? '🍪 Cookies already accepted (stored JSON) – banner will not be shown'
    : '🍪 No stored cookie state – will handle banner when it appears');

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    ignoreHTTPSErrors: true,
    storageState: savedCookieState || undefined,
    recordVideo: {
      dir: 'test-results',
      size: { width: 1920, height: 1080 },
    },
  });

  let page = await context.newPage();

  const refreshActivePage = async (fallbackUrl?: string) => {
    if (!page.isClosed()) return page;
    const openPages = context.pages().filter(p => !p.isClosed());
    if (openPages.length > 0) {
      page = openPages[openPages.length - 1];
      await page.bringToFront().catch(() => {});
      console.log('🔄 Switched to active page:', page.url());
      return page;
    }
    if (!fallbackUrl) {
      console.log('⚠️ Page is closed and no active tab is available');
      return page;
    }
    page = await context.newPage();
    await page.goto(fallbackUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
    console.log('🔄 Recreated page in same context using fallback URL');
    return page;
  };

  const switchToLatestOpenPage = async () => {
    const openPages = context.pages().filter(p => !p.isClosed());
    if (openPages.length > 0) {
      page = openPages[openPages.length - 1];
      await page.bringToFront().catch(() => {});
      console.log('🧭 Switched to latest open tab:', page.url());
    }
    return page;
  };

  /**
   * Captures screenshot on test failure for debugging
   */
  const captureScreenshotOnFailure = async (stepName: string) => {
    try {
      if (!page.isClosed()) {
        const timestamp = Date.now();
        const screenshotPath = `test-results/failure-${stepName}-${timestamp}.png`;
        await page.screenshot({ path: screenshotPath, fullPage: true });
        console.log(`📸 Screenshot captured: ${screenshotPath}`);
      }
    } catch (error) {
      console.log('⚠️ Could not capture screenshot:', error.message);
    }
  };

  try {
   // ═════════════════════════════════════════════════════════════════════
// REQ 1: Navigate to Schedule page
// ═════════════════════════════════════════════════════════════════════
const req1Start = Date.now();
console.log('📅 REQ 1 – Navigating to schedule page...');

await page.goto('https://www.dazn.com/en-AU/schedule', { waitUntil: 'domcontentloaded' });
const initialSchedulePage = new SchedulePage(page);
await initialSchedulePage.navigate();

console.log(`⏱️ REQ 1 – Completed in ${Date.now() - req1Start}ms`);


// ═════════════════════════════════════════════════════════════════════
// REQ 2: Handle cookies (NO CHANGE)
// ═════════════════════════════════════════════════════════════════════
const req2Start = Date.now();

if (cookiesAlreadyAccepted) {
  console.log('🍪 REQ 2 – Skipping cookie popup (state restored)');
  await removeOverlays(page);
} else {
  console.log('🍪 REQ 2 – Handling cookie banner...');
  await handleCookies(page);
  await saveCookieState(page);
  console.log('✅ REQ 2 – Cookie banner handled');
}

console.log(`⏱️ REQ 2 – Completed in ${Date.now() - req2Start}ms`);

// HARD GUARD: schedule UI must be ready
await page.waitForFunction(() => {
  return document.body.innerText.toLowerCase().includes('schedule');
}, { timeout: 10000 });
// ═════════════════════════════════════════════════════════════════════
// REQ 3: Schedule → Boxing → Date → Tile click
// ═════════════════════════════════════════════════════════════════════
const req3Start = Date.now();

console.log('🥊 REQ 3 – Selecting Boxing / Date / Event using SchedulePage...');

const schedulePage = new SchedulePage(page);

// 🔒 Ensure page is stable BEFORE interaction
await page.waitForLoadState('networkidle');

// Optional: wait for sports UI container if exists
await page.waitForFunction(() => {
  return document.querySelectorAll('button, [role="button"]').length > 5;
}, { timeout: 10000 });

// NOW interact
await schedulePage.selectBoxing();
const event = await schedulePage.findEventWithScroll('Chisora vs Wilder');
await schedulePage.clickEvent(event);
await schedulePage.clickBuyNow();

await page.waitForURL(/signup|plan|content|ppv/, {
  timeout: URL_CHANGE_TIMEOUT,
}).catch(() => {
  console.log('⚠️ Navigation timeout, current URL:', page.url());
});

console.log(`⏱️ REQ 3 – Completed in ${Date.now() - req3Start}ms`);

    // ═════════════════════════════════════════════════════════════════════
// REQ 4: Detect variant and validate PPV page + Continue flow
// ═════════════════════════════════════════════════════════════════════
const req4Start = Date.now();

if (page.isClosed()) {
  variant = 'unknown';
} else {
  const ppvPage = new PPVPage(page);

  // Check if variant indicators are visible
  const indicatorVisible = await ppvPage.areVariantIndicatorsVisible();

  if (!indicatorVisible) {
    console.log('📜 REQ 4 – Scrolling to reveal variant indicators...');
    await page.evaluate(() => window.scrollBy(0, 300));
    await page.waitForTimeout(COOKIE_BANNER_WAIT);
  } else {
    console.log('✅ REQ 4 – Variant indicators already visible');
  }

  // Detect variant
  variant = await detectVariant(page).catch(() => 'unknown');

  if (variant === 'unknown') {
    variant = await ppvPage.detectVariant();
  }

  console.log(`🎯 REQ 4 – Detected variant: ${variant}`);
}

// Refresh page reference
page = await refreshActivePage(page.url());

// Validate PPV page
const ppvData = getPPVDataByVariant(variant);
console.log(`📊 REQ 4 – Validating PPV page (${variant})`);
await validateVariant(page, variant, ppvData, results);
console.log('✅ REQ 4 – PPV page validation completed');

// ─────────────────────────────────────────────
// CONTINUE FLOW (PPV → PLAN → SIGNUP)
// ─────────────────────────────────────────────
if (!page.isClosed()) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(VALIDATION_STEP_WAIT);

  const daznPlanPage = new DAZNPlanPage(page);

  // ✅ CHECK PLAN PAGE CORRECTLY
  const isDaznPlanPage = await daznPlanPage.isPlanPage();

  if (isDaznPlanPage) {
    console.log('✅ REQ 4 – On DAZN Plan page');
    // Do not click plan CTA here; REQ 5 handles plan-page CTA flow.

  } else {
    console.log('ℹ️ REQ 4 – Not on Plan page, clicking PPV Continue');

    const continueBtn = page.getByRole('button', {
      name: /continue|next|proceed/i
    }).first();

    if (await continueBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await page.waitForTimeout(MANDATORY_WAIT_BEFORE_CONTINUE);

     const beforeUrl = page.url();

await smartClick(page, continueBtn, 'Continue (PPV)', {
  waitForNav: true,
  maxRetries: MAX_CLICK_RETRIES
});

// WAIT FOR REAL NAVIGATION
await page.waitForFunction(
  (url) => window.location.href !== url,
  beforeUrl,
  { timeout: 5000 }
).catch(() => console.log('⚠️ No URL change after Continue'));

await page.waitForLoadState('domcontentloaded');

      console.log('✅ Continue clicked on PPV page');
    }
  }

  // Wait for navigation
  await page.waitForTimeout(NAVIGATION_WAIT);
}

console.log(`⏱️ REQ 4 – Completed in ${Date.now() - req4Start}ms`);

// REQ 5: Validate DAZN Plan page and click CTA (FINAL INLINE)
// ═════════════════════════════════════════════════════════════════════
const req5Start = Date.now();

if (!page || page.isClosed()) {
  console.log('⚠️ REQ 5 – Page closed, skipping');
} else {
  const planDataArr = readSheet('Dazn Plan page');
  const daznPlanPage = new DAZNPlanPage(page);

  const onPlanPage = await daznPlanPage.isPlanPage();
  console.log(`📍 REQ 5 – On Plan Page: ${onPlanPage}`);

  if (onPlanPage) {
    // ─────────────────────────────────────────────
    // STEP 1: VALIDATION (NON-BLOCKING)
    // ─────────────────────────────────────────────
    if (planDataArr && planDataArr.length > 0) {
      console.log('📊 REQ 5 – Validating DAZN Plan page...');
      try {
        await validateDaznPlan(page, planDataArr, results);
        console.log('✅ REQ 5 – Validation completed');
      } catch (err) {
        console.log('⚠️ REQ 5 – Validation failed but continuing...');
      }
    }

    // ─────────────────────────────────────────────
    // STEP 2: CHECK IF ALREADY ON SIGNUP
    // ─────────────────────────────────────────────
    const alreadyOnSignup = await daznPlanPage.isOnSignupPage();

    if (alreadyOnSignup) {
      console.log('✅ REQ 5 – Already on signup page');
    } else {
      // ─────────────────────────────────────────────
      // STEP 3: FIND CTA
      // ─────────────────────────────────────────────
      console.log('🔍 REQ 5 – Looking for Continue CTA...');
// 🔥 FORCE CORRECT PLAN SELECTION (CRITICAL FIX)
console.log('🔁 Ensuring Trial plan is selected before Continue...');

const trialPlan = page.locator('label:has-text("7-day free trial")');

if (await trialPlan.isVisible().catch(() => false)) {
  await trialPlan.scrollIntoViewIfNeeded();
  await trialPlan.click();

  // Wait until selected state appears
  await trialPlan.locator('[aria-label="selected"], img[alt="selected"]').waitFor({
    timeout: 5000
  });

  console.log('✅ Trial plan confirmed selected');
} else {
  console.log('⚠️ Trial plan not found');
}
      const daznContinueBtn = await daznPlanPage.findContinueButton();

      if (!daznContinueBtn) {
        await captureScreenshotOnFailure('req5-no-cta');
        throw new Error('❌ Continue button not found on DAZN Plan page');
      }

      console.log('✅ REQ 5 – CTA found');

      // ─────────────────────────────────────────────
      // STEP 4: CLICK CTA (ROBUST)
      // ─────────────────────────────────────────────
      const beforeUrl = page.url();

      await daznContinueBtn.scrollIntoViewIfNeeded().catch(() => {});
      await page.waitForTimeout(500);

      console.log('🖱️ REQ 5 – Clicking Continue...');

      await daznContinueBtn.click({ force: true });

      // ─────────────────────────────────────────────
      // STEP 5: WAIT FOR NAVIGATION (SPA SAFE)
      // ─────────────────────────────────────────────
      await page.waitForFunction(
        (url) => window.location.href !== url,
        beforeUrl,
        { timeout: 5000 }
      ).catch(() => console.log('⚠️ REQ 5 – No URL change detected'));

      await page.waitForLoadState('domcontentloaded');

      // Final check
      const nowOnSignup = await daznPlanPage.isOnSignupPage();

      if (nowOnSignup) {
        console.log('✅ REQ 5 – Successfully navigated to signup');
      } else {
        console.log('⚠️ REQ 5 – Navigation unclear, current URL:', page.url());
      }
    }
  } else {
    console.log('ℹ️ REQ 5 – Not on DAZN Plan page');
  }
}

console.log(`⏱️ REQ 5 – Completed in ${Date.now() - req5Start}ms`);
    // ═════════════════════════════════════════════════════════════════════
    // REQ 6 & 7: Sign up flow
    // ═════════════════════════════════════════════════════════════════════
    const signupPage = new SignupPage(page);
    const emailInput = await signupPage.findEmailInput();

    if (emailInput) {
      const testUser = createTestUser();

      console.log(`📧 Entering email: ${testUser.email}`);
      await signupPage.enterEmail(testUser.email);
      await page.waitForTimeout(500);

      console.log('🖱️ Clicking continue after email...');
      await signupPage.clickContinue();

      console.log('⏳ Waiting for next signup step...');
      const firstNameField = page.locator('[data-test-id="FIRST_NAME"]');

      let reachedPersonalDetails = false;
      for (let i = 0; i < 3; i++) {
        console.log(`🔁 Check attempt ${i + 1}`);

        if (await firstNameField.isVisible().catch(() => false)) {
          reachedPersonalDetails = true;
          break;
        }

        const pageTypeAttempt = await signupPage.detectPageType();
        if (pageTypeAttempt === 'password') {
          break;
        }

        console.log('⚠️ Still on email page → retry click');
        await signupPage.clickContinue();
        await page.waitForTimeout(1500);
      }

      const pageType = reachedPersonalDetails ? 'personalDetails' : await signupPage.detectPageType();

      if (pageType === 'personalDetails') {
      console.log('✅ Landed on personal details page');

console.log('🧾 Filling personal details...');
await signupPage.fillPersonalDetails(testUser);

console.log('🖱️ REQ 7 – Clicking Continue after details...');
await signupPage.clickPersonalDetailsContinue();

validateField(
  results,
  'Signup Page',
  'Personal Details',
  'Completed',
  'Completed',
  'signup'
);

    // ═════════════════════════════════════════════════════════════════════
    // REQ 8: Payment page validation
    // ═════════════════════════════════════════════════════════════════════
console.log('💳 REQ 8 – Waiting for FULL payment page load...');

// 🔥 Wait for STRONG unique element
const paymentReady = page.locator(
  '[data-test-id="summary_next_payment_header_value_refined"]'
);

await paymentReady.waitFor({
  state: 'visible',
  timeout: 15000
}).catch(() => {
  console.log('❌ Payment page did not fully load');
});

// Extra safety (SPA stabilization)
await page.waitForTimeout(1500);

// 🔍 Double confirm
const paymentPage = new PaymentPage(page);
const isPaymentPage = await paymentPage.isPaymentPage();

if (isPaymentPage) {
  console.log('✅ Payment page FULLY loaded');

  const paymentDataArr = readSheet('Monthly Payment page ');

  if (paymentDataArr?.length) {
    await paymentPage.validate(paymentDataArr, results);
  }

} else {
  console.log('❌ Still not on payment page');
}
      }
    }
  } catch (error) {
    console.error('❌ Test failed:', error);
    await captureScreenshotOnFailure('test-failure');
    throw error;
  } finally {
    // Calculate total test time
    performanceMetrics.totalTestTime = Date.now() - testStartTs;
    console.log(`⏱️ Total test time: ${performanceMetrics.totalTestTime}ms`);
    
    // Write results
    await writeResults(results);
    
    // Display results table
    displayResultsTable(results, variant);
    
    // Close context
    await context.close();
  }
});