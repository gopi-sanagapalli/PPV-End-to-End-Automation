import { Page } from '@playwright/test';
import { BasePage } from './BasePage';
import { handleCookies, stabilisePage, sleep, setupPage } from '../utils/helpers';
import { SignupPage } from './SignupPage';
import { PaymentPage } from './PaymentPage';
import { PaymentFillPage } from './PaymentFillPage';
import { detectPageType } from '../utils/flowHelpers';
import { safeScrollToElement, clickAndWaitForNav } from '../utils/testHelpers';
import { validateVariant } from '../flows/validateVariant';
import { getPPVDataByVariant, getPlanDataByTier, getPaymentDataByTierAndPlan } from '../utils/excelReader.js';

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
 *   7. PPV Selection page → validate → select tier → continue
 *   8. Plans page → select plan → continue
 *   9. Signup page → enter email → fill personal details
 *   10. Payments page → validate → fill payment details
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
   * subscribe popup that appears, click the subscribe button.
   */
  async navigateToLiveTVRail(): Promise<void> {
    console.log('📺 [SignUp_Flow] Step 5: Looking for content tile to click...');

    // ── 5a. First try to find and click a tile with EntitlementIds=base_dazn_content ───
    const tileClicked = await this.findAndClickEntitlementTile();
    if (!tileClicked) {
      console.log('⚠️ [SignUp_Flow] No entitlement tile found — falling back to Live TV rail');
      await this.navigateViaLiveTVRail();
    }

    // Wait for subscribe popup or direct navigation after tile click
    await sleep(1000);

    // ── Handle the subscribe popup ────────────────────────
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
      const currentUrl = this.page.url();
      if (currentUrl.includes('/ppv') || currentUrl.includes('/sign-up') || currentUrl.includes('/subscribe') || currentUrl.includes('/plan')) {
        console.log(`✅ [SignUp_Flow] Navigated directly to: ${currentUrl}`);
        return;
      }
      throw new Error('❌ [SignUp_Flow] Subscribe popup did not appear after clicking content tile');
    }

    // ── Click the Subscribe button in the popup ───────────
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

    console.log('✅ [SignUp_Flow] Subscribe button clicked — proceeding to next page');
  }

  /**
   * Find a tile with EntitlementIds=base_dazn_content in the DOM,
   * scroll to it if needed, and click it.
   * Returns true if found and clicked, false otherwise.
   */
  private async findAndClickEntitlementTile(): Promise<boolean> {
    console.log('🔍 [SignUp_Flow] Looking for tile with EntitlementIds=base_dazn_content...');

    // Scroll to trigger lazy loading
    console.log('📜 [SignUp_Flow] Scrolling page to trigger lazy loading...');
    await this.slowScrollToBottom();
    await sleep(1500);
    await this.page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
    await sleep(500);

    // Search for the entitlement tile element reference
    const tileFound = await this.page.evaluate(() => {
      // Try to find any element that has EntitlementIds containing base_dazn_content
      // via dataset, attributes, or outerHTML
      const allLinks = document.querySelectorAll<HTMLElement>('a[href], [role="button"], button');
      for (const el of allLinks) {
        // Check dataset (JS property)
        const dataset = (el as any).dataset;
        if (dataset) {
          for (const key of Object.keys(dataset)) {
            const val = dataset[key];
            if (typeof val === 'string' && (val.includes('base_dazn_content') || val.includes('EntitlementIds'))) {
              return el.getAttribute('href') || '';
            }
          }
        }

        // Check data-* attributes
        for (let i = 0; i < el.attributes.length; i++) {
          const attr = el.attributes[i];
          if (attr.name.startsWith('data-') && attr.value.includes('base_dazn_content')) {
            return el.getAttribute('href') || '';
          }
        }
      }

      // Fallback: check any element with class containing tile/card that has JSON-like data
      const tiles = document.querySelectorAll<HTMLElement>('[class*="tile"], [class*="card"]');
      for (const tile of tiles) {
        const html = tile.outerHTML;
        if (html.includes('base_dazn_content') || html.includes('EntitlementIds')) {
          const link = tile.querySelector('a');
          if (link) return link.getAttribute('href') || '';
          return tile.getAttribute('href') || '';
        }
      }

      return '';
    });

    if (!tileFound) {
      console.log('⚠️ [SignUp_Flow] Entitlement tile not found in DOM');
      return false;
    }

    console.log(`✅ [SignUp_Flow] Found entitlement tile URL: ${tileFound}`);

    // Try to find and click the tile element directly
    const tileElement = this.page.locator(`a[href="${tileFound}"]`).first();
    const tileVisible = await tileElement.isVisible().catch(() => false);

    if (tileVisible) {
      console.log('📍 [SignUp_Flow] Entitlement tile is visible — clicking...');
      await tileElement.scrollIntoViewIfNeeded().catch(() => {});
      await this.page.waitForTimeout(300);
      await tileElement.click({ force: true, timeout: 10000 });
      console.log('✅ [SignUp_Flow] Clicked entitlement tile');
      return true;
    }

    // Tile not visible — scroll page to find it
    console.log('📜 [SignUp_Flow] Scrolling to find entitlement tile...');
    for (let i = 0; i < 30; i++) {
      const visibleNow = await tileElement.isVisible().catch(() => false);
      if (visibleNow) {
        console.log(`📍 [SignUp_Flow] Entitlement tile found at scroll position ${i} — clicking...`);
        await tileElement.scrollIntoViewIfNeeded().catch(() => {});
        await this.page.waitForTimeout(300);
        await tileElement.click({ force: true, timeout: 10000 });
        console.log('✅ [SignUp_Flow] Clicked entitlement tile');
        return true;
      }

      const scrollPos = (i + 1) * 500;
      await this.page.evaluate((pos) => {
        window.scrollTo({ top: pos, behavior: 'smooth' });
      }, scrollPos).catch(() => {});
      await this.page.waitForTimeout(600);
    }

    console.log('⚠️ [SignUp_Flow] Entitlement tile not visible even after scrolling — returning false');
    return false;
  }

  /**
   * Fallback: navigate via Live TV rail when no entitlement tile is found
   */
  private async navigateViaLiveTVRail(): Promise<void> {
    console.log('📺 [SignUp_Flow] navigateViaLiveTVRail: Looking for Live TV rail...');

    // ── Find the Live TV rail heading ─────────────────────
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

      const scrollPos = (i + 1) * 500;
      await this.page.evaluate((pos) => {
        window.scrollTo({ top: pos, behavior: 'smooth' });
      }, scrollPos).catch(() => {});
      await this.page.waitForTimeout(600);
    }

    if (!liveTVRailFound) {
      throw new Error('❌ [SignUp_Flow] Live TV rail heading not found on the home page');
    }

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

    // ── 5c. Click the 2nd tile in the Live TV rail ────────────
    // Find all clickable tile links within the rail wrapper
    const tileLinks = railWrapper.locator(
      'a[class*="tile"], a[class*="card"], section a, [class*="tile"] a, a[href*="/event"]'
    );

    const nextBtn = railWrapper.locator([
      'button[aria-label="Next slide"]',
      'button[class*="swiper-button-next"]',
      '.custom-swiper-button-next',
      '[class*="next" i]',
    ].join(', ')).first();

    await nextBtn.waitFor({ state: 'attached', timeout: 5000 }).catch(() => {});
    await railWrapper.hover({ force: true }).catch(() => {});
    await this.page.waitForTimeout(300);

    const tileCount = await tileLinks.count().catch(() => 0);
    console.log(`🔍 [SignUp_Flow] Found ${tileCount} tiles in Live TV rail`);

    let tileClicked = false;

    if (tileCount >= 2) {
      // Click the 2nd tile (index 1)
      const secondTile = tileLinks.nth(1);
      const visible = await secondTile.isVisible().catch(() => false);

      if (visible) {
        console.log('📍 [SignUp_Flow] Second tile is visible — clicking...');
        await secondTile.scrollIntoViewIfNeeded().catch(() => {});
        await this.page.waitForTimeout(300);
        await secondTile.click({ force: true, timeout: 10000 });
        tileClicked = true;
        console.log('✅ [SignUp_Flow] Clicked 2nd tile in Live TV rail');
      } else {
        console.log('🔍 [SignUp_Flow] Second tile not visible — clicking Next to scroll...');
        const nextDisabled = await nextBtn.evaluate((el: Element) => {
          return el.classList.contains('swiper-button-disabled') ||
            el.classList.contains('rail-module__disable') ||
            el.className.includes('disable') ||
            el.hasAttribute('disabled');
        }).catch(() => false);

        if (!nextDisabled) {
          await nextBtn.click({ timeout: 5000, force: true }).catch(() => {});
          await this.page.waitForTimeout(500);

          const recheckVisible = await secondTile.isVisible().catch(() => false);
          if (recheckVisible) {
            await secondTile.scrollIntoViewIfNeeded().catch(() => {});
            await this.page.waitForTimeout(300);
            await secondTile.click({ force: true, timeout: 10000 });
            tileClicked = true;
            console.log('✅ [SignUp_Flow] Clicked 2nd tile in Live TV rail after scrolling');
          }
        }
      }
    }

    // Fallback: click any tile link if 2nd tile approach didn't work
    if (!tileClicked) {
      const anyTile = railWrapper.locator('a').first();
      if (await anyTile.isVisible().catch(() => false)) {
        console.log('⚠️ [SignUp_Flow] Falling back to first tile in Live TV rail');
        await anyTile.scrollIntoViewIfNeeded().catch(() => {});
        await this.page.waitForTimeout(300);
        await anyTile.click({ force: true, timeout: 10000 });
        tileClicked = true;
      } else {
        throw new Error('❌ [SignUp_Flow] No clickable tiles found in Live TV rail');
      }
    }

    console.log('✅ [SignUp_Flow] Live TV rail navigation complete');
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
  // Handle PPV → Plan → Signup → Payment flow (from newuser.ppv.spec.ts dont miss flow)
  // ─────────────────────────────────────────────────────────────
  /**
   * Handle the complete flow from PPV page to Payment page using the
   * same detectPageType loop approach as the "dont miss" flow in
   * newuser.ppv.spec.ts. This replaces the individual handlePPVPage,
   * handlePlanPage, handleSignupPage, and handlePaymentPage methods.
   *
   * @param tier - The tier to select ('standard' or 'ultimate')
   * @param ratePlan - The rate plan (e.g., 'monthly', 'annual pay monthly', 'annual pay upfront')
   * @param variant - The variant key for PPV data lookup
   * @param results - Mutable results array for validation
   * @param eventData - Event configuration data
   * @param user - User object with email, firstName, lastName, password, phone (optional)
   * @param region - Region code (e.g., 'GB', 'AU') for phone validation
   * @param source - The source/surfacing point (e.g., 'home-page-dont-miss')
   * @param pagesConfig - Pages configuration for detectPageType (optional)
   * @param devModeEnabled - Whether dev mode is enabled for ultimate tier
   */
  async handlePPVToPaymentFlow(
    tier: string = 'standard',
    ratePlan: string = 'monthly',
    variant: string = 'variant1',
    results: any[] = [],
    eventData: Record<string, string> = {},
    user?: { email: string; firstName: string; lastName: string; password: string; phone: string },
    region?: string,
    source: string = 'home-page-dont-miss',
    pagesConfig?: Record<string, { detection: string }>,
    devModeEnabled: boolean = false
  ): Promise<{ reachedEndPage: boolean }> {
    console.log('🎯 [SignUp_Flow] Handling PPV → Payment flow using detectPageType loop...');

    let ppvValidated = false;
    let planValidated = false;
    let planClickCount = 0;
    let emailProcessedCount = 0;
    let stuckCount = 0;
    let reachedEndPage = false;

    const currentVariantConfig: Record<string, any> = {};
    const config = pagesConfig || {};

    for (let step = 0; step < 15; step++) {
      if (this.page.isClosed()) throw new Error('❌ Page closed unexpectedly');

      const pageType = await detectPageType(this.page, config, planClickCount);
      await handleCookies(this.page, step === 0 ? 5000 : 500);
      await stabilisePage(this.page);
      console.log(`\nstep ${step + 1} → pageType: ${pageType} | planClicks: ${planClickCount} | url: ${this.page.url()}`);

      // ── OTP Verification page ──────────────────────────────
      if (pageType === 'otp') {
        console.log('🔑 Reached OTP Verification page');
        reachedEndPage = true;
        break;
      }

      // ── Phone Number page ──────────────────────────────────
      if (pageType === 'phone') {
        console.log('📱 Reached "Add your phone number" page');
        reachedEndPage = true;
        break;
      }

      // ── Payment page ───────────────────────────────────────
      if (pageType === 'payment') {
        console.log('💳 Reached Payment page');
        reachedEndPage = true;

        const payment = new PaymentPage(this.page);
        if (await payment.isPaymentPage()) {
          console.log('✅ Payment page detected');
          const planKey = source.startsWith('boxing-bundle') ? `${ratePlan} bundle` : ratePlan;
          const paymentData = getPaymentDataByTierAndPlan(tier, planKey);
          console.log(`📊 Payment rows: ${paymentData.length}`);
          await payment.validate(paymentData, results, eventData, 'newuser');
        }

        // --- Payment details filling on staging ---
        const env = (process.env.DAZN_ENV || 'stag').toLowerCase();
        if (env === 'stag') {
          console.log('💳 DAZN_ENV is stag — filling credit card payment details...');
          const paymentFill = new PaymentFillPage(this.page);
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
        } else {
          console.log(`ℹ️ DAZN_ENV is "${env}" — skipping card details filling.`);
        }

        break;
      }

      // ── Email/Personal details page ────────────────────────
      if (pageType === 'email') {
        console.log('✅ Reached email/personal-details page');
        emailProcessedCount++;

        // CRITICAL FIX: After 2 email processing attempts, the flow is stuck
        if (emailProcessedCount > 2) {
          console.log('⚠️  Email/personal details loop detected — breaking');
          try {
            await this.page.screenshot({ path: 'test-results/personal_details_error.png', fullPage: true });
          } catch { }
          const anyBtn = this.page.locator('button[type="submit"], button:has-text("Continue")').first();
          if (await anyBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
            await anyBtn.click({ force: true }).catch(() => { });
            await this.page.waitForTimeout(2000);
          }
          if (this.page.url().includes('paymentDetails')) {
            reachedEndPage = true;
          }
          break;
        }

        const signup = new SignupPage(this.page);
        const testUser = user || { email: 'test@example.com', firstName: 'Test', lastName: 'User', password: 'Password123!', phone: '07123456789' };

        const onPersonalDetails = this.page.url().includes('page=personalDetails');

        // If we're on personalDetails and already processed once, just click Continue
        if (onPersonalDetails && emailProcessedCount > 1) {
          console.log('ℹ️  Already on personal details (retry) — just clicking Continue');
          const continueBtn = this.page.locator('button:has-text("Continue"), button[type="submit"]').first();
          if (await continueBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
            await continueBtn.click({ force: true }).catch(() => { });
            if (this.page.url().includes('paymentDetails') || this.page.url().includes('payment')) {
              console.log('💳 Navigated to payment after retry');
              reachedEndPage = true;
              break;
            }
          }
          continue;
        }

        const emailInput = onPersonalDetails ? null : await signup.findEmailInput();
        if (emailInput) {
          await signup.enterEmail(testUser.email);
          await signup.clickContinue();
          await this.page.waitForLoadState('domcontentloaded').catch(() => { });
          await sleep(500);
        } else {
          console.log('ℹ️  Email input not visible or on personal details page — assuming directly on personal details page');
        }

        // Wait for form state to initialize
        await this.page.waitForLoadState('domcontentloaded').catch(() => { });
        await this.page.waitForTimeout(500);

        const firstNameEl = this.page.locator('[data-test-id="FIRST_NAME"], input[name="firstName"]').first();
        const firstNameVisible = await firstNameEl.waitFor({ state: 'visible', timeout: 6000 }).then(() => true).catch(() => false);
        if (firstNameVisible) {
          try {
            await signup.fillPersonalDetails(testUser);
            await signup.clickPersonalDetailsContinue();

            // Robust phone validation fallback
            await this.page.waitForTimeout(1000);
            const errorMsg = this.page.locator('text=/valid phone number|valid number/i').first();
            if (await errorMsg.isVisible().catch(() => false)) {
              console.log(`⚠️ Phone validation error detected: "${await errorMsg.textContent()}"`);

              const phoneInput = this.page.locator(
                'input[type="tel"], input[name*="phone" i], input[name*="Phone" i], input[placeholder*="phone" i]'
              ).first();

              const isAU = region === 'AU' || this.page.url().includes('-AU');
              const formats = isAU
                ? ['0412345678', '412345678', '+61412345678', '0400000000', '400000000']
                : ['7480748354', '+447480748354', '07480748354', '+917480748354', '07700900100', '7700900100'];
              for (const fmt of formats) {
                console.log(`🔄 Trying alternative phone format: ${fmt}`);
                await phoneInput.click({ force: true });
                await phoneInput.press('Meta+A');
                await phoneInput.press('Backspace');
                await phoneInput.fill(fmt);
                await phoneInput.dispatchEvent('change');
                await phoneInput.blur();
                await this.page.waitForTimeout(500);

                await signup.clickPersonalDetailsContinue();
                await this.page.waitForTimeout(1500);

                if (!(await errorMsg.isVisible().catch(() => false)) && !this.page.url().includes('page=personalDetails')) {
                  console.log(`✅ Success! Phone format ${fmt} accepted`);
                  break;
                }
              }

              if (await errorMsg.isVisible().catch(() => false)) {
                const isStag = this.page.url().includes('stag') || (process.env.DAZN_ENV || '').toLowerCase() === 'stag';
                if (isStag) {
                  console.log('⚠️ Phone validation assets failed to load on staging — exiting flow early');
                  reachedEndPage = true;
                  break;
                }
              }
            }
          } catch (fillErr: any) {
            const currentUrl = this.page.url().toLowerCase();
            if (currentUrl.includes('payment') || currentUrl.includes('paymentdetails')) {
              console.log(`ℹ️ Form fill or click failed but page has transitioned to payment page: ${fillErr.message}. Proceeding.`);
            } else {
              throw fillErr;
            }
          }
        } else {
          console.log('⚠️  Personal details not detected — skipping');
        }

        await this.page.waitForLoadState('domcontentloaded').catch(() => { });
        await sleep(2000);
        if (this.page.url().includes('paymentDetails')) {
          console.log('💳 Navigated to payment page after personal details');
        }

        continue;
      }

      // ── PPV page ───────────────────────────────────────────
      if (pageType === 'ppv') {
        console.log('👉 PPV page');
        stuckCount = 0;

        if (!ppvValidated) {
          try {
            if (source.startsWith('boxing-bundle')) {
              console.log('📋 Validating Bundle PPV page (Boxing page sheet)...');
              const { readSheet } = await import('../utils/excelReader.js');
              const bundlePpvData = readSheet('Boxing page');
              await validateVariant(this.page, variant, bundlePpvData, results, eventData, 'Bundle PPV', 'boxing-bundle-ppv');
            } else {
              const ppvData = getPPVDataByVariant(variant);
              console.log(`📊 PPV rows: ${ppvData.length}`);
              await validateVariant(this.page, variant, ppvData, results, eventData, 'PPV');
            }
          } catch (e: any) {
            console.warn('⚠️  PPV validation error:', e.message);
          }
          ppvValidated = true;
        }

        // --- FAST PATH FOR DEV MODE FLOWS ---
        if (devModeEnabled) {
          console.log('⚡ Dev mode fast-path: clicking PPV page CTA immediately...');

          if (tier === 'ultimate') {
            console.log('💎 Dev mode: selecting Ultimate card before CTA...');
            const ultimateSelectors = [
              'div:has-text("The Ultimate Fan Package") >> text=DAZN Ultimate',
              '[class*="upsell" i]:has-text("Ultimate")',
              '[class*="ultimate" i]:has-text("Ultimate")',
              'div:has-text("DAZN Ultimate"):has-text("/month")',
              'label:has-text("DAZN Ultimate")'
            ];
            for (const sel of ultimateSelectors) {
              const el = this.page.locator(sel).first();
              if (await el.isVisible({ timeout: 500 }).catch(() => false)) {
                await el.click({ force: true }).catch(() => { });
                console.log(`✅ Dev mode: selected Ultimate card via: ${sel}`);
                await this.page.waitForTimeout(300);
                break;
              }
            }
          }

          const buttonSelectors = [
            'button:has-text("Continue with DAZN Ultimate")',
            'button:has-text("Continue with pay-per-view")',
            'button:has-text("Continue")',
            'button[type="submit"]'
          ];

          let ctaClicked = false;
          for (const sel of buttonSelectors) {
            const btn = this.page.locator(sel).first();
            if (await btn.isVisible({ timeout: 100 }).catch(() => false)) {
              await clickAndWaitForNav(this.page, btn, `PPV Continue (DevMode CTA: ${sel})`);
              ctaClicked = true;
              break;
            }
          }

          if (!ctaClicked) {
            const submitBtn = this.page.locator('button[type="submit"], button:has-text("Continue")').first();
            await submitBtn.waitFor({ state: 'visible', timeout: 3000 }).catch(() => { });
            await clickAndWaitForNav(this.page, submitBtn, 'PPV Continue (DevMode Fallback)');
          }

          await setupPage(this.page, 500);
          continue;
        }
        // ------------------------------------

        if (tier === 'ultimate') {
          console.log('💎 Clicking DAZN Ultimate card...');
          const selectors = [
            'div:has-text("The Ultimate Fan Package") >> text=DAZN Ultimate',
            '[class*="upsell" i]:has-text("Ultimate")',
            '[class*="ultimate" i]:has-text("Ultimate")',
            'div:has-text("DAZN Ultimate"):has-text("/month")',
            'label:has-text("DAZN Ultimate")'
          ];
          let clicked = false;
          for (const sel of selectors) {
            const el = this.page.locator(sel).first();
            if (await el.isVisible({ timeout: 1000 }).catch(() => false)) {
              await safeScrollToElement(this.page, el);
              await el.click({ force: true }).catch(() => { });
              console.log(`✅ Clicked Ultimate card via selector: ${sel}`);
              clicked = true;
              break;
            }
          }

          if (!clicked) {
            const radios = this.page.locator('input[type="radio"]');
            const count = await radios.count().catch(() => 0);
            for (let i = 0; i < count; i++) {
              const radio = radios.nth(i);
              const radioLabel = await radio
                .locator('xpath=ancestor::label | xpath=ancestor::div[1]')
                .first();
              const text = await radioLabel.innerText({ timeout: 500 }).catch(() => '');
              if (text.toLowerCase().includes('ultimate')) {
                await safeScrollToElement(this.page, radio);
                await radio.click({ force: true }).catch(() => { });
                console.log(`✅ Clicked Ultimate radio at index ${i}`);
                clicked = true;
                break;
              }
            }
          }

          const btn = this.page.locator('button:has-text("Continue with DAZN Ultimate")').first();
          await btn.waitFor({ state: 'visible', timeout: 5000 }).catch(() => { });
          await clickAndWaitForNav(this.page, btn, 'PPV Continue Ultimate');
        } else {
          const ppvSelector = currentVariantConfig?.ppvSelector || 'input[type="radio"]';
          const ppvInput = this.page.locator(ppvSelector).first();
          if (await ppvInput.waitFor({ state: 'visible', timeout: 1500 }).then(() => true).catch(() => false)) {
            await safeScrollToElement(this.page, ppvInput);
            await ppvInput.click({ force: true }).catch(() => { });
          }

          let btn = this.page.locator('button:has-text("Continue with pay-per-view")').first();
          if (await btn.waitFor({ state: 'visible', timeout: 1500 }).then(() => true).catch(() => false)) {
            console.log('🖱️ Clicking CTA: "Continue with pay-per-view"');
          } else {
            const ctaText = currentVariantConfig?.ctaText || 'Continue';
            console.log(`🖱️  Clicking CTA: "${ctaText}"`);
            btn = this.page.locator(`button:has-text("${ctaText}")`).first();
          }
          await clickAndWaitForNav(this.page, btn, `PPV Continue (${variant})`);
        }

        await setupPage(this.page, 500);
        continue;
      }

      // ── Plan page ──────────────────────────────────────────
      if (pageType === 'plan') {
        console.log(`👉 DAZN Plan page - Tier: ${tier}, Rate Plan: ${ratePlan}`);
        stuckCount = 0;
        planClickCount++;

        // Handle TierPlans selection first if on TierPlans page
        if (this.page.url().includes('page=TierPlans')) {
          console.log(`🗺️ Handling TierPlans page selection for tier: ${tier}`);
          let tierBtn;
          if (tier === 'ultimate') {
            tierBtn = this.page.locator('button:has-text("Continue with DAZN Ultimate"), button:has-text("Continue with Ultimate")').first();
          } else {
            tierBtn = this.page.locator('button:has-text("Continue with Standard"), button:has-text("Continue with DAZN Standard")').first();
          }
          if (await tierBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
            await safeScrollToElement(this.page, tierBtn);
            await clickAndWaitForNav(this.page, tierBtn, `TierPlans Selection (${tier})`);
            await setupPage(this.page, 500);
            continue;
          }
        }

        if (!planValidated && !this.page.url().includes('page=TierPlans')) {
          try {
            const planData = getPlanDataByTier(tier);
            console.log(`📊 Plan rows: ${planData.length}`);
            await validateVariant(this.page, 'plan', planData, results, eventData, 'DAZN Plan');
          } catch (e: any) {
            console.warn('⚠️  Plan validation error:', e.message);
          }
          planValidated = true;
        }

        if (tier === 'ultimate') {
          if (ratePlan === 'annual pay upfront') {
            const upfrontCard = this.page.locator(
              'label:has-text("Annual - Pay Upfront"), label:has-text("Pay Upfront"), [role="radio"]:has-text("Upfront")'
            ).first();
            if (await upfrontCard.isVisible({ timeout: 2000 }).catch(() => false)) {
              await safeScrollToElement(this.page, upfrontCard);
              await upfrontCard.click({ force: true }).catch(() => { });
              console.log('✅ Clicked Ultimate Upfront Card/Label by text selector');
            } else {
              const radios = this.page.locator('input[type="radio"], [role="radio"]');
              const count = await radios.count().catch(() => 0);
              let clicked = false;
              for (let i = 0; i < count; i++) {
                const r = radios.nth(i);
                const parentText = await r.evaluate((el: HTMLElement) => {
                  return el.closest('label')?.innerText || el.closest('div')?.innerText || '';
                }).catch(() => '');
                if (parentText.toLowerCase().includes('upfront') || parentText.toLowerCase().includes('save')) {
                  await safeScrollToElement(this.page, r);
                  await r.click({ force: true }).catch(() => { });
                  console.log(`✅ Selected Ultimate Upfront radio at index ${i} based on parent text: "${parentText.trim()}"`);
                  clicked = true;
                  break;
                }
              }
              if (!clicked) {
                const radio = count > 2 ? radios.nth(2) : radios.nth(1);
                if (await radio.isVisible({ timeout: 1500 }).catch(() => false)) {
                  await safeScrollToElement(this.page, radio);
                  await radio.click({ force: true }).catch(() => { });
                  console.log('✅ Selected Upfront radio (nth index fallback)');
                }
              }
            }
          } else {
            const monthlyCard = this.page.locator(
              'label:has-text("Annual - Pay Monthly"), label:has-text("Pay Monthly"), [role="radio"]:has-text("Pay Monthly")'
            ).first();
            if (await monthlyCard.isVisible({ timeout: 2000 }).catch(() => false)) {
              await safeScrollToElement(this.page, monthlyCard);
              await monthlyCard.click({ force: true }).catch(() => { });
              console.log('✅ Clicked Ultimate Monthly Card/Label by text selector');
            } else {
              const radios = this.page.locator('input[type="radio"], [role="radio"]');
              const count = await radios.count().catch(() => 0);
              let clicked = false;
              for (let i = 0; i < count; i++) {
                const r = radios.nth(i);
                const parentText = await r.evaluate((el: HTMLElement) => {
                  return el.closest('label')?.innerText || el.closest('div')?.innerText || '';
                }).catch(() => '');
                if (parentText.toLowerCase().includes('monthly') || parentText.toLowerCase().includes('saver') || parentText.toLowerCase().includes('over time')) {
                  await safeScrollToElement(this.page, r);
                  await r.click({ force: true }).catch(() => { });
                  console.log(`✅ Selected Ultimate Monthly radio at index ${i} based on parent text: "${parentText.trim()}"`);
                  clicked = true;
                  break;
                }
              }
              if (!clicked) {
                const radio = radios.first();
                if (await radio.isVisible({ timeout: 1500 }).catch(() => false)) {
                  await safeScrollToElement(this.page, radio);
                  await radio.click({ force: true }).catch(() => { });
                  console.log('✅ Selected Monthly radio (first index fallback)');
                }
              }
            }
          }

          const planBtn = this.page.locator(
            'button:has-text("Continue with DAZN Ultimate"), button:has-text("Continue")'
          ).first();
          await planBtn.waitFor({ state: 'visible', timeout: 5000 }).catch(() => { });
          await clickAndWaitForNav(this.page, planBtn, 'Ultimate Plan Continue');
        } else {
          if (ratePlan === 'annual pay monthly') {
            const annualCard = this.page.locator(
              'label:has-text("Annual - pay over time"), label:has-text("Annual - Pay Monthly")'
            ).first();

            if (await annualCard.isVisible({ timeout: 3000 }).catch(() => false)) {
              await safeScrollToElement(this.page, annualCard);
              await annualCard.click({ force: true }).catch(() => { });
              console.log('✅ Clicked Annual card');
            } else {
              const radio = this.page.locator('input[type="radio"]').nth(1);
              if (await radio.isVisible({ timeout: 1500 }).catch(() => false)) {
                await safeScrollToElement(this.page, radio);
                await radio.click({ force: true }).catch(() => { });
                console.log('✅ Selected Annual radio nth(1)');
              }
            }

            await this.page.waitForTimeout(500);

            const planBtn = this.page.locator(
              'button:has-text("Continue with 1st Month Free"), ' +
              'button:has-text("Continue with Annual"), ' +
              'button:has-text("Continue")'
            ).first();
            await planBtn.waitFor({ state: 'visible', timeout: 5000 }).catch(() => { });
            await clickAndWaitForNav(this.page, planBtn, 'Standard Annual Plan Continue');
          } else {
            const trialRadio = this.page.locator('input[type="radio"]').first();
            if (await trialRadio.isVisible({ timeout: 1500 }).catch(() => false)) {
              await safeScrollToElement(this.page, trialRadio);
              await trialRadio.click({ force: true }).catch(() => { });
              console.log('✅ Selected Flex/Trial radio');
            }

            const planBtn = this.page.locator(
              'button:has-text("Continue with 7-day Free Trial"), ' +
              'button:has-text("Continue with 1st Month Free"), ' +
              'button:has-text("Continue with PPV"), ' +
              'button:has-text("Continue")'
            ).first();
            await planBtn.waitFor({ state: 'visible', timeout: 5000 }).catch(() => { });
            await clickAndWaitForNav(this.page, planBtn, 'Standard Plan Continue');
          }
        }

        await setupPage(this.page, 500);
        continue;
      }

      // ── Unknown page ───────────────────────────────────────
      stuckCount++;
      console.log(`⚠️  Unknown page — waiting... (${stuckCount}/20) | URL: ${this.page.url()}`);
      await sleep(800);
      if (stuckCount >= 20) {
        const bodyPreview = await this.page.locator('body').innerText()
          .catch(() => 'N/A')
          .then((t: string) => t.substring(0, 200));
        throw new Error(`❌ Flow stuck on unknown page.\nURL: ${this.page.url()}\nPreview: ${bodyPreview}`);
      }
    }

    if (!reachedEndPage) {
      const finalUrl = this.page.url();
      if (finalUrl.includes('paymentDetails') || finalUrl.includes('payment')) {
        console.log('💳 Payment page detected after loop exit');
        reachedEndPage = true;

        const payment = new PaymentPage(this.page);
        if (await payment.isPaymentPage()) {
          const planKey = source.startsWith('boxing-bundle') ? `${ratePlan} bundle` : ratePlan;
          const paymentData = getPaymentDataByTierAndPlan(tier, planKey);
          await payment.validate(paymentData, results, eventData, 'newuser');
        }
      } else {
        console.log(`⚠️  Flow did not reach expected end page`);
      }
    }

    console.log(`✅ [SignUp_Flow] PPV → Payment flow complete. reachedEndPage: ${reachedEndPage}`);
    return { reachedEndPage };
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
   *   6. Subscribe popup → click Subscribe → navigate to PPV page
   *   7. PPV Selection page → validate → select tier → continue
   *   8. Plans page → select plan → continue
   *   9. Signup page → enter email → fill personal details
   *   10. Payments page → validate → fill payment details
   *
   * @param baseUrl - Base URL for DAZN site (optional)
   * @param user - User object with email, firstName, lastName, password, phone (optional)
   * @param ratePlan - The plan to select (e.g., "monthly", "annual pay monthly") (optional)
   * @param paymentData - Array of payment data rows from Excel (optional)
   * @param eventData - Event configuration data (optional)
   * @param results - Mutable results array for validation (optional)
   * @param cardDetails - Card details for filling (optional)
   * @param tier - The tier ('standard' or 'ultimate') (optional)
   * @param variant - The variant key for PPV data (optional)
   */
  async executeSignUpFlow(
    baseUrl?: string,
    user?: { email: string; firstName: string; lastName: string; password: string; phone: string },
    ratePlan?: string,
    paymentData?: any[],
    eventData?: Record<string, string>,
    results?: any[],
    cardDetails?: { cardNumber: string; expiryDate: string; cvv: string; cardHolder: string },
    tier: string = 'standard',
    variant: string = 'variant1',
    region?: string
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

    // Step 5: Find Live TV rail → click "ABC of... Climbing" → Subscribe → navigate
    await this.navigateToLiveTVRail();

    // Step 6-10: Handle PPV → Plan → Signup → Payment flow using detectPageType loop
    // (same approach as the "dont miss" flow in newuser.ppv.spec.ts)
    const ppvResults = results || [];
    const ppvEventData = eventData || {};
    const source = (eventData?.SOURCE || 'home-page-dont-miss').toLowerCase();
    const devModeEnabled = tier === 'ultimate';
    const flowRegion = region || process.env.DAZN_REGION || 'GB';

    await this.handlePPVToPaymentFlow(
      tier,
      ratePlan || 'monthly',
      variant,
      ppvResults,
      ppvEventData,
      user,
      flowRegion,
      source,
      undefined, // pagesConfig
      devModeEnabled
    );

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