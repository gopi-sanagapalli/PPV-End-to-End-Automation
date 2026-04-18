import { test }                        from '@playwright/test';
import path                            from 'path';

import { SchedulePage }                from '../../pages/schedulepage';
import { SignupPage }                  from '../../pages/SignupPage';
import { PaymentPage }                 from '../../pages/PaymentPage';

import { readSheet, getPPVDataByVariant } from '../../utils/excelReader';
import { detectVariant }               from '../../flows/detectVariant';
import { validateVariant }             from '../../flows/validateVariant';
import { buildEventData }              from '../../utils/buildEventData';
import { displayResultsTable }         from '../../utils/resultsDisplay';
import { writeResults }                from '../../utils/excelWriter';
import { createTestUser }              from '../../utils/testDataBuilder';
import { sleep, setupPage }            from '../../utils/helpers';

const REGION       = process.env.DAZN_REGION || 'IN';
const EVENT_CONFIG = process.env.PPV_CONFIG  || 'Wardley.json';

function loadEventConfig() {
  const p = path.resolve(process.cwd(), 'config', EVENT_CONFIG);
  return require(p);
}

test('PPV flow via schedule', async ({ browser }) => {
  test.setTimeout(300_000);

  const context = await browser.newContext({
    storageState: path.resolve(
      process.cwd(), 'auth/dazn-storage-state.json'
    ),
    viewport:     null,
    colorScheme:  'dark',
    reducedMotion:'no-preference',
    recordVideo: {
      dir:  'test-results/videos/',
      size: { width: 1920, height: 1080 },
    },
  });

  await context.addInitScript(() => {
    try {
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem('randomABPoint', Math.random().toString());
    } catch {}
  });

  const page    = await context.newPage();
  const results: any[] = [];

  // ── clickAndWaitForNav ────────────────────────────────────────
  const clickAndWaitForNav = async (
    p:     any,
    btn:   any,
    label: string
  ) => {
    console.log(`clicking: ${label}`);
    const before = p.url();
    await btn.scrollIntoViewIfNeeded().catch(() => {});
    await btn.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    await btn.click({ force: true });
    try {
      await p.waitForURL(
        (url: URL) => url.toString() !== before,
        { timeout: 8000 }
      );
      console.log(`navigated to: ${p.url()}`);
    } catch {
      await p.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => {});
      console.log(`navigated to: ${p.url()}`);
    }
  };

  // ── detectPageType — URL first, no body polling ───────────────
  const detectPageType = async (
    p:           any,
    pagesConfig: Record<string, { detection: string }>
  ): Promise<'ppv' | 'plan' | 'email' | 'payment' | 'unknown'> => {
    if (!p || p.isClosed()) return 'unknown';

    const url = p.url();

    // URL signals are instant — check these first
    if (url.includes('paymentDetails'))        return 'payment';
    if (url.includes('emailDetails'))          return 'email';
    if (url.includes('upsellTierShown=true'))  return 'ppv';
    if (url.includes('upsellTierSkipped=true')) return 'plan';

    // Email — DOM check
    try {
      const n = await p.locator('input[type="email"]').count();
      if (n > 0) return 'email';
    } catch {}

    // Body text fallback — only if URL gave no signal
    const lower = await p.locator('body')
      .innerText({ timeout: 2000 })
      .then((t: string) => t.toLowerCase())
      .catch(() => '');

    const ppvDetection = pagesConfig?.ppv?.detection?.toLowerCase() || '';
    if (ppvDetection && lower.includes(ppvDetection))     return 'ppv';
    if (lower.includes('subscribe without a pay-per-view')) return 'ppv';
    if (lower.includes('choose your plan'))               return 'ppv';
    if (lower.includes("choose a plan that's right"))     return 'plan';
    if (lower.includes('pick a plan to go with'))         return 'plan';

    return 'unknown';
  };

  try {
    const json      = loadEventConfig();
    const eventData = buildEventData(json, REGION);

    const flow          = (json.flow || 'schedule').toLowerCase();
    const baseUrl       = eventData.BASE_URL;
    const sport         = json.SPORT;
    const variantConfig = json.variants;
    const pagesConfig   = json.pages;

    console.log(`\n🔀 Flow     : ${flow}`);
    console.log(`🌍 Region   : ${REGION}`);
    console.log(`🥊 Event    : ${eventData.PPV_NAME}`);
    console.log(`🔗 Base URL : ${baseUrl}\n`);

    // ══════════════════════════════════════════════════════════
    // FLOW: SCHEDULE
    // ══════════════════════════════════════════════════════════
    if (flow === 'schedule') {

      const schedule = new SchedulePage(page);
      await schedule.navigate(baseUrl);
      await setupPage(page);                    // ← once after navigate

      await schedule.selectSport(sport);
      await sleep(300);                         // filter animation only

      const eventCard = await schedule.findEvent(eventData.PPV_NAME);
      await schedule.clickEvent(eventCard);

      console.log('\n📋 Validating Schedule page...');
      const scheduleData = readSheet('Schedule page');
      await validateVariant(
        page, 'schedule', scheduleData, results, eventData, 'Schedule'
      );

      await schedule.clickBuyNow();
      await page.waitForURL(
        (url) => !url.toString().includes('/schedule'),
        { timeout: 10000 }
      ).catch(() => {});
      await setupPage(page);                    // ← once after navigation

    // ══════════════════════════════════════════════════════════
    // FLOW: LANDING
    // ══════════════════════════════════════════════════════════
    } else if (flow === 'landing') {

      const landingUrl = `${baseUrl}/welcome`;
      console.log(`📅 Navigating to: ${landingUrl}`);
      await page.goto(landingUrl);
      await setupPage(page);                    // ← once after navigate

      console.log('\n📋 Validating Landing page...');
      const landingData = readSheet('Landing page');
      await validateVariant(
        page, 'landing', landingData, results, eventData, 'Landing'
      );

      const buyNow = page.locator(
        'button:has-text("Buy Now"), ' +
        'button:has-text("Buy now"), ' +
        'a:has-text("Buy now")'
      ).first();
      await buyNow.waitFor({ state: 'visible', timeout: 10000 });
      await buyNow.scrollIntoViewIfNeeded().catch(() => {});
      await buyNow.click({ force: true });

      await page.waitForURL(
        (url) => !url.toString().includes('/welcome'),
        { timeout: 10000 }
      ).catch(() => {});
      await setupPage(page);                    // ← once after navigation

    } else {
      throw new Error(`❌ Unknown flow: "${flow}"`);
    }

    // ══════════════════════════════════════════════════════════
    // STEP 2 — DETECT VARIANT
    // ══════════════════════════════════════════════════════════
    console.log('landed on:', page.url());

    // setupPage already called above — just detect variant
    const variant = await detectVariant(page, variantConfig)
      .catch(() => 'variant1');
    console.log('🎯 variant:', variant);

    const currentVariantConfig = variantConfig[variant];

    // ══════════════════════════════════════════════════════════
    // STEP 3 — FLOW LOOP  PPV → Plan → Email
    // ══════════════════════════════════════════════════════════
    let ppvValidated  = false;
    let planValidated = false;
    let stuckCount    = 0;

    for (let step = 0; step < 10; step++) {

      if (page.isClosed()) throw new Error('❌ Page closed unexpectedly');

      // detectPageType is now instant (URL-based) — no setupPage needed here
      const pageType = await detectPageType(page, pagesConfig);
      console.log(`\nstep ${step + 1} → pageType: ${pageType} | url: ${page.url()}`);

      // ── EMAIL ──────────────────────────────────────────────
      if (pageType === 'email') {
        console.log('✅ Reached email page');
        break;
      }

      // ── PPV PAGE ───────────────────────────────────────────
      if (pageType === 'ppv') {
        console.log('👉 PPV page');
        stuckCount = 0;

        if (!ppvValidated) {
          // setupPage already ran — just validate
          try {
            const ppvData = getPPVDataByVariant(variant);
            console.log(`📊 FINAL DATA: ${ppvData.length}`);
            await validateVariant(
              page, variant, ppvData, results, eventData, 'PPV'
            );
          } catch (e: any) {
            console.warn('⚠️  PPV validation error:', e.message);
          }
          ppvValidated = true;
        }

        const ppvSelector = currentVariantConfig?.ppvSelector || 'input[type="radio"]';
        const ctaText     = currentVariantConfig?.ctaText || 'Continue';

        const ppvInput = page.locator(ppvSelector).first();
        if (await ppvInput.isVisible({ timeout: 1500 }).catch(() => false)) {
          await ppvInput.scrollIntoViewIfNeeded().catch(() => {});
          await ppvInput.click({ force: true }).catch(() => {});
        }

        const btn = page.locator(`button:has-text("${ctaText}")`).first();
        await btn.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {
          console.warn(`⚠️  CTA "${ctaText}" not visible after 8s`);
        });
        await clickAndWaitForNav(page, btn, `PPV Continue (${variant})`);

        // setupPage after navigation — lazy load new page content
        await setupPage(page);
        continue;
      }

      // ── PLAN PAGE ──────────────────────────────────────────
      if (pageType === 'plan') {
        console.log('👉 DAZN Plan page');
        stuckCount = 0;

        if (!planValidated) {
          try {
            await page.waitForSelector(
              'input[type="radio"]',
              { timeout: 5000 }
            ).catch(() => {});

            const planData = readSheet('Dazn Plan page');
            await validateVariant(
              page, 'plan', planData, results, eventData, 'DAZN Plan'
            );
          } catch (e: any) {
            console.warn('⚠️  Plan validation error:', e.message);
          }
          planValidated = true;
        }

        const trialRadio = page.locator('input[type="radio"]').first();
        if (await trialRadio.isVisible({ timeout: 1500 }).catch(() => false)) {
          await trialRadio.scrollIntoViewIfNeeded().catch(() => {});
          await trialRadio.click({ force: true }).catch(() => {});
        }

        const btn = page.locator('button:has-text("Continue")').first();
        await btn.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {
          console.warn('⚠️  Plan Continue not visible after 8s');
        });
        await clickAndWaitForNav(page, btn, 'Plan Continue');

        // setupPage after navigation
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

    // No setupPage here — already called after last navigation
    const signup = new SignupPage(page);
    const user   = createTestUser();
    await signup.enterEmail(user.email);
    await signup.clickContinue();

    // ══════════════════════════════════════════════════════════
    // STEP 5 — PERSONAL DETAILS
    // ══════════════════════════════════════════════════════════
    await page.waitForLoadState('domcontentloaded').catch(() => {});
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
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForSelector(
      'text=/Today you pay|Next payment|free trial|payment/i',
      { timeout: 12000 }
    ).catch(() => console.log('⚠️  Payment UI signal not found'));

    console.log('\n💳 PAYMENT URL:', page.url());

    const payment = new PaymentPage(page);
    if (await payment.isPaymentPage()) {
      console.log('✅ payment page');
      const paymentData = readSheet('Monthly Payment page');
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
      event:     eventData.PPV_NAME,
      region:    REGION,
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
      else           console.log('⚠️  No video found');
    } catch (e: any) {
      console.log('⚠️  Video path error:', e.message);
    }
    await context.close();
  }
});