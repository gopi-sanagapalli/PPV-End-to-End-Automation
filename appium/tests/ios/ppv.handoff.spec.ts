// ─────────────────────────────────────────────────────────────────────────────
// DAZN PPV — iOS Appium Handoff Test
//
// DEVICE: iOS Simulator / Real Device (configured in config/wdio.ios.conf.ts)
// EVENT:  Joshua vs. Prenga
//
// FLOW:
//   1. Open DAZN app
//   2. Dismiss system dialogs & landing page interstitials
//   3. Navigates to Buy button based on SOURCE env var:
//        landing-page-banner     → Hero banner → Buy
//        schedule                → Bottom tab → Schedule → scroll to boxing → find PPV tile → Buy
//        home-boxing-upcoming    → Home Boxing filter → Upcoming Fights → Buy
//        home-boxing-banner      → Home hero banner → Buy
//        home-boxing-tile        → Home Boxing rail → Buy
//        search                  → Search icon/tab → Search for event → find PPV tile → Buy
//   4. App opens Safari View Controller or Safari with DAZN checkout URL
//   5. Captures URL via WebView context switch or Safari address bar fallback
//   6. Writes URL to mobile_entry_url.txt  ← Playwright reads this
//   7. Desktop Playwright launches Chromium to complete signup, flex/APM plans, and payment validations
//
// HOW TO RUN:
//   cd appium
//   IOS_DEVICE_MODE=real IOS_UDID=<udid> SOURCE=landing-page-banner npx wdio run config/wdio.ios.conf.ts --spec tests/ios/ppv.handoff.spec.ts
// ─────────────────────────────────────────────────────────────────────────────

// WebdriverIO injects `browser` as a global at runtime — declare so TS is happy.
// eslint-disable-next-line no-var
declare var browser: any;
type WdBrowser = any;
type WdElement = any;

import { writeHandoffUrl, clearHandoffUrl } from '../../utils/handoff';
import { prepareIosApp, waitForHomePage } from '../../utils/iosSetup';
import { loadEventConfig, EventConfig } from '../../utils/eventLoader';
import { openSchedulePPVPaywall } from '../../pages/ios/IOSSchedulePage';
import { openSearchResultPaywall } from '../../pages/ios/IOSSearchPage';
import {
  openBoxingUpcomingFightsPaywall,
  openBoxingPageBannerPaywall,
  openHomeBoxingBannerPaywall,
  openHomeBoxingUpcomingPaywall,
} from '../../pages/ios/IOSBoxingPage';
import { openHomeBannerPaywall, openGenericPPVPaywall } from '../../pages/ios/IOSHomePage';
import { openLandingBannerPaywall } from '../../pages/ios/IOSLandingPage';
import { copyImmediateCheckoutUrl } from '../../pages/ios/IOSPaywallPage';
import { getIOSSurfacingPoint, getIOSValidationSheet } from '../../pages/ios/IOSSurfacingPoint';
import {
  validateMobilePaywallPage,
  validateMobileBannerOrTilePage,
  IOSValidationResult,
} from '../../pages/ios/IOSValidationPage';
import {
  IOSFlowHooks,
  captureCheckoutUrl as sharedCaptureCheckoutUrl,
  findEl as sharedFindEl,
  findPPVBanner as sharedFindPPVBanner,
  isVisible as sharedIsVisible,
  scrollDown as sharedScrollDown,
  scrollToText as sharedScrollToText,
  swipeLeft as sharedSwipeLeft,
  tapByText as sharedTapByText,
} from '../../pages/ios/IOSBasePage';

// ── Config ───────────────────────────────────────────────────────────────────
const PPV_NAME    = process.env.PPV_NAME    || 'Joshua';
const SOURCE      = (process.env.SOURCE || 'landing-page-banner').trim().toLowerCase();
const SURFACING_POINT = getIOSSurfacingPoint(SOURCE);
const REGION = process.env.DAZN_REGION || 'GB';
const MODE = (process.env.IOS_DEVICE_MODE || 'simulator').toLowerCase();
const BUNDLE_ID = process.env.DAZN_BUNDLE_ID || (MODE === 'real' ? 'com.dazn.theApp' : 'com.dazn.enterprise');

// ── Direct aliases for shared utilities ─────────
const isVisible = sharedIsVisible;
const captureCheckoutUrl = sharedCaptureCheckoutUrl;

async function findEl(driver: WdBrowser, sel: string, timeoutMs = 10000): Promise<WdElement> {
  return sharedFindEl(driver, sel, timeoutMs);
}
async function tapByText(driver: WdBrowser, text: string, timeoutMs = 10000): Promise<boolean> {
  return sharedTapByText(driver, text, timeoutMs);
}
async function findPPVBanner(driver: WdBrowser): Promise<boolean> {
  return sharedFindPPVBanner(driver, PPV_NAME);
}
async function scrollDown(driver: WdBrowser): Promise<void> {
  return sharedScrollDown(driver);
}

const iosAvailabilityResults: IOSValidationResult[] = [];
let iosAvailabilityReportGenerated = false;

function iosAvailabilityPageName(source = SOURCE): string {
  if (source.includes('landing')) return 'Landing';
  if (source.includes('schedule')) return 'Schedule';
  if (source.includes('search')) return 'Search';
  if (source.includes('boxing')) return 'Home of Boxing';
  if (source.includes('home')) return 'Home Page';
  return 'iOS';
}

function iosAvailabilityCheckName(source = SOURCE): string {
  const surface = source.includes('banner') ? 'banner' : 'tile';
  return `${PPV_NAME} ${surface}`;
}

function recordIOSPPVAvailability(available: boolean, screenshot?: string, page?: string): void {
  const pageName = page || iosAvailabilityPageName();
  const field = iosAvailabilityCheckName();
  const existingIndex = iosAvailabilityResults.findIndex(
    r => r.page === pageName && r.field === field,
  );
  const row: IOSValidationResult = {
    page: pageName,
    field,
    expected: PPV_NAME,
    actual: available ? PPV_NAME : `${PPV_NAME} not available`,
    status: available ? 'PASS' as const : 'FAIL' as const,
    screenshot,
  };

  if (existingIndex >= 0) {
    iosAvailabilityResults[existingIndex] = row;
  } else {
    iosAvailabilityResults.push(row);
  }
}

async function saveIOSScreenshot(driver: WdBrowser, relativePath: string): Promise<string | undefined> {
  try {
    await driver.saveScreenshot(relativePath);
    const path = require('path');
    return path.resolve(process.cwd(), relativePath);
  } catch {
    return undefined;
  }
}

async function generateIOSAvailabilityFailureReport(errorMessage: string): Promise<void> {
  if (iosAvailabilityReportGenerated) return;
  iosAvailabilityReportGenerated = true;

  if (!iosAvailabilityResults.length) {
    recordIOSPPVAvailability(false);
  }

  const originalCwd = process.cwd();
  try {
    const path = require('path');
    const projectRoot = path.resolve(__dirname, '../../..');
    process.chdir(projectRoot);

    const { writeResults } = require('../../../utils/excelWriter');
    const { generateReports } = require('../../../utils/reportGenerator');
    const { displayResultsTable } = require('../../../utils/resultsDisplay');

    const srcLabel = SOURCE.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    const rows = iosAvailabilityResults.map(r => ({
      ...r,
      flowName: `iOS New User: ${srcLabel}`,
      source: SOURCE,
      tier: 'standard',
      ratePlan: 'monthly',
    }));

    const { excelPath, videoPath } = await writeResults(rows);
    displayResultsTable(rows, 'ppv', {
      event: PPV_NAME,
      region: REGION,
      excelPath,
      videoPath,
    });
    await generateReports(rows, {
      event: PPV_NAME,
      region: REGION,
      source: SOURCE,
      ratePlan: 'monthly',
      tier: 'standard',
      env: (process.env.DAZN_ENV || 'stag').toLowerCase(),
      flowName: `iOS New User: ${srcLabel}`,
      startTime: new Date(),
      endTime: new Date(),
      excelPath,
      videoPath,
      userType: 'new-user',
      userStatus: 'new',
      platform: 'iOS',
    });
    console.log(`📊 iOS PPV availability failure report generated: ${errorMessage}`);
  } catch (reportErr: any) {
    console.error(`⚠️ Failed to generate iOS availability failure report: ${reportErr.message}`);
  } finally {
    process.chdir(originalCwd);
  }
}

// ─── Test Definition ───
describe('DAZN iOS PPV — New User Handoff Flow', () => {
  before(async () => {
    clearHandoffUrl();
    require('fs').mkdirSync('./test-results/gemini-banner', { recursive: true });

    const shouldWaitHome = SOURCE !== 'landing-page-banner';
    const clearData = SOURCE === 'landing-page-banner';
    await prepareIosApp(browser, { clearAppData: clearData, waitForHome: shouldWaitHome });

    console.log(`\n╔════════════════════════════════════════════════════╗`);
    console.log(`║  DAZN iOS PPV Handoff                              ║`);
    console.log(`║  Event  : ${PPV_NAME.padEnd(40)}║`);
    console.log(`║  Source : ${SOURCE.padEnd(40)}║`);
    console.log(`║  Surface: ${SURFACING_POINT.page.padEnd(40)}║`);
    console.log(`╚════════════════════════════════════════════════════╝\n`);
  });

  it('navigates to PPV buy button, opens Safari, captures checkout URL', async () => {
    const driver = browser;

    console.log('🎥 Starting screen recording on iOS device...');
    await driver.startRecordingScreen({
      timeLimit: 300,
      videoType: 'mp4',
    }).catch(e => console.error('⚠️ Failed to start screen recording:', e));

    console.log('✅ Startup handled by prepareIosApp; beginning PPV navigation');

    const fs = require('fs');
    const path = require('path');
    const { loadEventConfig } = require('../../../utils/testHelpers');
    const { buildEventData } = require('../../../utils/buildEventData');

    const EVENT_CONFIG = process.env.PPV_CONFIG || 'ppv_t_joshua_prenga.json';
    const PLAN = process.env.PLAN || 'standard_monthly';
    const ENV = (process.env.DAZN_ENV || 'stag').toLowerCase();
    const PAYMENT_METHOD = (process.env.PAYMENT_METHOD || 'credit_card').toLowerCase();

    const json = loadEventConfig(EVENT_CONFIG);

    const plansPath = path.resolve(__dirname, '../../..', 'config/DaznPlan.json');
    const plans = JSON.parse(fs.readFileSync(plansPath, 'utf-8'));
    const planData = plans[PLAN];
    if (!planData) {
      throw new Error(`❌ Plan "${PLAN}" not found in DaznPlan.json`);
    }

    const planTier = (planData.TIER || 'standard').toLowerCase();
    const ratePlan = (planData.RATE_PLAN || 'monthly').toLowerCase();

    // Merge mobile overrides
    let mobileRegional = {};
    try {
      let mobileConfigPath = path.resolve(__dirname, '../../config/events', EVENT_CONFIG);
      if (!fs.existsSync(mobileConfigPath) && json.eventKey) {
        mobileConfigPath = path.resolve(__dirname, '../../config/events', `${json.eventKey}.json`);
      }
      if (fs.existsSync(mobileConfigPath)) {
        const mobileJson = JSON.parse(fs.readFileSync(mobileConfigPath, 'utf8'));
        mobileRegional = mobileJson.regions?.[REGION] || {};
        json.regions = json.regions || {};
        json.regions[REGION] = { ...json.regions[REGION], ...mobileRegional };
        console.log(` Merged mobile overrides into eventData`);
      }
    } catch (e: any) {
      console.warn(` Failed to load mobile overrides: ${e.message}`);
    }

    const eventData = buildEventData(json, REGION, planTier, ratePlan.replace(/-/g, ' '), SOURCE);
    eventData.USER_EMAIL = '';
    eventData.USER_STATE = 'new';
    eventData.source = SOURCE;
    eventData.SOURCE = SOURCE;
    eventData.MOBILE_WEB_HANDOFF = 'true';
    Object.assign(eventData, mobileRegional);

    let buyTapped = false;
    let bannerUrlCaptured = false;
    let bannerCheckoutUrl = '';
    let paywallValidatedRef = { value: false };

    async function validateMobilePaywall() {
      await validateMobilePaywallPage(driver, eventData, SOURCE, iosAvailabilityResults, paywallValidatedRef);
    }

    async function validateMobileBannerOrTile(surface: 'PPV Banner' | 'PPV Tile') {
      await validateMobileBannerOrTilePage(driver, surface, eventData, SOURCE, iosAvailabilityResults);
    }

    const iosFlowHooks: IOSFlowHooks = {
      validateSurface: validateMobileBannerOrTile,
      validatePaywall: validateMobilePaywall,
      recordAvailability: recordIOSPPVAvailability,
      saveScreenshot: (relativePath) => saveIOSScreenshot(driver, relativePath),
      generateAvailabilityFailureReport: generateIOSAvailabilityFailureReport,
    };

    // ── landing-page-banner ───────────────────────────────────────────────
    if (SOURCE === 'landing-page-banner') {
      console.log('  Landing page banner flow: find PPV banner, buy, validate.');
      buyTapped = await openLandingBannerPaywall(driver, PPV_NAME, iosFlowHooks);

      // Perform Gemini AI visual check on the captured iOS landing page banner
      const screenshotPath = path.resolve(process.cwd(), 'test-results', 'ios_landing_ppv_banner_found.png');
      if (fs.existsSync(screenshotPath)) {
        console.log(`🤖 [Gemini] Starting visual validation of iOS landing page banner: ${screenshotPath}`);
        const mockBanner = {
          screenshot: async () => fs.readFileSync(screenshotPath)
        };
        try {
          const { validatePpvBannerImage } = require('../../../utils/geminiBannerValidator');
          const geminiResult = await validatePpvBannerImage(mockBanner, {
            region: REGION,
            flow: 'landing-page-banner',
          });

          if (geminiResult) {
            console.log(`🤖 [Gemini] Visual validation complete. Passed: ${geminiResult.passed}`);
            iosAvailabilityResults.push({
              page: 'Landing Page',
              field: 'Visual Banner Quality (Gemini)',
              expected: 'pass',
              actual: geminiResult.passed ? 'pass' : 'fail',
              status: geminiResult.passed ? 'PASS' : 'FAIL',
            });
          }
        } catch (err: any) {
          console.error(`⚠️ [Gemini] Visual validation failed with error: ${err.message}`);
        }
      }
    }
    // ── schedule ────────────────────────────────────────────────────────────
    else if (SOURCE === 'schedule') {
      buyTapped = await openSchedulePPVPaywall(driver, PPV_NAME, json, iosFlowHooks);
    }
    // ── search ────────────────────────────────────────────────────────────
    else if (SOURCE === 'search') {
      let searchQuery = PPV_NAME;
      if (searchQuery.includes(':')) {
        searchQuery = searchQuery.split(':').pop()?.trim() || searchQuery;
      }
      searchQuery = searchQuery.replace(/\./g, '');
      buyTapped = await openSearchResultPaywall(driver, PPV_NAME, searchQuery, iosFlowHooks);
    }
    // ── home-boxing-upcoming ────────────────────────────────────────────
    else if (SOURCE === 'home-boxing-upcoming') {
      buyTapped = await openHomeBoxingUpcomingPaywall(driver, PPV_NAME, json, iosFlowHooks);
    }
    // ── home-boxing-banner ────────────────────────────────────────────────
    else if (SOURCE === 'home-boxing-banner') {
      buyTapped = await openHomeBoxingBannerPaywall(driver, PPV_NAME, iosFlowHooks);
    }
    // ── home-page-banner ──────────────────────────────────────────────────
    else if (SOURCE === 'home-page-banner') {
      buyTapped = await openHomeBannerPaywall(driver, PPV_NAME, iosFlowHooks);
      if (iosFlowHooks.validatePaywall) {
        await iosFlowHooks.validatePaywall();
      }
      const copyResult = await copyImmediateCheckoutUrl(driver, 'home-page-banner', {
        screenshotPrefix: 'home',
      });
      bannerCheckoutUrl = copyResult.url;
      bannerUrlCaptured = copyResult.captured;
      buyTapped = true;
    }
    // ── fallback ──────────────────────────────────────────────────────────
    else {
      console.log(`⚠️ Unknown SOURCE "${SOURCE}" — generic Home screen fallback`);
      buyTapped = await openGenericPPVPaywall(driver, PPV_NAME, iosFlowHooks);
    }

    if (!buyTapped) {
      await driver.saveScreenshot('./test-results/ios_buy_not_found.png');
      throw new Error(`❌ Could not tap Buy CTA. SOURCE="${SOURCE}". See test-results/ios_buy_not_found.png`);
    }

    // ── Capture checkout URL ─────────────────────────────────────────────
    console.log("📋 Capturing checkout URL from Safari...");
    try {
      await validateMobilePaywall();
    } catch (err: any) {
      console.warn('⚠️ Mobile paywall validation failed:', err.message);
    }
    await driver.saveScreenshot("./test-results/ios_paywall_screen.png");

    let checkoutUrl = bannerUrlCaptured ? bannerCheckoutUrl : "";
    if (!checkoutUrl) {
      checkoutUrl = await captureCheckoutUrl(driver);
    }

    if (checkoutUrl && (checkoutUrl.includes("dazn.com") || checkoutUrl.includes("amazonaws.com"))) {
      console.log("✅ Checkout URL captured successfully");
    } else {
      await driver.saveScreenshot("./test-results/ios_url_not_found.png");
      throw new Error(`❌ Could not capture checkout URL from Safari.\n   Got: ${checkoutUrl}`);
    }

    console.log(`\n🌐 Checkout URL captured:\n   ${checkoutUrl}\n`);
    writeHandoffUrl(checkoutUrl);
    console.log("✅ URL written to mobile_entry_url.txt");
    try {
      await driver.terminateApp(BUNDLE_ID);
    } catch {}
    await driver.pause(1000);

    // ── Playwright Web Checkout Phase ──────────────────────────────────────────
    console.log("📱 Launching Desktop Playwright checkout flow...");
    const originalCwd = process.cwd();
    let playwrightBrowser: any = null;
    let context: any = null;
    const runStart = new Date();
    let finalResults: any[] = [];
    let finalJson: any = null;
    let finalFlowConfig: any = null;
    let reachedEndPage = false;

    try {
      const nodePath = require('path');
      const nodeFs = require('fs');
      process.chdir(nodePath.resolve(__dirname, '../../..'));

      const { chromium } = require('@playwright/test');
      const fs = nodeFs;
      const path = nodePath;

      const { SignupPage } = require('../../../pages/SignupPage');
      const { PaymentPage } = require('../../../pages/PaymentPage');
      const {
        configureExcelPathForEvent,
        getPaymentDataByTierAndPlan,
      } = require('../../../utils/excelReader');

      const { detectVariant } = require('../../../flows/detectVariant');
      const { detectPageType } = require('../../../utils/flowHelpers');
      const { displayResultsTable } = require('../../../utils/resultsDisplay');
      const { writeResults } = require('../../../utils/excelWriter');
      const { generateReports } = require('../../../utils/reportGenerator');

      const {
        sleep,
        handleCookies,
        stabilisePage,
        dismissMarketingPopup,
      } = require('../../../utils/helpers');

      let webCheckoutUrl = checkoutUrl.replace('platform=ios', 'platform=web').replace('platform=android', 'platform=web');
      const separator = webCheckoutUrl.includes('?') ? '&' : '?';
      webCheckoutUrl = `${webCheckoutUrl}${separator}country=${REGION.toLowerCase()}`;

      const planName = ratePlan === 'monthly' ? 'Flex Monthly' : 'APM';
      const tierName = planTier.charAt(0).toUpperCase() + planTier.slice(1);
      const srcLabel = SOURCE.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

      const flowConfig = {
        name: `iOS New User: ${srcLabel} → ${tierName} → ${planName}`,
        source: SOURCE,
        tier: planTier,
        ratePlan: ratePlan,
        endPage: 'payment',
        planKey: PLAN
      };

      console.log(`\n╔═══════════════════════════════════════════════════════╗`);
      console.log(`║  RUNNING LOCAL PLAYWRIGHT WEB CHECKOUT: ${flowConfig.name}`);
      console.log(`╚═══════════════════════════════════════════════════════╝\n`);

      const results: any[] = [];
      results.push(...iosAvailabilityResults);
      finalJson = json;
      finalFlowConfig = flowConfig;
      finalResults = results;
      configureExcelPathForEvent(json.eventKey || '');

      const regionLocaleMap: Record<string, { locale: string; timezoneId: string }> = {
        GB: { locale: 'en-GB', timezoneId: 'Europe/London' },
        UK: { locale: 'en-GB', timezoneId: 'Europe/London' },
        US: { locale: 'en-US', timezoneId: 'America/New_York' },
      };
      const { locale: activeLocale, timezoneId: activeTz } =
        regionLocaleMap[REGION] ?? { locale: 'en-GB', timezoneId: 'Europe/London' };

      playwrightBrowser = await chromium.launch({
        headless: true,
        args: ['--incognito', '--no-first-run', '--disable-first-run-ui']
      });

      context = await playwrightBrowser.newContext({
        viewport: { width: 375, height: 667 },
        timezoneId: activeTz,
        locale: activeLocale,
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1'
      });

      // Inject country override cookies to force target region layout on local machine Playwright instance
      await context.addCookies([
        { name: 'user_country', value: REGION.toUpperCase(), domain: '.dazn.com', path: '/' },
        { name: 'country', value: REGION.toUpperCase(), domain: '.dazn.com', path: '/' },
        { name: 'detected_country', value: REGION.toUpperCase(), domain: '.dazn.com', path: '/' },
        { name: 'selected_country', value: REGION.toUpperCase(), domain: '.dazn.com', path: '/' },
      ]);

      const page = await context.newPage();
      await page.goto(webCheckoutUrl);

      // Explicitly wait for cookies
      const acceptBtn = page.locator('#onetrust-accept-btn-handler');
      try {
        await acceptBtn.waitFor({ state: 'visible', timeout: 20000 });
        await acceptBtn.click({ force: true });
        await page.locator('#onetrust-banner-sdk').waitFor({ state: 'hidden', timeout: 8000 }).catch(() => { });
      } catch (e) {
        await handleCookies(page, 5000);
      }

      const variant = await detectVariant(page, json.variants).catch(() => 'variant1');

      let pageType: string = 'unknown';

      // Traverse checkout funnel
      for (let step = 0; step < 15; step++) {
        if (page.isClosed()) throw new Error('❌ Page closed unexpectedly');

        pageType = await detectPageType(page, json.pages, 0);
        await handleCookies(page, 500);
        await stabilisePage(page);
        await dismissMarketingPopup(page);
        console.log(`\nstep ${step + 1} → pageType: ${pageType} | url: ${page.url()}`);

        // Welcome page handler (clicks CTA using LandingPage page object)
        if (pageType === 'welcome') {
          console.log('👉 Welcome page: finding PPV container & clicking Buy Now...');
          const { LandingPage } = require('../../../pages/LandingPage');
          const landing = new LandingPage(page);
          // Re-map real iOS device SOURCE to the matching web landing page equivalent
          const webSource = SOURCE === 'landing-page-banner' ? 'landing-page-banner' : SOURCE;
          const container = await landing.findPPVContainer(eventData, webSource);
          await landing.clickBuyNow(container, webSource);
          await page.waitForTimeout(2000);
          continue;
        }

        // New user registration (signup)
        if (pageType === 'email') {
          const signup = new SignupPage(page);
          const randEmail = `newuser.ios.${Date.now()}@yopmail.com`;
          console.log(`👉 Signup page: entering email ${randEmail}`);
          await signup.enterEmail(randEmail);
          await signup.clickContinue();
          await page.waitForTimeout(2000);
          continue;
        }

        if (pageType === 'password') {
          const signup = new SignupPage(page);
          console.log('👉 Password signup page: entering password');
          await signup.enterPassword('Dazn@1234');
          await signup.clickContinue();
          await page.waitForTimeout(2000);
          continue;
        }

        if (pageType === 'payment') {
          console.log('💳 Reached Payment page');
          reachedEndPage = true;

          const payment = new PaymentPage(page);
          if (await payment.isPaymentPage()) {
            const planKey = SOURCE.startsWith('boxing-bundle') ? `${ratePlan} bundle` : ratePlan;
            const paymentData = getPaymentDataByTierAndPlan(planTier, planKey);
            await payment.validate(paymentData, results, eventData, 'newuser');
          }
          break;
        }

        // Fallback progress clicker
        try {
          const nextBtn = page.locator('button:has-text("Continue"), button:has-text("Next"), button[type="submit"]').first();
          if (await nextBtn.isVisible()) {
            await nextBtn.click();
            await page.waitForTimeout(2500);
            continue;
          }
        } catch {}

        break;
      }

      console.log('🎥 Stopping screen recording on iOS device...');
      let videoOutputPath: string | null = null;
      try {
        const videoBuffer = await driver.stopRecordingScreen();
        if (videoBuffer) {
          const videoDir = path.resolve(process.cwd(), 'test-results');
          if (!fs.existsSync(videoDir)) fs.mkdirSync(videoDir, { recursive: true });
          videoOutputPath = path.join(videoDir, `handoff_run_${Date.now()}.mp4`);
          fs.writeFileSync(videoOutputPath, Buffer.from(videoBuffer, 'base64'));
          console.log(`🎥 Video saved to: ${videoOutputPath}`);
        }
      } catch {}

      // Write results to Excel
      const { excelPath, videoPath } = await writeResults(results, videoOutputPath);
      displayResultsTable(results, 'ppv', {
        event: json.PPV_NAME,
        region: REGION,
        excelPath,
        videoPath,
      });

      await generateReports(results, {
        event: json.PPV_NAME,
        region: REGION,
        source: flowConfig.source,
        ratePlan: flowConfig.ratePlan,
        tier: flowConfig.tier,
        env: ENV,
        flowName: flowConfig.name,
        startTime: runStart,
        endTime: new Date(),
        excelPath,
        videoPath,
        userType: 'new-user',
        platform: 'iOS',
      });

      const passed = results.filter(r => r.status === 'PASS').length;
      const failed = results.filter(r => r.status === 'FAIL').length;
      const total = passed + failed;

      console.log(`\n✅ Flow "${flowConfig.name}" complete: ${passed}/${total} passed`);

      if (total === 0) throw new Error('❌ Had 0 validation checks');
      if (!reachedEndPage) throw new Error('❌ Did not reach expected end page');

    } catch (playwrightErr: any) {
      console.error(`❌ Local Playwright Web Checkout failed: ${playwrightErr.message}`);
      throw playwrightErr;
    } finally {
      if (context) await context.close().catch(() => { });
      if (playwrightBrowser) await playwrightBrowser.close().catch(() => { });
      process.chdir(originalCwd);
    }
  });

  after(async () => {
    try {
      await browser.stopRecordingScreen().catch(() => { });
    } catch {}
  });
});
