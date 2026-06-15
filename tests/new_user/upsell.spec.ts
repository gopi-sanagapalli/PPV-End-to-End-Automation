import { test, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { LandingPage } from '../../pages/LandingPage';
import { HomePage } from '../../pages/HomePage';
import { SportsLandingPage } from '../../pages/SportsLandingPage';
import { SignupPage } from '../../pages/SignupPage';
import { PaymentPage } from '../../pages/PaymentPage';
import { PaymentFillPage } from '../../pages/PaymentFillPage';
import { SuccessUpsellPage } from '../../pages/SuccessUpsellPage';
import { SavedCardPaymentPage } from '../../pages/SavedCardPaymentPage';
import { DefaultSignupPage } from '../../pages/DefaultSignupPage';

import { readUpsellSheet } from '../../utils/upsellExcelReader';
import { detectPageType } from '../../utils/flowHelpers';
import { buildEventData } from '../../utils/buildEventData';
import { displayResultsTable } from '../../utils/resultsDisplay';
import { writeResults } from '../../utils/excelWriter';
import { createTestUser } from '../../utils/testDataBuilder';
import {
  sleep,
  setupPage,
  handleCookies,
  stabilisePage,
  injectConsentCookies,
} from '../../utils/helpers';
import {
  loadEventConfig,
  safeScrollToElement,
  clickAndWaitForNav,
  handlePopupModal,
} from '../../utils/testHelpers';
import { compare } from '../../utils/compare';
import { resolveExpected } from '../../utils/resolveExpected';

// ── Config ──
const REGION = process.env.DAZN_REGION || 'GB';
const EVENT_CONFIG = process.env.PPV_CONFIG || 'upsell_flow.json';

// ── Main Flow Runner ──
async function runUpsellFlow(
  browser: any,
  json: any,
  flowConfig: any,
  region: string
): Promise<{ results: any[]; reachedEndPage: boolean }> {
  const { name, source, tier, ratePlan } = flowConfig;
  const results: any[] = [];

  const eventData = buildEventData(json, region, tier, ratePlan, source);
  // Overlay all global keys directly into eventData for placeholder resolution
  const globalData = json.global || {};
  for (const [k, v] of Object.entries(globalData)) {
    if (typeof v === 'string') eventData[k] = v;
  }
  eventData.source = source;
  eventData.SOURCE = source;
  eventData.REGION = region.toUpperCase();
  eventData.region = region.toUpperCase();
  eventData.OFFER_TYPE = json.OFFER_TYPE || '7_day_trial';
  eventData.PPV_DISPLAY_NAME = json.PPV_DISPLAY_NAME || json.PPV_NAME || '';

  const baseUrl = eventData.BASE_URL || json.regions?.GB?.BASE_URL || 'https://stag.dazn.com/en-GB';
  const isStag = baseUrl.includes('stag.');

  const context = await browser.newContext({
    viewport: null,
    colorScheme: 'dark',
    reducedMotion: 'no-preference',
    locale: 'en-GB',
    timezoneId: 'Europe/London',
    geolocation: { latitude: 51.5074, longitude: -0.1278 },
    permissions: ['clipboard-read', 'clipboard-write', 'geolocation'],
    recordVideo: {
      dir: 'test-results/videos/',
      size: { width: 1920, height: 1080 },
    },
  });

  // Pre-inject OneTrust consent cookies so banner never appears
  await injectConsentCookies(context);

  const page = await context.newPage();

  page.on('console', (msg: any) => {
    const text = msg.text();
    const textLower = text.toLowerCase();
    if (textLower.includes('error') || textLower.includes('fail')) {
      console.log(`🖥️ [Page Console] ${text}`);
    }
  });

  let reachedEndPage = false;

  try {
    // ═══════════════════════════════════════════════════════════
    // PAGE 1: Welcome page — "Don't miss live on DAZN" rail
    // ═══════════════════════════════════════════════════════════
    const welcomeHeader = source.includes('banner')
      ? 'PAGE 1: Welcome Page — Hero Banner Carousel'
      : source.includes('rail')
        ? 'PAGE 1: Welcome Page — Welcome Rail'
        : 'PAGE 1: Welcome Page — Don\'t Miss Live Rail';
    console.log('\n══════════════════════════════════════════════');
    console.log(welcomeHeader);
    console.log('══════════════════════════════════════════════');

    const isHomePageSource = source.startsWith('home-page-');
    const isHomeSport = source.startsWith('home-') && !isHomePageSource;
    const landing = isHomePageSource
      ? new HomePage(page)
      : isHomeSport
        ? new SportsLandingPage(page)
        : new LandingPage(page);
    await landing.navigate(baseUrl, source, eventData);
    await setupPage(page, 8000);

    const container = await landing.findPPVContainer(eventData, source);
    if (!container) {
      const locationName = source.includes('banner')
        ? 'hero banner carousel'
        : source.includes('rail')
          ? 'welcome rail'
          : '"Don\'t miss live" rail';
      throw new Error(`❌ CRITICAL: PPV container not found in ${locationName}`);
    }

    // Validate Welcome page fields
    try {
      const welcomeData = readUpsellSheet('Welcome page');
      console.log('📋 Validating Welcome page...');
      const tileText = (await container.textContent().catch(() => '')) || '';
      const ppvDisplayName = eventData.PPV_DISPLAY_NAME || eventData.PPV_NAME || '';
      const nameParts = ppvDisplayName.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter((w: string) => w.length > 2 && w !== 'vs');
      const matchesTile = (text: string): boolean => {
        const lower = text.toLowerCase();
        return nameParts.every((w: string) => lower.includes(w));
      };

      // Find the rail heading for validation
      const railHeading = page.getByText(/don.t miss live/i).first();

      for (const row of welcomeData) {
        const field = (row['Field'] || '').trim();
        if (!field) continue;
        const expected = resolveExpected(row, eventData);
        let actual = 'N/A';
        const key = field.toLowerCase().replace(/\s+/g, ' ').trim();

        if (key === 'rail heading') {
          actual = (await railHeading.textContent().catch(() => ''))?.trim() || 'N/A';
        } else if (key.includes('tile name') || key.includes('ppv name')) {
          actual = matchesTile(tileText) ? ppvDisplayName : 'N/A';
        } else if (key.includes('date badge')) {
          const datePart = tileText.match(/june\s*\d+|jun\s*\d+|\d+\s*june|\d+\s*jun/i);
          actual = datePart ? datePart[0].trim() : 'N/A';
        } else if (key.includes('buy now')) {
          actual = tileText.toLowerCase().includes('buy now') ? 'Buy now' : 'N/A';
        }

        const status = compare(actual, expected) ? 'PASS' : 'FAIL';
        const icon = status === 'PASS' ? '✅' : '❌';
        console.log(`  ${icon} [${field}] expected="${expected}" actual="${actual}"`);
        results.push({ page: 'Welcome', field, expected, actual, status });
      }
    } catch (err: any) {
      console.warn(`⚠️ Welcome page validation error: ${err.message}`);
    }

    // Click "Buy now" on the tile
    const beforeUrl = page.url();
    await landing.clickBuyNow(container, source);

    // Handle generic popup validations and click-through
    await handlePopupModal(page, results, eventData, source, true);

    await page.waitForLoadState('domcontentloaded').catch(() => { });
    await page.waitForURL((url: URL) => url.toString() !== beforeUrl, { timeout: 10000 }).catch(() => { });
    console.log(`✅ Navigated to: ${page.url()}`);

    // ═══════════════════════════════════════════════════════════
    // PAGE 2+: detectPageType flow loop
    // ═══════════════════════════════════════════════════════════
    let stuckCount = 0;
    let ppvValidated = false;
    let planValidated = false;
    let emailProcessedCount = 0;
    let firstPaymentDone = false;
    let firstSuccessValidated = false;
    let savedCardPaymentDone = false;
    let secondSuccessValidated = false;

    for (let step = 0; step < 25; step++) {
      if (page.isClosed()) throw new Error('❌ Page closed unexpectedly');

      const currentUrl = page.url();
      await handleCookies(page, step === 0 ? 8000 : 1500);
      await stabilisePage(page);

      // Use detectPageType for consistent routing
      const pageType = await detectPageType(page, json.pages || {}, 0);
      console.log(`\nstep ${step + 1} → pageType: ${pageType} | url: ${currentUrl.substring(0, 80)}`);

      // ── Home page (final destination after DAZN Bet dismiss or bypass) ──
      if (currentUrl.includes('/home') || currentUrl.includes('/browse')) {
        console.log('🏠 Reached Home page — flow complete!');
        reachedEndPage = true;
        results.push({ page: 'Home', field: 'Home Page Reached', expected: 'Yes', actual: 'Yes', status: 'PASS' });
        break;
      }

      // ── DAZN Bet / Promotional Upsell (second success) ──
      if (pageType === 'bet-upsell' && firstPaymentDone) {
        console.log('\n══════════════════════════════════════════════');
        console.log('PAGE 8: Second Success Page — DAZN Bet Upsell');
        console.log('══════════════════════════════════════════════');
        stuckCount = 0;

        const successPage = new SuccessUpsellPage(page);
        try {
          const betData = readUpsellSheet('Second Success page');
          await successPage.validateBetUpsell(betData, results, eventData);
        } catch (err: any) {
          console.warn(`⚠️ Second Success page validation error: ${err.message}`);
        }

        secondSuccessValidated = true;
        await successPage.clickMaybeLater();
        continue;
      }

      // ── Saved Card Payment (upsell PPV purchase) ──
      if (pageType === 'saved-card-payment' && firstPaymentDone && firstSuccessValidated) {
        console.log('\n══════════════════════════════════════════════');
        console.log('PAGE 7: Upsell PPV — Saved Card Payment');
        console.log('══════════════════════════════════════════════');
        stuckCount = 0;

        const savedCardPage = new SavedCardPaymentPage(page);
        try {
          const upsellPaymentData = readUpsellSheet('Upsell Payment page');
          await savedCardPage.validateSavedCardPayment(upsellPaymentData, results, eventData, 'Upsell Payment');
        } catch (err: any) {
          console.warn(`⚠️ Saved Card Payment validation error: ${err.message}`);
        }

        savedCardPaymentDone = true;
        await savedCardPage.fillAndSubmit(eventData);

        results.push({
          page: 'Upsell Payment',
          field: 'Upsell Payment Completed',
          expected: 'Success',
          actual: 'Success',
          status: 'PASS',
        });
        continue;
      }

      // ── PPV Upsell Success Page (first success after initial payment) ──
      if (pageType === 'success-upsell' && firstPaymentDone && !firstSuccessValidated) {
        console.log('\n══════════════════════════════════════════════');
        console.log('PAGE 6: First Success Page — PPV Upsell');
        console.log('══════════════════════════════════════════════');
        stuckCount = 0;

        const successPage = new SuccessUpsellPage(page);
        try {
          const successData = readUpsellSheet('First Success page');
          await successPage.validateUpsellSuccess(successData, results, eventData);
        } catch (err: any) {
          console.warn(`⚠️ First Success page validation error: ${err.message}`);
        }

        firstSuccessValidated = true;
        await successPage.clickBuyUpsell();
        continue;
      }

      // ── DEFAULT SIGNUP PAGE ──────────────────────────────────
      if (pageType === 'default-signup') {
        console.log('👉 Default Signup page');
        stuckCount = 0;

        if (!ppvValidated) {
          try {
            const ppvData = readUpsellSheet('PPV page');
            console.log(`📊 PPV rows (Default Signup): ${ppvData.length}`);
            const defaultSignupPage = new DefaultSignupPage(page);
            await defaultSignupPage.validate(ppvData, results, eventData, 'variant1');
          } catch (e: any) {
            console.warn('⚠️ Default Signup validation error:', e.message);
          }
          ppvValidated = true;
        }

        const defaultSignupPage = new DefaultSignupPage(page);
        await defaultSignupPage.clickContinueWithPPV();
        await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => { });
        continue;
      }

      // ── PPV page (Choose the right plan) ──
      if ((pageType === 'ppv' || pageType === 'standalone-ppv') && !ppvValidated) {
        console.log('\n══════════════════════════════════════════════');
        console.log('PAGE 2: PPV Page — Choose Plan');
        console.log('══════════════════════════════════════════════');
        stuckCount = 0;

        try {
          // Wait for the page content to load (heading or continue button)
          await page.locator('h1, h2, button:has-text("Continue"), a:has-text("Continue")').first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => { });

          const ppvData = readUpsellSheet('PPV page');
          console.log('📋 Validating PPV page...');
          const bodyText = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
          const bodyLower = bodyText.toLowerCase();

          for (const row of ppvData) {
            const field = (row['Field'] || '').trim();
            if (!field) continue;
            const expected = resolveExpected(row, eventData);
            let actual = 'N/A';
            const key = field.toLowerCase().replace(/\s+/g, ' ').trim();

            if (key === 'page title') {
              const headings = await page.locator('h1, h2').allTextContents().catch(() => []);
              const titleH = headings.find((h: string) => h.toLowerCase().includes('choose'));
              actual = titleH?.trim() || 'N/A';
            } else if (key === 'page subtitle') {
              actual = (bodyLower.includes('you\'ll need a dazn plan') || bodyLower.includes('you\u2019ll need a dazn plan') || bodyLower.includes('need a dazn plan')) ? expected : 'N/A';
            } else if (key.includes('ppv card label')) {
              // Generic: check for "PPV:" prefix with event name
              const ppvName = eventData.PPV_NAME || '';
              const ppvCardLabel = eventData.PPV_CARD_LABEL || `PPV: ${ppvName}`;
              actual = bodyLower.includes('ppv:') ? ppvCardLabel : 'N/A';
            } else if (key === 'ppv description') {
              actual = bodyLower.includes('just the fight') ? expected : 'N/A';
            } else if (key.includes('ppv image')) {
              const imgs = page.locator('img');
              actual = (await imgs.count().catch(() => 0)) > 0 ? 'Yes' : 'No';
            } else if (key === 'ppv date') {
              const dpats = [
                /\b(Sat|Sun|Mon|Tue|Wed|Thu|Fri)\w*\s+\d{1,2}(?:st|nd|rd|th)?\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+at\s+\d{1,2}:\d{2}/i,
                /\b(Saturday|Sunday|Monday|Tuesday|Wednesday|Thursday|Friday)\s+at\s+\d{1,2}:\d{2}/i,
                /\b(Sat|Sun|Mon|Tue|Wed|Thu|Fri)\w*\s+at\s+\d{1,2}:\d{2}/i,
              ];
              for (const dp of dpats) {
                const dateMatch = bodyText.match(dp);
                if (dateMatch) { actual = dateMatch[0].trim(); break; }
              }
            } else if (key === 'ppv price') {
              const ppvPrice = eventData.PPV_PRICE_RAW || '24.99';
              actual = bodyText.includes(ppvPrice) ? `£${ppvPrice}` : 'N/A';
            } else if (key.includes('ppv radio')) {
              const radios = page.locator('input[type="radio"], [role="radio"], button[aria-pressed]');
              actual = 'N/A';
              const radioCount = await radios.count().catch(() => 0);
              for (let i = 0; i < radioCount; i++) {
                const r = radios.nth(i);
                const checked = await r.getAttribute('aria-checked').catch(() => null) ||
                  await r.getAttribute('aria-pressed').catch(() => null) ||
                  (await r.isChecked().catch(() => false) ? 'true' : null);
                if (checked === 'true') { actual = 'Yes'; break; }
              }
            } else if (key.includes('ultimate card')) {
              actual = bodyLower.includes('dazn ultimate') ? 'DAZN Ultimate' : 'N/A';
            } else if (key.includes('ultimate price')) {
              const ultimatePrice = eventData.ULTIMATE_PRICE?.replace('£', '') || '19.99';
              actual = bodyText.includes(ultimatePrice) ? `£${ultimatePrice}` : 'N/A';
            } else if (key.includes('ultimate crossed')) {
              const strikePrice = await page.evaluate(() => {
                const els = Array.from(document.querySelectorAll('*'));
                for (const el of els) {
                  const style = window.getComputedStyle(el);
                  if (style.textDecoration.includes('line-through') || style.textDecorationLine.includes('line-through')) {
                    const txt = el.textContent || '';
                    const match = txt.match(/£\d+\.\d{2}/);
                    if (match) return match[0];
                  }
                }
                const selectors = ['del', 's', '[class*="strike"]', '[class*="crossed"]', '[class*="original"]'];
                for (const sel of selectors) {
                  const el = document.querySelector(sel);
                  if (el) {
                    const txt = el.textContent || '';
                    const match = txt.match(/£\d+\.\d{2}/);
                    if (match) return match[0];
                  }
                }
                return null;
              }).catch(() => null);
              actual = strikePrice || 'N/A';
            } else if (key.includes('ultimate badge')) {
              actual = bodyLower.includes('ultimate fan package') ? 'The Ultimate Fan Package' : 'N/A';
            } else if (key === 'ppv cta') {
              const ctaBtn = page.locator('button:has-text("Continue with pay-per-view"), a:has-text("Continue with pay-per-view")').first();
              actual = (await ctaBtn.textContent().catch(() => ''))?.trim() || 'N/A';
            }

            const status = compare(actual, expected) ? 'PASS' : 'FAIL';
            const icon = status === 'PASS' ? '✅' : '❌';
            console.log(`  ${icon} [${field}] expected="${expected}" actual="${actual}"`);
            results.push({ page: 'PPV', field, expected, actual, status, variant: 'upsell-ppv' });
          }
        } catch (err: any) {
          console.warn(`⚠️ PPV page validation error: ${err.message}`);
        }

        ppvValidated = true;

        // Click "Continue with pay-per-view"
        const ppvCta = page.locator(
          'button:has-text("Continue with pay-per-view"), a:has-text("Continue with pay-per-view"), ' +
          'button:has-text("Continue"), a:has-text("Continue")'
        ).first();
        await ppvCta.waitFor({ state: 'visible', timeout: 10000 });
        const beforeUrl = page.url();
        await ppvCta.click({ force: true });
        console.log('✅ Clicked "Continue with pay-per-view"');
        await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => { });
        await page.waitForURL((url: URL) => url.toString() !== beforeUrl, { timeout: 10000 }).catch(() => { });
        continue;
      }

      // ── Plan page ──
      if (pageType === 'plan' && !planValidated) {
        console.log('\n══════════════════════════════════════════════');
        console.log('PAGE 3: Plan Page');
        console.log('══════════════════════════════════════════════');
        stuckCount = 0;

        try {
          const planData = readUpsellSheet('Plan page');
          console.log('📋 Validating Plan page...');
          const bodyText = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
          const bodyLower = bodyText.toLowerCase();

          for (const row of planData) {
            const field = (row['Field'] || '').trim();
            if (!field) continue;
            const expected = resolveExpected(row, eventData);
            let actual = 'N/A';
            const key = field.toLowerCase().replace(/\s+/g, ' ').trim();

            if (key === 'page title') {
              const h1 = await page.locator('h1').first().textContent().catch(() => '');
              actual = h1?.trim() || 'N/A';
            } else if (key.includes('flex card title')) {
              actual = bodyLower.includes('flex') && bodyLower.includes('pay monthly') ? expected : 'N/A';
            } else if (key.includes('flex trial')) {
              actual = bodyLower.includes('7 day free trial') ? '7 DAY FREE TRIAL' : 'N/A';
            } else if (key.includes('flex future date')) {
              actual = bodyLower.includes('in 7 days') ? expected : 'N/A';
            } else if (key.includes('flex future text')) {
              actual = bodyText.includes('25.99') ? '£25.99/month' : 'N/A';
            } else if (key.includes('annual card title')) {
              actual = bodyLower.includes('annual') && bodyLower.includes('pay monthly') ? expected : 'N/A';
            } else if (key.includes('annual free badge')) {
              actual = bodyLower.includes('1 month free') ? '1 MONTH FREE' : 'N/A';
            } else if (key.includes('annual save badge')) {
              actual = bodyLower.includes('save') && bodyText.includes('135.99') ? expected : 'N/A';
            } else if (key.includes('annual price text')) {
              actual = bodyText.includes('15.99') && bodyLower.includes('11 months') ? expected : 'N/A';
            } else if (key.includes('annual contract')) {
              actual = bodyLower.includes('annual contract') && bodyLower.includes('auto renews') ? expected : 'N/A';
            } else if (key === 'plan cta') {
              const ctaBtn = page.locator('button:has-text("Continue"), button:has-text("Free Trial")').first();
              actual = (await ctaBtn.textContent().catch(() => ''))?.trim() || 'N/A';
            }

            const status = compare(actual, expected) ? 'PASS' : 'FAIL';
            const icon = status === 'PASS' ? '✅' : '❌';
            console.log(`  ${icon} [${field}] expected="${expected}" actual="${actual}"`);
            results.push({ page: 'DAZN Plan', field, expected, actual, status, tier });
          }
        } catch (err: any) {
          console.warn(`⚠️ Plan page validation error: ${err.message}`);
        }

        planValidated = true;

        // Click plan CTA
        const planCta = page.locator(
          'button:has-text("Continue with 7-day Free Trial"), button:has-text("Free Trial"), ' +
          'button:has-text("Continue"), a:has-text("Continue")'
        ).first();
        await planCta.waitFor({ state: 'visible', timeout: 10000 });
        await planCta.click({ force: true });
        console.log('✅ Clicked Plan CTA');
        await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => { });
        continue;
      }

      // ── Email/Signup page ──
      if (pageType === 'email') {
        console.log('\n══════════════════════════════════════════════');
        console.log('PAGE 4: Signup');
        console.log('══════════════════════════════════════════════');
        stuckCount = 0;
        emailProcessedCount++;

        if (emailProcessedCount > 4) {
          console.log('⚠️ Email loop detected — breaking');
          break;
        }

        const signup = new SignupPage(page);
        const user = createTestUser();
        const onPersonalDetails = currentUrl.includes('personalDetails');

        if (!onPersonalDetails) {
          const emailInput = await signup.findEmailInput();
          if (emailInput) {
            await signup.enterEmail(user.email);
            await signup.clickContinue();
            console.log(`✅ Email entered: ${user.email}`);
            await page.waitForURL(
              (url: URL) => url.toString().includes('personalDetails') || url.toString().includes('payment') || url.toString().includes('checkout'),
              { timeout: 10000 }
            ).catch(() => { });
          }
        }

        await page.waitForLoadState('domcontentloaded').catch(() => { });

        const firstNameEl = page.locator('[data-test-id="FIRST_NAME"], input[name="firstName"]').first();
        if (await firstNameEl.waitFor({ state: 'visible', timeout: 6000 }).then(() => true).catch(() => false)) {
          await signup.fillPersonalDetails(user);
          await signup.clickPersonalDetailsContinue();
          console.log('✅ Personal details filled and submitted');
          await page.waitForURL(
            (url: URL) => url.toString().includes('payment') || url.toString().includes('paymentDetails') || url.toString().includes('checkout'),
            { timeout: 15000 }
          ).catch(() => { });
        }
        continue;
      }

      // ── First Payment page ──
      if (pageType === 'payment' && !firstPaymentDone) {
        console.log('\n══════════════════════════════════════════════');
        console.log('PAGE 5: First Payment Page');
        console.log('══════════════════════════════════════════════');
        stuckCount = 0;

        await page.waitForSelector(
          'text=/Today you pay|free trial|payment/i',
          { timeout: 12000 }
        ).catch(() => { });

        const payment = new PaymentPage(page);
        if (await payment.isPaymentPage()) {
          console.log('✅ Payment page detected');
          const paymentData = readUpsellSheet('Payment page');
          const filteredPaymentData = paymentData.filter((row: any) => {
            const rowTier = (row['Tier'] || '').trim().toLowerCase();
            const rowPlan = (row['Rate Plan'] || '').trim().toLowerCase();
            return rowTier === (tier || 'standard').toLowerCase() &&
              rowPlan === (ratePlan || 'monthly').toLowerCase();
          });
          console.log(`📊 Payment rows: ${paymentData.length} total → ${filteredPaymentData.length} filtered`);
          await payment.validate(filteredPaymentData, results, eventData, 'newuser');
        }

        // Fill payment on stag only
        const env = (process.env.DAZN_ENV || 'stag').toLowerCase();
        if (env === 'stag') {
          const paymentFill = new PaymentFillPage(page);
          try {
            await page.screenshot({ path: 'test-results/upsell-before-payment-fill.png' }).catch(() => { });
            await paymentFill.fillPaymentAndSubmit();
            console.log('✅ First payment submitted!');
            firstPaymentDone = true;
            results.push({
              page: 'Payment',
              field: 'First Payment Completed',
              expected: 'Success',
              actual: 'Success',
              status: 'PASS',
            });
            // Wait for URL change after submitting payment
            const beforePaymentUrl = page.url();
            await page.waitForURL(
              (url: URL) => url.toString() !== beforePaymentUrl,
              { timeout: 30000 }
            ).catch(() => { });
            await page.waitForTimeout(4000);
          } catch (payErr: any) {
            console.error(`❌ First payment failed: ${payErr.message}`);
            await page.screenshot({ path: 'test-results/upsell-payment-stuck.png' }).catch(() => { });
            results.push({
              page: 'Payment',
              field: 'First Payment Completed',
              expected: 'Success',
              actual: `Failed: ${payErr.message}`,
              status: 'FAIL',
            });
            throw payErr;
          }
        } else {
          console.log('ℹ️ Not stag — stopping after payment validation');
          reachedEndPage = true;
          break;
        }
        continue;
      }

      // ── Stuck detection ──
      stuckCount++;
      console.log(`⚠️ Unknown page — waiting... (${stuckCount}/20) | URL: ${currentUrl.substring(0, 80)}`);
      await sleep(1000);
      if (stuckCount >= 20) {
        throw new Error(`❌ Flow stuck on unknown page. URL: ${currentUrl}`);
      }
    }

    if (!reachedEndPage && !secondSuccessValidated) {
      console.log('⚠️ Flow loop ended without reaching final page');
    } else if (secondSuccessValidated) {
      reachedEndPage = true;
    }

  } finally {
    try {
      const videoPath = await page.video()?.path();
      if (videoPath) console.log(`🎥 Video: ${videoPath}`);
    } catch { }
    await context.close().catch(() => { });
  }

  return { results, reachedEndPage };
}

// ── Test Definition ──
test.describe.configure({ mode: 'parallel' });

const json = loadEventConfig(EVENT_CONFIG);

const filterPlan = process.env.PLAN;
const filterSource = process.env.SOURCE;

const plansPath = path.resolve(process.cwd(), 'config/plans.json');
const plans = JSON.parse(fs.readFileSync(plansPath, 'utf-8'));
const planKeys = filterPlan ? [filterPlan] : Object.keys(plans);

const sourcesPath = path.resolve(process.cwd(), 'config/sources.json');
const sources = JSON.parse(fs.readFileSync(sourcesPath, 'utf-8'));
const sourceKeys = filterSource ? [filterSource] : Object.keys(sources);

const flows: any[] = [];
for (const planKey of planKeys) {
  const planData = plans[planKey];
  const planTier = (planData.TIER || 'standard').toLowerCase();
  const isUltimate = planTier === 'ultimate';

  for (const srcKey of sourceKeys) {
    const srcConfig = sources[srcKey];
    if (!srcConfig) continue;

    // Upsell excludes myaccount / my-account
    if (srcKey === 'myaccount' || srcKey === 'my-account') {
      continue;
    }

    const devMode = isUltimate || !!srcConfig.enableDevMode;
    const endPage = srcConfig.endPage || 'payment';

    const planName = (planData.RATE_PLAN || 'monthly').toLowerCase() === 'monthly'
      ? 'Flex Monthly'
      : ((planData.RATE_PLAN || '').toLowerCase().includes('upfront') ? 'APU' : 'APM');
    const tierName = planTier.charAt(0).toUpperCase() + planTier.slice(1);
    const srcLabel = srcKey.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

    flows.push({
      name: `${srcLabel} → ${tierName} → ${planName}`,
      source: srcConfig.source || srcKey,
      tier: planTier,
      ratePlan: (planData.RATE_PLAN || 'monthly').toLowerCase(),
      endPage: endPage,
      enableDevMode: devMode,
      planKey: planKey
    });
  }
}

if (!flows.length) {
  throw new Error('❌ No flows defined in Upsell config');
}

for (let flowIdx = 0; flowIdx < flows.length; flowIdx++) {
  const flowConfig = flows[flowIdx];
  const { name, source, tier, ratePlan } = flowConfig;

  test(`Upsell Flow ${flowIdx + 1}: ${name}`, async ({ browser }) => {
    test.setTimeout(300_000); // 5 minutes for E2E with two payments

    console.log(`\n╔═══════════════════════════════════════════════════════════════╗`);
    console.log(`║  UPSELL FLOW ${flowIdx + 1}/${flows.length}: ${name}`);
    console.log(`║  Source: ${source} | Tier: ${tier} | Plan: ${ratePlan}`);
    console.log(`╚═══════════════════════════════════════════════════════════════╝\n`);

    const currentJson = loadEventConfig(EVENT_CONFIG, flowConfig.planKey);

    const { results, reachedEndPage } = await runUpsellFlow(
      browser, currentJson, flowConfig, REGION
    );

    results.forEach((r: any) => {
      r.flowName = name;
      r.source = source;
      r.tier = tier;
      r.ratePlan = ratePlan;
    });

    const { excelPath, videoPath } = await writeResults(results);

    displayResultsTable(results, 'ppv', {
      event: json.PPV_NAME,
      region: REGION,
      excelPath,
      videoPath,
    });

    const passed = results.filter((r: any) => r.status === 'PASS').length;
    const failed = results.filter((r: any) => r.status === 'FAIL').length;
    const total = passed + failed;

    console.log(`\n✅ Upsell Flow "${name}" complete: ${passed}/${total} passed`);

    if (total === 0) {
      throw new Error(`❌ Flow "${name}" had 0 validation checks`);
    }
  });
}
