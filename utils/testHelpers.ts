import fs from 'fs';

import path from 'path';

// ─────────────────────────────────────────────────────────────────
// FIND CONFIG FILE recursively under config/
// ─────────────────────────────────────────────────────────────────
export function findConfig(dir: string, filename: string): string | null {
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

// ─────────────────────────────────────────────────────────────────
// LOAD EVENT CONFIG — simple JSON require with recursive search
// NOTE: buildEventData() handles base config merging downstream
// so this just loads the raw flow config
// ─────────────────────────────────────────────────────────────────
import { loadEventConfig as delegateLoad } from './configLoader';

export function loadEventConfig(eventConfig?: string, planConfig?: string): Record<string, any> {
  return delegateLoad(eventConfig, planConfig);
}

// ─────────────────────────────────────────────────────────────────
// SAFE SCROLL TO ELEMENT
// ─────────────────────────────────────────────────────────────────
export async function safeScrollToElement(page: any, locator: any): Promise<void> {
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
  } catch (e) {
    console.warn(`⚠️  safeScrollToElement failed: ${e instanceof Error ? e.message : 'unknown error'}`);
  }
}

// ─────────────────────────────────────────────────────────────────
// CLICK AND WAIT FOR NAVIGATION
// ─────────────────────────────────────────────────────────────────
export async function clickAndWaitForNav(
  page: any,
  btn: any,
  label: string
): Promise<void> {
  console.log(`clicking: ${label}`);
  const before = page.url();
  await safeScrollToElement(page, btn);
  await btn.waitFor({ state: 'visible', timeout: 5000 }).catch(() => { });
  await btn.click({ force: true });
  try {
    await page.waitForURL(
      (url: URL) => url.toString() !== before,
      { timeout: 5000 }
    );
    console.log(`navigated to: ${page.url()}`);
  } catch {
    await page.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => { });
    console.log(`navigated to: ${page.url()}`);
  }
}

// ─────────────────────────────────────────────────────────────────
// CREATE FRESH BROWSER CONTEXT (new user flow)
// ─────────────────────────────────────────────────────────────────
export async function createFreshContext(browser: any): Promise<{ context: any; page: any }> {
  const context = await browser.newContext({
    viewport: null,
    colorScheme: 'dark',
    reducedMotion: 'no-preference',
    recordVideo: {
      dir: 'test-results/videos/',
      size: { width: 1920, height: 1080 },
    },
  });



  await context.addInitScript(() => {
    try {
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem('randomABPoint', Math.random().toString());
    } catch { }
  });

  const page = await context.newPage();
  return { context, page };
}

// ─────────────────────────────────────────────────────────────────
// LOG VIDEO PATH
// ─────────────────────────────────────────────────────────────────
export async function logVideoPath(page: any): Promise<void> {
  try {
    const videoPath = await page.video()?.path();
    if (videoPath) console.log(`🎥 Video: ${videoPath}`);
  } catch { }
}

import { validateVariant } from '../flows/validateVariant';
import { getHomeOfBoxingData, getHomePageData, getPaywallData } from './excelReader';

// ─────────────────────────────────────────────────────────────────
// HANDLE PAYWALL (VALIDATION & OPTIONAL CLICK THROUGH)
// ─────────────────────────────────────────────────────────────────
export async function handlePaywall(
  page: any,
  results: any[],
  eventData: any,
  source: string,
  clickBuyNow: boolean,
  paywallRules?: any[]
): Promise<boolean> {
  const src = (source || '').toLowerCase();
  const entryUrl = page.url();

  // ── Debug header ──
  console.log('\n══════════════════════════════════════════════════════');
  console.log('  🔒 PAYWALL CHECK');
  console.log('══════════════════════════════════════════════════════');
  console.log(`  Source:              ${source}`);
  console.log(`  Current URL:         ${entryUrl}`);
  console.log(`  clickBuyNow:         ${clickBuyNow}`);
  console.log(`  paywallRules passed: ${paywallRules ? paywallRules.length : 'none'}`);
  console.log('──────────────────────────────────────────────────────');

  // 1. Skip check for landing-page-dont-miss flows since they are cards, not tiles (no paywall displayed)
  if (src.includes('dont-miss') && !src.includes('home-') && !src.includes('sport')) {
    console.log('ℹ️ [Paywall Check] Skipping paywall check for standard landing-page-dont-miss (direct card flow)');
    console.log('══════════════════════════════════════════════════════\n');
    return false;
  }

  // 2. Skip validation if already validated to avoid duplicate errors
  const alreadyValidated = results.some(r => r.page === 'Paywall');
  if (alreadyValidated && !clickBuyNow) {
    console.log('ℹ️ [Paywall Check] Paywall already validated. Skipping.');
    console.log('══════════════════════════════════════════════════════\n');
    return true;
  }

  // 3. Skip check if page has already navigated to signup, PlanDetails, payment, or checkout
  const currentUrl = page.url();
  if (
    currentUrl.includes('signup') ||
    currentUrl.includes('PlanDetails') ||
    currentUrl.includes('payment') ||
    currentUrl.includes('checkout')
  ) {
    console.log('⚠️ [Paywall Check] EARLY RETURN — page already on onboarding/checkout.');
    console.log(`  URL: ${currentUrl}`);
    console.log('  This means Buy Now was clicked BEFORE handlePaywall() was called.');
    console.log('══════════════════════════════════════════════════════\n');
    return false;
  }

  console.log(`🔍 [Paywall Check] Checking if a paywall is visible (clickBuyNow=${clickBuyNow})...`);

  const modalSelectors = [
    '[role="dialog"]',
    '[aria-modal="true"]',
    '[class*="modal-content" i]',
    '[class*="modal-card" i]',
    '[class*="modal-body" i]',
    '[class*="dialog-box" i]',
    '[class*="modal" i]:not(body):not(html):not([class*="open"]):not([class*="active"]):not([class*="wrapper"]):not([class*="backdrop"]):not([class*="overlay"]):not([class*="mask"]):not([class*="container"]):not([class*="layout"])',
    '[class*="popup" i]:not(body):not(html):not([class*="open"]):not([class*="active"]):not([class*="wrapper"]):not([class*="backdrop"]):not([class*="overlay"]):not([class*="mask"]):not([class*="container"]):not([class*="layout"])',
    '[class*="Dialog" i]:not(body):not(html)',
    '.Modal:not(body):not(html)',
  ];

  let foundModal: any = null;

  // Wait up to 2.5s for a modal with a CTA to appear
  const ctaSelector = [
    'button:has-text("Buy now")', 'a:has-text("Buy now")', 'button:has-text("Buy Now")',
    'button:has-text("Subscribe")', 'a:has-text("Subscribe")', 'button:has-text("Continue")', 'a:has-text("Continue")',
    'button:has-text("Sign up")', 'a:has-text("Sign up")', 'button:has-text("Sign up for free")', 'a:has-text("Sign up for free")',
    'button:has-text("Start watching")', 'a:has-text("Start watching")', 'button:has-text("Get started")', 'a:has-text("Get started")'
  ].join(', ');

  for (const selector of modalSelectors) {
    const modalLocator = page.locator(selector).filter({ has: page.locator(ctaSelector) }).first();
    try {
      await modalLocator.waitFor({ state: 'visible', timeout: 2500 });
      if (await modalLocator.isVisible().catch(() => false)) {
        foundModal = modalLocator;
        break;
      }
    } catch {
      // Not found with this selector, try next
    }
  }

  // Check if page navigated during the wait
  if (!foundModal) {
    const intermediateUrl = page.url();
    if (
      intermediateUrl.includes('signup') ||
      intermediateUrl.includes('PlanDetails') ||
      intermediateUrl.includes('payment') ||
      intermediateUrl.includes('checkout')
    ) {
      console.log('⚠️ [Paywall Check] Background navigation detected during modal wait.');
      console.log(`  URL now: ${intermediateUrl}`);
      console.log('══════════════════════════════════════════════════════\n');
      return false;
    }
  }

  if (!foundModal) {
    console.log('⚠️ [Paywall Check] Paywall modal NOT found after checking all selectors.');
    console.log(`  URL now: ${page.url()}`);
  }

  if (foundModal) {
    console.log('📢 [handlePaywall] paywall locator found');
    console.log('📢 [handlePaywall] paywall visible');
    console.log('✅ [Paywall Check] Paywall detected!');

    if (!alreadyValidated) {
      // Load paywall validation rules (use provided paywallRules or read from sheet)
      let rules = paywallRules;
      if (!rules || rules.length === 0) {
        try {
          rules = getPaywallData();
        } catch (err: any) {
          console.warn(`⚠️ [Paywall Check] Could not load getPaywallData: ${err.message}`);
        }
      }

      console.log(`📢 [handlePaywall] paywallRules length: ${rules ? rules.length : 0}`);

      if (rules && rules.length > 0) {
        // Run validations against scoped paywall snapshot
        try {
          console.log('📢 [handlePaywall] validateVariant called');
          await validateVariant(page, 'paywall', rules, results, eventData, 'Paywall', undefined, foundModal);
          console.log(`📢 [handlePaywall] number of validations executed: ${rules.length}`);
          console.log('✅ [Paywall Check] Paywall validations completed successfully.');
        } catch (err: any) {
          console.warn(`⚠️ [Paywall Check] Paywall validation error/warning: ${err.message}`);
        }
      } else {
        console.warn('⚠️ [Paywall Check] No paywall rules available. Skipping validations.');
      }
    }

    if (clickBuyNow) {
      // Click "Buy now" / CTA inside the paywall container
      console.log('💳 [Paywall Check] Clicking "Buy now" / CTA inside paywall...');
      
      // Look for interactive elements with the text pattern first
      let buyNowBtn = foundModal.locator('a, button, [role="button"]')
        .filter({ hasText: /buy now|subscribe|continue|sign up|start watching|get started/i })
        .first();

      let visible = await buyNowBtn.isVisible({ timeout: 1500 }).catch(() => false);
      if (!visible) {
        // Fallback: search for any element containing the text
        buyNowBtn = foundModal.locator('*')
          .filter({ hasText: /buy now|subscribe|continue|sign up|start watching|get started/i })
          .first();
      }

      console.log('📌 [Paywall Check] Resolved CTA locator inside paywall. Attempting click...');
      
      try {
        await buyNowBtn.click({ force: true, timeout: 5000 });
        console.log('✅ [Paywall Check] Successfully clicked CTA button via Playwright click');
      } catch (clickErr: any) {
        console.warn(`⚠️ [Paywall Check] Playwright click failed: ${clickErr.message}. Trying JS click...`);
        const handle = await buyNowBtn.elementHandle().catch(() => null);
        if (handle) {
          await page.evaluate((el: any) => el.click(), handle).catch((evalErr: any) => {
            console.error(`❌ [Paywall Check] JS click failed: ${evalErr.message}`);
          });
          console.log('✅ [Paywall Check] Successfully clicked CTA button via JS click');
        } else {
          console.error('❌ [Paywall Check] Could not get elementHandle for CTA button to execute JS click');
        }
      }

      // Wait for the navigation to kick in
      await page.waitForURL(
        (url: URL) =>
          url.toString().includes('PlanDetails') ||
          url.toString().includes('signup') ||
          url.toString().includes('payment') ||
          url.toString().includes('checkout'),
        { timeout: 10000 }
      ).catch(() => {
        console.log(`⚠️ [Paywall Check] Timeout waiting for onboarding pages. Current URL: ${page.url()}`);
      });
    }

    console.log('  Paywall handled:     ✅ YES');
    console.log(`  Navigation URL:      ${page.url()}`);
    console.log('══════════════════════════════════════════════════════\n');
    return true;
  } else {
    console.log('  Paywall handled:     ❌ NO');
    console.log('══════════════════════════════════════════════════════\n');
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────
// ASSERT COUNTRY MATCH
// ─────────────────────────────────────────────────────────────────
export function assertCountryMatch(page: any, region: string): void {
  if (process.env.BYPASS_COUNTRY_CHECK === 'true') {
    console.log(`⚠️ [Country Match Check] Bypassed country match assertion (requested region: "${region}").`);
    return;
  }
  const url = page.url();
  const regionLower = region.toLowerCase();

  let matches = false;
  if (regionLower === 'gb') {
    matches = url.toLowerCase().includes('-gb') || url.toLowerCase().includes('-uk') || url.toLowerCase().includes('-gg') || url.toLowerCase().includes('-je');
  } else {
    matches = url.toLowerCase().includes(`-${regionLower}`);
  }

  if (!matches) {
    throw new Error(`❌ [Country Match Check] Country mismatch: expected region "${region}" but URL is "${url}". Please ensure your VPN is connected to the correct region.`);
  }
  console.log(`✅ [Country Match Check] URL matches expected region "${region}": ${url}`);
}