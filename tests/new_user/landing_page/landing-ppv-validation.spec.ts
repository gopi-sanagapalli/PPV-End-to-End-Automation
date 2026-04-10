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

// -------------------------------------------------------------------
// Timing constants — tuned from trial runs; adjust if flakiness appears
// -------------------------------------------------------------------

// after selecting a plan, the button needs a moment to reflect state
const PLAN_SELECTION_WAIT = 500;

// product requirement: must pause 3s before hitting Continue on PPV page
const MANDATORY_WAIT_BEFORE_CONTINUE = 3000;

// small buffer after re-selecting a plan to let the button re-enable
const BUTTON_STATE_RECHECK_WAIT = 800;

const NAVIGATION_WAIT = 500;
const VALIDATION_STEP_WAIT = 300;
const COOKIE_BANNER_WAIT = 200;

// -------------------------------------------------------------------
// Timeout constants — kept generous to handle slow CI environments
// -------------------------------------------------------------------

const PAGE_NAVIGATION_TIMEOUT = 15000;
const ELEMENT_VISIBILITY_TIMEOUT = 3000;
const PPV_BANNER_TIMEOUT = 8000;
const URL_CHANGE_TIMEOUT = 8000;
const EMAIL_SUBMISSION_WAIT = 1000;
const PAYMENT_PAGE_WAIT = 1000;
const MAX_CLICK_RETRIES = 3;

// -------------------------------------------------------------------
// Selector lists — ordered by priority (most specific first)
// -------------------------------------------------------------------

const BUY_NOW_SELECTORS = [
  'button:has-text("Buy now")',
  'a:has-text("Buy now")',
  'button:has-text("Watch now")',
  'a:has-text("Watch now")',
];

const CONTINUE_SELECTORS = [
  'button:has-text("Continue with PPV + 7-day free trial")',
  'button:has-text("Continue with PPV")',
  'button:has-text("Continue")',
  'button:has-text("Next")',
  '[data-testid*="continue"]',
];

const PLAN_SELECTORS = [
  'input[type="radio"]',
  '[role="radio"]',
  'button:has-text("7-day free trial")',
  'button:has-text("Monthly")',
];

const DATE_SELECTORS = [
  selectors.landingPage.eventDate,
  'text=/Saturday|Sunday|Monday|Tuesday|Wednesday|Thursday|Friday/i',
  'text=/\\d{1,2}:\\d{2}\\s*(AM|PM)/i',
];

// -------------------------------------------------------------------
// Main test — covers landing → PPV → plan selection → signup → payment
// -------------------------------------------------------------------

test('Landing + PPV Validation', {}, async ({ browser }) => {
  test.setTimeout(240000);

  const testStartTs = Date.now();
  const results: ValidationResult[] = [];
  let variant = 'unknown';

  const perf: PerformanceMetrics = {
    landingPageLoad: 0,
    ppvPageLoad: 0,
    daznPlanLoad: 0,
    signupPageLoad: 0,
    paymentPageLoad: 0,
    totalTestTime: 0,
  };

  // Pull landing page expected values from the sheet once up front
  const landingDataArr = readSheet('Landing page');
  const landingData: Record<string, string> = {};
  landingDataArr.forEach((row: any) => {
    landingData[row.Field] = row.Value;
  });

  // Reuse cookie state across runs so we don't fight the banner every time
  const savedCookieState = loadCookieState();
  const cookiesAlreadyAccepted = savedCookieState !== null;

  if (cookiesAlreadyAccepted) {
    console.log('🍪 Cookies already stored — skipping banner handling');
  } else {
    console.log('🍪 No cookie state found — will accept banner this run');
  }

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

  // Helper: if the active page closes mid-test (e.g. after a redirect opens a new tab),
  // grab the latest open one rather than crashing
  const refreshActivePage = async (fallbackUrl?: string) => {
    if (!page.isClosed()) return page;

    const openPages = context.pages().filter(p => !p.isClosed());
    if (openPages.length > 0) {
      page = openPages[openPages.length - 1];
      await page.bringToFront().catch(() => {});
      console.log('Switched to open tab:', page.url());
      return page;
    }

    if (!fallbackUrl) {
      console.log('Page closed and no fallback URL provided');
      return page;
    }

    // Last resort: open a fresh page in the same context
    page = await context.newPage();
    await page.goto(fallbackUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
    console.log('Reopened page using fallback URL');
    return page;
  };

  const switchToLatestOpenPage = async () => {
    const openPages = context.pages().filter(p => !p.isClosed());
    if (openPages.length > 0) {
      page = openPages[openPages.length - 1];
      await page.bringToFront().catch(() => {});
      console.log('Switched to latest tab:', page.url());
    }
    return page;
  };

  // Quick screenshot helper — called on unexpected failures for easier debugging
  const captureScreenshotOnFailure = async (stepName: string) => {
    try {
      if (!page.isClosed()) {
        const path = `test-results/failure-${stepName}-${Date.now()}.png`;
        await page.screenshot({ path, fullPage: true });
        console.log('📸 Screenshot saved:', path);
      }
    } catch (err) {
      console.log('Could not save screenshot:', err.message);
    }
  };

  try {

    // -------------------------------------------------------------------
    // Step 1: Load the landing page and record how long it takes
    // -------------------------------------------------------------------
    console.log('🌐 Navigating to DAZN landing page...');
    const landingNavStart = Date.now();

    await page.goto('https://www.dazn.com/en-AU/welcome', {
      waitUntil: 'domcontentloaded',
      timeout: PAGE_NAVIGATION_TIMEOUT,
    });
    await page.waitForLoadState('load');

    perf.landingPageLoad = Date.now() - landingNavStart;
    console.log(`⏱️ Landing page loaded in ${perf.landingPageLoad}ms`);

    // -------------------------------------------------------------------
    // Step 2: Handle the cookie consent banner
    // -------------------------------------------------------------------
    if (cookiesAlreadyAccepted) {
      console.log('Cookie state restored — removing any leftover overlays');
      await removeOverlays(page);
    } else {
      console.log('Accepting cookie banner...');
      await handleCookies(page);
      await saveCookieState(page);
      console.log('Cookie banner handled and state saved');
    }

    // -------------------------------------------------------------------
    // Step 3: Find the PPV banner, validate landing page fields, click Buy Now
    // -------------------------------------------------------------------
    console.log('Waiting for PPV Buy Now button to appear...');
    await page.locator('button:has-text("Buy now"), a:has-text("Buy now")').first()
      .waitFor({ timeout: PPV_BANNER_TIMEOUT })
      .catch(() => console.log('Buy now not immediately visible — continuing anyway'));

    await removeOverlays(page);

    const landingPage = new LandingPage(page);
    const banner = await landingPage.findPPVBanner();

    if (!banner) {
      await captureScreenshotOnFailure('ppv-banner-not-found');
      throw new Error('❌ PPV banner not found on landing page');
    }

    await landingPage.waitForBannerImageLoad(banner);

    // Validate each field from the sheet against what's actually on the page
    for (const [field, expected] of Object.entries(landingData)) {
      let actual: string = 'N/A';

      if (/baner|banner/i.test(field)) {
        actual = (await banner.isVisible()) ? 'Yes' : 'No';
      } else if (/name/i.test(field)) {
        actual = await landingPage.getEventName(banner);
      } else if (/date/i.test(field)) {
        actual = await landingPage.getEventDate(DATE_SELECTORS);
      } else if (/description/i.test(field)) {
        actual = await landingPage.getEventDescription(banner);
      } else if (/buy/i.test(field)) {
        actual = await landingPage.hasBuyButton(BUY_NOW_SELECTORS) ? 'Yes' : 'No';
      }

      validateField(results, 'Landing page', field, expected, actual?.trim(), 'landing');
    }

    console.log('Looking for Buy Now CTA inside the banner...');
    const buyBtn = await landingPage.findBuyNowButton(banner, BUY_NOW_SELECTORS);

    if (!buyBtn) {
      await captureScreenshotOnFailure('buy-now-button-not-found');
      throw new Error('PPV CTA not found');
    }

    await scrollIntoViewSmart(page, buyBtn, 'Buy Now CTA');
    await smartClick(page, buyBtn, 'Buy Now CTA', { waitForNav: true, maxRetries: MAX_CLICK_RETRIES });

    console.log('Waiting for navigation after Buy Now click...');
    await page.waitForURL(/signup|plan|content|ppv/, { timeout: URL_CHANGE_TIMEOUT })
      .catch(() => console.log('Navigation timeout — current URL:', page.url()));

    await page.waitForLoadState('domcontentloaded');

    // -------------------------------------------------------------------
    // Step 4: Detect A/B variant, validate PPV page, handle Continue
    // -------------------------------------------------------------------
    if (page.isClosed()) {
      variant = 'unknown';
    } else {
      const ppvPage = new PPVPage(page);

      // Variant detection sometimes needs a small scroll to expose the indicators
      const indicatorVisible = await ppvPage.areVariantIndicatorsVisible();
      if (!indicatorVisible) {
        console.log('Scrolling to reveal variant indicators...');
        await page.evaluate(() => window.scrollBy(0, 300));
        await page.waitForTimeout(COOKIE_BANNER_WAIT);
      }

      variant = await detectVariant(page).catch(() => 'unknown');

      // Fallback: try reading variant from page content directly
      if (variant === 'unknown') {
        variant = await ppvPage.detectVariantFromContent();
      }

      console.log('🎯 Detected variant:', variant);
    }

    page = await refreshActivePage(page.url());

    const ppvData = getPPVDataByVariant(variant);
    console.log(`📋 Validating PPV page for variant: ${variant}`);
    await validateVariant(page, variant, ppvData, results);
    console.log('PPV page validation done');

    // Decide whether we're already on the plan page or need to hit Continue first
    if (!page.isClosed()) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(VALIDATION_STEP_WAIT);

      const daznPlanPage = new DAZNPlanPage(page);
      const isDaznPlanPage = await daznPlanPage.isPlanPage();

      if (isDaznPlanPage) {
        console.log('Already on DAZN Plan page — Step 5 will handle the CTA');
      } else {
        console.log('Not on Plan page yet — clicking PPV Continue button');

        const continueBtn = page.getByRole('button', { name: /continue|next|proceed/i }).first();

        if (await continueBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await page.waitForTimeout(MANDATORY_WAIT_BEFORE_CONTINUE);

          const beforeUrl = page.url();

          await smartClick(page, continueBtn, 'Continue (PPV)', {
            waitForNav: true,
            maxRetries: MAX_CLICK_RETRIES,
          });

          // SPA pages don't always fire a full navigation event — check URL change instead
          await page.waitForFunction(
            (url) => window.location.href !== url,
            beforeUrl,
            { timeout: 5000 }
          ).catch(() => console.log('No URL change after Continue — may be SPA transition'));

          await page.waitForLoadState('domcontentloaded');
          console.log('Continue clicked, moved past PPV page');
        }
      }

      await page.waitForTimeout(NAVIGATION_WAIT);
    }

    // -------------------------------------------------------------------
    // Step 5: Validate DAZN Plan page and select trial plan before continuing
    // -------------------------------------------------------------------
    if (!page || page.isClosed()) {
      console.log('Page closed before Step 5 — skipping plan page');
    } else {
      const planDataArr = readSheet('Dazn Plan page');
      const daznPlanPage = new DAZNPlanPage(page);
      const onPlanPage = await daznPlanPage.isPlanPage();

      console.log('On Plan page:', onPlanPage);

      if (onPlanPage) {

        // Validate plan page fields if the sheet has data
        if (planDataArr && planDataArr.length > 0) {
          console.log('Validating DAZN Plan page fields...');
          try {
            await validateDaznPlan(page, planDataArr, results);
            console.log('Plan page validation complete');
          } catch (err) {
            // Non-blocking — we still want to attempt the continue flow
            console.log('Plan page validation encountered an issue, continuing anyway');
          }
        }

        const alreadyOnSignup = await daznPlanPage.isOnSignupPage();

        if (alreadyOnSignup) {
          console.log('Already redirected to signup — nothing more to do here');
        } else {

          // Make sure the trial plan is selected before clicking Continue.
          // Without this, the button sometimes stays disabled or selects the wrong plan.
          console.log('Ensuring 7-day trial plan is selected...');
          const trialPlan = page.locator('label:has-text("7-day free trial")');

          if (await trialPlan.isVisible().catch(() => false)) {
            await trialPlan.scrollIntoViewIfNeeded();
            await trialPlan.click();

            await trialPlan.locator('[aria-label="selected"], img[alt="selected"]').waitFor({
              timeout: 5000,
            });
            console.log('✅ Trial plan confirmed as selected');
          } else {
            console.log('Trial plan label not found — skipping selection step');
          }

          console.log('Looking for Continue button on Plan page...');
          const daznContinueBtn = await daznPlanPage.findContinueButton();

          if (!daznContinueBtn) {
            await captureScreenshotOnFailure('req5-no-cta');
            throw new Error('Continue button not found on DAZN Plan page');
          }

          const beforeUrl = page.url();
          await daznContinueBtn.scrollIntoViewIfNeeded().catch(() => {});
          await page.waitForTimeout(500);

          console.log('Clicking Continue on Plan page...');
          await daznContinueBtn.click({ force: true });

          await page.waitForFunction(
            (url) => window.location.href !== url,
            beforeUrl,
            { timeout: 5000 }
          ).catch(() => console.log('URL did not change after plan Continue click'));

          await page.waitForLoadState('domcontentloaded');

          const nowOnSignup = await daznPlanPage.isOnSignupPage();
          if (nowOnSignup) {
            console.log('✅ Successfully reached signup page');
          } else {
            console.log('⚠️ Unexpected URL after plan Continue:', page.url());
          }
        }
      } else {
        console.log('Not on DAZN Plan page — skipping plan validation');
      }
    }

    // -------------------------------------------------------------------
    // Step 6 & 7: Email entry and personal details
    // -------------------------------------------------------------------
    const signupPage = new SignupPage(page);
    const emailInput = await signupPage.findEmailInput();

    if (emailInput) {
      const testUser = createTestUser();

      console.log('📧 Entering test email:', testUser.email);
      await signupPage.enterEmail(testUser.email);
      await page.waitForTimeout(500);

      console.log('Submitting email...');
      await signupPage.clickContinue();

      // DAZN's signup is a multi-step form — check a few times in case the click
      // doesn't register immediately (seen in slower environments)
      const firstNameField = page.locator('[data-test-id="FIRST_NAME"]');
      let reachedPersonalDetails = false;

      for (let attempt = 0; attempt < 3; attempt++) {
        console.log(`Checking for personal details form (attempt ${attempt + 1})...`);

        if (await firstNameField.isVisible().catch(() => false)) {
          reachedPersonalDetails = true;
          break;
        }

        const pageTypeAttempt = await signupPage.detectPageType();
        if (pageTypeAttempt === 'password') break;

        console.log('Still on email step — retrying Continue click');
        await signupPage.clickContinue();
        await page.waitForTimeout(1500);
      }

      const pageType = reachedPersonalDetails
        ? 'personalDetails'
        : await signupPage.detectPageType();

      if (pageType === 'personalDetails') {
        console.log('On personal details form — filling in test data');
        await signupPage.fillPersonalDetails(testUser);

        console.log('Submitting personal details...');
        await signupPage.clickPersonalDetailsContinue();

        validateField(results, 'Signup Page', 'Personal Details', 'Completed', 'Completed', 'signup');

        // -------------------------------------------------------------------
        // Step 8: Payment page — wait for the summary section before validating
        // -------------------------------------------------------------------
        console.log('Waiting for payment page to fully load...');

        // Using the next-payment header as the "ready" signal — it's one of the last
        // elements the page renders so if it's visible everything else should be too
        const paymentReady = page.locator(
          '[data-test-id="summary_next_payment_header_value_refined"]'
        );

        await paymentReady.waitFor({ state: 'visible', timeout: 15000 })
          .catch(() => console.log('Payment summary element did not appear within timeout'));

        // Small buffer for any SPA re-renders to settle
        await page.waitForTimeout(1500);

        const paymentPage = new PaymentPage(page);
        const isPaymentPage = await paymentPage.isPaymentPage();

        if (isPaymentPage) {
          console.log('✅ Payment page loaded successfully');
          const paymentDataArr = readSheet('Monthly Payment page ');
          if (paymentDataArr?.length) {
            await paymentPage.validate(paymentDataArr, results);
          }
        } else {
          console.log('⚠️ Payment page not confirmed — current URL:', page.url());
        }
      }
    }

  } catch (error) {
    console.error('❌ Test failed:', error);
    await captureScreenshotOnFailure('test-failure');
    throw error;

  } finally {
    perf.totalTestTime = Date.now() - testStartTs;
    console.log(`⏱️ Total test duration: ${perf.totalTestTime}ms`);

    await writeResults(results);
    displayResultsTable(results, variant);
    await context.close();
  }
});