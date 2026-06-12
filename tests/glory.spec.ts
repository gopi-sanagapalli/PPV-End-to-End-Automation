import { test, expect } from '@playwright/test';
import { GloryPage } from '../pages/GloryPage';
import { StandalonePPVPage } from '../pages/StandalonePPVPage';
import { SignupPage } from '../pages/SignupPage';
import { PaymentPage } from '../pages/PaymentPage';
import { PaymentFillPage } from '../pages/PaymentFillPage';
import { createTestUser } from '../utils/testDataBuilder';
import { sleep, handleCookies, stabilisePage, setupPage } from '../utils/helpers';
import { detectPageType } from '../utils/flowHelpers';
import { clickAndWaitForNav, safeScrollToElement } from '../utils/testHelpers';

/**
 * Test: Glory Kickboxing page — Navigate, validate, click GLORY COLLISION 9 PPV,
 * then flow through Buy Now → Standalone PPV page → Signup → Payment
 *
 * Steps:
 * 1. Launch the glory page URL https://www.dazn.com/glory
 * 2. Wait for cookies and accept them
 * 3. Validate we are on the Glory Kickboxing page
 * 4. Find and click "GLORY COLLISION 9" on the "Coming up" rail
 * 5. Click "Buy Now" in the modal popup
 * 6. Flow through Standalone PPV page → Signup → Payment
 */
test('Glory page: full flow from Glory page to Payment', async ({ browser }) => {
  test.setTimeout(300_000);

  const context = await browser.newContext({
    viewport:    null,
    colorScheme: 'dark',
    locale:      'en-GB',
    timezoneId:  'Europe/London',
  });
  await context.clearCookies();
  const page = await context.newPage();
  const gloryPage = new GloryPage(page);

  const results: Array<{ page: string; field: string; expected: string; actual: string; status: string }> = [];

  try {
    // ═══════════════════════════════════════════════════════════════
    // STEP 1: Launch glory page URL & accept cookies
    // ═══════════════════════════════════════════════════════════════
    console.log('\n══════════════════════════════════════════════');
    console.log('PAGE 1: Glory Page — Navigation & Validation');
    console.log('══════════════════════════════════════════════');

    await gloryPage.navigate('https://www.dazn.com/glory');

    // ── Validate Glory Kickboxing page ──
    const isValid = await gloryPage.validateGloryPage();
    expect(isValid, 'Should be on Glory Kickboxing page').toBe(true);
    results.push({
      page: 'Glory Kickboxing',
      field: 'Glory Page Validation',
      expected: 'true',
      actual: String(isValid),
      status: 'PASS',
    });

    // ── Click GLORY COLLISION 9 tile in "Coming up" rail ──
    await gloryPage.clickGloryCollision9();
    results.push({
      page: 'Glory Kickboxing',
      field: 'GLORY COLLISION 9 Tile Clicked',
      expected: 'Tile clicked',
      actual: 'Tile clicked',
      status: 'PASS',
    });

    // ── Click Buy Now in modal popup ──
    await gloryPage.clickBuyNowInModal();
    results.push({
      page: 'Glory Kickboxing',
      field: 'Buy Now Clicked in Modal',
      expected: 'Navigated onwards',
      actual: `URL: ${page.url()}`,
      status: 'PASS',
    });

    // ═══════════════════════════════════════════════════════════════
    // STEP 2+: detectPageType flow loop
    // ═══════════════════════════════════════════════════════════════
    console.log('\n══════════════════════════════════════════════');
    console.log('PAGE 2+: Flow Loop — detectPageType routing');
    console.log('══════════════════════════════════════════════');

    let ppvValidated = false;
    let emailProcessedCount = 0;
    let reachedEndPage = false;
    const pagesConfig: Record<string, { detection: string }> = {};

    for (let step = 0; step < 20; step++) {
      if (page.isClosed()) throw new Error('❌ Page closed unexpectedly');

      const pageType = await detectPageType(page, pagesConfig, 0);
      await handleCookies(page, step === 0 ? 5000 : 500);
      await stabilisePage(page);

      const currentUrl = page.url().substring(0, 100);
      console.log(`\nstep ${step + 1} → pageType: ${pageType} | url: ${currentUrl}`);

      // ── Payment page ──
      if (pageType === 'payment') {
        console.log('\n══════════════════════════════════════════════');
        console.log('PAGE: Payment Page');
        console.log('══════════════════════════════════════════════');
        reachedEndPage = true;

        const payment = new PaymentPage(page);
        if (await payment.isPaymentPage()) {
          console.log('✅ Payment page detected');
          results.push({
            page: 'Payment',
            field: 'Payment Page Reached',
            expected: 'Yes',
            actual: 'Yes',
            status: 'PASS',
          });
        }

        // Fill payment details on staging
        const env = (process.env.DAZN_ENV || 'stag').toLowerCase();
        if (env === 'stag') {
          console.log('💳 DAZN_ENV is stag — filling credit card payment details...');
          const paymentFill = new PaymentFillPage(page);
          try {
            await paymentFill.fillPaymentAndSubmit();
            await paymentFill.verifyPaymentSuccess();
            await paymentFill.clickSuccessContinue();
            console.log('✅ Payment details submitted successfully on staging!');
            results.push({
              page: 'Payment Success',
              field: 'Payment Completed',
              expected: 'Success page reached',
              actual: 'Success page reached',
              status: 'PASS',
            });
          } catch (paymentErr: any) {
            console.error(`❌ Payment filling failed: ${paymentErr.message}`);
            try {
              await page.screenshot({ path: `test-results/glory_payment_fill_error_${Date.now()}.png`, fullPage: true });
            } catch { }
            results.push({
              page: 'Payment Success',
              field: 'Payment Completed',
              expected: 'Success page reached',
              actual: `Failed: ${paymentErr.message}`,
              status: 'FAIL',
            });
            throw paymentErr;
          }
        } else {
          console.log(`ℹ️ DAZN_ENV is "${env}" — skipping card details filling.`);
        }
        break;
      }

      // ── OTP Verification page ──
      if (pageType === 'otp') {
        console.log('🔑 Reached OTP Verification page');
        reachedEndPage = true;
        results.push({
          page: 'OTP Verification',
          field: 'OTP Page Reached',
          expected: 'Yes',
          actual: 'Yes',
          status: 'PASS',
        });
        break;
      }

      // ── Phone Number page ──
      if (pageType === 'phone') {
        console.log('📱 Reached Phone Number page');
        reachedEndPage = true;
        results.push({
          page: 'Phone Number',
          field: 'Phone Page Reached',
          expected: 'Yes',
          actual: 'Yes',
          status: 'PASS',
        });
        break;
      }

      // ── Signup / Email / Personal Details page ──
      if (pageType === 'email') {
        console.log('\n══════════════════════════════════════════════');
        console.log('PAGE: Signup — Email & Personal Details');
        console.log('══════════════════════════════════════════════');
        emailProcessedCount++;

        // Break out if stuck in email loop
        if (emailProcessedCount > 4) {
          console.log('⚠️ Email loop detected — breaking');
          const anyBtn = page.locator('button[type="submit"], button:has-text("Continue")').first();
          if (await anyBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
            await anyBtn.click({ force: true }).catch(() => { });
            await page.waitForTimeout(2000);
          }
          if (page.url().includes('paymentDetails') || page.url().includes('payment')) {
            reachedEndPage = true;
          }
          break;
        }

        const signup = new SignupPage(page);
        const user = createTestUser();
        const onPersonalDetails = page.url().includes('page=personalDetails');

        // If already on personal details and retrying, just click Continue
        if (onPersonalDetails && emailProcessedCount > 1) {
          console.log('ℹ️ Already on personal details (retry) — clicking Continue');
          const continueBtn = page.locator('button:has-text("Continue"), button[type="submit"]').first();
          if (await continueBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
            await continueBtn.click({ force: true }).catch(() => { });
            await page.waitForURL(
              (url: URL) => url.toString().includes('payment') || url.toString().includes('paymentDetails'),
              { timeout: 15000 }
            ).catch(() => {});
            if (page.url().includes('paymentDetails') || page.url().includes('payment')) {
              reachedEndPage = true;
              break;
            }
          }
          continue;
        }

        // Enter email if on email step
        const emailInput = onPersonalDetails ? null : await signup.findEmailInput();
        if (emailInput) {
          await signup.enterEmail(user.email);
          await signup.clickContinue();
          console.log(`✅ Email entered: ${user.email}`);
          await page.waitForURL(
            (url: URL) => url.toString().includes('personalDetails') || url.toString().includes('payment'),
            { timeout: 10000 }
          ).catch(() => {});
        }

        await page.waitForLoadState('domcontentloaded').catch(() => { });
        await page.waitForTimeout(500);

        // Fill personal details
        const firstNameEl = page.locator('[data-test-id="FIRST_NAME"], input[name="firstName"]').first();
        if (await firstNameEl.waitFor({ state: 'visible', timeout: 6000 }).then(() => true).catch(() => false)) {
          try {
            await signup.fillPersonalDetails(user);
            await signup.clickPersonalDetailsContinue();
            console.log('✅ Personal details filled and submitted');
            await page.waitForURL(
              (url: URL) => url.toString().includes('payment') || url.toString().includes('paymentDetails'),
              { timeout: 15000 }
            ).catch(() => {});
          } catch (fillErr: any) {
            const currentUrl = page.url().toLowerCase();
            if (currentUrl.includes('payment') || currentUrl.includes('paymentdetails')) {
              console.log(`ℹ️ Page transitioned to payment despite form fill error: ${fillErr.message}`);
            } else {
              throw fillErr;
            }
          }
        } else {
          console.log('⚠️ Personal details not detected — skipping');
        }

        await page.waitForLoadState('domcontentloaded').catch(() => { });
        await sleep(2000);

        if (page.url().includes('paymentDetails')) {
          console.log('💳 Navigated to payment page after personal details');
        }
        continue;
      }

      // ── Standalone PPV page (Glory PPV has checkbox-based plan selection) ──
      if (pageType === 'standalone-ppv') {
        console.log('\n══════════════════════════════════════════════');
        console.log('PAGE: Standalone PPV Page');
        console.log('══════════════════════════════════════════════');

        const standalonePPVPage = new StandalonePPVPage(page);

        if (!ppvValidated) {
          // Ensure PPV checkbox is checked
          const ppvName = 'GLORY COLLISION 9';
          if (!(await standalonePPVPage.isPPVCheckboxChecked(ppvName))) {
            console.log('📌 Toggling PPV checkbox to ensure it is checked...');
            await standalonePPVPage.togglePPVCheckbox(ppvName);
          }
          ppvValidated = true;
        }

        // Select Flex plan (first radio) and click Continue
        await standalonePPVPage.selectPlan('flex');
        await standalonePPVPage.clickContinue();

        results.push({
          page: 'Standalone PPV',
          field: 'Standalone PPV - Continue Clicked',
          expected: 'Navigated to next page',
          actual: 'Continue clicked',
          status: 'PASS',
        });

        await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => { });
        continue;
      }

      // ── Unknown page — wait and retry ──
      console.log(`⚠️ Unknown page — waiting... (step ${step + 1}/20) | URL: ${page.url()}`);
      await sleep(1000);
    }

    // ── Post-loop payment detection ──
    if (!reachedEndPage) {
      const finalUrl = page.url();
      if (finalUrl.includes('paymentDetails') || finalUrl.includes('payment')) {
        console.log('💳 Payment page detected after loop exit');
        reachedEndPage = true;
        results.push({
          page: 'Payment',
          field: 'Payment Page Reached',
          expected: 'Yes',
          actual: 'Yes',
          status: 'PASS',
        });
      }
    }

    // ── Final summary ──
    console.log(`\n✅ Test completed. Final URL: ${page.url()}`);

    // Take final screenshot
    await page.screenshot({ path: 'test-results/glory-full-flow.png' }).catch(() => {});

    // Print results table
    console.log('\n══════════════════════════════════════════════');
    console.log('RESULTS SUMMARY');
    console.log('══════════════════════════════════════════════');
    const passed = results.filter(r => r.status === 'PASS').length;
    const failed = results.filter(r => r.status === 'FAIL').length;
    console.log(`Total: ${results.length} | ✅ PASS: ${passed} | ❌ FAIL: ${failed}`);

    for (const r of results) {
      console.log(`  ${r.status === 'PASS' ? '✅' : '❌'} [${r.page}] ${r.field}: ${r.status}`);
    }

    // Verify we reached the payment page
    expect(reachedEndPage, 'Should have reached the payment page').toBe(true);

  } finally {
    await sleep(2000);
    await context.close();
  }
});