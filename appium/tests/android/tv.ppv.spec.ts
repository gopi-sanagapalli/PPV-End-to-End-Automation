// WebdriverIO injects `browser` as a global at runtime.
// eslint-disable-next-line no-var
declare var browser: any;

import { writeHandoffUrl, clearHandoffUrl } from '../../utils/handoff';
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

describe('DAZN TV PPV Android Handoff', () => {
  before(async () => {
    clearHandoffUrl();
    require('fs').mkdirSync('./test-results', { recursive: true });

    const isFireTv = TV_TARGET === 'firetv';

    await prepareAndroidApp(browser, {
      clearAppData: true,
      waitForHome: !isFireTv,
    });

    if (TV_TARGET === 'androidtv') {
      await primeAndroidTvFocus(browser);
    }

    if (isFireTv) {
      // FireTV can land on an in-player promo/overlay where startup home
      // selectors are unavailable. Back once to return to a navigable shell.
      sendTvKeyevent(TV_KEYCODES.BACK);
      await browser.pause(1500);
    }

    const caps: any = browser.capabilities || {};
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

    const opened = await openTvPpvFlow(driver);
    if (!opened) {
      throw new Error(`TV PPV flow did not reach paywall for SOURCE=${SOURCE}`);
    }

    let checkoutUrl = await decodeCheckoutUrlFromQr(driver, './test-results/android_tv_qr_capture.png');
    if (checkoutUrl) {
      writeHandoffUrl(checkoutUrl);
      await driver.saveScreenshot('./test-results/android_tv_handoff_success.png').catch(() => {});
      console.log(`✅ TV handoff URL captured from QR: ${checkoutUrl}`);
      return;
    }

    const copied = await copyImmediateCheckoutUrl(driver, SOURCE, {
      ppvName: PPV_NAME,
      isLandingPageBanner: SOURCE === 'landing-page-banner',
      retrySwipeBackToPPV: SOURCE === 'landing-page-banner' || SOURCE === 'home-page-banner',
    });

    checkoutUrl = copied.url || '';
    if (!copied.captured || !checkoutUrl.includes('dazn.com')) {
      checkoutUrl = await captureCheckoutUrl(driver);
    }

    if (!checkoutUrl || !checkoutUrl.includes('dazn.com')) {
      await driver.saveScreenshot('./test-results/android_tv_checkout_url_missing.png').catch(() => {});
      throw new Error('Could not capture DAZN checkout URL from TV flow.');
    }

    writeHandoffUrl(checkoutUrl);
    await driver.saveScreenshot('./test-results/android_tv_handoff_success.png').catch(() => {});
    console.log(`✅ TV handoff URL captured: ${checkoutUrl}`);
  });
});
