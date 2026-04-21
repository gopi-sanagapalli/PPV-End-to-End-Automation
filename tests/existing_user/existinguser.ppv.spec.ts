import { test }                        from '@playwright/test';
import path                            from 'path';
import fs                              from 'fs';
import { PaymentPage } from '../../pages/PaymentPage';
import { HomePage }                    from '../../pages/HomePage';
import { MyAccountPage }               from '../../pages/MyAccountPage';

import {
  readSheet,
  getPPVDataByVariant,
  getPlanDataByTier,
  getPaymentDataByTierAndPlan,
  getMyAccountData,
  getChooseHowToBuyData,
  getPPVPaymentData,
  getUpgradeConfirmationData,
}                                      from '../../utils/excelReader';
import { detectVariant }               from '../../flows/detectVariant';
import { validateVariant }             from '../../flows/validateVariant';
import { buildEventData }              from '../../utils/buildEventData';
import { displayResultsTable }         from '../../utils/resultsDisplay';
import { writeResults }                from '../../utils/excelWriter';
import {
  sleep,
  setupPage,
  handleCookies,
  stabilisePage,
}                                      from '../../utils/helpers';

const REGION       = process.env.DAZN_REGION || 'UK';
const EVENT_CONFIG = process.env.PPV_CONFIG  || 'Wardley_myaccount_returning.json';

// ── Flow constant — used for flow-restricted Excel rows ──────────────
// Enables Welcome Back, Saved Card, Signed In As, Log Out validations
const FLOW = 'myaccount';

function findConfig(dir: string, filename: string): string | null {
  if (!fs.existsSync(dir)) return null;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findConfig(full, filename);
      if (found) return found;
    } else if (entry.name === filename) {
      return full;
    }
  }
  return null;
}

function loadEventConfig() {
  const configDir  = path.resolve(process.cwd(), 'config');
  const directPath = path.join(configDir, EVENT_CONFIG);
  if (fs.existsSync(directPath)) {
    console.log(`📁 Config: ${EVENT_CONFIG}`);
    return require(directPath);
  }
  const found = findConfig(configDir, EVENT_CONFIG);
  if (found) {
    console.log(`📁 Config found: ${found}`);
    return require(found);
  }
  throw new Error(`❌ Config not found: "${EVENT_CONFIG}"`);
}

// ── Safe scroll helper ────────────────────────────────────────────────
const safeScrollToElement = async (page: any, locator: any) => {
  try {
    const handle = await locator.elementHandle({ timeout: 3000 });
    if (!handle) return;
    await page.evaluate((el: HTMLElement) => {
      const rect = el.getBoundingClientRect();
      const inView =
        rect.top    >= 0 &&
        rect.bottom <= window.innerHeight &&
        rect.left   >= 0 &&
        rect.right  <= window.innerWidth;
      if (!inView) {
        const scrollTop = window.scrollY + rect.top - 150;
        window.scrollTo({ top: Math.max(0, scrollTop), behavior: 'instant' });
      }
    }, handle);
  } catch {
    // silently ignore
  }
};

test('PPV flow via existing user my account', async ({ browser }) => {
  test.setTimeout(300_000);

  const json      = loadEventConfig();
  const eventData = buildEventData(json, REGION);

  const tier           = (json.TIER           || 'freemium').toLowerCase();
  const ratePlan       = (json.RATE_PLAN       || 'monthly').toLowerCase();
  const userEmail      = eventData.USER_EMAIL  || json.USER_EMAIL       || '';
  const userPassword   = eventData.USER_PASSWORD || json.USER_PASSWORD  || '';
  const purchaseOption = (json.PURCHASE_OPTION || 'ppv').toLowerCase();
  const baseUrl        = eventData.BASE_URL;
  const variantConfig  = json.variants;
  const pagesConfig    = json.pages;

  console.log(`\n🔀 Flow      : ${FLOW}`);
  console.log(`🌍 Region    : ${REGION}`);
  console.log(`🥊 Event     : ${eventData.PPV_NAME}`);
  console.log(`💎 Tier      : ${tier}`);
  console.log(`📋 Rate Plan : ${ratePlan}`);
  console.log(`📁 Config    : ${EVENT_CONFIG}`);
  console.log(`🔗 Base URL  : ${baseUrl}\n`);

  // ── Clean context ─────────────────────────────────────────────
  const context = await browser.newContext({
    viewport:      null,
    colorScheme:   'dark',
    reducedMotion: 'no-preference',
    recordVideo: {
      dir:  'test-results/videos/',
      size: { width: 1920, height: 1080 },
    },
  });

  await context.addInitScript(() => {
    try {
      localStorage.setItem('randomABPoint', Math.random().toString());
    } catch {}
  });

  const page    = await context.newPage();
  const results: any[] = [];

  // ── clickAndWaitForNav ────────────────────────────────────────
  const clickAndWaitForNav = async (p: any, btn: any, label: string) => {
    console.log(`clicking: ${label}`);
    const before = p.url();
    await safeScrollToElement(p, btn);
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

  // ── detectPageType ────────────────────────────────────────────
  const detectPageType = async (
    p: any,
    pagesConfig: Record<string, { detection: string }>
  ): Promise<'ppv' | 'plan' | 'payment' | 'confirmation' | 'unknown'> => {
    if (!p || p.isClosed()) return 'unknown';
    const url = p.url();

    if (url.includes('paymentDetails'))           return 'payment';
    if (url.includes('upsellTierShown=true'))     return 'ppv';
    if (url.includes('upsellTierSkipped=true'))   return 'plan';
    if (url.includes('upsellTierSelected=true') &&
        url.includes('PlanDetails'))              return 'plan';
if (url.includes('UpgradePlan') ||
    (url.includes('UpgradeTier') &&
     !url.includes('isUpgradeTierFlow')))     return 'confirmation';

    const lower = await p.locator('body')
      .innerText({ timeout: 2000 })
      .then((t: string) => t.toLowerCase())
      .catch(() => '');

    if (lower.includes('subscribe without a pay-per-view')) return 'ppv';
    if (lower.includes('choose your plan'))                 return 'ppv';
    if (lower.includes('choose how to buy'))                return 'ppv';
    if (lower.includes("choose a plan that's right"))       return 'plan';
    if (lower.includes('your plan will be changed'))        return 'confirmation';

    return 'unknown';
  };

  try {
    // ══════════════════════════════════════════════════════════════
    // STEP 1 — SIGN IN
    // ══════════════════════════════════════════════════════════════
    const signinUrl = `${baseUrl}/signin`;
    console.log(`\n🔐 Navigating to: ${signinUrl}`);
    await page.goto(signinUrl, { waitUntil: 'domcontentloaded' });

    await page.waitForURL(/emailDetails/, { timeout: 10000 }).catch(() => {});
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    console.log(`📍 Landed on: ${page.url()}`);

    console.log('🍪 Waiting for cookie banner...');
    try {
      await page.waitForSelector('#onetrust-accept-btn-handler', {
        state:   'visible',
        timeout: 10000,
      });
      await page.locator('#onetrust-accept-btn-handler').click({ force: true });
      await page.waitForSelector('#onetrust-banner-sdk', {
        state:   'hidden',
        timeout: 5000,
      }).catch(() => {});
      console.log('🍪 ✅ Cookies accepted');
    } catch {
      console.log('ℹ️  No cookie banner appeared');
    }

    console.log(`📧 Entering email: ${userEmail}`);
    const emailInput = page.locator(
      'input[type="email"], '           +
      'input[name="email"], '           +
      'input[placeholder*="email" i]'
    ).first();
    await emailInput.waitFor({ state: 'visible', timeout: 10000 });
    await emailInput.fill(userEmail);

    const emailNextBtn = page.locator(
      'button:has-text("Next"), '     +
      'button:has-text("Continue"), ' +
      'button[type="submit"]'
    ).first();
    await clickAndWaitForNav(page, emailNextBtn, 'Email Next');

    console.log('🔑 Entering password...');
    const passwordInput = page.locator(
      'input[type="password"], ' +
      'input[name="password"]'
    ).first();
    await passwordInput.waitFor({ state: 'visible', timeout: 15000 });
    await passwordInput.fill(userPassword);

    const signInBtn = page.locator(
      'button:has-text("Sign in"), ' +
      'button:has-text("Log in"), '  +
      'button:has-text("Sign In"), ' +
      'button[type="submit"]'
    ).first();
    await clickAndWaitForNav(page, signInBtn, 'Sign In');

    await page.waitForURL(/\/home/i, { timeout: 20000 }).catch(() => {});
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    console.log(`✅ Signed in — on: ${page.url()}`);

    // ══════════════════════════════════════════════════════════════
    // STEP 2 — DISMISS HOME PAGE POPUP
    // ══════════════════════════════════════════════════════════════
    const homePage = new HomePage(page, baseUrl);
    await homePage.dismissPopup();

    // ══════════════════════════════════════════════════════════════
    // STEP 3 — NAVIGATE TO MY ACCOUNT
    // ══════════════════════════════════════════════════════════════
    await homePage.navigateToMyAccount();

    console.log('⏳ Waiting for My Account page to fully render...');

    // Wait for ANY account content — whichever appears first
    const accountFound = await Promise.race([
      page.waitForSelector('button:has-text("Resubscribe")',        { state: 'visible', timeout: 15000 }).then(() => 'Resubscribe').catch(() => null),
      page.waitForSelector('button:has-text("Upgrade now")',        { state: 'visible', timeout: 15000 }).then(() => 'Upgrade now').catch(() => null),
      page.waitForSelector('button:has-text("Manage subscription")',{ state: 'visible', timeout: 15000 }).then(() => 'Manage subscription').catch(() => null),
      page.waitForSelector('button:has-text("Manage")',             { state: 'visible', timeout: 15000 }).then(() => 'Manage').catch(() => null),
      page.waitForSelector('button:has-text("Buy now")',            { state: 'visible', timeout: 15000 }).then(() => 'Buy now').catch(() => null),
      page.waitForSelector('[data-testid*="subscription" i]',       { state: 'visible', timeout: 15000 }).then(() => 'subscription testid').catch(() => null),
    ]);
    if (accountFound) {
      console.log(`✅ Account content found: ${accountFound}`);
      // FIX: Wait a bit more for full page render including PPV section
      // IN freemium loads subscription status fast but PPV section loads later
      await page.waitForTimeout(1500);
    } else {
      console.log('⚠️  Account content not found in time');
    }

    // ══════════════════════════════════════════════════════════════
    // STEP 4 — VALIDATE MY ACCOUNT PAGE
    // ══════════════════════════════════════════════════════════════
    console.log('\n📋 Validating My Account page...');

    await page.evaluate(() => {
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
    });

    const myAccountData = getMyAccountData();
    await validateVariant(
      page, 'myaccount', myAccountData, results, eventData, 'My Account'
    );

    await page.evaluate(() => {
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
    });

    // ══════════════════════════════════════════════════════════════
    // STEP 4b — EXTRACT DYNAMIC USER DATA FROM MY ACCOUNT
    // Reads first name, last name, returning status from live page
    // Injects into eventData for downstream validation
    // ══════════════════════════════════════════════════════════════
    const myAccountPage = new MyAccountPage(page);

    const isReturning             = await myAccountPage.isReturningUser();
    const { firstName, lastName } = await myAccountPage.getUserName();

    console.log(`👤 Is returning user : ${isReturning}`);
    console.log(`👤 First name        : "${firstName}"`);
    console.log(`👤 Last name         : "${lastName}"`);

 eventData.FIRST_NAME = firstName;
eventData.LAST_NAME  = lastName;
eventData['FIRST_NAME'] = firstName;
eventData['LAST_NAME']  = lastName;
    eventData.FULL_NAME         = `$${firstName} $${lastName}`.trim();
    eventData.IS_RETURNING_USER = isReturning ? 'true' : 'false';
    eventData.WELCOME_BACK_TEXT = isReturning && firstName
      ? `Hi ${firstName}, welcome back!`
      : '';
  eventData.SIGNED_IN_AS_TEXT = firstName
  ? `Signed in as ${firstName} ${lastName}`.trim()
  : '';

    // Keep UPPER_CASE versions in sync
    eventData['FIRST_NAME']        = eventData.FIRST_NAME;
    eventData['LAST_NAME']         = eventData.LAST_NAME;
    eventData['FULL_NAME']         = eventData.FULL_NAME;
    eventData['IS_RETURNING_USER'] = eventData.IS_RETURNING_USER;
    eventData['WELCOME_BACK_TEXT'] = eventData.WELCOME_BACK_TEXT;
    eventData['SIGNED_IN_AS_TEXT'] = eventData.SIGNED_IN_AS_TEXT;

    console.log(`👤 Welcome back text : "${eventData.WELCOME_BACK_TEXT}"`);
    console.log(`👤 Signed in as      : "${eventData.SIGNED_IN_AS_TEXT}"`);

    // ══════════════════════════════════════════════════════════════
    // STEP 5 — HANDLE ULTIMATE TIER
    // PPV shows "Purchased" or "Included" — no purchase flow
    // ══════════════════════════════════════════════════════════════
    if (tier === 'ultimate') {
      console.log('\n💎 Ultimate tier — checking PPV status...');

      await myAccountPage.scrollToPPVSection();

      const ppvStatus = await myAccountPage.isPPVPurchased(eventData.PPV_NAME);
      console.log(`✅ PPV Status: "${ppvStatus}"`);

      results.push({
        page:     'My Account',
        variant:  'ultimate',
        tier,
        ratePlan,
        field:    'PPV Status',
        expected: eventData.PPV_STATUS || 'Purchased',
        actual:   ppvStatus,
        status:   ppvStatus.toLowerCase().includes(
          (eventData.PPV_STATUS || 'Purchased').toLowerCase()
        ) ? 'PASS' : 'FAIL',
      });

      const { excelPath, videoPath } = await writeResults(results);
      displayResultsTable(results, 'ultimate', {
        event:     eventData.PPV_NAME,
        region:    REGION,
        excelPath,
        videoPath,
      });
      return;
    }

    // ══════════════════════════════════════════════════════════════
    // STEP 5b — SCROLL TO PPV SECTION
    // Only for freemium / standard tiers
    // ══════════════════════════════════════════════════════════════
    await myAccountPage.scrollToPPVSection();

    // ══════════════════════════════════════════════════════════════
    // STEP 6 — CLICK BUY NOW
    // ══════════════════════════════════════════════════════════════
    console.log(`\n💳 Clicking Buy Now for: ${eventData.PPV_NAME}`);
    await myAccountPage.clickBuyNow(eventData.PPV_NAME);

    await page.waitForLoadState('domcontentloaded').catch(() => {});
    const postClickUrl = page.url();
    console.log(`✅ Post Buy Now URL: ${postClickUrl}`);

    // ══════════════════════════════════════════════════════════════
    // STEP 7 — DETECT FLOW FROM URL
    //
    // freemium/returning:
    //   → SEE DAZN PLANS clicked
    //   → /signup?contextualPpvId=... (no upsellTierShown param)
    //   → PPV page → Plan (standard) → Payment
    //
    // standard:
    //   → Buy Now clicked directly (no modal)
    //   → /signup?contextualPpvId=...&upsellTierShown=true
    //   → Choose How To Buy → PPV Payment OR Plan (ultimate) → Confirmation
    // ══════════════════════════════════════════════════════════════
    const bodyText = await page.locator('body')
      .innerText({ timeout: 3000 })
      .then(t => t.toLowerCase())
      .catch(() => '');

const isSignupPPVFlow =
  postClickUrl.includes('/signup') &&
  postClickUrl.includes('contextualPpvId') &&
  !postClickUrl.includes('upsellTierShown=true');

const isChooseHowToBuy =
  postClickUrl.includes('upsellTierShown=true') ||
  postClickUrl.includes('/addon/purchase') ||  // ← US active standard
  bodyText.includes('choose how to buy');

    console.log(`\n🔀 Post-click detection:`);
    console.log(`   tier             : ${tier}`);
    console.log(`   isSignupPPVFlow  : ${isSignupPPVFlow}`);
    console.log(`   isChooseHowToBuy : ${isChooseHowToBuy}`);
    console.log(`   purchaseOption   : ${purchaseOption}`);
    console.log(`   isReturning      : ${isReturning}`);

    // ══════════════════════════════════════════════════════════════
    // FLOW A — FREEMIUM / RETURNING USER
    // Same pages as new user signup flow
    // PPV page → Plan page (standard) → Payment page
    // Welcome Back rows validated only if isReturning=true
    // Saved Card + Signed In As + Log Out validated for all myaccount users
    // ══════════════════════════════════════════════════════════════
    if (isSignupPPVFlow) {
      console.log('\n📋 Flow A: Freemium/Returning — signup flow');

      await setupPage(page);

      const variant = await detectVariant(page, variantConfig).catch(() => 'variant1');
      console.log('🎯 variant:', variant);

      const currentVariantConfig = variantConfig?.[variant];
      let ppvValidated  = false;
      let planValidated = false;
      let stuckCount    = 0;

      for (let step = 0; step < 10; step++) {

        if (page.isClosed()) throw new Error('❌ Page closed unexpectedly');

        const pageType = await detectPageType(page, pagesConfig);
console.log(`\nstep ${step + 1} → pageType: ${pageType} | url: ${page.url()}`);
        // ── PAYMENT ───────────────────────────────────────────
        if (pageType === 'payment') {
          console.log('💳 Payment page');
          console.log('\n📋 Validating Payment page...');

          const paymentData = getPaymentDataByTierAndPlan('standard', ratePlan);
          console.log(`📊 Payment rows: ${paymentData.length}`);

         const paymentPage = new PaymentPage(page);

          if (await paymentPage.isPaymentPage()) {
            // Returning users → validate Saved Card (myaccount) + Signed In As + Log Out (returning)
            // New freemium    → these rows excluded (not returning)
            // FIX: Pass 'returning' flow for returning users to include Signed In As + Log Out
            // 'myaccount' flow includes Saved Card Present
            // Both flows needed — validate twice or use combined flow
            if (isReturning) {
              // Validate myaccount rows (Saved Card)
              await paymentPage.validate(paymentData, results, eventData, FLOW);
              // Validate returning rows (Signed In As, Log Out) — avoid duplicates
              const returningData = paymentData.filter((r: any) => {
                const rf = (r.Flow || '').trim().toLowerCase();
                return rf === 'returning';
              });
              if (returningData.length > 0) {
                await paymentPage.validate(returningData, results, eventData, 'returning');
              }
            } else {
              await paymentPage.validate(paymentData, results, eventData, undefined);
            }
          }
          break;
        }

        // ── PPV PAGE ──────────────────────────────────────────
// ── PPV PAGE ──────────────────────────────────────────
        if (pageType === 'ppv') {
          console.log('👉 PPV page');
          stuckCount = 0;

          if (!ppvValidated) {
            try {
              const ppvData = getPPVDataByVariant(variant);
              console.log(`📊 PPV rows: ${ppvData.length}`);

              // Returning users → validate Welcome Back rows
              // New freemium   → Welcome Back rows excluded
              const ppvFlow = isReturning ? 'returning' : undefined;
await validateVariant(
  page, variant, ppvData, results, eventData, 'PPV', ppvFlow
);
            } catch (e: any) {
              console.warn('⚠️  PPV validation error:', e.message);
            }
            ppvValidated = true;
          }

          if (purchaseOption === 'ultimate') {
            const ultimateCard = page.locator(
              '[class*="upsell" i], '        +
              '[class*="ultimate" i], '      +
              'label:has-text("DAZN Ultimate")'
            ).first();

            if (await ultimateCard.isVisible({ timeout: 3000 }).catch(() => false)) {
              await safeScrollToElement(page, ultimateCard);
              await ultimateCard.click({ force: true }).catch(() => {});
              console.log('✅ Clicked Ultimate card');
            }

            const btn = page.locator(
              'button:has-text("Continue with DAZN Ultimate")'
            ).first();
            await btn.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
            await clickAndWaitForNav(page, btn, 'PPV Continue Ultimate');

          } else {
            const ppvRadio = page.locator('input[type="radio"]').first();
            if (await ppvRadio.isVisible({ timeout: 1500 }).catch(() => false)) {
              await safeScrollToElement(page, ppvRadio);
              await ppvRadio.click({ force: true }).catch(() => {});
            }

            const ctaText = currentVariantConfig?.ctaText || 'Continue';
            const btn = page.locator(`button:has-text("${ctaText}")`).first();
            await btn.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
            await clickAndWaitForNav(page, btn, `PPV Continue (${variant})`);
          }

          // Light wait — no full setupPage needed in loop
          await page.waitForLoadState('domcontentloaded').catch(() => {});
          continue;
        }

        // ── PLAN PAGE ─────────────────────────────────────────
     // ── PLAN PAGE ─────────────────────────────────────────
// ── PLAN PAGE ─────────────────────────────────────────
        if (pageType === 'plan') {
          console.log(`👉 DAZN Plan page`);
          stuckCount = 0;

          if (!planValidated) {
            try {
              await page.waitForSelector(
                'input[type="radio"]',
                { timeout: 5000 }
              ).catch(() => {});

              const originalTier = eventData.TIER;
              eventData.TIER     = 'standard';
              eventData['TIER']  = 'standard';

              const planData = getPlanDataByTier('standard');
              const planFlow = isReturning ? 'returning' : undefined;
              console.log(`📊 Plan rows: ${planData.length}`);

              await validateVariant(
                page, 'plan', planData, results, eventData, 'DAZN Plan', planFlow
              );

              eventData.TIER     = originalTier;
              eventData['TIER']  = originalTier;

            } catch (e: any) {
              console.warn('⚠️  Plan validation error:', e.message);
            }
            planValidated = true;
          }

          if (ratePlan === 'annual pay monthly') {
            const annualCard = page.locator(
              'label:has-text("Annual - pay over time"), ' +
              'label:has-text("Annual - Pay Monthly")'
            ).first();

            if (await annualCard.isVisible({ timeout: 3000 }).catch(() => false)) {
              await safeScrollToElement(page, annualCard);
              await annualCard.click({ force: true }).catch(() => {});
              console.log('✅ Clicked Annual card');
            } else {
              const radio = page.locator('input[type="radio"]').nth(1);
              if (await radio.isVisible({ timeout: 1500 }).catch(() => false)) {
                await safeScrollToElement(page, radio);
                await radio.click({ force: true }).catch(() => {});
                console.log('✅ Selected Annual radio nth(1)');
              }
            }
          } else {
            const trialRadio = page.locator('input[type="radio"]').first();
            if (await trialRadio.isVisible({ timeout: 1500 }).catch(() => false)) {
              await safeScrollToElement(page, trialRadio);
              await trialRadio.click({ force: true }).catch(() => {});
              console.log('✅ Selected Trial radio');
            }
          }

          const planBtn = page.locator(
            'button:has-text("Continue with PPV + 7-day free trial"), ' +
            'button:has-text("Continue with PPV"), '                    +
            'button:has-text("Continue")'
          ).first();
          await planBtn.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
          await clickAndWaitForNav(page, planBtn, 'Plan Continue');

          await page.waitForLoadState('domcontentloaded').catch(() => {});
          continue;
        }

        // ── CONFIRMATION ──────────────────────────────────────
        if (pageType === 'confirmation') {
          console.log('✅ Upgrade confirmation page');
          const confirmData = getUpgradeConfirmationData(ratePlan);
          await validateVariant(
            page, 'confirmation', confirmData, results, eventData, 'Upgrade Confirmation'
          );
          break;
        }

        // ── UNKNOWN ───────────────────────────────────────────
        stuckCount++;
        console.log(`⚠️  Unknown page — waiting... (${stuckCount}/5)`);
        await sleep(800);
        if (stuckCount >= 5) {
          throw new Error(`❌ Flow stuck on unknown page.\nURL: ${page.url()}`);
        }
      }

    // ══════════════════════════════════════════════════════════════
    // FLOW B — ACTIVE STANDARD USER
    // Choose How To Buy (variant1 always)
    // PPV only:  → PPV Payment page
    // Ultimate:  → DAZN Plan page (ultimate) → Upgrade Confirmation
    // ══════════════════════════════════════════════════════════════
  // ── FLOW B — ACTIVE STANDARD USER ────────────────────────────
} else if (isChooseHowToBuy) {
  console.log('\n📋 Flow B: Active Standard — Choose How To Buy');

  // Wait for page to fully load
  await page.waitForSelector(
    '[class*="addon" i], [class*="purchase" i], input[type="radio"]',
    { state: 'visible', timeout: 8000 }
  ).catch(() => {});

  // ✅ Validate Choose How To Buy — single validation
  const chooseBuyData = getChooseHowToBuyData();
  console.log(`📊 Choose How To Buy rows: ${chooseBuyData.length}`);
  await validateVariant(
    page, 'choosebuy', chooseBuyData, results, eventData, 'Choose How To Buy'
  );

  if (purchaseOption === 'ultimate') {
    // ── Ultimate upgrade path ─────────────────────────────────
    console.log('\n💎 Selecting DAZN Ultimate...');

    const ultimateCard = page.locator(
      '[class*="upsell" i], '        +
      '[class*="ultimate" i], '      +
      'label:has-text("DAZN Ultimate")'
    ).first();

    if (await ultimateCard.isVisible({ timeout: 3000 }).catch(() => false)) {
      await safeScrollToElement(page, ultimateCard);
      await ultimateCard.click({ force: true }).catch(() => {});
      console.log('✅ Selected DAZN Ultimate');
    }

    const ultimateCta = page.locator(
      'button:has-text("Continue with DAZN Ultimate"), ' +
      'button:has-text("Continue")'
    ).first();
    await ultimateCta.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
    await clickAndWaitForNav(page, ultimateCta, 'Continue with DAZN Ultimate');

    // ── Validate DAZN Plan page (Ultimate) ─────────────────────
    console.log('\n📋 Validating DAZN Plan page (Ultimate)...');
    await page.waitForSelector(
      'input[type="radio"]',
      { timeout: 5000 }
    ).catch(() => {});

const originalTier = eventData.TIER;
eventData.TIER     = 'ultimate';
eventData['TIER']  = 'ultimate';

const planData = getPlanDataByTier('ultimate');
console.log(`📊 Plan rows: ${planData.length}`);
await validateVariant(
  page, 'plan', planData, results, eventData, 'DAZN Plan'
);

// Restore
eventData.TIER     = originalTier;
eventData['TIER']  = originalTier;

    // Select rate plan
    if (ratePlan === 'annual pay monthly') {
      const radio = page.locator('input[type="radio"]').first();
      if (await radio.isVisible({ timeout: 1500 }).catch(() => false)) {
        await safeScrollToElement(page, radio);
        await radio.click({ force: true }).catch(() => {});
        console.log('✅ Selected Annual Pay Monthly');
      }
    } else if (ratePlan === 'annual pay upfront') {
      const radio = page.locator('input[type="radio"]').nth(1);
      if (await radio.isVisible({ timeout: 1500 }).catch(() => false)) {
        await safeScrollToElement(page, radio);
        await radio.click({ force: true }).catch(() => {});
        console.log('✅ Selected Annual Pay Upfront');
      }
    }

    const planBtn = page.locator(
      'button:has-text("Continue with DAZN Ultimate"), ' +
      'button:has-text("Continue")'
    ).first();
    await planBtn.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
    await clickAndWaitForNav(page, planBtn, 'Plan Continue');

    // ── Handle Phone Number Collection (US specific) ───────────
    const currentUrl = page.url();
    if (currentUrl.includes('PhoneNumberCollection')) {
      console.log('📱 Phone number collection page — skipping...');
      const skipBtn = page.locator(
        'button:has-text("Skip"), '    +
        'button:has-text("Not now"), ' +
        'button:has-text("Continue")'
      ).first();
      if (await skipBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await clickAndWaitForNav(page, skipBtn, 'Skip phone collection');
        console.log('✅ Skipped phone collection');
      }
    }

    // ── Validate Upgrade Confirmation ──────────────────────────
    console.log('\n📋 Validating Upgrade Confirmation page...');
    const confirmData = getUpgradeConfirmationData(ratePlan);
    console.log(`📊 Confirmation rows: ${confirmData.length}`);
    await validateVariant(
      page, 'confirmation', confirmData, results, eventData, 'Upgrade Confirmation'
    );

  } else {
    // ── PPV only path ──────────────────────────────────────────
    console.log('\n🥊 Selecting PPV only...');

    const ppvCta = page.locator(
      `button:has-text("Continue with ${eventData.PPV_NAME} only"), ` +
      `button:has-text("Continue with Wardley"), `                     +
      `button:has-text("Continue")`
    ).first();
    await ppvCta.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
    await clickAndWaitForNav(page, ppvCta, 'PPV Only Continue');

    await setupPage(page);

    // ── Validate PPV Payment ───────────────────────────────────
    console.log('\n📋 Validating PPV Payment page...');
    await page.waitForSelector(
      'text=/Today you pay|payment/i',
      { timeout: 10000 }
    ).catch(() => {});

    const ppvPaymentData = getPPVPaymentData();
    console.log(`📊 PPV Payment rows: ${ppvPaymentData.length}`);
    await validateVariant(
      page, 'ppvpayment', ppvPaymentData, results, eventData, 'PPV Payment', FLOW
    );
  }

    }

    // ══════════════════════════════════════════════════════════════
    // STEP 8 — RESULTS
    // ══════════════════════════════════════════════════════════════
    const { excelPath, videoPath } = await writeResults(results);
    displayResultsTable(results, tier, {
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