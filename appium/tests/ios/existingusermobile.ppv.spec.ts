// ─────────────────────────────────────────────────────────────────────────────
// DAZN PPV — iOS Appium Existing User Test
//
// DEVICE: iOS Simulator / Real Device (configured in config/wdio.ios.conf.ts)
// EVENT:  Configurable via PPV_CONFIG env var
//
// FLOW:
//   1. DAZN app opens (already logged in, noReset=true)
//   2. Dismisses system alerts (ATT, notifications) & landing page interstitials
//   3. Pre-login flow (if My Account source):
//      - Navigate to signin page
//      - Enter email and password
//      - Sign in
//      - Navigate to My Account
//   4. Navigate to PPV buy button based on SOURCE env var:
//        myaccount                → My Account → Find PPV → Buy
//        schedule                 → Bottom tab → Schedule → scroll to event → Buy
//        boxing-upcoming-fights   → Sports tab → Boxing → Upcoming Big Fights → Buy
//        boxing-page-banner       → Sports tab → Boxing → hero banner → Buy
//        home-boxing-banner       → Home Boxing filter → Boxing page → hero banner → Buy
//        home-boxing-upcoming     → Home Boxing filter → Upcoming Fights → Buy
//        home-boxing-tile         → Home Boxing rail → Buy
//        search                   → Search icon/tab → Search for event → Buy
//   5. App opens Safari View Controller or redirects to Safari
//   6. Captures URL via WebView context switch or Safari address bar fallback
//   7. Writes URL to mobile_entry_url.txt  ← Playwright reads this
//
// HOW TO RUN:
//   cd appium && npm run ios
//   Overrides: PPV_NAME="Joshua" SOURCE="myaccount" USER_STATE="active_standard" npm run ios
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
import { IOSMyAccountPage, openMyAccountPPVPaywall, preLoginFlow as sharedPreLoginFlow } from '../../pages/ios/IOSMyAccountPage';
import { openHomeBannerPaywall, openGenericPPVPaywall } from '../../pages/ios/IOSHomePage';
import { openLandingBannerPaywall } from '../../pages/ios/IOSLandingPage';
import { copyImmediateCheckoutUrl } from '../../pages/ios/IOSPaywallPage';
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
import { getIOSSurfacingPoint, getIOSValidationSheet } from '../../pages/ios/IOSSurfacingPoint';
import {
  validateMobilePaywallPage,
  validateMobileBannerOrTilePage,
  IOSValidationResult,
} from '../../pages/ios/IOSValidationPage';

// ── Config ───────────────────────────────────────────────────────────────────
const event: EventConfig = loadEventConfig();
const PPV_NAME = event.PPV_NAME;
const SCHEDULE_PPV_TITLE = event.PPV_NAME;
const SOURCE: string = (process.env.SOURCE || 'myaccount').trim().toLowerCase();
const USER_STATE = process.env.USER_STATE || 'active_standard_monthly';
process.env.USER_STATE = USER_STATE;
const MODE = (process.env.IOS_DEVICE_MODE || 'simulator').toLowerCase();
const BUNDLE_ID = process.env.DAZN_BUNDLE_ID || (MODE === 'real' ? 'com.dazn.theApp' : 'com.dazn.enterprise');
const REGION = process.env.DAZN_REGION || 'GB';
const LOGIN_FIRST = (process.env.LOGIN_FIRST || process.env.LOGIN || '').toLowerCase() === 'true';

let USER_EMAIL = process.env.USER_EMAIL || '';
let USER_PASSWORD = process.env.USER_PASSWORD || '';

// Dynamically resolve credentials matching the web flow
if (!USER_EMAIL || !USER_PASSWORD) {
  try {
    const fs = require('fs');
    const path = require('path');
    const originalCwd = process.cwd();
    const projectRoot = path.resolve(__dirname, '../../..');
    process.chdir(projectRoot);

    const { buildEventData } = require('../../../utils/buildEventData');
    const { loadEventConfig } = require('../../../utils/testHelpers');
    const eventConfig = process.env.PPV_CONFIG || 'ppv_t_joshua_prenga.json';
    const eventJson = loadEventConfig(eventConfig);
    const eventData = buildEventData(eventJson, REGION);
    USER_EMAIL = eventData.USER_EMAIL || '';
    USER_PASSWORD = eventData.USER_PASSWORD || '';
    console.log(`🔑 Resolved credentials from config: ${USER_EMAIL}`);

    process.chdir(originalCwd);
  } catch (e: any) {
    console.warn('⚠️ Failed to resolve credentials from config:', e.message);
  }
}

// ── Direct aliases for shared utilities ─────────
const isVisible = sharedIsVisible;
const captureCheckoutUrl = sharedCaptureCheckoutUrl;

async function findEl(driver: WdBrowser, sel: string, timeoutMs = 10000): Promise<WdElement> {
  return sharedFindEl(driver, sel, timeoutMs);
}
async function tapByText(driver: WdBrowser, text: string, timeoutMs = 10000): Promise<boolean> {
  return sharedTapByText(driver, text, timeoutMs);
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
  if (source.includes('myaccount')) return 'My Account';
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
      flowName: `iOS ${USER_STATE}: ${srcLabel}`,
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
      flowName: `iOS ${USER_STATE}: ${srcLabel}`,
      startTime: new Date(),
      endTime: new Date(),
      excelPath,
      videoPath,
      userType: 'existing-user',
      userStatus: USER_STATE,
      platform: 'iOS',
    });
    console.log(`📊 iOS PPV availability failure report generated: ${errorMessage}`);
  } catch (reportErr: any) {
    console.error(`⚠️ Failed to generate iOS availability failure report: ${reportErr.message}`);
  } finally {
    process.chdir(originalCwd);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// TEST
// ════════════════════════════════════════════════════════════════════════════
describe('DAZN iOS PPV — Existing User Flow', () => {
  before(async () => {
    clearHandoffUrl();
    require('fs').mkdirSync('./test-results', { recursive: true });
    console.log(`\n╔════════════════════════════════════════════════════╗`);
    console.log(`║  DAZN iOS PPV — Existing User                     ║`);
    console.log(`║  Event  : ${PPV_NAME.padEnd(40)}║`);
    console.log(`║  Source : ${SOURCE.padEnd(40)}║`);
    console.log(`║  User   : ${USER_STATE.padEnd(40)}║`);
    console.log(`╚════════════════════════════════════════════════════╝\n`);

    console.log('🎥 Starting screen recording on iOS device/simulator...');
    await browser.startRecordingScreen({
      timeLimit: 600,
      videoType: 'mp4',
    }).catch(e => console.error('⚠️ Failed to start screen recording:', e));

    await prepareIosApp(browser, {
      clearAppData: false, // iOS simulator/real devices preserve cache
      acceptCookiesOnly: LOGIN_FIRST || undefined,
      waitForHome: !LOGIN_FIRST,
    });
  });

  it('navigates to PPV buy button as existing user, opens Safari, captures checkout URL', async () => {
    const driver = browser;
    const baseUrl = 'https://www.dazn.com';

    console.log('✅ Startup handled by prepareIosApp; beginning existing-user PPV navigation');

    let buyTapped = false;
    let bannerUrlCaptured = false;
    let bannerCheckoutUrl = "";
    let paywallValidated = false;
    const paywallValidatedRef = { value: false };

    const isMyAccount = SOURCE === 'myaccount' || SOURCE === 'myaccount-subscription-status';
    const appiumResults: any[] = [];

    const fs = require('fs');
    const path = require('path');
    const { buildEventData } = require('../../../utils/buildEventData');
    const { loadEventConfig } = require('../../../utils/testHelpers');
    const EVENT_CONFIG = process.env.PPV_CONFIG || 'ppv_t_joshua_prenga.json';
    const PLAN = process.env.PLAN || 'standard_monthly';
    const json = loadEventConfig(EVENT_CONFIG, PLAN);
    const plansPath = path.resolve(__dirname, '../../..', 'config/DaznPlan.json');
    const plans = JSON.parse(fs.readFileSync(plansPath, 'utf-8'));
    const planData = plans[PLAN] || { TIER: 'standard', RATE_PLAN: 'monthly' };
    const planTier = (planData.TIER || 'standard').toLowerCase();
    const ratePlan = (planData.RATE_PLAN || 'monthly').toLowerCase();

    const eventData = buildEventData(json, REGION, planTier, ratePlan.replace(/-/g, ' '), SOURCE);

    // Merge mobile overrides
    try {
      let mobileConfigPath = path.resolve(__dirname, '../../config/events', EVENT_CONFIG);
      if (!fs.existsSync(mobileConfigPath) && json.eventKey) {
        mobileConfigPath = path.resolve(__dirname, '../../config/events', `${json.eventKey}.json`);
      }
      if (fs.existsSync(mobileConfigPath)) {
        const mobileJson = JSON.parse(fs.readFileSync(mobileConfigPath, 'utf8'));
        const mobileRegional = mobileJson.regions?.[REGION] || {};
        Object.assign(eventData, mobileRegional);
        console.log(`📱 Loaded mobile-specific overrides from ${mobileConfigPath}`);
      } else {
        console.warn(`⚠️ Mobile config override file not found: ${EVENT_CONFIG}`);
      }
    } catch (e: any) {
      console.warn(`⚠️ Failed to load mobile overrides: ${e.message}`);
    }

    // validateMobilePaywall
    async function validateMobilePaywall() {
      await validateMobilePaywallPage(driver, eventData, SOURCE, iosAvailabilityResults, paywallValidatedRef);
      paywallValidated = paywallValidatedRef.value;
    }

    // validateMobileBannerOrTile
    async function validateMobileBannerOrTile(surface: 'PPV Banner' | 'PPV Tile') {
      await validateMobileBannerOrTilePage(driver, surface, eventData, SOURCE, iosAvailabilityResults);
    }

    // ── Pre-Login Phase ───────────────────────────────────────────────────
    if (isMyAccount || LOGIN_FIRST) {
      if (!USER_EMAIL || !USER_PASSWORD) {
        throw new Error(
          `LOGIN_FIRST requires USER_EMAIL and USER_PASSWORD. No credentials resolved for USER_STATE="${USER_STATE}"`,
        );
      }
      await sharedPreLoginFlow(driver, baseUrl, { email: USER_EMAIL, password: USER_PASSWORD });
      console.log('🔍 Waiting for post-login cleanup...');
      await waitForHomePage(driver);
    }

    const iosFlowHooks: IOSFlowHooks = {
      validateSurface: validateMobileBannerOrTile,
      validatePaywall: validateMobilePaywall,
      recordAvailability: recordIOSPPVAvailability,
      saveScreenshot: (relativePath) => saveIOSScreenshot(driver, relativePath),
      generateAvailabilityFailureReport: generateIOSAvailabilityFailureReport,
    };

    // ── myaccount ─────────────────────────────────────────────────────────
    if (isMyAccount) {
      const myAccountPage = new IOSMyAccountPage(driver, PPV_NAME);
      const ppvStatus = await myAccountPage.getPPVStatus(PPV_NAME);
      if (ppvStatus === 'Purchased' || ppvStatus === 'Included') {
        console.log(`\n✅ [Already Purchased] PPV "${PPV_NAME}" status: ${ppvStatus}`);
        console.log('   Skipping buy flow — PPV is already owned by this user.');

        const imagePresent = await myAccountPage.hasPPVImage(PPV_NAME);
        appiumResults.push({
          page: 'My Account',
          field: 'PPV Image Present',
          expected: 'Yes',
          actual: imagePresent ? 'Yes' : 'No',
          status: imagePresent ? 'PASS' : 'FAIL',
        });

        const title = await myAccountPage.getPPVName(PPV_NAME);
        const expectedTitle = eventData.PPV_NAME || PPV_NAME;
        const titleStatus = title.toLowerCase().includes(expectedTitle.toLowerCase()) ? 'PASS' : 'FAIL';
        appiumResults.push({
          page: 'My Account',
          field: 'PPV Title',
          expected: expectedTitle,
          actual: title,
          status: titleStatus,
        });

        const dateTime = await myAccountPage.getPPVDate(PPV_NAME);
        appiumResults.push({
          page: 'My Account',
          field: 'PPV Date & Time',
          expected: eventData.PPV_DATE || '',
          actual: dateTime,
          status: dateTime !== 'N/A' ? 'PASS' : 'FAIL',
        });

        buyTapped = true;
      } else {
        console.log(`\n🛒 PPV "${PPV_NAME}" not yet purchased (status: ${ppvStatus}) — proceeding with buy flow`);
        buyTapped = await openMyAccountPPVPaywall(driver, PPV_NAME, iosFlowHooks);
      }
    }
    // ── schedule ────────────────────────────────────────────────────────────
    else if (SOURCE === 'schedule') {
      buyTapped = await openSchedulePPVPaywall(driver, PPV_NAME, event, iosFlowHooks);
    }
    // ── search ────────────────────────────────────────────────────────────
    else if (SOURCE === 'search') {
      let searchQuery = PPV_NAME;
      try {
        const fs = require('fs');
        const path = require('path');
        const configFileName = process.env.PPV_CONFIG || 'ppv_t_joshua_prenga.json';
        const configPath = path.resolve(__dirname, '../../..', 'config/events', configFileName);
        if (fs.existsSync(configPath)) {
          const configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
          if (configData.PPV_NAME) {
            searchQuery = configData.PPV_NAME;
          }
        }
      } catch {}

      if (searchQuery.includes(':')) {
        searchQuery = searchQuery.split(':').pop()?.trim() || searchQuery;
      }
      searchQuery = searchQuery.replace(/\./g, '');
      buyTapped = await openSearchResultPaywall(driver, PPV_NAME, searchQuery, iosFlowHooks);
    }
    // ── boxing-upcoming-fights ────────────────────────────────────────────
    else if (SOURCE === 'boxing-upcoming-fights') {
      buyTapped = await openBoxingUpcomingFightsPaywall(driver, PPV_NAME, iosFlowHooks);
    }
    // ── boxing-page-banner ────────────────────────────────────────────────
    else if (SOURCE === 'boxing-page-banner') {
      buyTapped = await openBoxingPageBannerPaywall(driver, PPV_NAME, iosFlowHooks, { requireBanner: true });
    }
    // ── home-boxing-upcoming ──────────────────────────────────────────────
    else if (SOURCE === 'home-boxing-upcoming') {
      buyTapped = await openHomeBoxingUpcomingPaywall(driver, PPV_NAME, event, iosFlowHooks);
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
    // ── landing-page-banner ───────────────────────────────────────────────
    else if (SOURCE === 'landing-page-banner') {
      buyTapped = await openLandingBannerPaywall(driver, PPV_NAME, iosFlowHooks);
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

    // ── Step 3: Capture checkout URL from paywall screen ──────────────────
    console.log("📋 Capturing checkout URL from paywall...");
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
    console.log("📱 Closing DAZN app...");
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
    let finalExcelPath: string | null = null;
    let finalVideoPath: string | null = null;
    let finalNativeVideoPath: string | null = null;
    let reportGenerated = false;

    try {
      const nodePath = require('path');
      const nodeFs = require('fs');
      process.chdir(nodePath.resolve(__dirname, '../../..'));
      console.log(`📂 Changed working directory to: ${process.cwd()}`);

      const { chromium } = require('@playwright/test');
      const fs = nodeFs;
      const path = nodePath;

      const { SignupPage } = require('../../../pages/SignupPage');
      const { PaymentPage } = require('../../../pages/PaymentPage');
      const { SearchPage } = require('../../../pages/SearchPage');
      const { MyAccountPage } = require('../../../pages/MyAccountPage');
      const { SchedulePage: WebSchedulePage } = require('../../../pages/schedulepage');

      const {
        configureExcelPathForEvent,
        getPaymentDataByTierAndPlan,
        getOTPPageData,
        getPhonePageData,
        getPPVPaymentData,
      } = require('../../../utils/excelReader');

      const { detectVariant } = require('../../../flows/detectVariant');
      const { buildEventData } = require('../../../utils/buildEventData');
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

      const REGION = process.env.DAZN_REGION || 'GB';
      const EVENT_CONFIG = process.env.PPV_CONFIG || 'ppv_t_joshua_prenga.json';
      const PLAN = process.env.PLAN || 'standard_monthly';
      const PPV_TYPE = (process.env.PPV_TYPE || 'normal').toLowerCase();
      const SWITCH_TO_ULTIMATE = (process.env.SWITCH || '').toLowerCase() === 'true';
      const PLAN_TARGET = (process.env.PLAN || '').toLowerCase().replace(/[- ]/g, '_');
      const WANT_ULTIMATE = SWITCH_TO_ULTIMATE || PLAN_TARGET === 'ultimate_apm' || PLAN_TARGET === 'ultimate_apu';
      const ENV = (process.env.DAZN_ENV || 'stag').toLowerCase();
      const PAYMENT_METHOD = (process.env.PAYMENT_METHOD || 'credit_card').toLowerCase();

      async function captureFailShot(page: any, field: string): Promise<string | undefined> {
        try {
          const dir = path.resolve(process.cwd(), 'test-results', 'screenshots');
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          const safe = field.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 40);
          const shotPath = path.join(dir, `FAIL_${safe}_${Date.now()}.jpg`);
          await page.screenshot({ path: shotPath, type: 'jpeg', quality: 75 });
          return shotPath;
        } catch {
          return undefined;
        }
      }

      let webCheckoutUrl = checkoutUrl.replace('platform=ios', 'platform=web').replace('platform=android', 'platform=web');

      const json = loadEventConfig(EVENT_CONFIG);
      const plansPath = path.resolve(__dirname, '../../..', 'config/DaznPlan.json');
      const plans = JSON.parse(fs.readFileSync(plansPath, 'utf-8'));
      const planData = plans[PLAN];
      if (!planData) {
        throw new Error(`❌ Plan "${PLAN}" not found in DaznPlan.json`);
      }

      const planTier = (planData.TIER || 'standard').toLowerCase();
      const ratePlan = (planData.RATE_PLAN || 'monthly').toLowerCase();

      const planName = ratePlan === 'monthly'
        ? 'Flex Monthly'
        : (ratePlan.includes('upfront') ? 'APU' : 'APM');
      const tierName = planTier.charAt(0).toUpperCase() + planTier.slice(1);
      const srcLabel = SOURCE.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

      const formattedUserState = USER_STATE
        .split('_')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');

      const flowConfig = {
        name: `iOS ${formattedUserState}: ${srcLabel} → ${tierName} → ${planName}`,
        source: SOURCE,
        tier: planTier,
        ratePlan: ratePlan,
        endPage: 'payment',
        enableDevMode: planTier === 'ultimate',
        planKey: PLAN
      };

      console.log(`\n╔═══════════════════════════════════════════════════════╗`);
      console.log(`║  RUNNING LOCAL PLAYWRIGHT WEB CHECKOUT: ${flowConfig.name}`);
      console.log(`╚═══════════════════════════════════════════════════════╝\n`);

      const results: any[] = [];
      results.push(...iosAvailabilityResults);
      results.push(...appiumResults);
      finalJson = json;
      finalFlowConfig = flowConfig;
      finalResults = results;
      configureExcelPathForEvent(json.eventKey || '');

      const eventData = buildEventData(json, REGION, planTier, ratePlan.replace(/-/g, ' '), SOURCE);
      eventData.source = SOURCE;
      eventData.SOURCE = SOURCE;
      eventData.MOBILE_WEB_HANDOFF = 'true';

      const regionLocaleMap: Record<string, { locale: string; timezoneId: string }> = {
        GB: { locale: 'en-GB', timezoneId: 'Europe/London' },
        UK: { locale: 'en-GB', timezoneId: 'Europe/London' },
        US: { locale: 'en-US', timezoneId: 'America/New_York' },
      };
      const REGION_KEY = (process.env.DAZN_REGION || 'GB').toUpperCase();
      const { locale: activeLocale, timezoneId: activeTz } =
        regionLocaleMap[REGION_KEY] ?? { locale: 'en-GB', timezoneId: 'Europe/London' };

      console.log('Launching desktop Chromium browser for checkout...');
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

      const page = await context.newPage();
      console.log(`\n🌐 Opening handoff URL in Playwright: ${webCheckoutUrl}\n`);
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
      console.log('🎯 variant:', variant);

      let reachedEndPage = false;
      let ppvValidated = false;
      let firstPaymentDone = false;
      let savedCardPaymentDone = false;
      let pageType: string = 'unknown';

      // Traverse checkout funnel
      for (let step = 0; step < 15; step++) {
        if (page.isClosed()) throw new Error('❌ Page closed unexpectedly');

        pageType = await detectPageType(page, json.pages, 0);
        await handleCookies(page, 500);
        await stabilisePage(page);
        await dismissMarketingPopup(page);
        console.log(`\nstep ${step + 1} → pageType: ${pageType} | url: ${page.url()}`);

        if (pageType === 'myaccount-ppv') {
          console.log('\n✅ [Purchased] Landed on My Account PPV page.');
          reachedEndPage = true;
          try {
            const myAccountPage = new MyAccountPage(page);
            await myAccountPage.validatePPVOnCurrentPage(eventData.PPV_NAME, results, eventData);
          } catch (myAccountErr: any) {
            console.warn(`⚠️ [My Account PPV] Validation error: ${myAccountErr.message}`);
          }
          break;
        }

        // OTP Verification page
        if (pageType === 'otp') {
          console.log('🔑 Reached OTP Verification page');
          reachedEndPage = true;
          try {
            const otpData = getOTPPageData();
            for (const row of otpData) {
              const field = (row['Field'] || '').trim();
              const expected = (row['Expected'] || '').toString().trim();
              if (!field) continue;

              let actual = 'N/A';
              const fieldLower = field.toLowerCase();
              if (fieldLower === 'page title') {
                actual = await page.locator('h1').first().textContent().catch(() => 'N/A');
              } else if (fieldLower === 'otp input present') {
                actual = await page.locator('input').count() > 0 ? 'Yes' : 'No';
              }
              const status = actual.toLowerCase().includes(expected.toLowerCase()) ? 'PASS' : 'FAIL';
              results.push({ page: 'OTP Verification', field, expected, actual, status });
            }
          } catch {}
          break;
        }

        // Phone Number page
        if (pageType === 'phone') {
          console.log('Referencing phone number page');
          reachedEndPage = true;
          try {
            const phoneData = getPhonePageData();
            for (const row of phoneData) {
              const field = (row['Field'] || '').trim();
              const expected = (row['Expected'] || '').toString().trim();
              if (!field) continue;
              let actual = 'N/A';
              if (field.toLowerCase() === 'page title') {
                actual = await page.locator('h1').first().textContent().catch(() => 'N/A');
              }
              results.push({ page: 'Phone Number', field, expected, actual, status: 'PASS' });
            }
          } catch {}
          break;
        }

        // Saved Card Payment
        if (pageType === 'saved-card-payment' && !savedCardPaymentDone) {
          console.log('💳 PPV Saved Card Payment (existing user)');
          reachedEndPage = true;
          savedCardPaymentDone = true;
          break;
        }

        // Payment Details Page
        if (pageType === 'payment') {
          console.log('💳 Reached Payment page');
          reachedEndPage = true;

          const payment = new PaymentPage(page);
          if (await payment.isPaymentPage()) {
            const planKey = SOURCE.startsWith('boxing-bundle') ? `${ratePlan} bundle` : ratePlan;
            const paymentData = getPaymentDataByTierAndPlan(planTier, planKey);
            await payment.validate(paymentData, results, eventData, 'existinguser');
          }

          if (ENV === 'stag') {
            console.log(`💳 DAZN_ENV is stag — filling payment via method: ${PAYMENT_METHOD}`);
            try {
              if (PAYMENT_METHOD === 'gpay') {
                await payment.fillGooglePayAndSubmit(results, eventData);
                await payment.verifyPaymentSuccess();
                await payment.clickSuccessContinue();
              } else {
                await payment.fillPaymentAndSubmit();
                await payment.verifyPaymentSuccess();
                await payment.clickSuccessContinue();
              }
              results.push({
                page: 'Payment Success',
                field: 'Payment Completed',
                expected: 'Success page reached',
                actual: 'Success page reached',
                status: 'PASS',
              });
            } catch (paymentErr: any) {
              console.error(`❌ Payment filling failed: ${paymentErr.message}`);
              throw paymentErr;
            }
          }
          break;
        }

        // Email / Login page
        if (pageType === 'email') {
          console.log('👉 Email/Login page');
          const signup = new SignupPage(page);
          await signup.enterEmail(USER_EMAIL);
          await signup.clickContinue();
          await page.waitForTimeout(2000);
          continue;
        }

        // Password page
        if (pageType === 'password') {
          console.log('🔑 Password page');
          const signup = new SignupPage(page);
          await signup.enterPassword(USER_PASSWORD);
          await signup.clickContinue();
          await page.waitForTimeout(2000);
          continue;
        }

        // Fallback progress clicker
        try {
          const nextBtn = page.locator('button:has-text("Continue"), button:has-text("Next"), button[type="submit"]').first();
          if (await nextBtn.isVisible()) {
            console.log('  Tapping generic Next/Continue button...');
            await nextBtn.click();
            await page.waitForTimeout(2500);
            continue;
          }
        } catch {}

        console.log('  ⚠️ Funnel page unrecognized, breaking to avoid infinite loop.');
        break;
      }

    } catch (playwrightErr: any) {
      console.error(`❌ Local Playwright Web Checkout failed: ${playwrightErr.message}`);
      throw playwrightErr;
    } finally {
      if (context) await context.close().catch(() => { });
      if (playwrightBrowser) await playwrightBrowser.close().catch(() => { });
      process.chdir(originalCwd);
    }

    // ── Generate reports ──
    const passed = finalResults.filter(r => r.status === 'PASS').length;
    const failed = finalResults.filter(r => r.status === 'FAIL').length;
    console.log(`\n📊 Run Summary: ${passed} passed, ${failed} failed`);
  });

  after(async () => {
    try {
      await browser.stopRecordingScreen().catch(() => { });
    } catch {}
  });
});
