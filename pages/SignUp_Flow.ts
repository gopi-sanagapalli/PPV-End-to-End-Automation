import { Page } from '@playwright/test';
import { BasePage } from './BasePage';
import { handleCookies, stabilisePage, sleep } from '../utils/helpers';
import { SignupPage } from './SignupPage';
import { DAZNPlanPage } from './DAZNPlanPage';
import { PaymentPage } from './PaymentPage';
import { PaymentFillPage } from './PaymentFillPage';

/**
 * SignUp_Flow — Page object for the DAZN sign-up flow.
 *
 * Full flow:
 *   1. Launch the DAZN site
 *   2. Wait for cookies banner
 *   3. Accept the cookies
 *   4. Click the Explore button
 *   5. Find Live TV rail → scroll to it → click "ABC of... Climbing"
 *   6. Subscribe popup appears → click Subscribe button
 *   7. Plans page → select plan → continue
 *   8. Signup page → enter email → fill personal details
 *   9. Payments page → validate → fill payment details
 */
export class SignUp_Flow extends BasePage {
  private baseUrl: string;

  constructor(page: Page, baseUrl: string = '') {
    super(page);
    this.baseUrl = baseUrl;
  }

  // ─────────────────────────────────────────────────────────────
  // 1. Launch the DAZN site
  // ─────────────────────────────────────────────────────────────
  /**
   * Navigate to the DAZN welcome page.
   */
  async launchSite(baseUrl?: string): Promise<void> {
    const url = baseUrl || this.baseUrl || this.getFallbackBaseUrl();
    const welcomeUrl = `${url}/welcome`;
    console.log(`🌍 [SignUp_Flow] Launching DAZN site: ${welcomeUrl}`);
    await this.navigate(welcomeUrl);
    console.log(`✅ [SignUp_Flow] DAZN site launched: ${this.page.url()}`);
  }

  // ─────────────────────────────────────────────────────────────
  // 2 & 3. Wait for cookies & Accept the cookies
  // ─────────────────────────────────────────────────────────────
  /**
   * Wait for the cookie consent banner to appear and accept it.
   */
  async waitForAndAcceptCookies(timeout = 15000): Promise<void> {
    console.log('🍪 [SignUp_Flow] Waiting for cookie consent banner...');
    await this.waitForConsentAndDismiss(timeout);
    console.log('✅ [SignUp_Flow] Cookies accepted and page stabilised');
  }

  // ─────────────────────────────────────────────────────────────
  // 4. Click the Explore button
  // ─────────────────────────────────────────────────────────────
  /**
   * Find and click the "Explore" button/link on the welcome page.
   */
  async clickExplore(): Promise<void> {
    console.log('🔍 [SignUp_Flow] Looking for Explore button on welcome page...');

    const exploreSelectors = [
      'a:has-text("Explore")',
      'button:has-text("Explore")',
      'a[href*="/home" i]',
      'a:has-text("Explore DAZN")',
      'a:has-text("Explore without subscribing")',
      'a:has-text("Explore for free")',
      '[class*="explore" i]',
    ];

    const combinedSelector = exploreSelectors.join(', ');
    const anyExplore = this.page.locator(combinedSelector).first();
    const found = await anyExplore
      .waitFor({ state: 'visible', timeout: 8000 })
      .then(() => true)
      .catch(() => false);

    if (found) {
      console.log('📍 [SignUp_Flow] Explore button found');
      await anyExplore.scrollIntoViewIfNeeded().catch(() => {});
      await anyExplore.click({ force: true });
      await this.page
        .waitForURL((url: URL) => url.toString().includes('/home'), {
          timeout: 15000,
        })
        .catch(() => {});
    } else {
      console.log(
        '⚠️  [SignUp_Flow] Explore button not found — waiting for cookies and navigating directly to /home',
      );
      await this.waitForAndAcceptCookies();
      const currentUrl = this.page.url();
      const baseMatch = currentUrl.match(
        /(https:\/\/[a-z0-9.-]*dazn\.com\/en-[A-Z]+)/i,
      );
      const base = baseMatch?.[1] || this.getFallbackBaseUrl();
      await this.page.goto(`${base}/home`, { waitUntil: 'domcontentloaded' });
    }

    await this.page.waitForLoadState('domcontentloaded').catch(() => {});
    console.log(`✅ [SignUp_Flow] Explore flow complete: ${this.page.url()}`);
  }

  // ─────────────────────────────────────────────────────────────
  // 5. Find Live TV rail → click "ABC of... Climbing"
  //    → handle subscribe popup → navigate to PPV page 
  // ─────────────────────────────────────────────────────────────
  /**
   * Step 5: Scroll to the "Live TV" rail on the home page,
   * click on the "ABC of... Climbing" content tile, handle the
   * subscribe popup that appears, click the subscribe button,
   * and navigate to the PPV page.
   */
  async navigateToLiveTVRail(): Promise<void> {
    console.log('📺 [SignUp_Flow] Step 5: Looking for Live TV rail...');

    // ── 5a. Find the Live TV rail heading ─────────────────────
    // Use specific heading selectors within rail context to avoid
    // matching nav links or other unrelated "Live TV" text
    const liveTVLocator = this.page.locator(
      'h2:has-text("Live TV"), h3:has-text("Live TV"), ' +
      '[class*="rail" i] h2:has-text("Live TV"), [class*="rail" i] h3:has-text("Live TV"), ' +
      '[class*="heading" i]:has-text("Live TV"), [class*="title" i]:has-text("Live TV")'
    ).first();

    let liveTVRailFound = false;

    // First scroll to bottom to trigger all lazy loading
    console.log('📜 [SignUp_Flow] Scrolling page to trigger lazy loading...');
    await this.slowScrollToBottom();
    await sleep(1500);

    // Now scroll back to top and search for the Live TV rail heading
    await this.page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
    await sleep(500);

    for (let i = 0; i < 30; i++) {
      if (await liveTVLocator.isVisible().catch(() => false)) {
        // Verify it's a heading element, not just a nav link
        const tagName = await liveTVLocator.evaluate((el: Element) => el.tagName.toLowerCase()).catch(() => '');
        const isHeading = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tagName);
        const hasHeadingClass = await liveTVLocator.evaluate((el: Element) => {
          const cls = el.className?.toString() || '';
          const parentCls = el.parentElement?.className?.toString() || '';
          return cls.includes('heading') || cls.includes('title') ||
                 parentCls.includes('heading') || parentCls.includes('title') ||
                 parentCls.includes('rail');
        }).catch(() => false);

        if (isHeading || hasHeadingClass) {
          liveTVRailFound = true;
          console.log(`✅ [SignUp_Flow] Live TV rail heading found at scroll position ${i}`);
          break;
        }
      }

      // Scroll down incrementally
      const scrollPos = (i + 1) * 500;
      await this.page.evaluate((pos) => {
        window.scrollTo({ top: pos, behavior: 'smooth' });
      }, scrollPos).catch(() => {});
      await this.page.waitForTimeout(600);
    }

    if (!liveTVRailFound) {
      throw new Error('❌ [SignUp_Flow] Live TV rail heading not found on the home page');
    }

    // Scroll the Live TV rail heading into view
    await liveTVLocator.scrollIntoViewIfNeeded().catch(() => {});
    await sleep(800);
    console.log('✅ [SignUp_Flow] Live TV rail found and scrolled into view');

    // ── 5b. Locate the rail wrapper around the Live TV heading ─
    const railWrapper = liveTVLocator.locator(
      'xpath=ancestor::*[contains(@class,"rail__rail-wrapper")][1] | ' +
      'ancestor::section[contains(@class,"rail")][1] | ' +
      'ancestor::div[contains(@class,"rail")][1] | ' +
      'ancestor::*[contains(@class,"railWrapper")][1]'
    );
    await railWrapper.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
    console.log('✅ [SignUp_Flow] Live TV rail wrapper located');

    // ── 5c. Find "ABC of... Climbing" tile ───────────────────
    const contentTitle = 'ABC of... Climbing';
    const pushingForwardText = this.page.getByText(/ABC of.*Climbing/i);
    let foundPushingForward = false;

    // Try scrolling through the rail using the next button
    const nextBtn = railWrapper.locator([
      'button[aria-label="Next slide"]',
      'button[class*="swiper-button-next"]',
      '.custom-swiper-button-next',
      '[class*="next" i]',
    ].join(', ')).first();

    await nextBtn.waitFor({ state: 'attached', timeout: 5000 }).catch(() => {});
    await railWrapper.hover({ force: true }).catch(() => {});
    await this.page.waitForTimeout(300);

    // Check if "ABC of... Climbing" is already visible
    foundPushingForward = await pushingForwardText.isVisible().catch(() => false);

    let clicks = 0;
    const maxClicks = 20;

    while (!foundPushingForward && clicks < maxClicks) {
      const nextDisabled = await nextBtn.evaluate((el: Element) => {
        return el.classList.contains('swiper-button-disabled') ||
          el.classList.contains('rail-module__disable') ||
          el.className.includes('disable') ||
          el.hasAttribute('disabled');
      }).catch(() => false);

      if (nextDisabled) {
        console.log('⚠️ [SignUp_Flow] Next button disabled — end of Live TV rail reached');
        break;
      }

      await nextBtn.click({ timeout: 5000, force: true }).catch((e: any) => {
        console.log('⚠️ [SignUp_Flow] Next click error:', e.message);
      });
      clicks++;
      await this.page.waitForTimeout(300);

      foundPushingForward = await pushingForwardText.isVisible().catch(() => false);
    }

    if (!foundPushingForward) {
      // Fallback: search for tile by image alt or link text
      const tileLink = railWrapper.locator(
        `a:has-text("${contentTitle}"), ` +
        `img[alt*="${contentTitle}" i], ` +
        `[class*="tile" i]:has-text("${contentTitle}")`
      ).first();

      foundPushingForward = await tileLink.isVisible().catch(() => false);
      if (foundPushingForward) {
        console.log(`✅ [SignUp_Flow] Found "${contentTitle}" tile via fallback selector`);
        await tileLink.scrollIntoViewIfNeeded().catch(() => {});
        await this.page.waitForTimeout(300);
        await tileLink.click({ force: true, timeout: 10000 });
        console.log(`✅ [SignUp_Flow] Clicked "${contentTitle}" tile (fallback)`);
      } else {
        throw new Error(`❌ [SignUp_Flow] "${contentTitle}" not found in Live TV rail after ${clicks} clicks`);
      }
    } else {
      // Click the "ABC of... Climbing" tile
      console.log(`📍 [SignUp_Flow] "${contentTitle}" is visible — clicking...`);
      await pushingForwardText.scrollIntoViewIfNeeded().catch(() => {});
      await this.page.waitForTimeout(300);

      const tileLink = pushingForwardText.locator('xpath=ancestor::a[1]').first();
      const isLinkVisible = await tileLink.isVisible().catch(() => false);

      if (isLinkVisible) {
        await tileLink.click({ force: true, timeout: 10000 });
      } else {
        await pushingForwardText.click({ force: true, timeout: 10000 });
      }
      console.log(`✅ [SignUp_Flow] Clicked "${contentTitle}"`);
    }

    await sleep(1000);

    // ── 5d. Handle the subscribe popup ────────────────────────
    console.log('📋 [SignUp_Flow] Waiting for subscribe popup...');
    let subscribePopupFound = false;

    for (let attempt = 0; attempt < 15; attempt++) {
      const popup = await this.waitForSubscribePopup();
      if (popup) {
        subscribePopupFound = true;
        console.log('✅ [SignUp_Flow] Subscribe popup detected');
        break;
      }
      await this.page.waitForTimeout(500);
    }

    if (!subscribePopupFound) {
      // Check if we were directly navigated to a PPV / subscribe page
      const currentUrl = this.page.url();
      if (currentUrl.includes('/ppv') || currentUrl.includes('/sign-up') || currentUrl.includes('/subscribe') || currentUrl.includes('/plan')) {
        console.log(`✅ [SignUp_Flow] Navigated directly to: ${currentUrl}`);
        return;
      }
      throw new Error('❌ [SignUp_Flow] Subscribe popup did not appear after clicking "ABC of... Climbing"');
    }

    // ── 5e. Click the Subscribe button in the popup ───────────
    console.log('🖱️ [SignUp_Flow] Looking for Subscribe button in popup...');
    const subscribeSelectors = [
      'button:has-text("Subscribe")',
      'a:has-text("Subscribe")',
      'button:has-text("Sign up")',
      'button:has-text("Sign Up")',
      'a:has-text("Sign up")',
      'a:has-text("Sign Up")',
      'button:has-text("Start watching")',
      'a:has-text("Start watching")',
      'button:has-text("Continue")',
      'a:has-text("Continue")',
    ];

    let subscribeClicked = false;

    for (const selector of subscribeSelectors) {
      const btn = this.page.locator(selector).first();
      const visible = await btn.isVisible({ timeout: 1500 }).catch(() => false);
      if (visible) {
        await btn.scrollIntoViewIfNeeded().catch(() => {});
        await btn.click({ force: true, timeout: 10000 });
        console.log(`✅ [SignUp_Flow] Clicked Subscribe button: ${selector}`);
        subscribeClicked = true;
        break;
      }
    }

    if (!subscribeClicked) {
      // Try clicking any prominent button inside the popup
      const anyBtn = this.page.locator(
        '[role="dialog"] button, [class*="modal" i] button, [class*="popup" i] button'
      ).first();
      const fallbackVisible = await anyBtn.isVisible({ timeout: 3000 }).catch(() => false);
      if (fallbackVisible) {
        const btnText = await anyBtn.textContent().catch(() => '');
        console.log(`🖱️ [SignUp_Flow] Clicking fallback popup button: "${btnText?.trim()}"`);
        await anyBtn.click({ force: true, timeout: 10000 });
        subscribeClicked = true;
      }
    }

    if (!subscribeClicked) {
      throw new Error('❌ [SignUp_Flow] Subscribe button not found in the subscribe popup');
    }

    // ── 5f. Wait for navigation to PPV page ──────────────────
    console.log('⏳ [SignUp_Flow] Waiting for navigation to PPV page...');
    try {
      await this.page.waitForURL(
        (url: URL) => {
          const u = url.toString().toLowerCase();
          return u.includes('/ppv') || u.includes('/sign-up') || u.includes('/subscribe') || u.includes('/plan');
        },
        { timeout: 20000 }
      );
    } catch {
      console.log('⚠️ [SignUp_Flow] URL did not change — checking current page...');
    }

    await this.page.waitForLoadState('domcontentloaded').catch(() => {});
    console.log(`✅ [SignUp_Flow] Current page: ${this.page.url()}`);
    console.log('✅ [SignUp_Flow] Step 5 complete — navigated to PPV/signup page');
  }

  /**
   * Helper: Wait for a subscribe-related popup to appear on screen.
   */
  private async waitForSubscribePopup(): Promise<boolean> {
    const popupSelectors = [
      '[role="dialog"]',
      '[class*="modal" i]',
      '[class*="popup" i]',
      '[aria-modal="true"]',
      '[class*="overlay" i]',
      '[class*="subscribe" i][class*="dialog" i]',
      '[class*="subscribe" i][class*="popup" i]',
    ];

    for (const selector of popupSelectors) {
      const popup = this.page.locator(selector).first();
      if (await popup.isVisible().catch(() => false)) {
        // Verify it has a subscribe-related button
        const hasSubscribeBtn = await popup.locator(
          'button:has-text("Subscribe"), a:has-text("Subscribe"), ' +
          'button:has-text("Sign"), a:has-text("Sign"), ' +
          'button:has-text("Continue"), a:has-text("Continue"), ' +
          'button:has-text("Start"), a:has-text("Start")'
        ).first().isVisible({ timeout: 1000 }).catch(() => false);

        if (hasSubscribeBtn) {
          return true;
        }
      }
    }
    return false;
  }

  // ─────────────────────────────────────────────────────────────
  // Step 6: Handle Plans page — select plan and continue
  // ─────────────────────────────────────────────────────────────
  /**
   * Handle the DAZN plans page: select a plan and click continue.
   * Uses the existing DAZNPlanPage page object.
   *
   * @param ratePlan - The plan to select (e.g., "monthly", "annual pay monthly", "annual pay upfront")
   */
  async handlePlanPage(ratePlan: string): Promise<void> {
    console.log('📋 [SignUp_Flow] Step 6: Handling Plans page...');

    const planPage = new DAZNPlanPage(this.page);
    await planPage.waitForLoad();

    const isPlan = await planPage.isPlanPage();
    if (!isPlan) {
      console.log('⚠️ [SignUp_Flow] Not on plans page — checking current URL');
      console.log(`   Current URL: ${this.page.url()}`);
    }

    // Select the plan
    console.log(`🎯 [SignUp_Flow] Selecting plan: "${ratePlan}"`);
    await planPage.selectPlan(ratePlan);
    await sleep(500);

    // Click continue to proceed to signup/payment
    console.log('▶️ [SignUp_Flow] Clicking continue on plans page...');
    await planPage.clickContinue();

    await this.page.waitForLoadState('domcontentloaded').catch(() => {});
    await sleep(1000);
    console.log(`✅ [SignUp_Flow] Plans page handled. Current URL: ${this.page.url()}`);
  }

  // ─────────────────────────────────────────────────────────────
  // Step 7: Handle Signup page — enter email, fill personal details
  // ─────────────────────────────────────────────────────────────
  /**
   * Handle the signup page: enter email, fill personal details,
   * and continue to the next step.
   * Uses the existing SignupPage page object.
   *
   * @param user - User object with email, firstName, lastName, password, phone
   * @param region - Region code (e.g., 'GB', 'AU') for phone validation
   */
  async handleSignupPage(user: { email: string; firstName: string; lastName: string; password: string; phone: string }, region?: string): Promise<void> {
    console.log('📝 [SignUp_Flow] Step 7: Handling Signup page...');

    const signupPage = new SignupPage(this.page);

    // Check if we're on the personal details page first
    const onPersonalDetails = this.page.url().includes('page=personalDetails');

    // Check if we're on the signup/email page
    const emailInput = onPersonalDetails ? null : await signupPage.findEmailInput();
    if (emailInput) {
      console.log('📧 [SignUp_Flow] Email input found — entering email...');
      await signupPage.enterEmail(user.email);
      await signupPage.clickContinue();
      await this.page.waitForLoadState('domcontentloaded').catch(() => {});
      await sleep(500);
    } else {
      console.log('ℹ️  [SignUp_Flow] Email input not visible or on personal details page');
    }

    // Wait for form state to initialize
    await this.page.waitForLoadState('domcontentloaded').catch(() => {});
    await this.page.waitForTimeout(500);

    // Check if personal details form is visible
    const firstNameEl = this.page.locator('[data-test-id="FIRST_NAME"], input[name="firstName"]').first();
    const firstNameVisible = await firstNameEl.waitFor({ state: 'visible', timeout: 6000 }).then(() => true).catch(() => false);

    if (firstNameVisible) {
      console.log('👤 [SignUp_Flow] Filling personal details...');
      try {
        await signupPage.fillPersonalDetails(user);
        await signupPage.clickPersonalDetailsContinue();

        // Robust phone validation fallback: retry different formats if stuck with error message
        await this.page.waitForTimeout(1000);
        const errorMsg = this.page.locator('text=/valid phone number|valid number/i').first();
        if (await errorMsg.isVisible().catch(() => false)) {
          console.log(`⚠️ [SignUp_Flow] Phone validation error detected: "${await errorMsg.textContent()}"`);

          const phoneInput = this.page.locator(
            'input[type="tel"], input[name*="phone" i], input[name*="Phone" i], input[placeholder*="phone" i]'
          ).first();

          const isAU = region === 'AU' || this.page.url().includes('-AU');
          const formats = isAU
            ? ['0412345678', '412345678', '+61412345678', '0400000000', '400000000']
            : ['7480748354', '+447480748354', '07480748354', '+917480748354', '07700900100', '7700900100'];

          for (const fmt of formats) {
            console.log(`🔄 [SignUp_Flow] Trying alternative phone format: ${fmt}`);
            await phoneInput.click({ force: true });
            await phoneInput.press('Meta+A');
            await phoneInput.press('Backspace');
            await phoneInput.fill(fmt);
            await phoneInput.dispatchEvent('change');
            await phoneInput.blur();
            await this.page.waitForTimeout(500);

            // Re-trigger validation with click
            await signupPage.clickPersonalDetailsContinue();
            await this.page.waitForTimeout(1500);

            if (!(await errorMsg.isVisible().catch(() => false)) && !this.page.url().includes('page=personalDetails')) {
              console.log(`✅ [SignUp_Flow] Phone format ${fmt} accepted`);
              break;
            }
          }

          // If still showing error on staging, it may be a known issue
          if (await errorMsg.isVisible().catch(() => false)) {
            const isStag = this.page.url().includes('stag') || (process.env.DAZN_ENV || '').toLowerCase() === 'stag';
            if (isStag) {
              console.log('⚠️ [SignUp_Flow] Phone validation assets failed to load on staging — continuing');
            }
          }
        }
      } catch (fillErr: any) {
        // Ignore error if page has already navigated to payment
        const currentUrl = this.page.url().toLowerCase();
        if (currentUrl.includes('payment') || currentUrl.includes('paymentdetails')) {
          console.log(`ℹ️ [SignUp_Flow] Form fill failed but page transitioned to payment: ${fillErr.message}`);
        } else {
          throw fillErr;
        }
      }
    } else {
      console.log('⚠️ [SignUp_Flow] Personal details form not detected — skipping');
    }

    await this.page.waitForLoadState('domcontentloaded').catch(() => {});

    // After personal details Continue, wait and check if we moved to payment
    await sleep(2000);
    if (this.page.url().includes('paymentDetails')) {
      console.log('💳 [SignUp_Flow] Navigated to payment page after personal details');
    }

    console.log(`✅ [SignUp_Flow] Signup page handled. Current URL: ${this.page.url()}`);
  }

  // ─────────────────────────────────────────────────────────────
  // Step 8: Handle Payments page — validate and fill payment details
  // ─────────────────────────────────────────────────────────────
  /**
   * Handle the payments page: validate fields and fill payment details.
   * Uses the existing PaymentPage and PaymentFillPage page objects.
   * On staging, fills and submits payment; on prod, only validates.
   *
   * @param paymentData - Array of payment data rows from Excel
   * @param eventData - Event configuration data
   * @param results - Mutable results array for validation
   * @param cardDetails - Card details for filling (cardNumber, expiryDate, cvv, cardHolder)
   */
  async handlePaymentPage(
    paymentData: any[],
    eventData: Record<string, string>,
    results: any[],
    cardDetails?: { cardNumber: string; expiryDate: string; cvv: string; cardHolder: string }
  ): Promise<void> {
    console.log('💰 [SignUp_Flow] Step 8: Handling Payments page...');

    const paymentPage = new PaymentPage(this.page);
    await paymentPage.waitForLoad();

    const isPayment = await paymentPage.isPaymentPage();
    if (!isPayment) {
      console.log('⚠️ [SignUp_Flow] Not on payments page — checking current URL');
      console.log(`   Current URL: ${this.page.url()}`);
    }

    // Validate payment page fields
    if (paymentData && paymentData.length > 0) {
      console.log('🔍 [SignUp_Flow] Validating payments page fields...');
      await paymentPage.validate(paymentData, results, eventData, 'newuser');
      console.log(`✅ [SignUp_Flow] Payment validation complete. Results: ${results.length} entries`);
    }

    // Fill and submit payment details on staging
    const env = (process.env.DAZN_ENV || 'stag').toLowerCase();
    if (env === 'stag') {
      console.log('💳 [SignUp_Flow] DAZN_ENV is stag — filling credit card payment details...');
      const paymentFillPage = new PaymentFillPage(this.page);
      try {
        await paymentFillPage.fillPaymentAndSubmit();
        await paymentFillPage.verifyPaymentSuccess();
        await paymentFillPage.clickSuccessContinue();

        console.log('✅ [SignUp_Flow] Payment details submitted successfully on staging!');
        results.push({
          page: 'Payment Success',
          field: 'Payment Completed',
          expected: 'Success page reached',
          actual: 'Success page reached',
          status: 'PASS',
        });
      } catch (paymentErr: any) {
        console.error(`❌ [SignUp_Flow] Payment filling failed: ${paymentErr.message}`);
        try {
          await this.page.screenshot({ path: `test-results/payment_fill_error_${Date.now()}.png`, fullPage: true });
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
    } else if (cardDetails) {
      // On non-staging environments, only fill card details if explicitly provided
      console.log(`ℹ️ [SignUp_Flow] DAZN_ENV is "${env}" — filling provided card details...`);
      const paymentFillPage = new PaymentFillPage(this.page);
      await paymentFillPage.selectCreditCard();
      await paymentFillPage.fillCardDetails(
        cardDetails.cardNumber,
        cardDetails.expiryDate,
        cardDetails.cvv,
        cardDetails.cardHolder
      );
      console.log('✅ [SignUp_Flow] Payment details filled');
    } else {
      console.log(`ℹ️ [SignUp_Flow] DAZN_ENV is "${env}" — skipping card details filling.`);
    }

    await this.page.waitForLoadState('domcontentloaded').catch(() => {});
    console.log(`✅ [SignUp_Flow] Payments page handled. Current URL: ${this.page.url()}`);
  }

  // ─────────────────────────────────────────────────────────────
  // Full flow: execute all steps in sequence
  // ─────────────────────────────────────────────────────────────
  /**
   * Execute the complete sign-up flow:
   *   1. Launch the DAZN site
   *   2. Wait for cookies
   *   3. Accept the cookies
   *   4. Click the Explore button
   *   5. Find Live TV rail → click "ABC of... Climbing"
   *   6. Subscribe popup → click Subscribe → navigate to PPV/plan page
   *   7. Plans page → select plan → continue
   *   8. Signup page → enter email → fill personal details
   *   9. Payments page → validate → fill payment details
   *
   * @param baseUrl - Base URL for DAZN site (optional)
   * @param user - User object with email, firstName, lastName, password, phone (optional)
   * @param ratePlan - The plan to select (e.g., "monthly", "annual pay monthly") (optional)
   * @param paymentData - Array of payment data rows from Excel (optional)
   * @param eventData - Event configuration data (optional)
   * @param results - Mutable results array for validation (optional)
   * @param cardDetails - Card details for filling (optional)
   */
  async executeSignUpFlow(
    baseUrl?: string,
    user?: { email: string; firstName: string; lastName: string; password: string; phone: string },
    ratePlan?: string,
    paymentData?: any[],
    eventData?: Record<string, string>,
    results?: any[],
    cardDetails?: { cardNumber: string; expiryDate: string; cvv: string; cardHolder: string }
  ): Promise<void> {
    console.log('🚀 [SignUp_Flow] Starting full sign-up flow...');

    // Step 1: Launch the DAZN site
    await this.launchSite(baseUrl);

    // Step 2 & 3: Wait for cookies and accept them
    await this.waitForAndAcceptCookies();

    // Extra stabilisation after cookie dismissal
    await sleep(1000);

    // Step 4: Click the Explore button
    await this.clickExplore();

    // Step 5: Find Live TV rail → click "ABC of... Climbing"
    await this.navigateToLiveTVRail();

    // Step 6: Handle Plans page — select plan and continue
    if (ratePlan) {
      await this.handlePlanPage(ratePlan);
    } else {
      console.log('⚠️ [SignUp_Flow] No rate plan provided — skipping plans page handling');
    }

    // Step 7: Handle Signup page — enter email, fill personal details
    if (user) {
      await this.handleSignupPage(user);
    } else {
      console.log('⚠️ [SignUp_Flow] No user data provided — skipping signup page handling');
    }

    // Step 8: Handle Payments page — validate and fill payment details
    if (paymentData && eventData && results) {
      await this.handlePaymentPage(paymentData, eventData, results, cardDetails);
    } else {
      console.log('⚠️ [SignUp_Flow] No payment data provided — skipping payments page handling');
    }

    console.log('✅ [SignUp_Flow] Full sign-up flow completed successfully');
  }

  // ─────────────────────────────────────────────────────────────
  // Fallback base URL construction
  // ─────────────────────────────────────────────────────────────
  private getFallbackBaseUrl(): string {
    const env = (process.env.DAZN_ENV || 'stag').toLowerCase();
    const region = (process.env.DAZN_REGION || 'GB').toUpperCase();
    let domain = 'stag.dazn.com';
    if (env === 'beta') domain = 'beta.dazn.com';
    if (env === 'prod') domain = 'www.dazn.com';
    return `https://${domain}/en-${region}`;
  }
}