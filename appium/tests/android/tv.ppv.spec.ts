// WebdriverIO injects `browser` as a global at runtime.
// eslint-disable-next-line no-var
declare var browser: any;

import { execSync } from 'child_process';
import * as path from 'path';
import { writeHandoffUrl, readHandoffUrl, clearHandoffUrl } from '../../utils/handoff';
import { prepareAndroidApp } from '../../utils/androidSetup';
import { loadEventConfig } from '../../utils/eventLoader';
import { openSchedulePPVPaywall } from '../../pages/android/AndroidSchedulePage';
import { openSearchResultPaywall } from '../../pages/android/AndroidSearchPage';
import { openHomeBannerPaywall, openGenericPPVPaywall } from '../../pages/android/AndroidHomePage';
import { openLandingBannerPaywall } from '../../pages/android/AndroidLandingPage';
import { copyImmediateCheckoutUrl } from '../../pages/android/AndroidPaywallPage';
import { captureCheckoutUrl } from '../../pages/android/AndroidBasePage';
import { primeAndroidTvFocus, sendTvKeyevent, TV_KEYCODES } from '../../utils/androidTvControls';
import { decodeCheckoutUrlFromQr } from '../../utils/qrBridge';

const event = loadEventConfig();
const PPV_NAME = event.PPV_NAME;
const SOURCE = (process.env.SOURCE || 'home-page-banner').trim().toLowerCase();
const TV_TARGET = (process.env.TV_TARGET || 'androidtv').trim().toLowerCase();
const APP_PACKAGE = process.env.APP_PACKAGE || 'com.dazn';
const TV_LOGIN_SETTLE_MS = Number(process.env.TV_LOGIN_SETTLE_MS || 10000);
const BROWSER_LOGIN_COMPLETE_SETTLE_MS = Number(process.env.BROWSER_LOGIN_COMPLETE_SETTLE_MS || 3000);
const PPV_PURCHASE_BACK_SETTLE_MS = Number(process.env.PPV_PURCHASE_BACK_SETTLE_MS || 5000);
const FIRETV_POST_LOGIN_BANNER_WAIT_MS = Number(process.env.FIRETV_POST_LOGIN_BANNER_WAIT_MS || 8000);
const FIRETV_POST_LOGIN_AFTER_BACK_WAIT_MS = Number(process.env.FIRETV_POST_LOGIN_AFTER_BACK_WAIT_MS || 10000);
const TV_HANDOFF_STORAGE_STATE = process.env.TV_HANDOFF_STORAGE_STATE || path.resolve(__dirname, '../../../tv_handoff_storage_state.json');

// TV PPV flow outline:
// 1. Reset/launch DAZN app and wait for a usable TV entry screen.
// 2. If Android TV starts on the QR login screen, complete login in browser and switch back.
// 3. Open the configured PPV source inside the TV app.
// 4. Capture the handoff URL from QR first, then use checkout URL fallbacks if needed.
// 5. Store the handoff URL for the downstream web/mobile continuation.

type RegionCredentials = {
  email: string;
  password: string;
};

function resolveRegionCredentials(): RegionCredentials {
  const region = (process.env.DAZN_REGION || 'GB').toUpperCase();
  const environment = (process.env.DAZN_ENV || 'prod').toLowerCase();
  const userState = String(process.env.USER_STATE || 'active_standard_monthly')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_');

  const userStatusPath = require('path').resolve(__dirname, '../../../config/userstatus.json');
  const userStatus = JSON.parse(require('fs').readFileSync(userStatusPath, 'utf-8'));
  const envNode = userStatus?.[userState]?.regions?.[region]?.environments?.[environment] || {};

  const email = String(envNode.USER_EMAIL || '').trim();
  const password = String(envNode.USER_PASSWORD || '').trim();
  if (!email || !password) {
    throw new Error(`Missing credentials for USER_STATE="${userState}", DAZN_REGION="${region}", DAZN_ENV="${environment}".`);
  }

  return { email, password };
}

async function clickGetStartedCta(driver: any): Promise<boolean> {
  const isFireTv = TV_TARGET === 'firetv';

  const adbTapElementCenter = async (el: any): Promise<void> => {
    const rect = await el.getRect();
    const tapX = Math.round(rect.x + rect.width / 2);
    const tapY = Math.round(rect.y + rect.height / 2);
    const caps: any =
      typeof driver.getCapabilities === 'function'
        ? await driver.getCapabilities().catch(() => ({}))
        : (driver.capabilities || {});
    const udid =
      caps['appium:udid'] ||
      caps.udid ||
      process.env.FIRETV_SERIAL ||
      process.env.DEVICE_SERIAL ||
      '';
    const serialArg = udid ? `-s ${udid}` : '';
    const androidSdk = process.env.ANDROID_HOME || `${process.env.HOME}/Library/Android/sdk`;
    const adb = `${androidSdk}/platform-tools/adb`;
    execSync(`${adb} ${serialArg} shell input tap ${tapX} ${tapY}`);
  };

  const isLandingStillVisible = async (): Promise<boolean> => {
    const landingSelectors = [
      'android=new UiSelector().textMatches("(?i)^Get started$")',
      'android=new UiSelector().textMatches("(?i)^Explore$")',
    ];

    for (const selector of landingSelectors) {
      try {
        const el = await driver.$(selector);
        if (await el.isDisplayed({ timeout: 600 }).catch(() => false)) {
          return true;
        }
      } catch {}
    }

    return false;
  };

  const isAlreadyOnFireTvShell = async (): Promise<boolean> => {
    const shellSelectors = [
      'android=new UiSelector().text("Home")',
      'android=new UiSelector().text("Schedule")',
      'android=new UiSelector().text("Search")',
      'android=new UiSelector().text("All sports")',
      'android=new UiSelector().text("Live TV")',
    ];

    for (const selector of shellSelectors) {
      try {
        const el = await driver.$(selector);
        if (await el.isDisplayed({ timeout: 500 }).catch(() => false)) {
          return true;
        }
      } catch {}
    }

    return false;
  };

  const isValidGetStartedTarget = (value: string): boolean => {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return false;
    if (normalized.includes('explore')) return false;
    return /^(get started|log in|sign in)$/.test(normalized);
  };

  const getFocusedLabel = async (): Promise<string> => {
    try {
      const focused = await driver.$('//*[@focused="true"]');
      if (await focused.isDisplayed({ timeout: 300 }).catch(() => false)) {
        const text = String(await focused.getText().catch(() => '')).trim();
        const desc = String(await focused.getAttribute('contentDescription').catch(() => '')).trim();
        return (text || desc || '').trim();
      }
    } catch {}

    return '';
  };

  const fireTvSelectors = [
    'android=new UiSelector().textMatches("(?i)^Get started$")',
    'android=new UiSelector().textMatches("(?i)^Get Started$")',
    '//android.widget.TextView[@text="Get started"]',
    '//android.widget.Button[@text="Get started"]',
    '//android.widget.TextView[@text="Get Started"]',
    '//android.widget.Button[@text="Get Started"]',
    'android=new UiSelector().resourceId("com.dazn:id/btn_get_started").textMatches("(?i)^Get started$")',
    'android=new UiSelector().descriptionMatches("(?i)^Get started$")',
  ];

  const nonFireTvSelectors = [
    'android=new UiSelector().textMatches("(?i)^Get started$")',
    'android=new UiSelector().textMatches("(?i)^Get Started$")',
    'android=new UiSelector().descriptionMatches("(?i)^Get started$")',
    'android=new UiSelector().textMatches("(?i)^Log in$")',
    'android=new UiSelector().textMatches("(?i)^Sign in$")',
    'android=new UiSelector().descriptionMatches("(?i)^Log in$")',
    'android=new UiSelector().descriptionMatches("(?i)^Sign in$")',
  ];

  const selectors = isFireTv ? fireTvSelectors : nonFireTvSelectors;

  if (isFireTv) {
    const landingVisible = await isLandingStillVisible();
    if (!landingVisible) {
      if (await isAlreadyOnFireTvShell()) {
        console.log('✅ Fire TV already past landing (Home/Schedule shell visible). Skipping Get started CTA.');
        return true;
      }
    }
  }

  if (isFireTv && await isLandingStillVisible()) {
    for (const selector of fireTvSelectors) {
      try {
        const target = await driver.$(selector);
        if (!await target.isDisplayed({ timeout: 1000 }).catch(() => false)) continue;

        await target.click().catch(() => undefined);
        await driver.pause(1400);
        if (!await isLandingStillVisible()) {
          console.log(`✅ Get started clicked via ${selector}`);
          return true;
        }

        await adbTapElementCenter(target);
        await driver.pause(1400);
        if (!await isLandingStillVisible()) {
          console.log(`✅ Get started clicked via ADB tap fallback (${selector})`);
          return true;
        }
      } catch {}
    }

    const focusedBeforeCenter = (await getFocusedLabel()).trim();
    if (isValidGetStartedTarget(focusedBeforeCenter)) {
      sendTvKeyevent(TV_KEYCODES.DPAD_CENTER);
      await driver.pause(1400);
      if (!await isLandingStillVisible()) {
        console.log('✅ Get started activated via Fire TV focus (DPAD_CENTER)');
        return true;
      }
    }

    const centerFailShot = './test-results/firetv_get_started_center_no_transition.png';
    await driver.saveScreenshot(centerFailShot).catch(() => {});
    throw new Error(
      `Fire TV Get started did not transition. Focused label was "${focusedBeforeCenter || 'unknown'}". Screenshot: ${centerFailShot}`,
    );
  }

  if (isFireTv) {
    return false;
  }

  for (const selector of selectors) {
    try {
      const el = await driver.$(selector);
      if (await el.isDisplayed({ timeout: 1000 })) {
        const text = String(await el.getText().catch(() => '')).trim();
        const desc = String(await el.getAttribute('contentDescription').catch(() => '')).trim();
        const hasValidLabel = isValidGetStartedTarget(text) || isValidGetStartedTarget(desc);

        if (!hasValidLabel) {
          console.log(`ℹ️ Skipping non-target CTA for selector ${selector}: text="${text}" desc="${desc}"`);
          continue;
        }
        if (String(text || desc).toLowerCase().includes('explore')) {
          console.log(`ℹ️ Skipping Explore CTA for selector ${selector}: text="${text}" desc="${desc}"`);
          continue;
        }

        for (let attempt = 1; attempt <= 3; attempt++) {
          // Re-resolve each attempt in case carousel animation changed element bounds.
          const target = await driver.$(selector);
          if (!await target.isDisplayed({ timeout: 800 }).catch(() => false)) {
            continue;
          }

          if (!isFireTv) {
            try {
              await target.click();
              await driver.pause(1400);
              const stillLandingAfterClick = await isLandingStillVisible();
              if (!stillLandingAfterClick) {
                console.log(`✅ Get started clicked via ${selector} (attempt ${attempt})`);
                return true;
              }
            } catch {}
          }

          try {
            await adbTapElementCenter(target);
            await driver.pause(1400);
            const stillLandingAfterAdbTap = await isLandingStillVisible();
            if (!stillLandingAfterAdbTap) {
              console.log(`✅ Get started clicked via ADB tap fallback (selector ${selector}, attempt ${attempt})`);
              return true;
            }
          } catch {}

          console.log(`ℹ️ Get started tap did not transition screen yet (selector ${selector}, attempt ${attempt}). Retrying...`);
        }
      }
    } catch {}
  }

  return false;
}

async function assertQrPageDisplayedAfterGetStarted(driver: any): Promise<void> {
  const qrPageSelectors = [
    'android=new UiSelector().textContains("QR")',
    'android=new UiSelector().textContains("Scan")',
    'android=new UiSelector().textContains("code")',
    'android=new UiSelector().textContains("dazn.com")',
    'android=new UiSelector().resourceIdMatches(".*qr.*")',
    '//*[@resource-id[contains(.,"qr")]]',
  ];

  const isQrPageVisible = async (): Promise<boolean> => {
    for (const selector of qrPageSelectors) {
      try {
        const el = await driver.$(selector);
        if (await el.isDisplayed({ timeout: 500 }).catch(() => false)) {
          return true;
        }
      } catch {}
    }
    return false;
  };

  try {
    await driver.waitUntil(async () => {
      return isQrPageVisible();
    }, {
      timeout: 20000,
      interval: 800,
      timeoutMsg: 'QR code page was not displayed after clicking Get started.',
    });
    console.log('✅ QR code page displayed after Get started');
  } catch {
    const shot = './test-results/firetv_qr_page_assertion_failed.png';
    await driver.saveScreenshot(shot).catch(() => {});
    throw new Error(`QR code page assertion failed after clicking Get started. Screenshot: ${shot}`);
  }
}

async function isQrLoginPageVisible(driver: any): Promise<boolean> {
  const qrLoginSelectors = [
    'android=new UiSelector().textContains("Scan the QR code")',
    'android=new UiSelector().textContains("Use remote to log in")',
    'android=new UiSelector().textContains("dazn.com/loginhelp")',
  ];

  for (const selector of qrLoginSelectors) {
    try {
      const el = await driver.$(selector);
      if (await el.isDisplayed({ timeout: 500 }).catch(() => false)) {
        return true;
      }
    } catch {}
  }

  return false;
}

async function waitForQrLoginPage(driver: any, timeoutMs = 15000): Promise<boolean> {
  return driver.waitUntil(async () => isQrLoginPageVisible(driver), {
    timeout: timeoutMs,
    interval: 1000,
    timeoutMsg: 'TV QR login page was not displayed.',
  }).then(() => true).catch(() => false);
}

async function isTvNavigationShellVisible(driver: any): Promise<boolean> {
  const shellSelectors = [
    'android=new UiSelector().text("Home")',
    'android=new UiSelector().text("Schedule")',
    'android=new UiSelector().text("Search")',
    'android=new UiSelector().text("All sports")',
    'android=new UiSelector().text("Live TV")',
    'android=new UiSelector().descriptionContains("Home")',
    'android=new UiSelector().descriptionContains("Schedule")',
    'android=new UiSelector().descriptionContains("Search")',
  ];

  for (const selector of shellSelectors) {
    try {
      const el = await driver.$(selector);
      if (await el.isDisplayed({ timeout: 500 }).catch(() => false)) {
        return true;
      }
    } catch {}
  }

  return false;
}

async function isDaznAppUiLoaded(driver: any): Promise<boolean> {
  try {
    const activity = String(await driver.getCurrentActivity().catch(() => '')).toLowerCase();
    if (activity && !activity.includes('splash')) {
      const source = String(await driver.getPageSource().catch(() => ''));
      const hasNativeUi = source.includes('android.widget.') || source.includes('android.view.') || source.includes('com.dazn');
      const stillOnQrLogin = /scan the qr code|use remote to log in|dazn\.com\/loginhelp/i.test(source);
      if (hasNativeUi && !stillOnQrLogin) {
        console.log(`✅ DAZN app UI loaded after login (activity: ${activity})`);
        return true;
      }
    }
  } catch {}

  return false;
}

async function closePostLoginBannerIfPresent(driver: any): Promise<void> {
  const closeSelectors = [
    'android=new UiSelector().descriptionContains("Close")',
    'android=new UiSelector().descriptionContains("Dismiss")',
    'android=new UiSelector().textMatches("(?i)^(Close|Dismiss|Not now|No thanks|Maybe later|Skip)$")',
    'android=new UiSelector().resourceIdMatches(".*close.*")',
  ];

  for (const selector of closeSelectors) {
    try {
      const el = await driver.$(selector);
      if (!await el.isDisplayed({ timeout: 800 }).catch(() => false)) continue;
      await el.click().catch(() => undefined);
      await driver.pause(1500);
      console.log(`✅ Post-login banner closed via ${selector}`);
      return;
    } catch {}
  }

  console.log('ℹ️ No explicit post-login banner close button found. Continuing without Back press.');
}

async function waitForTvPageLoadAfterLogin(driver: any, timeoutMs = 45000): Promise<void> {
  try {
    await driver.waitUntil(async () => {
      return await isTvNavigationShellVisible(driver) || await isDaznAppUiLoaded(driver);
    }, {
      timeout: timeoutMs,
      interval: 1000,
      timeoutMsg: 'TV app did not load after browser login.',
    });
  } catch (error) {
    await driver.saveScreenshot('./test-results/firetv_post_login_not_loaded.png').catch(() => {});
    try {
      const pageSource = await driver.getPageSource();
      require('fs').writeFileSync('./test-results/firetv_post_login_not_loaded.xml', pageSource);
    } catch {}
    throw error;
  }

  await driver.saveScreenshot('./test-results/firetv_post_login_loaded.png').catch(() => {});
  console.log('✅ TV app loaded after login');
}

async function settleTvAppAfterBrowserLogin(driver: any): Promise<void> {
  if (TV_TARGET === 'firetv') {
    console.log(`⏳ Waiting ${FIRETV_POST_LOGIN_BANNER_WAIT_MS}ms for Fire TV post-login banner to appear...`);
    await driver.pause(FIRETV_POST_LOGIN_BANNER_WAIT_MS);
    await driver.saveScreenshot('./test-results/firetv_post_login_before_back.png').catch(() => {});

    console.log('↩️ Closing Fire TV post-login banner with one Back press...');
    sendTvKeyevent(TV_KEYCODES.BACK);

    console.log(`⏳ Waiting ${FIRETV_POST_LOGIN_AFTER_BACK_WAIT_MS}ms for Fire TV app to load after Back...`);
    await driver.pause(FIRETV_POST_LOGIN_AFTER_BACK_WAIT_MS);
    await waitForTvPageLoadAfterLogin(driver);
    await driver.pause(2000);
    return;
  }

  await driver.pause(5000);
  await waitForTvPageLoadAfterLogin(driver);
  await closePostLoginBannerIfPresent(driver);
  await driver.pause(2000);
}

// Browser-side QR login: used only after the TV app displays a device sign-in QR.
async function signInViaQrInBrowser(signInUrl: string, credentials: RegionCredentials): Promise<void> {
  const { chromium } = require('@playwright/test');
  const browser = await chromium.launch({
    headless: false,
  });
  const page = await browser.newPage();

  // Some DAZN QR logins land on the PPV purchase/plans page. Back out once so
  // the TV session can settle before the native app continues the PPV flow.
  const clickPlansBackIfPresent = async (): Promise<void> => {
    const waitAfterBackClick = async (): Promise<void> => {
      if (PPV_PURCHASE_BACK_SETTLE_MS <= 0) return;
      console.log(`⏳ Waiting ${PPV_PURCHASE_BACK_SETTLE_MS}ms after PPV purchase Back click...`);
      await page.waitForTimeout(PPV_PURCHASE_BACK_SETTLE_MS);
    };

    const isPlansPageVisible = async (): Promise<boolean> => {
      await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
      const url = page.url().toLowerCase();
      const planTextVisible = await page
        .getByText(/plans?|choose your plan|select your plan|choose how to buy|dazn ultimate|buy .* or get it included/i)
        .first()
        .isVisible({ timeout: 500 })
        .catch(() => false);

      return url.includes('/plans') ||
        url.includes('/account/addon/purchase') ||
        url.includes('contextualppvid') ||
        url.includes('purchase') ||
        url.includes('plan') ||
        planTextVisible;
    };

    const start = Date.now();
    while (Date.now() - start < 20000) {
      if (await isPlansPageVisible()) break;
      await page.waitForTimeout(1000);
    }

    if (!await isPlansPageVisible()) return;

    console.log('ℹ️ Browser landed on PPV purchase/plans page after login. Clicking top-left Back icon...');

    const clickTopLeftControl = async (): Promise<boolean> => {
      const controls = await page.locator('button, a, [role="button"]').all();
      for (const control of controls) {
        const box = await control.boundingBox().catch(() => null);
        if (!box || box.x > 100 || box.y > 100) continue;
        await control.click({ force: true });
        await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
        console.log('✅ Browser PPV purchase back clicked via top-left control');
        await waitAfterBackClick();
        return true;
      }

      return false;
    };

    if (await clickTopLeftControl()) return;

    const backSelectors = [
      '[data-testid*="back" i]',
      '[data-test-id*="back" i]',
      'button[aria-label*="back" i]',
      'a[aria-label*="back" i]',
      '[role="button"][aria-label*="back" i]',
      'button:has-text("<")',
      'a:has-text("<")',
    ];

    for (const selector of backSelectors) {
      const back = page.locator(selector).first();
      if (await back.isVisible({ timeout: 1500 }).catch(() => false)) {
        await back.click({ force: true });
        await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
        console.log(`✅ Browser PPV purchase back clicked via ${selector}`);
        await waitAfterBackClick();
        return;
      }
    }

    await page.mouse.click(44, 28);
    await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
    console.log('✅ Browser PPV purchase back clicked via top-left coordinate fallback');
    await waitAfterBackClick();
  };

  const waitForBrowserLoginCompletion = async (): Promise<void> => {
    const start = Date.now();
    await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    await page.waitForFunction(() => {
      const path = (window.location.pathname || '').toLowerCase();
      const href = (window.location.href || '').toLowerCase();
      const stillOnAuthRoute = /login|signin|sign-in|auth/.test(path) || /login|signin|sign-in|auth/.test(href);
      const hasAuthFields = !!document.querySelector('input[type="email"], input[name="email"], input[type="password"], input[name="password"]');
      return !stillOnAuthRoute || !hasAuthFields;
    }, { timeout: 30000 }).catch(() => {});

    const elapsed = Date.now() - start;
    console.log(`✅ Browser post-continue wait completed (${elapsed}ms)`);
  };

  try {
    await page.goto(signInUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const emailInput = page.locator('input[type="email"], input[name="email"]').first();
    await emailInput.waitFor({ state: 'visible', timeout: 20000 });
    await emailInput.fill(credentials.email);

    const emailContinueSelectors = [
      'button:has-text("Continue")',
      'button[type="submit"]',
      'input[type="submit"]',
    ];

    const passwordLoginSelectors = [
      'button:has-text("Log in")',
      'button:has-text("Login")',
      'button:has-text("Sign in")',
      'button[type="submit"]',
      'input[type="submit"]',
    ];

    const clickCta = async (selectors: string[], stepLabel: string): Promise<boolean> => {
      for (const selector of selectors) {
        const el = page.locator(selector).first();
        if (await el.isVisible({ timeout: 3000 }).catch(() => false)) {
          await el.click({ force: true });
          console.log(`✅ ${stepLabel} via ${selector}`);
          return true;
        }
      }

      return false;
    };

    const passwordInput = page.locator('input[type="password"], input[name="password"]').first();
    const passwordVisibleAfterEmail = await passwordInput.isVisible({ timeout: 3000 }).catch(() => false);

    if (!passwordVisibleAfterEmail) {
      const emailContinueClicked = await clickCta(emailContinueSelectors, 'Email Continue CTA clicked');
      if (!emailContinueClicked) {
        throw new Error('Email Continue CTA not found on browser login page.');
      }
      await passwordInput.waitFor({ state: 'visible', timeout: 20000 });
    }

    await passwordInput.waitFor({ state: 'visible', timeout: 20000 });
    await passwordInput.fill(credentials.password);

    const passwordLoginClicked = await clickCta(passwordLoginSelectors, 'Password Log in CTA clicked');
    if (!passwordLoginClicked) {
      throw new Error('Password Log in CTA not found on browser login page.');
    }

    await waitForBrowserLoginCompletion();
    if (BROWSER_LOGIN_COMPLETE_SETTLE_MS > 0) {
      console.log(`⏳ Waiting ${BROWSER_LOGIN_COMPLETE_SETTLE_MS}ms after completing browser login before PPV purchase Back check...`);
      await page.waitForTimeout(BROWSER_LOGIN_COMPLETE_SETTLE_MS);
    }
    console.log('✅ Browser login process completed. Checking for PPV purchase Back icon...');
    await clickPlansBackIfPresent();
  } finally {
    await browser.close().catch(() => {});
  }
}

// Decodes the TV QR, signs in through browser, waits for DAZN to sync login,
// then reactivates the native TV app.
async function runBrowserLoginAndSwitchBack(driver: any, options: { allowHandoffFallback?: boolean } = {}): Promise<void> {
  const allowHandoffFallback = options.allowHandoffFallback !== false;
  let qrUrl = '';
  for (let attempt = 1; attempt <= 6; attempt++) {
    qrUrl = await decodeCheckoutUrlFromQr(driver, `./test-results/android_tv_qr_capture_attempt_${attempt}.png`);
    if (qrUrl) {
      console.log(`✅ QR payload decoded on attempt ${attempt}`);
      writeHandoffUrl(qrUrl);
      break;
    }

    if (attempt < 6) {
      console.log(`ℹ️ QR payload not available yet (attempt ${attempt}/6). Retrying...`);
      await driver.pause(2000);
    }
  }

  if (!qrUrl && allowHandoffFallback) {
    qrUrl = readHandoffUrl?.() || '';
  }
  if (!qrUrl) {
    await driver.saveScreenshot('./test-results/android_tv_qr_capture_missing.png').catch(() => {});
    throw new Error('No fresh QR handoff URL captured from the app.');
  }

  const credentials = resolveRegionCredentials();
  await signInViaQrInBrowser(qrUrl, credentials);

  if (TV_LOGIN_SETTLE_MS > 0) {
    console.log(`⏳ Waiting ${TV_LOGIN_SETTLE_MS}ms for TV login handoff to settle before switching back to app...`);
    await driver.pause(TV_LOGIN_SETTLE_MS);
  }

  await driver.activateApp(APP_PACKAGE).catch(() => {});
  await settleTvAppAfterBrowserLogin(driver);
  console.log('✅ Browser login completed and DAZN app reactivated');
}

// Routes only this TV PPV spec to the configured in-app source.
async function openTvPpvFlow(driver: any): Promise<boolean> {
  if (SOURCE === 'schedule') {
    return openSchedulePPVPaywall(driver, PPV_NAME, event);
  }

  if (SOURCE === 'search') {
    return openSearchResultPaywall(driver, PPV_NAME, PPV_NAME);
  }

  if (SOURCE === 'landing-page-banner') {
    return openLandingBannerPaywall(driver, PPV_NAME);
  }

  if (SOURCE === 'home-page-banner') {
    return openHomeBannerPaywall(driver, PPV_NAME, {}, { immediatePaywall: true });
  }

  return openGenericPPVPaywall(driver, PPV_NAME);
}

function extractEmailFromText(value: string): string {
  const match = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0].replace(/[.,;:]+$/, '') : '';
}

async function extractTvPaywallEmail(driver: any): Promise<string> {
  const source = await driver.getPageSource().catch(() => '');
  const email = extractEmailFromText(source);
  if (email) {
    console.log(`✅ TV paywall email detected: ${email}`);
  }
  return email;
}

async function openYopmailAndCapturePlansUrl(email: string): Promise<string> {
  const inbox = email.split('@')[0];
  const { chromium } = require('@playwright/test');
  const playwrightBrowser = await chromium.launch({ headless: false });
  const context = await playwrightBrowser.newContext();
  const page = await context.newPage();
  const credentials = resolveRegionCredentials();

  const clickFirstVisible = async (selectors: string[], label: string): Promise<boolean> => {
    for (const selector of selectors) {
      const el = page.locator(selector).first();
      if (await el.isVisible({ timeout: 1500 }).catch(() => false)) {
        await el.click({ force: true });
        console.log(`✅ ${label} via ${selector}`);
        return true;
      }
    }
    return false;
  };

  const completeLoginIfPrompted = async (targetPage: any): Promise<void> => {
    const emailInput = targetPage.locator('input[type="email"], input[name="email"]').first();
    if (!await emailInput.isVisible({ timeout: 4000 }).catch(() => false)) return;

    await emailInput.fill(credentials.email);
    for (const selector of ['button:has-text("Continue")', 'button[type="submit"]', 'input[type="submit"]']) {
      const button = targetPage.locator(selector).first();
      if (await button.isVisible({ timeout: 1500 }).catch(() => false)) {
        await button.click({ force: true });
        break;
      }
    }

    const passwordInput = targetPage.locator('input[type="password"], input[name="password"]').first();
    if (await passwordInput.isVisible({ timeout: 15000 }).catch(() => false)) {
      await passwordInput.fill(credentials.password);
      for (const selector of ['button:has-text("Log in")', 'button:has-text("Login")', 'button:has-text("Sign in")', 'button[type="submit"]', 'input[type="submit"]']) {
        const button = targetPage.locator(selector).first();
        if (await button.isVisible({ timeout: 1500 }).catch(() => false)) {
          await button.click({ force: true });
          break;
        }
      }
      await targetPage.waitForLoadState('domcontentloaded', { timeout: 20000 }).catch(() => {});
    }
  };

  const waitForPlansPage = async (targetPage: any): Promise<string> => {
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      await targetPage.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
      await completeLoginIfPrompted(targetPage);

      const url = String(targetPage.url());
      const lowerUrl = url.toLowerCase();
      const hasPlansText = await targetPage
        .getByText(/choose your plan|select your plan|plans?|tierplans|plandetails|purchase this event/i)
        .first()
        .isVisible({ timeout: 1000 })
        .catch(() => false);

      if (
        lowerUrl.includes('dazn.com') &&
        (lowerUrl.includes('/plans') ||
          lowerUrl.includes('page=tierplans') ||
          lowerUrl.includes('page=plandetails') ||
          lowerUrl.includes('/account/addon/purchase') ||
          lowerUrl.includes('contextualppvid') ||
          hasPlansText)
      ) {
        return url;
      }

      await targetPage.waitForTimeout(1000);
    }

    throw new Error(`Yopmail DAZN link did not reach plans page. Last URL: ${targetPage.url()}`);
  };

  try {
    console.log(`🌐 Opening Yopmail inbox for TV paywall email: ${email}`);
    await page.goto('https://www.yopmail.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });

    const loginInput = page.locator('#login, input[name="login"]').first();
    if (await loginInput.isVisible({ timeout: 4000 }).catch(() => false)) {
      await loginInput.fill(inbox);
      await clickFirstVisible(['#refreshbut', 'button:has-text("Check Inbox")', 'button[title*="Check" i]', 'input[type="submit"]'], 'Yopmail inbox open');
    }

    const inboxFrame = page.frameLocator('iframe#ifinbox');
    let mailOpened = false;
    for (let attempt = 1; attempt <= 8 && !mailOpened; attempt++) {
      await page.locator('#refresh').click({ force: true, timeout: 1000 }).catch(() => {});
      await page.locator('#refreshbut').click({ force: true, timeout: 1000 }).catch(() => {});
      await page.waitForTimeout(2000);

      const message = inboxFrame
        .locator('div.m, button, a, [role="button"]')
        .filter({ hasText: /dazn|joshua|prenga|pay-per-view|purchase|my account/i })
        .first();

      if (await message.isVisible({ timeout: 2000 }).catch(() => false)) {
        await message.click({ force: true });
        mailOpened = true;
        console.log(`✅ Opened DAZN Yopmail message on attempt ${attempt}`);
      }
    }

    if (!mailOpened) {
      throw new Error(`No DAZN purchase email found in Yopmail inbox for ${email}.`);
    }

    const mailFrame = page.frameLocator('iframe#ifmail');
    const completeSignInLink = mailFrame
      .locator('a')
      .filter({ hasText: /complete\s+sign\s*-?\s*in\s+process|complete/i })
      .first();
    const daznLinks = mailFrame.locator('a[href*="dazn" i], a[href*="awstrack" i]');
    const targetLink = await completeSignInLink.count().catch(() => 0) > 0
      ? completeSignInLink
      : daznLinks.first();

    const targetHref = await targetLink.getAttribute('href').catch(() => '');
    if (!targetHref) {
      throw new Error('Opened Yopmail message, but no Complete Sign in process / DAZN link was found.');
    }

    const popupPromise = context.waitForEvent('page', { timeout: 6000 }).catch(() => null);
    const clicked = await targetLink.click({ force: true, timeout: 4000 }).then(() => true).catch((error: any) => {
      console.warn(`⚠️ Yopmail CTA click failed, navigating to CTA href directly: ${error.message}`);
      return false;
    });
    const popup = await popupPromise;
    const daznPage = popup || page;

    if (!clicked) {
      await daznPage.goto(targetHref, { waitUntil: 'domcontentloaded', timeout: 60000 });
    }

    await daznPage.bringToFront().catch(() => {});

    const plansUrl = await waitForPlansPage(daznPage);
    await context.storageState({ path: TV_HANDOFF_STORAGE_STATE }).catch(() => {});
    console.log(`📝 TV handoff browser storage saved to: ${TV_HANDOFF_STORAGE_STATE}`);
    console.log(`✅ Yopmail DAZN link reached plans page: ${plansUrl}`);
    return plansUrl;
  } finally {
    await playwrightBrowser.close().catch(() => {});
  }
}

// After the TV app opens the PPV paywall, capture the web handoff URL that the
// root Playwright runner continues from.
async function captureTvPpvHandoffUrl(driver: any): Promise<void> {
  // Step 4: Prefer QR handoff because TV checkout normally presents a QR code.
  let checkoutUrl = await decodeCheckoutUrlFromQr(driver, './test-results/android_tv_qr_capture.png');
  if (checkoutUrl) {
    writeHandoffUrl(checkoutUrl);
    await driver.saveScreenshot('./test-results/android_tv_handoff_success.png').catch(() => {});
    console.log(`✅ TV handoff URL captured from QR: ${checkoutUrl}`);
    return;
  }

  // Step 5: If QR is unavailable, try the existing checkout URL capture paths.
  const copied = await copyImmediateCheckoutUrl(driver, SOURCE, {
    ppvName: PPV_NAME,
    isLandingPageBanner: SOURCE === 'landing-page-banner',
    retrySwipeBackToPPV: SOURCE === 'landing-page-banner' || SOURCE === 'home-page-banner',
  });

  checkoutUrl = copied.url || '';
  if (!copied.captured || !checkoutUrl.includes('dazn.com')) {
    checkoutUrl = await captureCheckoutUrl(driver);
  }

  if ((!checkoutUrl || !checkoutUrl.includes('dazn.com')) && TV_TARGET === 'firetv') {
    const paywallEmail = await extractTvPaywallEmail(driver);
    if (paywallEmail.toLowerCase().endsWith('@yopmail.com')) {
      checkoutUrl = await openYopmailAndCapturePlansUrl(paywallEmail);
    }
  }

  if (!checkoutUrl || !checkoutUrl.includes('dazn.com')) {
    await driver.saveScreenshot('./test-results/android_tv_checkout_url_missing.png').catch(() => {});
    throw new Error('Could not capture DAZN checkout URL from TV flow.');
  }

  // Step 6: Save the final DAZN handoff URL for the next automation stage.
  writeHandoffUrl(checkoutUrl);
  await driver.saveScreenshot('./test-results/android_tv_handoff_success.png').catch(() => {});
  console.log(`✅ TV handoff URL captured: ${checkoutUrl}`);
}

describe('DAZN TV PPV Android Handoff', () => {
  before(async () => {
    // Step 1: start every TV run from a clean handoff state and prepared app.
    clearHandoffUrl();
    require('fs').mkdirSync('./test-results', { recursive: true });

    const isFireTv = TV_TARGET === 'firetv';

    await prepareAndroidApp(browser, {
      clearAppData: true,
      waitForHome: TV_TARGET === 'firetv' ? false : true,
      acceptCookiesOnly: isFireTv,
    });

    if (TV_TARGET === 'androidtv') {
      // Step 2: Android TV prod can start on QR login after data clear.
      // Complete QR login in browser, then return focus to DAZN before navigation.
      await primeAndroidTvFocus(browser);
      if (await waitForQrLoginPage(browser)) {
        await runBrowserLoginAndSwitchBack(browser, { allowHandoffFallback: false });
        await primeAndroidTvFocus(browser);
      }
    }

    const caps: any =
      typeof browser.getCapabilities === 'function'
        ? await browser.getCapabilities().catch(() => ({}))
        : (browser.capabilities || {});
    const resolvedDeviceName =
      caps['appium:deviceName'] ||
      caps.deviceName ||
      process.env.DEVICE_NAME ||
      process.env.FIRETV_DEVICE_NAME ||
      process.env.ANDROIDTV_DEVICE_NAME ||
      'unknown-device';
    const resolvedUdid =
      caps['appium:udid'] ||
      caps.udid ||
      process.env.DEVICE_SERIAL ||
      process.env.FIRETV_SERIAL ||
      process.env.ANDROIDTV_SERIAL ||
      'unknown-udid';
    const resolvedPlatformVersion =
      caps['appium:platformVersion'] ||
      caps.platformVersion ||
      process.env.PLATFORM_VERSION ||
      'unknown-version';
    const resolvedTvTarget =
      caps['dazn:tvTarget'] ||
      TV_TARGET ||
      'not-set';

    console.log(`\n╔════════════════════════════════════════════════════╗`);
    console.log(`║  TV PPV Android Flow                               ║`);
    console.log(`║  Target : ${TV_TARGET.padEnd(40)}║`);
    console.log(`║  Event  : ${PPV_NAME.padEnd(40)}║`);
    console.log(`║  Source : ${SOURCE.padEnd(40)}║`);
    console.log(`╚════════════════════════════════════════════════════╝\n`);
    console.log('📋 Resolved device details from active session:');
    console.log(`   • deviceName      : ${resolvedDeviceName}`);
    console.log(`   • udid            : ${resolvedUdid}`);
    console.log(`   • platformVersion : ${resolvedPlatformVersion}`);
    console.log(`   • tvTarget        : ${resolvedTvTarget}`);
  });

  it('navigates to PPV and captures checkout URL for web handoff', async () => {
    const driver = browser;

    if (TV_TARGET === 'firetv') {
      // Fire TV schedule flow:
      // Get started -> QR browser login -> return to app -> Schedule -> PPV tile.
      if (!await waitForQrLoginPage(driver, 3000)) {
        const getStartedClicked = await clickGetStartedCta(driver);
        if (!getStartedClicked) {
          throw new Error('Could not click Get started CTA on Fire TV.');
        }
        await assertQrPageDisplayedAfterGetStarted(driver);
      }

      await runBrowserLoginAndSwitchBack(driver, { allowHandoffFallback: false });

      const opened = await openTvPpvFlow(driver);
      if (!opened) {
        throw new Error(`TV PPV flow did not reach paywall for SOURCE=${SOURCE}`);
      }

      await captureTvPpvHandoffUrl(driver);
      return;
    }

    // Step 3: Android TV flow opens the configured PPV entry point in the app.
    const opened = await openTvPpvFlow(driver);
    if (!opened) {
      throw new Error(`TV PPV flow did not reach paywall for SOURCE=${SOURCE}`);
    }

    await captureTvPpvHandoffUrl(driver);
  });
});
