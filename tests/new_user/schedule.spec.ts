import { test } from '@playwright/test';
import path from 'path';
import fs from 'fs';

import { SchedulePage } from '../../pages/schedulepage';
import { LandingPage } from '../../pages/LandingPage';
import { SignupPage } from '../../pages/SignupPage';
import { PaymentPage } from '../../pages/PaymentPage';
import { StandalonePPVPage } from '../../pages/StandalonePPVPage';

import {
  readSheet,
  getPPVDataByVariant,
  getPlanDataByTier,
  getPaymentDataByTierAndPlan,
  configureExcelPathForEvent,
} from '../../utils/excelReader';
import { detectVariant } from '../../flows/detectVariant';
import { validateVariant } from '../../flows/validateVariant';
import { buildEventData } from '../../utils/buildEventData';
import { displayResultsTable } from '../../utils/resultsDisplay';
import { writeResults } from '../../utils/excelWriter';
import { createTestUser } from '../../utils/testDataBuilder';
import {
  sleep,
  setupPage,
  handleCookies,
  stabilisePage,
  triggerLazyLoad,
  injectConsentCookies,
} from '../../utils/helpers';

import { loadEventConfig, handlePopupModal } from '../../utils/testHelpers';

const REGION = process.env.DAZN_REGION || 'IN';
const EVENT_CONFIG = process.env.PPV_CONFIG || 'beauty_and_beast';


// ── Safe scroll helper ────────────────────────────────────────────────────────
const safeScrollToElement = async (page: any, locator: any) => {
  try {
    const handle = await locator.elementHandle({ timeout: 3000 });
    if (!handle) return;
    await page.evaluate((el: HTMLElement) => {
      const rect = el.getBoundingClientRect();
      const inView =
        rect.top >= 0 &&
        rect.bottom <= window.innerHeight &&
        rect.left >= 0 &&
        rect.right <= window.innerWidth;
      if (!inView) {
        const scrollTop = window.scrollY + rect.top - 150;
        window.scrollTo({ top: Math.max(0, scrollTop), behavior: 'instant' });
      }
    }, handle);
  } catch {
    // silently ignore
  }
};

test('PPV flow', async ({ browser }) => {
  test.setTimeout(300_000);

  const context = await browser.newContext({
    storageState: path.resolve(
      process.cwd(), 'auth/dazn-storage-state.json'
    ),
    viewport: null,
    colorScheme: 'dark',
    reducedMotion: 'no-preference',
    recordVideo: {
      dir: 'test-results/videos/',
      size: { width: 1920, height: 1080 },
    },
  });

  // Pre-inject OneTrust consent cookies so banner never appears
  await injectConsentCookies(context);

  await context.addInitScript(() => {
    try {
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem('randomABPoint', Math.random().toString());
    } catch { }
  });

  const page = await context.newPage();
  const results: any[] = [];

  // ── clickAndWaitForNav ────────────────────────────────────────
  const clickAndWaitForNav = async (
    p: any,
    btn: any,
    label: string
  ) => {
    console.log(`clicking: ${label}`);
    const before = p.url();
    await safeScrollToElement(p, btn);
    await btn.waitFor({ state: 'visible', timeout: 5000 }).catch(() => { });
    await btn.click({ force: true });
    try {
      await p.waitForURL(
        (url: URL) => url.toString() !== before,
        { timeout: 8000 }
      );
      console.log(`navigated to: ${p.url()}`);
    } catch {
      await p.waitForLoadState('domcontentloaded', { timeout: 3000 })
        .catch(() => { });
      console.log(`navigated to: ${p.url()}`);
    }
  };

  // ── detectPageType ────────────────────────────────────────────
  const detectPageType = async (
    p: any,
    pagesConfig: Record<string, { detection: string }>
  ): Promise<'ppv' | 'plan' | 'email' | 'payment' | 'standalone-ppv' | 'unknown'> => {
    if (!p || p.isClosed()) return 'unknown';

    const url = p.url();

    if (url.includes('paymentDetails')) return 'payment';
    if (url.includes('emailDetails')) return 'email';
    if (url.includes('upsellTierShown=true')) return 'ppv';
    if (url.includes('upsellTierSkipped=true')) return 'plan';

    // Standalone check before standard plan
    if (url.includes('page=PlanDetails') && (
      url.toLowerCase().includes('standalone') ||
      (await p.locator('input[type="checkbox"], button[class*="ni7RX"]').count().catch(() => 0)) > 0
    )) {
      return 'standalone-ppv';
    }

    try {
      const n = await p.locator('input[type="email"]').count();
      if (n > 0) return 'email';
    } catch { }

    const lower = await p.locator('body')
      .innerText({ timeout: 2000 })
      .then((t: string) => t.toLowerCase())
      .catch(() => '');

    if (lower.includes("choose a plan") && lower.includes("choose your subscription")) {
      const checkboxCount = await p.locator('input[type="checkbox"]').count().catch(() => 0);
      if (checkboxCount > 0) return 'standalone-ppv';
    }

    const ppvDetection = pagesConfig?.ppv?.detection?.toLowerCase() || '';
    if (ppvDetection && lower.includes(ppvDetection)) return 'ppv';
    if (lower.includes('subscribe without a pay-per-view')) return 'ppv';
    if (lower.includes('choose your plan')) return 'ppv';
    if (lower.includes('choose how to buy')) return 'ppv';
    if (lower.includes("choose a plan that's right")) return 'plan';
    if (lower.includes('pick a plan to go with')) return 'plan';

    return 'unknown';
  };

  try {
    const json = loadEventConfig(EVENT_CONFIG);
    configureExcelPathForEvent(json.eventKey || '');
    const eventData = buildEventData(json, REGION);

    const flow = (json.flow || 'schedule').toLowerCase();
    const tier = (json.TIER || 'standard').toLowerCase();
    const ratePlan = (json.RATE_PLAN || 'monthly').toLowerCase();

    const baseUrl = eventData.BASE_URL;
    const sport = json.SPORT;
    const variantConfig = json.variants;
    const pagesConfig = json.pages;

    console.log(`\n🔀 Flow      : ${flow}`);
    console.log(`🌍 Region    : ${REGION}`);
    console.log(`🥊 Event     : ${eventData.PPV_NAME}`);
    console.log(`💎 Tier      : ${tier}`);
    console.log(`📋 Rate Plan : ${ratePlan}`);
    console.log(`📁 Config    : ${EVENT_CONFIG}`);
    console.log(`🔗 Base URL  : ${baseUrl}\n`);

    // ══════════════════════════════════════════════════════════
    // FLOW: SCHEDULE
    // ══════════════════════════════════════════════════════════
    if (flow === 'schedule') {

      const schedule = new SchedulePage(page);
      await schedule.navigate(baseUrl);
      await setupPage(page);
      await schedule.selectSport(sport);

      const eventCard = await schedule.findEvent(eventData.PPV_NAME);
      await schedule.clickEvent(eventCard);

      console.log('\n📋 Validating Schedule page...');
      const scheduleData = readSheet('Schedule page');
      await validateVariant(
        page, 'schedule', scheduleData, results, eventData, 'Schedule'
      );

      await schedule.clickBuyNow();

      // Handle generic popup validations and click-through
      await handlePopupModal(page, results, eventData, 'schedule', true);

      await page.waitForURL(
        (url) => url.toString().includes('PlanDetails'),
        { timeout: 15000 }
      ).catch(async () => {
        await page.waitForURL(
          (url) => !url.toString().includes('/schedule'),
          { timeout: 5000 }
        ).catch(() => { });
      });

      await setupPage(page);

      // ══════════════════════════════════════════════════════════
      // FLOW: LANDING
      // ══════════════════════════════════════════════════════════
    } else if (flow === 'landing') {

      const landing = new LandingPage(page);
      await landing.navigate(baseUrl);

      await page.waitForLoadState('domcontentloaded').catch(() => { });
      await handleCookies(page);
      await stabilisePage(page);

      const container = await landing.findPPVContainer(eventData);
      if (!container) {
        throw new Error(`❌ PPV container not found on landing page (no source specified)`);
      }

      console.log('\n📋 Validating Landing page...');
      const landingData = readSheet('Landing page');
      await validateVariant(
        page, 'landing', landingData, results, eventData, 'Landing'
      );

      await landing.clickBuyNow(container);

      // Handle generic popup validations and click-through
      await handlePopupModal(page, results, eventData, 'landing-page-tile', true);

      await page.waitForURL(
        (url) => url.toString().includes('PlanDetails'),
        { timeout: 15000 }
      ).catch(async () => {
        await page.waitForURL(
          (url) => !url.toString().includes('/welcome'),
          { timeout: 5000 }
        ).catch(() => { });
      });

      await setupPage(page);

    } else {
      throw new Error(`❌ Unknown flow: "${flow}"`);
    }

    // ══════════════════════════════════════════════════════════
    // STEP 2 — DETECT VARIANT
    // ══════════════════════════════════════════════════════════
    console.log('landed on:', page.url());

    const variant = await detectVariant(page, variantConfig)
      .catch(() => 'variant1');
    console.log('🎯 variant:', variant);

    const currentVariantConfig = variantConfig[variant];

    // ══════════════════════════════════════════════════════════
    // STEP 3 — FLOW LOOP  PPV → Plan → Email
    // ══════════════════════════════════════════════════════════
    let ppvValidated = false;
    let planValidated = false;
    let stuckCount = 0;

    for (let step = 0; step < 10; step++) {

      if (page.isClosed()) throw new Error('❌ Page closed unexpectedly');

      const pageType = await detectPageType(page, pagesConfig);
      console.log(`\nstep ${step + 1} → pageType: ${pageType} | url: ${page.url()}`);

      // ── EMAIL ──────────────────────────────────────────────
      if (pageType === 'email') {
        console.log('✅ Reached email page');
        break;
      }

      // ── STANDALONE PPV PAGE ───────────────────────────────────
      if (pageType === 'standalone-ppv') {
        console.log('👉 Standalone PPV page');
        stuckCount = 0;

        const standalonePPVPage = new StandalonePPVPage(page);

        if (!ppvValidated) {
          try {
            const ppvData = readSheet('PPV page');
            console.log(`📊 Standalone PPV rows: ${ppvData.length}`);
            // Validate checked state
            await standalonePPVPage.validatePPVPageChecked(ppvData, results, eventData);
            // Validate unchecked state
            await standalonePPVPage.validatePPVPageUnchecked(ppvData, results, eventData);
            ppvValidated = true;
          } catch (err: any) {
            console.warn('⚠️ Standalone PPV page validation error:', err.message);
          }
        }

        // Select plan
        await standalonePPVPage.selectPlan(ratePlan === 'monthly' ? 'flex' : 'annual');
        // Click Continue
        await standalonePPVPage.clickContinue();

        await page.waitForLoadState('domcontentloaded').catch(() => { });
        continue;
      }

      // ── PPV PAGE ───────────────────────────────────────────
      if (pageType === 'ppv') {
        console.log('👉 PPV page');
        stuckCount = 0;

        if (!ppvValidated) {
          try {
            const ppvData = getPPVDataByVariant(variant);
            console.log(`📊 PPV rows: ${ppvData.length}`);
            await validateVariant(
              page, variant, ppvData, results, eventData, 'PPV'
            );
          } catch (e: any) {
            console.warn('⚠️  PPV validation error:', e.message);
          }
          ppvValidated = true;
        }

        // ── Click tier card ───────────────────────────────────
        if (tier === 'ultimate') {
          console.log('💎 Clicking DAZN Ultimate card...');

          const ultimateCard = page.locator(
            '[class*="upsell" i], ' +
            '[class*="ultimate" i], ' +
            'label:has-text("DAZN Ultimate")'
          ).first();

          if (await ultimateCard.isVisible({ timeout: 3000 })
            .catch(() => false)) {
            await safeScrollToElement(page, ultimateCard);
            await ultimateCard.click({ force: true }).catch(() => { });
            console.log('✅ Clicked Ultimate card');
          } else {
            const radios = page.locator('input[type="radio"]');
            const count = await radios.count().catch(() => 0);
            for (let i = 0; i < count; i++) {
              const radio = radios.nth(i);
              const radioLabel = await radio
                .locator('xpath=ancestor::label | xpath=ancestor::div[1]')
                .first();
              const text = await radioLabel
                .innerText({ timeout: 500 })
                .catch(() => '');
              if (text.toLowerCase().includes('ultimate')) {
                await safeScrollToElement(page, radio);
                await radio.click({ force: true }).catch(() => { });
                console.log(`✅ Clicked Ultimate radio at index ${i}`);
                break;
              }
            }
          }
        } else {
          const ppvSelector = currentVariantConfig?.ppvSelector
            || 'input[type="radio"]';
          const ppvInput = page.locator(ppvSelector).first();
          if (await ppvInput.isVisible({ timeout: 1500 })
            .catch(() => false)) {
            await safeScrollToElement(page, ppvInput);
            await ppvInput.click({ force: true }).catch(() => { });
          }
        }

        const ctaText = tier === 'ultimate'
          ? 'Continue with DAZN Ultimate'
          : currentVariantConfig?.ctaText || 'Continue';

        console.log(`🖱️  Clicking CTA: "${ctaText}"`);

        const btn = page.locator(
          `button:has-text("${ctaText}")`
        ).first();
        await btn.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {
          console.warn(`⚠️  CTA "${ctaText}" not visible after 8s`);
        });
        await clickAndWaitForNav(page, btn, `PPV Continue (${variant})`);

        await setupPage(page);
        continue;
      }

      // ── PLAN PAGE ──────────────────────────────────────────
      if (pageType === 'plan') {
        console.log(`👉 DAZN Plan page - Tier: ${tier}`);
        stuckCount = 0;

        if (!planValidated) {
          try {
            await page.waitForSelector(
              'input[type="radio"]',
              { timeout: 5000 }
            ).catch(() => { });

            const planData = getPlanDataByTier(tier);
            console.log(`📊 Plan rows: ${planData.length}`);
            await validateVariant(
              page, 'plan', planData, results, eventData, 'DAZN Plan'
            );
          } catch (e: any) {
            console.warn('⚠️  Plan validation error:', e.message);
          }
          planValidated = true;
        }

        if (tier === 'ultimate') {
          console.log(`💎 Selecting Ultimate - ${ratePlan}...`);

          if (ratePlan === 'annual pay monthly') {
            const radio = page.locator('input[type="radio"]').first();
            if (await radio.isVisible({ timeout: 1500 })
              .catch(() => false)) {
              await safeScrollToElement(page, radio);
              await radio.click({ force: true }).catch(() => { });
              console.log('✅ Selected Annual Pay Monthly');
            }
          } else if (ratePlan === 'annual pay upfront') {
            const radio = page.locator('input[type="radio"]').nth(1);
            if (await radio.isVisible({ timeout: 1500 })
              .catch(() => false)) {
              await safeScrollToElement(page, radio);
              await radio.click({ force: true }).catch(() => { });
              console.log('✅ Selected Annual Pay Upfront');
            }
          }

          const planBtn = page.locator(
            'button:has-text("Continue with DAZN Ultimate"), ' +
            'button:has-text("Continue")'
          ).first();
          await planBtn.waitFor({ state: 'visible', timeout: 8000 })
            .catch(() => {
              console.warn('⚠️  Ultimate Plan Continue not visible after 8s');
            });
          await clickAndWaitForNav(page, planBtn, 'Ultimate Plan Continue');

        } else {
          // ── Standard tier ─────────────────────────────────
          console.log(`📋 Selecting Standard - ${ratePlan}...`);

          if (ratePlan === 'annual pay monthly') {
            // ✅ Click Annual card by label text
            const annualCard = page.locator(
              'label:has-text("Annual - pay over time"), ' +
              'label:has-text("Annual - Pay Monthly")'
            ).first();

            if (await annualCard.isVisible({ timeout: 3000 }).catch(() => false)) {
              await safeScrollToElement(page, annualCard);
              await annualCard.click({ force: true }).catch(() => { });
              console.log('✅ Clicked Annual card');
            } else {
              // Fallback — annual is nth(1)
              console.log('⚠️  Annual card not found — using radio nth(1)');
              const radio = page.locator('input[type="radio"]').nth(1);
              if (await radio.isVisible({ timeout: 1500 }).catch(() => false)) {
                await safeScrollToElement(page, radio);
                await radio.click({ force: true }).catch(() => { });
                console.log('✅ Selected Annual radio at index 1');
              }
            }

            // ✅ Wait for CTA to update after selection
            await page.waitForTimeout(500);

            const planBtn = page.locator(
              'button:has-text("Continue with Annual"), ' +
              'button:has-text("Continue with PPV + Annual"), ' +
              'button:has-text("Continue with PPV"), ' +
              'button:has-text("Continue")'
            ).first();
            await planBtn.waitFor({ state: 'visible', timeout: 8000 })
              .catch(() => {
                console.warn('⚠️  Standard Annual Plan Continue not visible after 8s');
              });
            await clickAndWaitForNav(page, planBtn, 'Standard Annual Plan Continue');

          } else {
            // ✅ Monthly / trial — first radio
            const trialRadio = page.locator('input[type="radio"]').first();
            if (await trialRadio.isVisible({ timeout: 1500 })
              .catch(() => false)) {
              await safeScrollToElement(page, trialRadio);
              await trialRadio.click({ force: true }).catch(() => { });
              console.log('✅ Selected Trial radio');
            }

            const planBtn = page.locator(
              'button:has-text("Continue with PPV"), ' +
              'button:has-text("Continue")'
            ).first();
            await planBtn.waitFor({ state: 'visible', timeout: 8000 })
              .catch(() => {
                console.warn('⚠️  Standard Monthly Plan Continue not visible after 8s');
              });
            await clickAndWaitForNav(page, planBtn, 'Standard Plan Continue');
          }
        }

        await setupPage(page);
        continue;
      }

      // ── UNKNOWN ────────────────────────────────────────────
      stuckCount++;
      console.log(`⚠️  Unknown page — waiting... (${stuckCount}/5)`);
      await sleep(800);
      if (stuckCount >= 5) {
        throw new Error(
          `❌ Flow stuck on unknown page.\nURL: ${page.url()}`
        );
      }
    }

    // ══════════════════════════════════════════════════════════
    // STEP 4 — EMAIL
    // ══════════════════════════════════════════════════════════
    if (page.isClosed()) throw new Error('❌ Page closed before email step');

    const signup = new SignupPage(page);
    const user = createTestUser();
    await signup.enterEmail(user.email);
    await signup.clickContinue();

    // ══════════════════════════════════════════════════════════
    // STEP 5 — PERSONAL DETAILS
    // ══════════════════════════════════════════════════════════
    await page.waitForLoadState('domcontentloaded').catch(() => { });
    await sleep(500);

    const firstNameEl = page.locator('[data-test-id="FIRST_NAME"]');
    if (await firstNameEl.isVisible({ timeout: 6000 }).catch(() => false)) {
      const signup2 = new SignupPage(page);
      await signup2.fillPersonalDetails(user);
      await signup2.clickPersonalDetailsContinue();
    } else {
      console.log('⚠️  Personal details page not detected — skipping');
    }

    // ══════════════════════════════════════════════════════════
    // STEP 6 — PAYMENT PAGE
    // ══════════════════════════════════════════════════════════
    await page.waitForLoadState('domcontentloaded').catch(() => { });
    await page.waitForSelector(
      'text=/Today you pay|Next payment|free trial|payment/i',
      { timeout: 12000 }
    ).catch(() => console.log('⚠️  Payment UI signal not found'));

    console.log('\n💳 PAYMENT URL:', page.url());

    const payment = new PaymentPage(page);
    if (await payment.isPaymentPage()) {
      console.log('✅ Payment page detected');
      const paymentData = getPaymentDataByTierAndPlan(tier, ratePlan);
      console.log(`📊 Payment rows: ${paymentData.length}`);
      await payment.validate(paymentData, results, eventData);
    } else {
      console.log('❌ Not on payment page — URL:', page.url());
    }

    // ══════════════════════════════════════════════════════════
    // STEP 7 — RESULTS
    // ══════════════════════════════════════════════════════════
    const { excelPath, videoPath } = await writeResults(results);
    displayResultsTable(results, variant, {
      event: eventData.PPV_NAME,
      region: REGION,
      excelPath,
      videoPath,
    });

  } catch (error) {
    console.error('❌ Test error:', error);
    throw error;

  } finally {
    try {
      await page.waitForTimeout(300);
      const videoPath = await page.video()?.path();
      if (videoPath) console.log(`🎥 Video saved: ${videoPath}`);
      else console.log('⚠️  No video found');
    } catch (e: any) {
      console.log('⚠️  Video path error:', e.message);
    }
    await context.close().catch(() => { });
  }
});