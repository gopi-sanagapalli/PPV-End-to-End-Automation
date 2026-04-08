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

test('Landing → PPV Tile (Don\'t Miss) → Plan → Signup → Payment flow', async ({ browser }) => {
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
    
    // Find PPV Tile in "Don't Miss live on DAZN" section for Wardley vs Dubois
    console.log('🔍 Looking for Wardley vs Dubois PPV tile in Don\'t Miss section...');
    
    // Locate the Don't Miss section first
    const dontMissSection = page.locator('section:has(h1:has-text("Don\'t Miss live on DAZN"))');
    await dontMissSection.waitFor({ state: 'visible', timeout: 15000 });
    
    // Exact PPV tile locator as provided
    const ppvTile = dontMissSection.getByRole('article')
      .filter({ hasText: 'May 10Wardley vs. DuboisBuy' })
      .locator('[data-test-id="BACKGROUND_IMAGE"]');
    
    await ppvTile.waitFor({ state: 'visible', timeout: 15000 });
    
    if (!ppvTile) throw new Error('Wardley vs Dubois PPV tile not found in Don\'t Miss section');
    console.log('✅ Wardley vs Dubois PPV tile found');

    const landingDataArr = readSheet('Landing page');
    const landingData: Record<string, string> = {};
    landingDataArr.forEach((r: any) => (landingData[r.Field] = r.Value));

    for (const [field, expected] of Object.entries(landingData)) {
      let actual = 'N/A';

      if (/banner|tile/i.test(field)) {
        actual = (await ppvTile.isVisible()) ? 'Yes' : 'No';
      } else if (/name/i.test(field)) {
        // Get event name from tile - exact selector
        const eventNameEl = dontMissSection.getByRole('paragraph').filter({ hasText: 'Wardley vs. Dubois' });
        actual = (await eventNameEl.innerText().catch(() => 'N/A')).trim();
      } else if (/date/i.test(field)) {
        // Get event date from tile - exact selector
        const dateEl = dontMissSection.getByText('May 10');
        actual = (await dateEl.innerText().catch(() => 'N/A')).trim();
      } else if (/description/i.test(field)) {
        actual = await landingPage.getEventDescription(ppvTile);
      } else if (/buy/i.test(field)) {
        // Check for Buy now button inside the tile
        const buyBtn = ppvTile.locator('button:has-text("Buy now"), a:has-text("Buy now")').first();
        actual = (await buyBtn.isVisible().catch(() => false)) ? 'Yes' : 'No';
      }

      validateField(results, 'Landing page', field, expected, actual?.trim(), 'landing');
    }

    // Find and click Buy Now button in the PPV tile
    const buyBtn = dontMissSection.getByRole('article')
      .filter({ hasText: 'May 10Wardley vs. DuboisBuy' })
      .getByRole('button', { name: 'Buy now' });
    
    if (!await buyBtn.isVisible().catch(() => false)) throw new Error('Buy Now CTA not found on PPV tile');

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