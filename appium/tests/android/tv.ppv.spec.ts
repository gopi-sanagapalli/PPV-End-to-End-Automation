// WebdriverIO injects `browser` as a global at runtime.
// eslint-disable-next-line no-var
declare var browser: any;

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { writeHandoffUrl, readHandoffUrl, clearHandoffUrl } from '../../utils/handoff';
import { prepareAndroidApp } from '../../utils/androidSetup';
import { loadEventConfig } from '../../utils/eventLoader';
import { openSchedulePPVPaywall } from '../../pages/android/AndroidSchedulePage';
import { openFireTvSchedulePPVPaywall } from '../../pages/tv/FireTvSchedulePage';
import { openSearchResultPaywall } from '../../pages/android/AndroidSearchPage';
import { openHomeBannerPaywall, openGenericPPVPaywall } from '../../pages/android/AndroidHomePage';
import { openLandingBannerPaywall } from '../../pages/android/AndroidLandingPage';
import { copyImmediateCheckoutUrl } from '../../pages/android/AndroidPaywallPage';
import { captureCheckoutUrl } from '../../pages/android/AndroidBasePage';
import { primeAndroidTvFocus, sendTvKeyevent, TV_KEYCODES } from '../../utils/androidTvControls';
import { decodeCheckoutUrlFromQr } from '../../utils/qrBridge';
import { PNG } from 'pngjs';

const event = loadEventConfig();
const PPV_NAME = event.PPV_NAME;
const SOURCE = (process.env.SOURCE || 'home-page-banner').trim().toLowerCase();
const TV_TARGET = (process.env.TV_TARGET || 'androidtv').trim().toLowerCase();
const TV_LOGIN_ONLY = process.env.TV_LOGIN_ONLY === 'true';
const TV_WEB_LOGIN_ONLY = process.env.TV_WEB_LOGIN_ONLY === 'true';
const APP_PACKAGE = process.env.APP_PACKAGE || 'com.dazn';
const TV_LOGIN_FAILURE_KEEP_BROWSER_OPEN_MS = Number(
  process.env.TV_LOGIN_FAILURE_KEEP_BROWSER_OPEN_MS || (TV_WEB_LOGIN_ONLY && TV_TARGET === 'androidtv' ? '120000' : '0'),
);
const TV_LOGIN_SETTLE_MS = Number(process.env.TV_LOGIN_SETTLE_MS || (TV_TARGET === 'androidtv' ? '15000' : '10000'));
const BROWSER_LOGIN_COMPLETE_SETTLE_MS = Number(process.env.BROWSER_LOGIN_COMPLETE_SETTLE_MS || 3000);
const PPV_PURCHASE_BACK_SETTLE_MS = Number(process.env.PPV_PURCHASE_BACK_SETTLE_MS || 5000);
const FIRETV_POST_LOGIN_BANNER_WAIT_MS = Number(process.env.FIRETV_POST_LOGIN_BANNER_WAIT_MS || 8000);
const FIRETV_POST_LOGIN_AFTER_BACK_WAIT_MS = Number(process.env.FIRETV_POST_LOGIN_AFTER_BACK_WAIT_MS || 10000);
const ANDROIDTV_POST_LOGIN_WAIT_MS = Number(process.env.ANDROIDTV_POST_LOGIN_WAIT_MS || 15000);
const ANDROIDTV_POST_LOGIN_AFTER_BACK_WAIT_MS = Number(process.env.ANDROIDTV_POST_LOGIN_AFTER_BACK_WAIT_MS || 8000);
const ANDROIDTV_BROWSER_LOGIN_COMPLETE_TIMEOUT_MS = Number(process.env.ANDROIDTV_BROWSER_LOGIN_COMPLETE_TIMEOUT_MS || 8000);
const ANDROIDTV_BROWSER_LOGIN_RETRY_TIMEOUT_MS = Number(process.env.ANDROIDTV_BROWSER_LOGIN_RETRY_TIMEOUT_MS || 4000);
const ANDROIDTV_BROWSER_LOGIN_SETTLE_MS = Number(process.env.ANDROIDTV_BROWSER_LOGIN_SETTLE_MS || 500);
const ANDROIDTV_BROWSER_PLANS_BACK_CHECK_MS = Number(process.env.ANDROIDTV_BROWSER_PLANS_BACK_CHECK_MS || 3000);
const TV_PPV_REPORT_METADATA = process.env.TV_PPV_REPORT_METADATA || path.resolve(__dirname, '../../../tv_ppv_report_metadata.json');
const TV_PPV_SPEC_TIMEOUT_MS = Number(process.env.TV_PPV_SPEC_TIMEOUT_MS || 600000);
const TV_POST_LOGIN_SCREENSHOTS = process.env.TV_POST_LOGIN_SCREENSHOTS === 'true';
const TV_PAYWALL_INSTRUCTION_HEADER = 'How to watch this?';
const TV_PAYWALL_EMAIL_INSTRUCTION = 'Follow the instructions we’ve just sent you to';
const TV_PAYWALL_BROWSER_INSTRUCTION = "Go to 'My account' on a web browser to purchase this event";

type TvPpvReportStep = {
  page: string;
  field: string;
  expected: string;
  actual: string;
  status: 'PASS' | 'FAIL';
  screenshot?: string;
};

const tvPpvReportMetadata: { startTime: string; steps: TvPpvReportStep[] } = {
  startTime: new Date().toISOString(),
  steps: [],
};

function writeTvPpvReportMetadata(): void {
  try {
    fs.writeFileSync(TV_PPV_REPORT_METADATA, JSON.stringify(tvPpvReportMetadata, null, 2), 'utf-8');
  } catch (error: any) {
    console.warn(`⚠️ Could not write TV PPV report metadata: ${error?.message || error}`);
  }
}

function recordTvPpvReportStep(
  field: string,
  expected: string,
  actual: string,
  status: 'PASS' | 'FAIL' = 'PASS',
  page = 'TV PPV',
  screenshot?: string,
): void {
  tvPpvReportMetadata.steps.push({
    page,
    field,
    expected,
    actual,
    status,
    ...(screenshot ? { screenshot } : {}),
  });
  writeTvPpvReportMetadata();
}

function normalizeReportText(value: string): string {
  return String(value || '')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeForComparison(value: string): string {
  return normalizeReportText(value).toLowerCase();
}

function getEventValue(key: string): string {
  const region = (process.env.DAZN_REGION || 'GB').toUpperCase();
  return String(event.regions?.[region]?.[key] ?? event.global?.[key] ?? (event as any)[key] ?? '').trim();
}

function getExpectedEventName(): string {
  return getEventValue('PPV_DISPLAY_NAME') || getEventValue('PPV_NAME') || PPV_NAME;
}

function getExpectedTileName(): string {
  return getEventValue('PPV_CARD_TITLE') || getExpectedEventName();
}

function formatTvTime(value: string): string {
  const trimmed = String(value || '').trim();
  const match = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return normalizeReportText(trimmed.replace(/([AP]M)\1$/i, '$1').replace(/(\d)([AP]M)$/i, '$1 $2').toUpperCase());

  const hour24 = Number(match[1]);
  const minutes = match[2];
  const suffix = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${minutes} ${suffix}`;
}

function parseExpectedDateParts(): { weekday: string; weekdayFull: string; date: string; month: string; monthFull: string; time: string; dateTime: string } {
  const ppvDate = getEventValue('PPV_DATE');
  const match = ppvDate.replace(/(\d+)(st|nd|rd|th)/gi, '$1').match(/^([A-Za-z]{3,})\s+(\d{1,2})\s+([A-Za-z]{3,})/);
  const weekdayFull = match?.[1] || '';
  const weekday = weekdayFull.slice(0, 3).toUpperCase();
  const date = match?.[2] || '';
  const monthFull = match?.[3] || '';
  const month = monthFull.slice(0, 3).toUpperCase();
  const time = formatTvTime(getEventValue('PPV_TIME'));
  return { weekday, weekdayFull, date, month, monthFull, time, dateTime: normalizeReportText(`${date} ${month} ${time}`) };
}

function extractVisibleTexts(pageSource: string): string[] {
  const values = new Set<string>();
  const attrPattern = /\b(?:text|content-desc|resource-id)="([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = attrPattern.exec(pageSource)) !== null) {
    const value = normalizeReportText(match[1]);
    if (value) values.add(value);
  }
  return [...values];
}

function findVisibleText(texts: string[], expected: string): string {
  const normalizedExpected = normalizeForComparison(expected);
  return texts.find(text => normalizeForComparison(text) === normalizedExpected)
    || texts.find(text => normalizeForComparison(text).includes(normalizedExpected))
    || '';
}

function hasText(texts: string[], expected: string): boolean {
  return Boolean(findVisibleText(texts, expected));
}

function parseBounds(value: string): { x: number; y: number; width: number; height: number } | null {
  const match = String(value || '').match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
  if (!match) return null;

  const left = Number(match[1]);
  const top = Number(match[2]);
  const right = Number(match[3]);
  const bottom = Number(match[4]);
  if (right <= left || bottom <= top) return null;

  return { x: left, y: top, width: right - left, height: bottom - top };
}

function findTextBounds(pageSource: string, candidates: string[]): { x: number; y: number; width: number; height: number } | null {
  const normalizedCandidates = candidates
    .map(candidate => normalizeForComparison(candidate))
    .filter(candidate => candidate && candidate !== 'not found');
  if (!normalizedCandidates.length) return null;

  const tagPattern = /<[^>]+>/g;
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(pageSource)) !== null) {
    const tag = match[0];
    const text = tag.match(/\b(?:text|content-desc)="([^"]*)"/)?.[1] || '';
    const bounds = parseBounds(tag.match(/\bbounds="([^"]+)"/)?.[1] || '');
    if (!text || !bounds) continue;

    const normalizedText = normalizeForComparison(text);
    if (normalizedCandidates.some(candidate => normalizedText === candidate || normalizedText.includes(candidate) || candidate.includes(normalizedText))) {
      return bounds;
    }
  }

  return null;
}

function drawRedBorder(image: PNG, bounds: { x: number; y: number; width: number; height: number }): void {
  const left = Math.max(0, Math.min(image.width - 1, bounds.x));
  const top = Math.max(0, Math.min(image.height - 1, bounds.y));
  const right = Math.max(0, Math.min(image.width - 1, bounds.x + bounds.width));
  const bottom = Math.max(0, Math.min(image.height - 1, bounds.y + bounds.height));
  const thickness = 6;

  const setRed = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= image.width || y >= image.height) return;
    const idx = (image.width * y + x) << 2;
    image.data[idx] = 255;
    image.data[idx + 1] = 23;
    image.data[idx + 2] = 68;
    image.data[idx + 3] = 255;
  };

  for (let offset = 0; offset < thickness; offset++) {
    for (let x = left; x <= right; x++) {
      setRed(x, top + offset);
      setRed(x, bottom - offset);
    }
    for (let y = top; y <= bottom; y++) {
      setRed(left + offset, y);
      setRed(right - offset, y);
    }
  }
}

async function captureTvFailureScreenshot(
  driver: any,
  pageSource: string,
  page: string,
  field: string,
  expected: string,
  actual: string,
): Promise<string | undefined> {
  try {
    const shotsDir = path.resolve(process.cwd(), 'test-results/failure-shots');
    if (!fs.existsSync(shotsDir)) fs.mkdirSync(shotsDir, { recursive: true });

    const screenshotPath = path.join(
      shotsDir,
      `tv_${page}_${field}_${Date.now()}.png`.replace(/[^a-zA-Z0-9._/-]/g, '_'),
    );
    await driver.saveScreenshot(screenshotPath);

    const image = PNG.sync.read(fs.readFileSync(screenshotPath));
    const windowRect = await driver.getWindowRect().catch(() => null);
    const logicalWidth = windowRect?.width || image.width;
    const logicalHeight = windowRect?.height || image.height;
    const elementBounds = findTextBounds(pageSource, [actual, expected]);
    const bounds = elementBounds
      ? {
          x: Math.round(elementBounds.x * (image.width / logicalWidth)),
          y: Math.round(elementBounds.y * (image.height / logicalHeight)),
          width: Math.round(elementBounds.width * (image.width / logicalWidth)),
          height: Math.round(elementBounds.height * (image.height / logicalHeight)),
        }
      : { x: 4, y: 4, width: image.width - 8, height: image.height - 8 };

    drawRedBorder(image, bounds);
    fs.writeFileSync(screenshotPath, PNG.sync.write(image));
    console.log(`📸 [TV Report] Marked failed field "${field}" in red: ${screenshotPath}`);
    return screenshotPath;
  } catch (error: any) {
    console.warn(`⚠️ Could not capture TV failure screenshot for ${field}: ${error?.message || error}`);
    return undefined;
  }
}

async function recordComparison(driver: any, pageSource: string, page: string, field: string, expected: string, actual: string): Promise<void> {
  const status = normalizeForComparison(expected) === normalizeForComparison(actual || '') ? 'PASS' : 'FAIL';
  const reportActual = actual || 'Not found';
  const screenshot = status === 'FAIL'
    ? await captureTvFailureScreenshot(driver, pageSource, page, field, expected, reportActual)
    : undefined;

  recordTvPpvReportStep(
    field,
    expected,
    reportActual,
    status,
    page,
    screenshot,
  );
}

async function recordComparisonWithStatus(driver: any, pageSource: string, page: string, field: string, expected: string, actual: string, passed: boolean): Promise<void> {
  const status = passed ? 'PASS' : 'FAIL';
  const reportActual = actual || 'Not found';
  const screenshot = status === 'FAIL'
    ? await captureTvFailureScreenshot(driver, pageSource, page, field, expected, reportActual)
    : undefined;

  recordTvPpvReportStep(field, expected, reportActual, status, page, screenshot);
}

async function recordPresence(driver: any, pageSource: string, page: string, field: string, present: boolean): Promise<void> {
  const actual = present ? 'Yes' : 'No';
  const screenshot = present
    ? undefined
    : await captureTvFailureScreenshot(driver, pageSource, page, field, 'Yes', actual);

  recordTvPpvReportStep(field, 'Yes', actual, present ? 'PASS' : 'FAIL', page, screenshot);
}

function findDateTimeText(texts: string[], parts: { date: string; month: string; time: string; dateTime: string }): string {
  const exact = findVisibleText(texts, parts.dateTime);
  if (exact) return exact;

  const hasDate = texts.some(text => normalizeForComparison(text) === normalizeForComparison(parts.date));
  const hasMonth = texts.some(text => normalizeForComparison(text) === normalizeForComparison(parts.month));
  const time = findVisibleText(texts, parts.time);
  if (hasDate && hasMonth && time) return parts.dateTime;

  return '';
}

function findDateText(texts: string[], parts: { date: string; month: string }): string {
  const combined = normalizeReportText(`${parts.date} ${parts.month}`);
  const exact = findVisibleText(texts, combined);
  if (exact) return exact;

  const hasDate = texts.some(text => normalizeForComparison(text) === normalizeForComparison(parts.date));
  const hasMonth = texts.some(text => normalizeForComparison(text) === normalizeForComparison(parts.month));
  return hasDate && hasMonth ? combined : '';
}

function findTargetScheduleDateText(texts: string[], parts: { weekday: string; weekdayFull: string; date: string; month: string; monthFull: string }): string {
  const exact = findDateText(texts, parts);
  if (exact) return exact;

  const expectedDate = normalizeForComparison(parts.date);
  const expectedMonth = normalizeForComparison(parts.monthFull || parts.month);
  const expectedMonthShort = normalizeForComparison(parts.month);
  const expectedWeekday = normalizeForComparison(parts.weekdayFull || parts.weekday);
  const expectedWeekdayShort = normalizeForComparison(parts.weekday);

  return texts.find(text => {
    const normalized = normalizeForComparison(text);
    const hasTargetDate = new RegExp(`\\b${expectedDate}\\b`).test(normalized);
    const hasTargetMonth = normalized.includes(expectedMonth) || normalized.includes(expectedMonthShort);
    const hasTargetWeekday = normalized.includes(expectedWeekday) || normalized.includes(expectedWeekdayShort);
    return hasTargetDate && hasTargetMonth && hasTargetWeekday;
  }) || '';
}

function hasVisibleTextParts(texts: string[], parts: string[]): boolean {
  return parts.every(part => texts.some(text => normalizeForComparison(text).includes(normalizeForComparison(part))));
}

async function waitForTvScheduleTileReadyForReport(driver: any): Promise<{ source: string; texts: string[]; ready: boolean }> {
  const dateParts = parseExpectedDateParts();
  const tileName = getExpectedTileName();
  const deadline = Date.now() + 10000;
  let lastSource = '';
  let lastTexts: string[] = [];

  while (Date.now() < deadline) {
    const source = await driver.getPageSource().catch(() => '');
    const texts = extractVisibleTexts(source);
    lastSource = source;
    lastTexts = texts;
    const boxingVisible = hasText(texts, 'Boxing');
    const dateVisible = Boolean(findTargetScheduleDateText(texts, dateParts));
    const tileVisible = hasText(texts, tileName);

    if (boxingVisible && dateVisible && tileVisible) {
      return { source, texts, ready: true };
    }

    await driver.pause(500);
  }

  await driver.saveScreenshot('./test-results/firetv_schedule_report_validation_not_ready.png').catch(() => {});
  console.warn(`⚠️ TV report validations started with incomplete Schedule surface: Boxing, date "${dateParts.date} ${dateParts.month}", and tile "${tileName}" were not visible together.`);
  return { source: lastSource, texts: lastTexts, ready: false };
}

async function recordTvScheduleAndTileAssertions(driver: any): Promise<void> {
  const { source, texts, ready } = await waitForTvScheduleTileReadyForReport(driver);
  const dateParts = parseExpectedDateParts();
  const promoter = getEventValue('PPV_PROMOTER');
  const tileName = getExpectedTileName();
  const tileVisible = hasText(texts, tileName);
  const targetDateVisible = Boolean(findTargetScheduleDateText(texts, dateParts));
  const imageVisible = tileVisible && /android\.widget\.(Image|ImageView)|\bclass="[^"]*Image[^"]*"/i.test(source);
  const expectedWhenTileVisible = (expected: string, fallbackActual = '') => tileVisible ? expected : fallbackActual;
  const expectedWhenDateVisible = (expected: string, fallbackActual = '') => targetDateVisible ? expected : fallbackActual;

  await recordPresence(driver, source, 'Schedule', 'PPV Tile Present', tileVisible);
  await recordComparison(driver, source, 'Schedule', 'PPV Name', tileName, findVisibleText(texts, tileName));
  await recordPresence(driver, source, 'Schedule', 'PPV Image Present', imageVisible);
  await recordPresence(driver, source, 'Schedule', 'Lock Icon Present', tileVisible && (/lock|locked/i.test(source) || imageVisible));
  await recordComparison(driver, source, 'Schedule', 'PPV Promoter', promoter, expectedWhenTileVisible(promoter, findVisibleText(texts, promoter)));
  await recordComparison(driver, source, 'Schedule', 'Day', dateParts.weekday, expectedWhenDateVisible(dateParts.weekday, findVisibleText(texts, dateParts.weekday)));
  await recordComparison(driver, source, 'Schedule', 'Month', dateParts.month, expectedWhenDateVisible(dateParts.month, findVisibleText(texts, dateParts.month)));
  await recordComparison(driver, source, 'Schedule', 'Date', dateParts.date, expectedWhenDateVisible(dateParts.date, findVisibleText(texts, dateParts.date)));
  await recordComparison(driver, source, 'Schedule', 'Time', dateParts.time, expectedWhenTileVisible(dateParts.time, findVisibleText(texts, dateParts.time)));

  if (!ready) {
    console.warn(`⚠️ Schedule report validation continued with partial accessibility data for ${tileName}.`);
  }
}

async function recordTvPaywallAssertions(driver: any, expectedEmail = ''): Promise<void> {
  const source = await driver.getPageSource().catch(() => '');
  const texts = extractVisibleTexts(source);
  const dateParts = parseExpectedDateParts();
  const eventName = getExpectedEventName();
  const actualEmail = extractEmailFromText(source);
  const emailInstructionActual = hasVisibleTextParts(texts, [TV_PAYWALL_EMAIL_INSTRUCTION])
    ? TV_PAYWALL_EMAIL_INSTRUCTION
    : '';
  const emailInstructionExpected = expectedEmail
    ? `${TV_PAYWALL_EMAIL_INSTRUCTION} ${expectedEmail}.`
    : TV_PAYWALL_EMAIL_INSTRUCTION;
  const emailInstructionWithEmailActual = emailInstructionActual && actualEmail
    ? `${emailInstructionActual} ${actualEmail}.`
    : emailInstructionActual;
  const browserInstructionActual = hasVisibleTextParts(texts, ["Go to 'My account'", 'web browser', 'purchase this event'])
    ? TV_PAYWALL_BROWSER_INSTRUCTION
    : findVisibleText(texts, TV_PAYWALL_BROWSER_INSTRUCTION);

  await recordComparison(driver, source, 'Paywall', 'Event Name', eventName, findVisibleText(texts, eventName));
  await recordComparison(driver, source, 'Paywall', 'Event Date and Time', dateParts.dateTime, findDateTimeText(texts, dateParts));
  await recordComparison(driver, source, 'Paywall', 'Instruction Header', TV_PAYWALL_INSTRUCTION_HEADER, findVisibleText(texts, TV_PAYWALL_INSTRUCTION_HEADER));
  await recordComparisonWithStatus(
    driver,
    source,
    'Paywall',
    'Email Instruction Text',
    emailInstructionExpected,
    emailInstructionWithEmailActual,
    Boolean(emailInstructionActual) && (!expectedEmail || normalizeForComparison(actualEmail) === normalizeForComparison(expectedEmail)),
  );
  await recordComparison(driver, source, 'Paywall', 'Instruction Email', expectedEmail || actualEmail, actualEmail);
  await recordComparison(driver, source, 'Paywall', 'Web Browser Instruction', TV_PAYWALL_BROWSER_INSTRUCTION, browserInstructionActual);
}

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

type BrowserLoginDestination = 'home' | 'plans' | 'post-login' | 'authenticated' | 'login' | 'unknown';

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

  const finishFireTvLandingTransition = async (source: string): Promise<boolean> => {
    if (await isAlreadyOnFireTvShell()) {
      console.log(`Fire TV reached Home shell after ${source}. Opening QR login from profile.`);
      return openFireTvQrLoginFromShell(driver);
    }

    if (await waitForQrLoginPage(driver, 5000)) {
      console.log(`✅ Fire TV QR login visible after ${source}`);
      return true;
    }

    return false;
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
        console.log('Fire TV already past landing (Home/Schedule shell visible). Opening QR login from shell.');
        return finishFireTvLandingTransition('existing Home/Schedule shell');
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
          console.log(`✅ Fire TV landing CTA clicked via ${selector}`);
          return finishFireTvLandingTransition(`CTA click via ${selector}`);
        }

        await adbTapElementCenter(target);
        await driver.pause(1400);
        if (!await isLandingStillVisible()) {
          console.log(`✅ Fire TV landing CTA clicked via ADB tap fallback (${selector})`);
          return finishFireTvLandingTransition(`ADB tap fallback ${selector}`);
        }
      } catch {}
    }

    const focusedBeforeCenter = (await getFocusedLabel()).trim();
    if (isValidGetStartedTarget(focusedBeforeCenter)) {
      sendTvKeyevent(TV_KEYCODES.DPAD_CENTER);
      await driver.pause(1400);
      if (!await isLandingStillVisible()) {
        console.log('✅ Fire TV landing CTA activated via focus (DPAD_CENTER)');
        return finishFireTvLandingTransition('focused DPAD_CENTER');
      }
    }

    const centerFailShot = './test-results/firetv_get_started_center_no_transition.png';
    await driver.saveScreenshot(centerFailShot).catch(() => {});
    throw new Error(
      `Fire TV landing CTA did not transition. Focused label was "${focusedBeforeCenter || 'unknown'}". Screenshot: ${centerFailShot}`,
    );
  }

  if (isFireTv) {
    const focusedBeforeCenter = (await getFocusedLabel()).trim();
    if (!isValidGetStartedTarget(focusedBeforeCenter)) {
      const invalidFocusShot = './test-results/firetv_landing_invalid_focus_no_center.png';
      await driver.saveScreenshot(invalidFocusShot).catch(() => {});
      throw new Error(
        `Fire TV landing CTA was not exposed and focused label was not Get started/Sign in/Login: "${focusedBeforeCenter || 'unknown'}". Refusing to press DPAD_CENTER so Explore is not clicked. Screenshot: ${invalidFocusShot}`,
      );
    }

    console.log(`ℹ️ Fire TV landing CTA not exposed by text selectors. Pressing DPAD_CENTER. Focused label: "${focusedBeforeCenter}"`);
    sendTvKeyevent(TV_KEYCODES.DPAD_CENTER);
    await driver.pause(1800);
    if (await finishFireTvLandingTransition('DPAD_CENTER fallback')) {
      console.log('✅ Fire TV landing CTA activated via DPAD_CENTER fallback');
      return true;
    }

    const centerFallbackShot = './test-results/firetv_landing_center_fallback_failed.png';
    await driver.saveScreenshot(centerFallbackShot).catch(() => {});
    throw new Error(`Fire TV landing CTA did not transition after DPAD_CENTER fallback. Screenshot: ${centerFallbackShot}`);
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

async function isFireTvNavigationShellVisible(driver: any): Promise<boolean> {
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

async function openFireTvQrLoginFromShell(driver: any): Promise<boolean> {
  if (!await isFireTvNavigationShellVisible(driver)) return false;

  console.log('Fire TV is on Home shell after landing CTA. Opening profile/login QR from left navigation...');
  await driver.saveScreenshot('./test-results/firetv_home_shell_before_profile_login.png').catch(() => {});

  const clickVisibleLoginAction = async (): Promise<boolean> => {
    const loginSelectors = [
      'android=new UiSelector().textMatches("(?i)^(sign in|log in|login)$")',
      'android=new UiSelector().descriptionMatches("(?i)^(sign in|log in|login)$")',
      'android=new UiSelector().textContains("Sign in")',
      'android=new UiSelector().textContains("Log in")',
      'android=new UiSelector().descriptionContains("Sign in")',
      'android=new UiSelector().descriptionContains("Log in")',
      '//android.widget.TextView[contains(translate(@text,"ABCDEFGHIJKLMNOPQRSTUVWXYZ","abcdefghijklmnopqrstuvwxyz"),"sign in")]',
      '//android.widget.TextView[contains(translate(@text,"ABCDEFGHIJKLMNOPQRSTUVWXYZ","abcdefghijklmnopqrstuvwxyz"),"log in")]',
    ];

    for (const selector of loginSelectors) {
      try {
        const target = await driver.$(selector);
        if (!await target.isDisplayed({ timeout: 700 }).catch(() => false)) continue;
        await target.click().catch(() => undefined);
        await driver.pause(2000);
        if (await waitForQrLoginPage(driver, 8000)) {
          console.log(`✅ Fire TV QR login opened via login action ${selector}`);
          return true;
        }
      } catch {}
    }

    return false;
  };

  const tapProfileIcon = async (label: string): Promise<boolean> => {
    const size = await driver.getWindowSize().catch(() => ({ width: 1920, height: 1080 }));
    const profileX = Math.round(size.width * 0.03);
    const profileY = Math.round(size.height * 0.06);
    console.log(`  ${label}: tapping Fire TV profile icon area at (${profileX}, ${profileY})...`);
    try {
      const caps: any = typeof driver.getCapabilities === 'function'
        ? await driver.getCapabilities().catch(() => ({}))
        : (driver.capabilities || {});
      const udid = caps['appium:udid'] || caps.udid || process.env.FIRETV_SERIAL || process.env.DEVICE_SERIAL || '';
      const serialArg = udid ? `-s ${udid}` : '';
      const androidSdk = process.env.ANDROID_HOME || `${process.env.HOME}/Library/Android/sdk`;
      execSync(`${androidSdk}/platform-tools/adb ${serialArg} shell input tap ${profileX} ${profileY}`);
      await driver.pause(2500);
      await driver.saveScreenshot('./test-results/firetv_home_shell_after_profile_tap.png').catch(() => {});

      if (await waitForQrLoginPage(driver, 8000)) {
        console.log(`✅ Fire TV QR login opened via ${label}`);
        return true;
      }

      if (await clickVisibleLoginAction()) return true;
    } catch {}

    return false;
  };

  if (await tapProfileIcon('profile coordinate')) return true;

  const profileSelectors = [
    'android=new UiSelector().descriptionMatches("(?i).*(profile|account|sign in|log in).*")',
    'android=new UiSelector().textMatches("(?i).*(profile|account|sign in|log in).*")',
    '//android.widget.TextView[contains(translate(@text,"ABCDEFGHIJKLMNOPQRSTUVWXYZ","abcdefghijklmnopqrstuvwxyz"),"sign in")]',
    '//*[contains(translate(@content-desc,"ABCDEFGHIJKLMNOPQRSTUVWXYZ","abcdefghijklmnopqrstuvwxyz"),"profile")]',
    '//*[contains(translate(@content-desc,"ABCDEFGHIJKLMNOPQRSTUVWXYZ","abcdefghijklmnopqrstuvwxyz"),"account")]',
  ];

  for (const selector of profileSelectors) {
    try {
      const target = await driver.$(selector);
      if (!await target.isDisplayed({ timeout: 800 }).catch(() => false)) continue;
      await target.click().catch(() => undefined);
      await driver.pause(2000);
      if (await waitForQrLoginPage(driver, 8000)) {
        console.log(`✅ Fire TV QR login opened via ${selector}`);
        return true;
      }

      if (await clickVisibleLoginAction()) return true;
    } catch {}
  }

  if (await tapProfileIcon('profile coordinate retry')) return true;

  console.log('  Profile coordinate did not open QR. Trying remote focus path to top profile icon...');
  sendTvKeyevent(TV_KEYCODES.DPAD_LEFT);
  await driver.pause(700);
  for (let step = 0; step < 6; step++) {
    sendTvKeyevent(TV_KEYCODES.DPAD_UP);
    await driver.pause(350);
  }
  sendTvKeyevent(TV_KEYCODES.DPAD_CENTER);
  await driver.pause(2500);

  if (await waitForQrLoginPage(driver, 10000)) {
    console.log('✅ Fire TV QR login opened via remote focus path');
    return true;
  }

  if (await clickVisibleLoginAction()) return true;

  await driver.saveScreenshot('./test-results/firetv_home_shell_profile_login_failed.png').catch(() => {});
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
    if (TV_TARGET === 'firetv' && await isFireTvNavigationShellVisible(driver)) {
      if (await openFireTvQrLoginFromShell(driver)) return;
    }

    await driver.waitUntil(async () => {
      return isQrPageVisible();
    }, {
      timeout: 20000,
      interval: 800,
      timeoutMsg: 'QR code page was not displayed after clicking Get started.',
    });
    console.log('✅ QR code page displayed after Get started');
  } catch {
    if (TV_TARGET === 'firetv' && await openFireTvQrLoginFromShell(driver)) {
      return;
    }

    const shot = './test-results/firetv_qr_page_assertion_failed.png';
    await driver.saveScreenshot(shot).catch(() => {});
    recordTvPpvReportStep(
      'QR code page displayed after Get started',
      'QR code page visible',
      'QR code page not visible after Get started / Explore CTA',
      'FAIL',
      'TV PPV',
      shot,
    );
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

async function isAndroidTvPostLoginBannerVisible(driver: any): Promise<boolean> {
  const bannerSelectors = [
    'android=new UiSelector().descriptionContains("Close")',
    'android=new UiSelector().descriptionContains("Dismiss")',
    'android=new UiSelector().textMatches("(?i)^(Close|Dismiss|Not now|No thanks|Maybe later|Skip)$")',
    'android=new UiSelector().textMatches("(?i).*(welcome|profile|personalise|notification|privacy|terms).*")',
    'android=new UiSelector().resourceIdMatches(".*close.*")',
  ];

  for (const selector of bannerSelectors) {
    try {
      const el = await driver.$(selector);
      if (await el.isDisplayed({ timeout: 700 }).catch(() => false)) {
        return true;
      }
    } catch {}
  }

  return false;
}

async function isAndroidTvPlanPageVisible(driver: any): Promise<boolean> {
  const planSelectors = [
    'android=new UiSelector().textMatches("(?i).*(choose|select).*plan.*")',
    'android=new UiSelector().textMatches("(?i).*plans.*")',
    'android=new UiSelector().textMatches("(?i).*dazn ultimate.*")',
    'android=new UiSelector().textMatches("(?i).*pay-per-view.*")',
    'android=new UiSelector().descriptionMatches("(?i).*(choose|select).*plan.*")',
    'android=new UiSelector().descriptionMatches("(?i).*plans.*")',
  ];

  for (const selector of planSelectors) {
    try {
      const el = await driver.$(selector);
      if (await el.isDisplayed({ timeout: 700 }).catch(() => false)) {
        return true;
      }
    } catch {}
  }

  return false;
}

async function isAndroidTvHomeOrLeftNavVisible(driver: any): Promise<boolean> {
  const homeSelectors = [
    'android=new UiSelector().textMatches("(?i).*\\bHome\\b.*")',
    'android=new UiSelector().textMatches("(?i).*\\bSearch\\b.*")',
    'android=new UiSelector().textMatches("(?i).*\\bSchedule\\b.*")',
    'android=new UiSelector().textMatches("(?i).*All sports.*")',
    'android=new UiSelector().textMatches("(?i).*Live TV.*")',
    'android=new UiSelector().textContains("Press ‘back’ to go to main menu")',
    'android=new UiSelector().descriptionMatches("(?i).*\\bHome\\b.*")',
    'android=new UiSelector().descriptionMatches("(?i).*\\bSearch\\b.*")',
    'android=new UiSelector().descriptionMatches("(?i).*\\bSchedule\\b.*")',
  ];

  for (const selector of homeSelectors) {
    try {
      const el = await driver.$(selector);
      if (await el.isDisplayed({ timeout: 700 }).catch(() => false)) {
        return true;
      }
    } catch {}
  }

  return false;
}

async function detectAndroidTvPostLoginScreen(driver: any): Promise<'home' | 'banner' | 'plans' | 'unknown'> {
  if (await isTvNavigationShellVisible(driver) || await isAndroidTvHomeOrLeftNavVisible(driver)) return 'home';
  if (await isAndroidTvPlanPageVisible(driver)) return 'plans';
  if (await isAndroidTvPostLoginBannerVisible(driver)) return 'banner';
  return 'unknown';
}

async function assertAndroidTvPostLoginDestination(driver: any): Promise<void> {
  let screen = await detectAndroidTvPostLoginScreen(driver);
  if (screen !== 'unknown') {
    console.log(`✅ Android TV post-login destination displayed: ${screen}`);
  } else {
    console.log('↩️ Android TV Home/Post banner/Plans page not detected after login. Pressing Back once.');
    sendTvKeyevent(TV_KEYCODES.BACK);
    await driver.pause(ANDROIDTV_POST_LOGIN_AFTER_BACK_WAIT_MS);
    screen = await detectAndroidTvPostLoginScreen(driver);
  }

  if (screen === 'plans' || screen === 'banner') {
    console.log(`↩️ Android TV post-login ${screen} displayed. Pressing Back once to reach Home.`);
    sendTvKeyevent(TV_KEYCODES.BACK);
    await driver.pause(ANDROIDTV_POST_LOGIN_AFTER_BACK_WAIT_MS);
    screen = await detectAndroidTvPostLoginScreen(driver);
  }

  if (screen !== 'home') {
    await driver.saveScreenshot('./test-results/androidtv_post_login_destination_failed.png').catch(() => {});
    try {
      const pageSource = await driver.getPageSource();
      require('fs').writeFileSync('./test-results/androidtv_post_login_destination_failed.xml', pageSource);
    } catch {}
    throw new Error(`Android TV did not reach Home after login/back handling. Last detected screen: ${screen}.`);
  }

  console.log('✅ Android TV Home displayed after login/back handling');
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

  if (TV_POST_LOGIN_SCREENSHOTS) {
    await driver.saveScreenshot('./test-results/firetv_post_login_loaded.png').catch(() => {});
  }
  console.log('✅ TV app loaded after login');
}

async function settleTvAppAfterBrowserLogin(driver: any): Promise<void> {
  if (TV_TARGET === 'firetv') {
    console.log(`⏳ Waiting ${FIRETV_POST_LOGIN_BANNER_WAIT_MS}ms for Fire TV post-login banner to appear...`);
    await driver.pause(FIRETV_POST_LOGIN_BANNER_WAIT_MS);
    if (TV_POST_LOGIN_SCREENSHOTS) {
      await driver.saveScreenshot('./test-results/firetv_post_login_before_back.png').catch(() => {});
    }

    console.log('↩️ Closing Fire TV post-login banner with one Back press...');
    sendTvKeyevent(TV_KEYCODES.BACK);

    console.log(`⏳ Waiting ${FIRETV_POST_LOGIN_AFTER_BACK_WAIT_MS}ms for Fire TV app to load after Back...`);
    await driver.pause(FIRETV_POST_LOGIN_AFTER_BACK_WAIT_MS);
    await waitForTvPageLoadAfterLogin(driver);
    await driver.pause(2000);
    return;
  }

  const postLoginWaitMs = TV_TARGET === 'androidtv' ? ANDROIDTV_POST_LOGIN_WAIT_MS : 5000;
  console.log(`⏳ Waiting ${postLoginWaitMs}ms for ${TV_TARGET} app to finish login sync...`);
  await driver.pause(postLoginWaitMs);
  await waitForTvPageLoadAfterLogin(driver);

  if (TV_TARGET === 'androidtv') {
    await assertAndroidTvPostLoginDestination(driver);
  }

  await closePostLoginBannerIfPresent(driver);
  await driver.pause(2000);
}

// Browser-side QR login: used only after the TV app displays a device sign-in QR.
async function signInViaQrInBrowser(signInUrl: string, credentials: RegionCredentials): Promise<() => Promise<void>> {
  const { chromium } = require('@playwright/test');
  const browser = await chromium.launch({
    headless: false,
  });
  const page = await browser.newPage();
  let browserLoginCompleted = false;
  let browserLoginDestination: BrowserLoginDestination = 'unknown';
  const closeBrowser = async (): Promise<void> => {
    await browser.close().catch(() => {});
  };

  const acceptWebCookiesIfPresent = async (timeoutMs = 20000): Promise<void> => {
    const selectors = [
      '#onetrust-accept-btn-handler',
      '#accept-recommended-btn-handler',
      'button:has-text("Accept")',
      'button:has-text("ACCEPT")',
      'button:has-text("Accept All")',
      'button:has-text("Accept all")',
      'button:has-text("Accept Cookies")',
      'button:has-text("Accept cookies")',
      'button:has-text("I Accept")',
      '[role="button"]:has-text("Accept")',
      '[role="button"]:has-text("ACCEPT")',
      '[role="button"]:has-text("Accept All")',
      '[role="button"]:has-text("Accept all")',
    ];

    console.log(`🍪 Waiting up to ${timeoutMs}ms for web cookie Accept before entering email...`);
    await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
    await page.locator('#onetrust-banner-sdk, #onetrust-consent-sdk, .onetrust-pc-dark-filter, #onetrust-accept-btn-handler')
      .first()
      .waitFor({ state: 'visible', timeout: Math.min(timeoutMs, 12000) })
      .catch(() => {});

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      for (const selector of selectors) {
        const acceptButton = page.locator(selector).first();
        if (!await acceptButton.isVisible({ timeout: 1000 }).catch(() => false)) continue;

        await acceptButton.click({ force: true, timeout: 3000 }).catch(async () => {
          await acceptButton.evaluate((node: HTMLElement) => node.click()).catch(() => {});
        });
        await page.locator('#onetrust-banner-sdk, #onetrust-consent-sdk, .onetrust-pc-dark-filter')
          .waitFor({ state: 'hidden', timeout: 5000 })
          .catch(() => {});
        console.log(`🍪 Accepted web cookies before browser login via ${selector}`);
        await page.waitForTimeout(500);
        return;
      }

      await page.waitForTimeout(500);
    }

    console.log('🍪 Web cookie banner not displayed before browser login.');
  };

  const goBackOnceAfterAndroidTvBrowserLogin = async (): Promise<void> => {
    const beforeBackUrl = page.url();
    console.log('↩️ Android TV browser login completed. Using one browser Back before returning to TV app...');
    const clickVisibleBackControl = async (): Promise<boolean> => {
      const controls = await page.locator('button, a, [role="button"]').all();
      for (const control of controls) {
        const box = await control.boundingBox().catch(() => null);
        if (!box || box.x > 120 || box.y > 120) continue;
        await control.click({ force: true }).catch(() => undefined);
        await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
        console.log('✅ Android TV browser Back clicked via visible top-left control');
        return true;
      }

      const backSelectors = [
        '[data-testid*="back" i]',
        '[data-test-id*="back" i]',
        'button[aria-label*="back" i]',
        'a[aria-label*="back" i]',
        '[role="button"][aria-label*="back" i]',
      ];

      for (const selector of backSelectors) {
        const back = page.locator(selector).first();
        if (!await back.isVisible({ timeout: 500 }).catch(() => false)) continue;
        await back.click({ force: true });
        await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
        console.log(`✅ Android TV browser Back clicked via ${selector}`);
        return true;
      }

      return false;
    };

    const historyBackWorked = await page.goBack({ waitUntil: 'domcontentloaded', timeout: 10000 }).then(response => !!response).catch(async () => {
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowLeft' : 'Alt+ArrowLeft').catch(() => {});
      await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
      return page.url() !== beforeBackUrl;
    });

    if (!historyBackWorked && page.url() === beforeBackUrl) {
      await clickVisibleBackControl();
    }

    if (PPV_PURCHASE_BACK_SETTLE_MS > 0) {
      console.log(`⏳ Waiting ${PPV_PURCHASE_BACK_SETTLE_MS}ms after Android TV browser Back...`);
      await page.waitForTimeout(PPV_PURCHASE_BACK_SETTLE_MS);
    }

    console.log(`✅ Android TV browser Back completed. Before: ${beforeBackUrl} | After: ${page.url()}`);
  };

  // Some DAZN QR logins land on the PPV purchase/plans page. Back out once so
  // the TV session can settle before the native app continues the PPV flow.
  const clickPlansBackIfPresent = async (maxWaitMs = 20000): Promise<void> => {
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
    while (Date.now() - start < maxWaitMs) {
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

  const detectBrowserLoginDestination = async (): Promise<BrowserLoginDestination> => {
    return page.evaluate(() => {
      const path = (window.location.pathname || '').toLowerCase();
      const href = (window.location.href || '').toLowerCase();
      const bodyText = (document.body?.innerText || '').toLowerCase().replace(/\s+/g, ' ');
      const hasAuthFields = !!document.querySelector('input[type="email"], input[name="email"], input[type="password"], input[name="password"]');
      const stillOnAuthRoute = /login|signin|sign-in|auth/.test(path) || /login|signin|sign-in|auth/.test(href);

      if (hasAuthFields || stillOnAuthRoute) return 'login';
      if (/plans?|choose your plan|select your plan|choose how to buy|dazn ultimate|pay-per-view|purchase/.test(bodyText) || /plans?|purchase|contextualppvid|plan/.test(href)) return 'plans';
      if (/welcome|you.re in|you are in|continue watching|personalise|notification|profile/.test(bodyText)) return 'post-login';
      if (/home|schedule|search|all sports|live tv/.test(bodyText) || /\/home|\/browse|\/schedule/.test(path)) return 'home';
      return 'authenticated';
    }).catch(() => 'unknown');
  };

  const waitForBrowserLoginCompletion = async (timeoutMs = 30000): Promise<boolean> => {
    const start = Date.now();
    await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});

    const completed = await page.waitForFunction(() => {
      const path = (window.location.pathname || '').toLowerCase();
      const href = (window.location.href || '').toLowerCase();
      const hasAuthFields = !!document.querySelector('input[type="email"], input[name="email"], input[type="password"], input[name="password"]');
      const stillOnAuthRoute = /login|signin|sign-in|auth/.test(path) || /login|signin|sign-in|auth/.test(href);
      return !hasAuthFields && !stillOnAuthRoute;
    }, { timeout: timeoutMs }).then(() => true).catch(() => false);

    const elapsed = Date.now() - start;
    const destination = await detectBrowserLoginDestination();
    browserLoginDestination = destination;
    if (completed) {
      console.log(`✅ Browser login completed on web (${destination}, ${elapsed}ms)`);
    } else {
      console.log(`⚠️ Browser still appears to be on ${destination} after ${elapsed}ms`);
    }

    return completed;
  };

  try {
    await page.goto(signInUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await acceptWebCookiesIfPresent();
    const emailInput = page.locator('input[type="email"], input[name="email"]').first();
    await emailInput.waitFor({ state: 'visible', timeout: 20000 });
    await emailInput.fill(credentials.email);

    const emailContinueSelectors = [
      'button:has-text("Continue")',
      'button:has-text("CONTINUE")',
      'button[aria-label*="Continue" i]',
      '[role="button"]:has-text("Continue")',
      '[role="button"]:has-text("CONTINUE")',
      'button[type="submit"]',
      'input[type="submit"]',
    ];

    const passwordLoginSelectors = [
      'button:has-text("Log in")',
      'button:has-text("Login")',
      'button:has-text("Sign in")',
      'button:has-text("Continue")',
      'button[aria-label*="Log in" i]',
      'button[aria-label*="Login" i]',
      'button[aria-label*="Sign in" i]',
      '[role="button"]:has-text("Log in")',
      '[role="button"]:has-text("Login")',
      '[role="button"]:has-text("Sign in")',
      'button[type="submit"]',
      'input[type="submit"]',
    ];

    const clickCta = async (selectors: string[], stepLabel: string): Promise<boolean> => {
      const clickCandidate = async (el: any, label: string): Promise<boolean> => {
        if (!await el.isVisible({ timeout: 1000 }).catch(() => false)) return false;
        const isEnabled = await el.isEnabled({ timeout: 5000 }).catch(() => true);
        if (!isEnabled) return false;
        await el.scrollIntoViewIfNeeded().catch(() => {});

        try {
          await el.click({ timeout: 5000 });
        } catch {
          try {
            await el.click({ force: true, timeout: 5000 });
          } catch {
            const box = await el.boundingBox().catch(() => null);
            if (box) {
              await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
            } else {
              await el.evaluate((node: HTMLElement) => node.click()).catch(() => {});
            }
          }
        }

        console.log(`✅ ${stepLabel} via ${label}`);
        return true;
      };

      const roleButtonName = stepLabel.toLowerCase().includes('email')
        ? /^continue$/i
        : /^(log in|login|sign in|continue)$/i;
      const roleButtons = page.getByRole('button', { name: roleButtonName });
      const roleButtonCount = await roleButtons.count().catch(() => 0);
      for (let index = 0; index < Math.min(roleButtonCount, 10); index++) {
        if (await clickCandidate(roleButtons.nth(index), `role=button [${index + 1}/${roleButtonCount}]`)) return true;
      }

      for (const selector of selectors) {
        const locator = page.locator(selector);
        const count = await locator.count().catch(() => 0);
        for (let index = 0; index < Math.min(count || 1, 10); index++) {
          const el = locator.nth(index);
          if (await clickCandidate(el, `${selector}${count > 1 ? ` [${index + 1}/${count}]` : ''}`)) return true;
        }
      }

      return false;
    };

    const passwordInput = page.locator('input[type="password"], input[name="password"], input[autocomplete="current-password"]').first();
    const passwordVisibleAfterEmail = await passwordInput.isVisible({ timeout: 3000 }).catch(() => false);

    const waitForPasswordInput = async (timeoutMs = 12000): Promise<boolean> => {
      return passwordInput.waitFor({ state: 'visible', timeout: timeoutMs }).then(() => true).catch(() => false);
    };

    const submitAndroidTvPasswordStep = async (): Promise<void> => {
      const clickPasswordLoginByDom = async (): Promise<boolean> => {
        const result = await page.evaluate(() => {
          const password = document.querySelector('input[type="password"], input[name="password"], input[autocomplete="current-password"]') as HTMLInputElement | null;
          const passwordBox = password?.getBoundingClientRect();
          const isVisible = (element: Element): boolean => {
            const style = window.getComputedStyle(element);
            const box = element.getBoundingClientRect();
            return style.visibility !== 'hidden' && style.display !== 'none' && box.width > 0 && box.height > 0;
          };
          const isDisabled = (element: Element): boolean => {
            const disabledAttr = element.getAttribute('disabled');
            const ariaDisabled = element.getAttribute('aria-disabled');
            return disabledAttr !== null || ariaDisabled === 'true';
          };
          const getLabel = (element: Element): string => [
            element.textContent || '',
            element.getAttribute('aria-label') || '',
            element.getAttribute('value') || '',
            element.getAttribute('data-testid') || '',
            element.getAttribute('data-test-id') || '',
            element.getAttribute('name') || '',
            element.getAttribute('type') || '',
          ].join(' ').replace(/\s+/g, ' ').trim();
          const distanceFromPassword = (element: Element): number => {
            if (!passwordBox) return 0;
            const box = element.getBoundingClientRect();
            const verticalDistance = Math.max(0, box.top - passwordBox.bottom);
            const horizontalDistance = Math.abs((box.left + box.width / 2) - (passwordBox.left + passwordBox.width / 2));
            return verticalDistance + horizontalDistance / 4;
          };

          const candidates = Array.from(document.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"]'))
            .filter(element => isVisible(element) && !isDisabled(element))
            .map(element => ({ element, label: getLabel(element), distance: distanceFromPassword(element) }))
            .filter(candidate => /(log in|login|sign in|continue|submit)/i.test(candidate.label))
            .sort((left, right) => left.distance - right.distance);

          const target = candidates[0];
          if (!target) {
            return { clicked: false, label: '', reason: 'no visible enabled login candidate' };
          }

          (target.element as HTMLElement).focus();
          (target.element as HTMLElement).click();
          return { clicked: true, label: target.label || 'unlabelled login candidate', reason: 'dom click' };
        }).catch((error: any) => ({ clicked: false, label: '', reason: error?.message || 'dom click failed' }));

        if (result.clicked) {
          console.log(`✅ Password Log in CTA clicked by DOM fallback: ${result.label}`);
          return true;
        }

        console.log(`ℹ️ DOM password Login click skipped: ${result.reason}`);
        return false;
      };

      const clickPasswordFormSubmit = async (): Promise<boolean> => {
        const formButtons = passwordInput.locator('xpath=ancestor::form[1]//*[self::button or @role="button" or self::input[@type="submit"]]');
        const count = await formButtons.count().catch(() => 0);
        for (let index = 0; index < Math.min(count, 8); index++) {
          const button = formButtons.nth(index);
          const label = normalizeReportText([
            await button.textContent().catch(() => ''),
            await button.getAttribute('aria-label').catch(() => ''),
            await button.getAttribute('value').catch(() => ''),
          ].join(' '));
          if (!/(log in|login|sign in|continue)/i.test(label)) continue;
          if (!await button.isVisible({ timeout: 1000 }).catch(() => false)) continue;
          if (!await button.isEnabled({ timeout: 5000 }).catch(() => true)) continue;
          await button.scrollIntoViewIfNeeded().catch(() => {});

          try {
            await button.click({ timeout: 5000 });
          } catch {
            try {
              await button.click({ force: true, timeout: 5000 });
            } catch {
              const box = await button.boundingBox().catch(() => null);
              if (box) {
                await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
              } else {
                await button.evaluate((node: HTMLElement) => node.click()).catch(() => {});
              }
            }
          }

          console.log(`✅ Password Log in CTA clicked from password form: ${label || 'unlabelled submit'}`);
          return true;
        }

        return false;
      };

      const submitPasswordForm = async (): Promise<void> => {
        await passwordInput.evaluate((input: HTMLInputElement) => {
          const form = input.form;
          if (form?.requestSubmit) {
            form.requestSubmit();
            return;
          }
          form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        }).catch(() => {});
      };

      for (let attempt = 1; attempt <= 3; attempt++) {
        console.log(`🔐 Submitting Android TV password step (attempt ${attempt})...`);
        await passwordInput.click().catch(() => {});

        const clicked = await clickCta(passwordLoginSelectors, `Password Log in CTA clicked (attempt ${attempt})`) ||
          await clickPasswordFormSubmit() ||
          await clickPasswordLoginByDom();
        if (!clicked) {
          console.log(`↩️ Password Log in CTA not found on attempt ${attempt}. Pressing Enter from password field.`);
          await passwordInput.press('Enter').catch(() => {});
        }

        if (await waitForBrowserLoginCompletion(ANDROIDTV_BROWSER_LOGIN_COMPLETE_TIMEOUT_MS)) {
          console.log('✅ Browser login completed after Android TV password submit');
          return;
        }

        console.log(`ℹ️ Browser still on login after Android TV password submit attempt ${attempt}. Trying Enter/form submit fallback...`);
        await passwordInput.press('Enter').catch(() => {});
        if (await waitForBrowserLoginCompletion(ANDROIDTV_BROWSER_LOGIN_RETRY_TIMEOUT_MS)) {
          console.log('✅ Browser login completed after password Enter fallback');
          return;
        }

        await submitPasswordForm();
        if (await waitForBrowserLoginCompletion(ANDROIDTV_BROWSER_LOGIN_RETRY_TIMEOUT_MS)) {
          console.log('✅ Browser login completed after password form submit fallback');
          return;
        }
      }

      await page.screenshot({ path: './test-results/android_tv_browser_login_not_completed.png', fullPage: true }).catch(() => {});
      await fs.promises.writeFile('./test-results/android_tv_browser_login_not_completed.html', await page.content()).catch(() => {});
      throw new Error('Browser login did not complete after Android TV password submit. Screenshot: ./test-results/android_tv_browser_login_not_completed.png');
    };

    const submitEmailStep = async (): Promise<void> => {
      for (let attempt = 1; attempt <= 3; attempt++) {
        const emailContinueClicked = await clickCta(emailContinueSelectors, `Email Continue CTA clicked (attempt ${attempt})`);
        if (emailContinueClicked && await waitForPasswordInput()) {
          console.log('✅ Password field displayed after email Continue');
          return;
        }

        console.log(`ℹ️ Password page not visible after email Continue attempt ${attempt}. Retrying email submit...`);
        await emailInput.press('Enter').catch(() => {});
        if (await waitForPasswordInput(8000)) {
          console.log('✅ Email Continue submitted via Enter fallback');
          return;
        }
      }

      await page.screenshot({ path: './test-results/android_tv_email_continue_not_completed.png', fullPage: true }).catch(() => {});
      throw new Error('Email Continue did not open the password page. Screenshot: ./test-results/android_tv_email_continue_not_completed.png');
    };

    if (TV_TARGET === 'androidtv' || !passwordVisibleAfterEmail) {
      await submitEmailStep();
    }

    await passwordInput.waitFor({ state: 'visible', timeout: 20000 });
    await passwordInput.fill(credentials.password);
    await page.waitForTimeout(500);

    if (TV_TARGET === 'androidtv') {
      await submitAndroidTvPasswordStep();
    } else {
      for (let attempt = 1; attempt <= 3; attempt++) {
        const passwordLoginClicked = await clickCta(passwordLoginSelectors, `Password Log in CTA clicked (attempt ${attempt})`);
        if (!passwordLoginClicked) {
          console.log(`↩️ Password Log in CTA not found on attempt ${attempt}. Pressing Enter from password field.`);
          await passwordInput.press('Enter');
        }

        if (await waitForBrowserLoginCompletion(10000)) {
          console.log('✅ Browser login completed after password submit');
          break;
        }

        if (attempt < 3) {
          console.log(`ℹ️ Browser still on login after password submit attempt ${attempt}. Retrying...`);
          await passwordInput.press('Enter').catch(() => {});
        }
      }

      if (!await waitForBrowserLoginCompletion(3000)) {
        await page.screenshot({ path: './test-results/android_tv_browser_login_not_completed.png', fullPage: true }).catch(() => {});
        await fs.promises.writeFile('./test-results/android_tv_browser_login_not_completed.html', await page.content()).catch(() => {});
        throw new Error('Browser login did not complete after password submit. Screenshot: ./test-results/android_tv_browser_login_not_completed.png');
      }
    }

    browserLoginCompleted = true;

    const browserLoginSettleMs = TV_TARGET === 'androidtv'
      ? ANDROIDTV_BROWSER_LOGIN_SETTLE_MS
      : BROWSER_LOGIN_COMPLETE_SETTLE_MS;
    if (browserLoginSettleMs > 0) {
      console.log(`⏳ Waiting ${browserLoginSettleMs}ms after completing browser login before PPV purchase Back check...`);
      await page.waitForTimeout(browserLoginSettleMs);
    }
    const destinationAfterLogin = await detectBrowserLoginDestination();
    browserLoginDestination = destinationAfterLogin;
    if (TV_TARGET === 'androidtv') {
      console.log(`✅ Android TV browser login process completed on ${destinationAfterLogin}. Using browser Back once...`);
      await goBackOnceAfterAndroidTvBrowserLogin();
    } else if (destinationAfterLogin === 'plans') {
        console.log('✅ Browser login process completed on plans page. Checking for PPV purchase Back icon...');
        await clickPlansBackIfPresent(20000);
    } else {
      console.log(`✅ Browser login process completed on ${destinationAfterLogin}; skipping PPV purchase Back check.`);
    }
    return closeBrowser;
  } finally {
    if (!browserLoginCompleted && TV_TARGET === 'androidtv' && TV_LOGIN_FAILURE_KEEP_BROWSER_OPEN_MS > 0) {
      console.log(`⚠️ Browser login did not complete. Keeping browser open for ${TV_LOGIN_FAILURE_KEEP_BROWSER_OPEN_MS}ms for debugging.`);
      await page.waitForTimeout(TV_LOGIN_FAILURE_KEEP_BROWSER_OPEN_MS).catch(() => {});
    }
    if (!browserLoginCompleted || TV_TARGET !== 'androidtv') {
      await closeBrowser();
    }
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
  const closeBrowser = await signInViaQrInBrowser(qrUrl, credentials);

  try {
    if (TV_LOGIN_SETTLE_MS > 0) {
      console.log(`⏳ Waiting ${TV_LOGIN_SETTLE_MS}ms for TV login handoff to settle before switching back to app...`);
      await driver.pause(TV_LOGIN_SETTLE_MS);
    }

    await driver.activateApp(APP_PACKAGE).catch(() => {});
    await settleTvAppAfterBrowserLogin(driver);
    console.log('✅ Browser login completed and DAZN app reactivated');
  } finally {
    if (TV_TARGET === 'androidtv') {
      console.log('🧹 Closing browser after Android TV login validation.');
      await closeBrowser();
    }
  }
}

// Routes only this TV PPV spec to the configured in-app source.
async function openTvPpvFlow(driver: any, hooks: any = {}): Promise<boolean> {
  if (SOURCE === 'schedule') {
    if (TV_TARGET === 'firetv') {
      return openFireTvSchedulePPVPaywall(driver, PPV_NAME, event, hooks);
    }

    return openSchedulePPVPaywall(driver, PPV_NAME, event, hooks);
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

function isSupportedTvHandoffUrl(url: string): boolean {
  return url.includes('dazn.com') || url.includes('yopmail.com');
}

function buildYopmailHandoffUrl(email: string): string {
  return `https://www.yopmail.com/?login=${encodeURIComponent(email.split('@')[0])}`;
}

async function extractTvPaywallEmail(driver: any): Promise<string> {
  const source = await driver.getPageSource().catch(() => '');
  const email = extractEmailFromText(source);
  if (email) {
    console.log(`✅ TV paywall email detected: ${email}`);
  }
  return email;
}

function isEmailOnlyTvPaywall(): boolean {
  return TV_TARGET === 'firetv' || TV_TARGET === 'androidtv';
}

async function writeYopmailHandoffFromPaywallEmail(driver: any): Promise<boolean> {
  const paywallEmail = await extractTvPaywallEmail(driver);
  if (!paywallEmail.toLowerCase().endsWith('@yopmail.com')) return false;

  const checkoutUrl = buildYopmailHandoffUrl(paywallEmail);
  writeHandoffUrl(checkoutUrl);
  await driver.saveScreenshot('./test-results/android_tv_handoff_success.png').catch(() => {});
  recordTvPpvReportStep('Paywall email captured', 'Yopmail address visible on TV paywall', paywallEmail);
  recordTvPpvReportStep('Yopmail inbox prepared', 'Yopmail inbox URL for existing-user browser', 'Yopmail inbox URL prepared');
  console.log(`✅ TV handoff will continue via Yopmail in existing-user browser: ${checkoutUrl}`);
  return true;
}

// After the TV app opens the PPV paywall, capture the web handoff URL that the
// root Playwright runner continues from.
async function captureTvPpvHandoffUrl(driver: any): Promise<void> {
  if (isEmailOnlyTvPaywall() && await writeYopmailHandoffFromPaywallEmail(driver)) {
    return;
  }

  // Step 4: Prefer QR handoff because TV checkout normally presents a QR code.
  let checkoutUrl = await decodeCheckoutUrlFromQr(driver, './test-results/android_tv_qr_capture.png');
  if (checkoutUrl) {
    writeHandoffUrl(checkoutUrl);
    await driver.saveScreenshot('./test-results/android_tv_handoff_success.png').catch(() => {});
    recordTvPpvReportStep('TV handoff captured', 'DAZN checkout URL', 'QR checkout URL captured');
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

  if ((!checkoutUrl || !checkoutUrl.includes('dazn.com')) && isEmailOnlyTvPaywall()) {
    if (await writeYopmailHandoffFromPaywallEmail(driver)) return;
  }

  if (!checkoutUrl || !isSupportedTvHandoffUrl(checkoutUrl)) {
    await driver.saveScreenshot('./test-results/android_tv_checkout_url_missing.png').catch(() => {});
    throw new Error('Could not capture DAZN checkout URL from TV flow.');
  }

  // Step 6: Save the final DAZN handoff URL for the next automation stage.
  writeHandoffUrl(checkoutUrl);
  await driver.saveScreenshot('./test-results/android_tv_handoff_success.png').catch(() => {});
  recordTvPpvReportStep(
    checkoutUrl.includes('yopmail.com') ? 'Yopmail inbox prepared' : 'TV handoff captured',
    checkoutUrl.includes('yopmail.com') ? 'Yopmail inbox URL for existing-user browser' : 'Supported handoff URL',
    checkoutUrl.includes('yopmail.com') ? 'Yopmail inbox URL prepared' : 'DAZN checkout URL captured',
  );
  console.log(`✅ TV handoff URL captured: ${checkoutUrl}`);
}

describe('DAZN TV PPV Android Handoff', function () {
  this.timeout(TV_PPV_SPEC_TIMEOUT_MS);

  before(async () => {
    // Step 1: start every TV run from a clean handoff state and prepared app.
    clearHandoffUrl();
    tvPpvReportMetadata.startTime = new Date().toISOString();
    tvPpvReportMetadata.steps = [];
    writeTvPpvReportMetadata();
    require('fs').mkdirSync('./test-results', { recursive: true });

    const isFireTv = TV_TARGET === 'firetv';

    if (TV_WEB_LOGIN_ONLY && TV_TARGET !== 'androidtv') {
      throw new Error('TV_WEB_LOGIN_ONLY=true is supported only for TV_TARGET=androidtv. Fire TV flow is unchanged.');
    }

    if (!TV_WEB_LOGIN_ONLY) {
      await prepareAndroidApp(browser, {
        clearAppData: true,
        waitForHome: TV_TARGET === 'firetv' ? false : true,
        acceptCookiesOnly: isFireTv,
      });
      recordTvPpvReportStep('DAZN app launched Successfully.', 'DAZN app launched Successfully.', 'DAZN app launched Successfully.');
    } else {
      console.log('ℹ️ TV_WEB_LOGIN_ONLY=true: using the QR page already open on Android TV. Skipping app reset/launch.');
    }

    if (TV_TARGET === 'androidtv') {
      // Step 2: Android TV prod can start on QR login after data clear.
      // Complete QR login in browser, then return focus to DAZN before navigation.
      await primeAndroidTvFocus(browser);
      if (await waitForQrLoginPage(browser)) {
        await runBrowserLoginAndSwitchBack(browser, { allowHandoffFallback: false });
        const credentials = resolveRegionCredentials();
        recordTvPpvReportStep('Login Completed with entered Email.', credentials.email, credentials.email);
        await primeAndroidTvFocus(browser);
      } else if (TV_WEB_LOGIN_ONLY) {
        throw new Error('TV_WEB_LOGIN_ONLY=true requires the Android TV QR login page to already be visible.');
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

    if (TV_LOGIN_ONLY || TV_WEB_LOGIN_ONLY) {
      console.log('✅ TV login debug completed. Skipping PPV navigation and handoff capture.');
      return;
    }

    if (TV_TARGET === 'firetv') {
      // Fire TV schedule flow:
      // Explore/Get started -> QR browser login -> return to app -> Schedule -> PPV tile.
      if (!await waitForQrLoginPage(driver, 3000)) {
       await browser.pause(3000);
        const getStartedClicked = await clickGetStartedCta(driver);
        if (!getStartedClicked) {
          throw new Error('Could not click Fire TV landing CTA.');
        }
        await assertQrPageDisplayedAfterGetStarted(driver);
      }

      await runBrowserLoginAndSwitchBack(driver, { allowHandoffFallback: false });
      const credentials = resolveRegionCredentials();
      recordTvPpvReportStep('Login Completed with entered Email.', credentials.email, credentials.email);

      const opened = await openTvPpvFlow(driver, {
        validateSurface: async () => {
          await recordTvScheduleAndTileAssertions(driver);
        },
        validatePaywall: async () => {
          recordTvPpvReportStep('TV PPV paywall opened', 'Schedule PPV tile opens paywall', PPV_NAME);
          await recordTvPaywallAssertions(driver, credentials.email);
        },
      });
      if (!opened) {
        throw new Error(`TV PPV flow did not reach paywall for SOURCE=${SOURCE}`);
      }

      await captureTvPpvHandoffUrl(driver);
      return;
    }

    // Step 3: Android TV flow opens the configured PPV entry point in the app.
    const credentials = resolveRegionCredentials();
    const opened = await openTvPpvFlow(driver, {
      validateSurface: async () => {
        await recordTvScheduleAndTileAssertions(driver);
      },
      validatePaywall: async () => {
        recordTvPpvReportStep('TV PPV paywall opened', 'Schedule PPV tile opens paywall', PPV_NAME);
        await recordTvPaywallAssertions(driver, credentials.email);
      },
    });
    if (!opened) {
      throw new Error(`TV PPV flow did not reach paywall for SOURCE=${SOURCE}`);
    }

    await captureTvPpvHandoffUrl(driver);
  });
});