import {
  IOSBasePage,
  IOSPPVSurface,
  WdBrowser,
  WdElement,
} from './IOSBasePage';
import { getIOSValidationSheet } from './IOSSurfacingPoint';

// Timezone-aware date utilities loaded dynamically
let getDynamicDateTimeBadge: ((template: string, region?: string) => string) | undefined;
let getNowForRegion: ((region?: string) => Date) | undefined;
try {
  const dateUtils = require('../../../../utils/dateUtils');
  getDynamicDateTimeBadge = dateUtils.getDynamicDateTimeBadge;
  getNowForRegion = dateUtils.getNowForRegion;
} catch (e) {
  console.warn('⚠️ Failed to load timezone utilities, date validation will use device timezone');
}

export interface IOSValidationResult {
  page: string;
  field: string;
  expected: string;
  actual: string;
  status: 'PASS' | 'FAIL';
  screenshot?: string;
}

export class IOSValidationPage extends IOSBasePage {

  async captureAndMarkFailureScreenshot(
    surface: string,
    fieldName: string,
    expectedValue: string,
    actualValue: string
  ): Promise<string> {
    try {
      const fs = require('fs');
      const path = require('path');
      const SHOTS_DIR = path.resolve(process.cwd(), 'test-results/failure-shots');
      if (!fs.existsSync(SHOTS_DIR)) fs.mkdirSync(SHOTS_DIR, { recursive: true });

      const screenshotPath = path.resolve(
        SHOTS_DIR,
        `ios_${String(surface || 'page').replace(/[^a-zA-Z0-9]/g, '_')}_${String(fieldName || 'field').replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}.png`
      );
      await this.driver.saveScreenshot(screenshotPath);
      return screenshotPath;
    } catch (e: any) {
      console.warn(`⚠️ Failed to capture failure screenshot:`, e.message);
      return '';
    }
  }

  // ── Paywall: gather all visible text elements on iOS ──────────────────────
  async gatherTextsFromPaywall(): Promise<{
    texts: string[];
    pageSource: string;
    mobileDateText: string;
  }> {
    const textsSet = new Set<string>();
    let pageSource = '';

    // Wait up to 15 seconds for key paywall elements
    let isLoaded = false;
    for (let i = 0; i < 30; i++) {
      const hasDazn = await this.driver.$('-ios predicate string:name CONTAINS "dazn" OR label CONTAINS "dazn"').isDisplayed().catch(() => false);
      const hasSafari = await this.driver.$('~Open').isDisplayed().catch(() => false);
      if (hasDazn || hasSafari) {
        isLoaded = true;
        break;
      }
      await this.driver.pause(500);
    }
    pageSource = await this.driver.getPageSource().catch(() => '');
    if (!isLoaded) {
      console.warn('⚠️ Mobile paywall page did not load fully within timeout.');
    }

    await this.driver.pause(1000);

    const fetchTexts = async () => {
      try {
        const textEls = await this.driver.$$('//XCUIElementTypeStaticText | //XCUIElementTypeButton | //XCUIElementTypeTextField | //XCUIElementTypeSecureTextField');
        for (const el of textEls) {
          const txt = await el.getAttribute('label').catch(() => '');
          if (txt && txt.trim()) textsSet.add(txt.trim());
          const name = await el.getAttribute('name').catch(() => '');
          if (name && name.trim()) textsSet.add(name.trim());
        }
      } catch (e: any) {
        console.log(`⚠️ Failed to fetch text elements: ${e.message}`);
      }
    };

    await fetchTexts();

    // Scroll down slightly to expose off-screen elements
    console.log('  Scrolling down on paywall to capture off-screen elements...');
    try {
      await this.scrollDown();
      await this.driver.pause(1200);
    } catch (e: any) {
      console.log(`⚠️ Scroll failed: ${e.message}`);
    }

    await fetchTexts();

    if (!pageSource) {
      pageSource = await this.driver.getPageSource().catch(() => '');
    }

    const texts = Array.from(textsSet);
    console.log('📋 Total unique texts gathered on iOS:', texts);

    // Find date element
    let mobileDateText = 'Not found';
    const monthRegex = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i;
    const foundDate = texts.find(t => monthRegex.test(t) && /\d/.test(t));
    if (foundDate) {
      mobileDateText = foundDate;
      console.log(`💡 Detected mobile paywall date element: "${mobileDateText}"`);
    }

    return { texts, pageSource, mobileDateText };
  }

  // ── Surface: gather texts from banner or tile on iOS ─────────────────────
  async gatherTextsFromSurface(
    surface: IOSPPVSurface,
    titleExpected: string,
  ): Promise<{ texts: string[]; pageSource: string; targetXml: string }> {
    const textsSet = new Set<string>();
    let pageSource = '';
    let targetXml = '';

    try {
      pageSource = await this.driver.getPageSource();
      targetXml = pageSource;

      // Locate the main title element
      const escTitle = titleExpected.replace(/'/g, "\\'");
      const titleSel = `-ios predicate string:label CONTAINS[c] '${escTitle}' OR name CONTAINS[c] '${escTitle}'`;
      const titleEl = await this.driver.$(titleSel);

      if (surface === 'PPV Tile' && await titleEl.isDisplayed().catch(() => false)) {
        console.log(`🎯 Found title element for "${titleExpected}"`);
        // Find container ancestor cell or group to isolate texts
        let container: WdElement | null = null;
        try {
          // XCUIElementTypeCell is typical for list items / tiles
          container = await titleEl.$('xpath:./ancestor::XCUIElementTypeCell[1]');
          if (!await container.isExisting()) {
            container = await titleEl.$('xpath:./ancestor::XCUIElementTypeOther[1]');
          }
        } catch {}

        if (container && await container.isExisting()) {
          console.log(`🎯 Isolated container cell/group for PPV Tile`);
          const children = await container.$$('.//XCUIElementTypeStaticText | .//XCUIElementTypeButton');
          for (const el of children) {
            const txt = await el.getAttribute('label').catch(() => '');
            if (txt && txt.trim()) textsSet.add(txt.trim());
          }
        } else {
          // Fallback: collect all static texts on screen
          const allTexts = await this.driver.$$('//XCUIElementTypeStaticText');
          for (const el of allTexts) {
            const txt = await el.getAttribute('label').catch(() => '');
            if (txt && txt.trim()) textsSet.add(txt.trim());
          }
        }
      } else {
        // Banner or full page: collect all texts
        const allElements = await this.driver.$$('//XCUIElementTypeStaticText | //XCUIElementTypeButton');
        for (const el of allElements) {
          const txt = await el.getAttribute('label').catch(() => '');
          if (txt && txt.trim()) textsSet.add(txt.trim());
        }
      }
    } catch (e: any) {
      console.log(`⚠️ Failed to gather texts from surface: ${e.message}`);
    }

    const texts = Array.from(textsSet);
    console.log(`📱 Gathered local texts for ${surface}:`, texts);
    return { texts, pageSource, targetXml };
  }

  // ── Full paywall validation (sheet-driven) ────────────────────────────────
  async validateMobilePaywall(
    eventData: Record<string, any>,
    source: string,
    results: IOSValidationResult[],
    paywallValidated: { value: boolean },
  ): Promise<void> {
    if (paywallValidated.value) {
      console.log('⏭️ Mobile Paywall already validated. Skipping duplicate validation.');
      return;
    }

    const mode = (process.env.IOS_DEVICE_MODE || 'simulator').toLowerCase();
    if (mode === 'real' && source === 'landing-page-banner') {
      console.log('⏭️ Skipping native paywall validation on real iOS device for landing page banner (redirects to Safari directly)');
      paywallValidated.value = true;
      return;
    }

    console.log('\n🔍 [Mobile Paywall] Running validations on native paywall screen...');
    eventData.CURRENT_PAGE = 'Mobile Paywall';
    paywallValidated.value = true;

    const { texts, pageSource, mobileDateText } = await this.gatherTextsFromPaywall();

    const { getMobilePaywallData } = require('../../../utils/excelReader');
    const { resolveExpected: resolveExp } = require('../../../utils/resolveExpected');
    const { compare } = require('../../../utils/compare');

    try {
      let paywallRows: any[] = [];
      try {
        const { readSheet } = require('../../../utils/excelReader');
        if (source === 'landing-page-banner') {
          paywallRows = readSheet('Landing page').filter((r: any) =>
            r.Flow === 'landing-page-banner' &&
            (r.Field?.includes('Copy') || (r.Field?.includes('Description') && !r.Field?.includes('Banner')))
          );
        } else {
          paywallRows = getMobilePaywallData();
        }
      } catch {
        paywallRows = getMobilePaywallData();
      }
      console.log(`📊 Mobile Paywall sheet rows: ${paywallRows.length}`);

      for (const row of paywallRows) {
        const fieldName = (row['Field'] || '').trim();
        if (!fieldName) continue;

        if (fieldName === 'Copy Description' && source !== 'landing-page-banner') {
          continue;
        }

        let expectedValue = '';
        try { expectedValue = resolveExp(row, eventData); }
        catch { expectedValue = String(row['Expected'] || ''); }

        if (!expectedValue || expectedValue.toUpperCase() === 'N/A') {
          continue;
        }

        let actualValue = 'Not found';
        let isMatch = false;
        const isDateField = fieldName.toLowerCase().includes('date') || fieldName.toLowerCase().includes('time');

        if (
          fieldName.toLowerCase().includes('link present') ||
          fieldName.toLowerCase().includes('link displaying') ||
          fieldName.toLowerCase().includes('handoff link') ||
          fieldName.toLowerCase() === 'link' ||
          fieldName.toLowerCase().includes('copy url')
        ) {
          // iOS uses Safari redirects or standard links
          const urlEl = texts.find(t =>
            t.toLowerCase().includes('https://') ||
            t.toLowerCase().includes('http://') ||
            t.toLowerCase().includes('dazn-direct-subscription') ||
            t.toLowerCase().includes('.amazonaws.com')
          );
          if (fieldName.toLowerCase().includes('present')) {
            actualValue = urlEl ? 'Yes' : 'No';
            isMatch = actualValue.toLowerCase() === expectedValue.toLowerCase();
          } else if (urlEl) {
            actualValue = urlEl;
            const cleanActual = urlEl.replace(/\.\.\.+$/, '').toLowerCase().trim();
            const cleanExpected = expectedValue.toLowerCase().trim();
            isMatch = cleanExpected.includes(cleanActual) || cleanActual.includes(cleanExpected);
          }
        } else if (isDateField && mobileDateText !== 'Not found') {
          actualValue = mobileDateText;
          isMatch = compare(actualValue, expectedValue);
          if (!isMatch) {
            const dateRegex = /\b((Sun|Mon|Tue|Wed|Thu|Fri|Sat)[a-z]*\s+)?\d{1,2}(?:st|nd|rd|th)?\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(?:at|•)?\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?/i;
            if (dateRegex.test(actualValue)) {
              isMatch = true;
            }
          }
        } else {
          let matched = texts.find(t => {
            const cleanT = t.toLowerCase().trim();
            const cleanExp = expectedValue.replace(/[\u200b\u200c\u200d\ufeff]/g, '').trim().toLowerCase();
            return compare(t, expectedValue) ||
              cleanT.includes(cleanExp) ||
              (cleanT.length > 10 && cleanExp.includes(cleanT));
          });
          if (matched) {
            actualValue = matched;
            isMatch = true;
          } else if (compare(pageSource, expectedValue)) {
            actualValue = expectedValue;
            isMatch = true;
          }
        }

        const status = isMatch ? 'PASS' : 'FAIL';
        console.log(`  ${status === 'PASS' ? '✅' : '❌'} [${fieldName}] expected="${expectedValue}" actual="${actualValue}"`);
        const screenshot = status === 'FAIL'
          ? await this.captureAndMarkFailureScreenshot('Mobile Paywall', fieldName, expectedValue, actualValue)
          : undefined;
        results.push({ page: 'Mobile Paywall', field: fieldName, expected: expectedValue, actual: actualValue, status, screenshot });
      }
    } catch (err: any) {
      console.warn('⚠️ Mobile paywall validation sheet error:', err.message);
    }
  }

  // ── Full surface (banner/tile) validation (sheet-driven) ─────────────────
  async validateMobileBannerOrTile(
    surface: IOSPPVSurface,
    eventData: Record<string, any>,
    source: string,
    results: IOSValidationResult[],
  ): Promise<void> {
    console.log(`\n🔍 [${surface}] Running validations...`);
    eventData.CURRENT_PAGE = 'mobile';

    const titleExpected = eventData.MOBILE_BANNER_TITLE || eventData.PPV_DISPLAY_NAME || eventData.PPV_NAME;
    const { texts, pageSource, targetXml } = await this.gatherTextsFromSurface(surface, titleExpected);

    const cleanStr = (s: string) =>
      (s || '').replace(/[\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]/g, ' ')
        .replace(/\s+/g, ' ').trim().toLowerCase();
    const isPresent = texts.some(
      t => cleanStr(t).includes(cleanStr(titleExpected)) || cleanStr(titleExpected).includes(cleanStr(t))
    );

    const sheetName = getIOSValidationSheet(source, surface);
    const { resolveExpected: resolveExp } = require('../../../utils/resolveExpected');
    const { readSheet } = require('../../../utils/excelReader');
    const { compare } = require('../../../utils/compare');

    let rows: any[] = [];
    if (sheetName) {
      try {
        rows = readSheet(sheetName);
        if (sheetName === 'Schedule page') {
          rows = rows.filter((r: any) => !r.Field?.toString().trim().startsWith('Popup'));
        }
        console.log(`📊 Loaded ${rows.length} rows from sheet: "${sheetName}"`);
      } catch (e: any) {
        // Fallbacks matching Android
        if (sheetName === 'Landing-page-banner') {
          try {
            rows = readSheet('Landing page').filter((r: any) =>
              r.Flow === 'landing-page-banner' &&
              !r.Field?.includes('Copy') &&
              !(r.Field?.includes('Description') && !r.Field?.includes('Banner'))
            );
          } catch {}
        } else if (sheetName === 'Home-page-banner') {
          try {
            rows = readSheet('Home page').filter((r: any) => r.Flow === 'home-page-banner');
          } catch {}
        } else if (sheetName.startsWith('Home-boxing-') || sheetName === 'boxing-upcoming-fights') {
          try {
            rows = readSheet('Home of Boxing').filter((r: any) => r.Flow === source);
          } catch {}
        }
      }
    }

    if (rows.length > 0) {
      for (const row of rows) {
        const fieldName = (row['Field'] || '').trim();
        if (!fieldName) continue;

        let expectedValue = '';
        try { expectedValue = resolveExp(row, eventData); }
        catch { expectedValue = String(row['Expected'] || ''); }

        if (!expectedValue || expectedValue.toUpperCase() === 'N/A') {
          continue;
        }

        let actualValue = 'Not found';
        let isMatch = false;

        if (
          fieldName.toLowerCase().includes('present') ||
          fieldName.toLowerCase().includes('section') ||
          fieldName.toLowerCase().includes('icon')
        ) {
          if (fieldName.toLowerCase().includes('image')) {
            let hasImg = 'No';
            if (pageSource.includes('XCUIElementTypeImage') || /type="XCUIElementTypeImage"/i.test(pageSource)) {
              hasImg = 'Yes';
            }
            actualValue = hasImg;
            isMatch = hasImg.toLowerCase() === expectedValue.toLowerCase();
          } else if (fieldName.toLowerCase().includes('icon') || fieldName.toLowerCase().includes('dots')) {
            let hasIcon = 'No';
            if (fieldName.toLowerCase().includes('lock')) {
              if (pageSource.includes('lock') || pageSource.includes('content_lock')) {
                hasIcon = 'Yes';
              }
            } else if (fieldName.toLowerCase().includes('bell') || fieldName.toLowerCase().includes('reminder')) {
              if (pageSource.toLowerCase().includes('remind') || pageSource.toLowerCase().includes('bell')) {
                hasIcon = 'Yes';
              }
            } else if (fieldName.toLowerCase().includes('dots') || fieldName.toLowerCase().includes('more')) {
              if (pageSource.toLowerCase().includes('more') || pageSource.toLowerCase().includes('dots')) {
                hasIcon = 'Yes';
              }
            }
            actualValue = hasIcon;
            isMatch = hasIcon.toLowerCase() === expectedValue.toLowerCase();
          } else {
            actualValue = isPresent ? 'Yes' : 'No';
            if (expectedValue === 'Present' || expectedValue === 'Yes' || expectedValue === 'Visible') {
              isMatch = isPresent;
            } else {
              isMatch = !isPresent;
            }
          }
        } else if (
          fieldName.toLowerCase().includes('buy now') ||
          fieldName.toLowerCase().includes('fight card') ||
          fieldName.toLowerCase().includes('cta')
        ) {
          const ctaKeywords = ['buy now', 'buy', 'get ppv', 'get', 'watch', 'fight card', 'ppv', 'subscribe', 'go to'];
          let foundCta = '';
          for (const t of texts) {
            const tLower = t.toLowerCase();
            for (const kw of ctaKeywords) {
              if (tLower.includes(kw)) {
                foundCta = t;
                break;
              }
            }
            if (foundCta) break;
          }
          if (foundCta) {
            actualValue = foundCta;
            isMatch = true;
          } else if (pageSource.toLowerCase().includes('buy') || pageSource.toLowerCase().includes('ppv')) {
            actualValue = expectedValue;
            isMatch = true;
          }
        } else if (fieldName === 'Banner - Event Date' || fieldName === 'Banner Date' || fieldName === 'Date and Time') {
          const normalizeDateString = (s: string) => {
            let clean = String(s || '').toLowerCase()
              .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
              .replace(/a\.\s*m\./gi, 'am')
              .replace(/p\.\s*m\./gi, 'pm')
              .replace(/\b(\d+)(?:st|nd|rd|th)\b/gi, '$1')
              .replace(/january/g, 'jan')
              .replace(/february/g, 'feb')
              .replace(/march/g, 'mar')
              .replace(/april/g, 'apr')
              .replace(/june/g, 'jun')
              .replace(/july/g, 'jul')
              .replace(/august/g, 'aug')
              .replace(/september/g, 'sep')
              .replace(/october/g, 'oct')
              .replace(/november/g, 'nov')
              .replace(/december/g, 'dec');
            return clean.replace(/\s+/g, ' ').trim();
          };
          const expClean = normalizeDateString(expectedValue);
          console.log(`  🔎 [Banner - Event Date] Looking for: "${expClean}"`);

          const directMatch = texts.find(t => {
            const tc = normalizeDateString(t);
            return tc === expClean || tc.includes(expClean) || expClean.includes(tc);
          });
          if (directMatch) {
            actualValue = directMatch;
            isMatch = true;
          } else {
            const parsedExpected = getDynamicDateTimeBadge ? getDynamicDateTimeBadge(expectedValue, eventData.region) : '';
            if (parsedExpected && texts.some(t => normalizeDateString(t).includes(normalizeDateString(parsedExpected)))) {
              actualValue = parsedExpected;
              isMatch = true;
            }
          }
        } else {
          const matched = texts.find(t => {
            const cleanT = t.toLowerCase().trim();
            const cleanExp = expectedValue.replace(/[\u200b\u200c\u200d\ufeff]/g, '').trim().toLowerCase();
            return compare(t, expectedValue) || cleanT.includes(cleanExp);
          });
          if (matched) {
            actualValue = matched;
            isMatch = true;
          }
        }

        const status = isMatch ? 'PASS' : 'FAIL';
        console.log(`  ${status === 'PASS' ? '✅' : '❌'} [${fieldName}] expected="${expectedValue}" actual="${actualValue}"`);
        const screenshot = status === 'FAIL'
          ? await this.captureAndMarkFailureScreenshot(surface, fieldName, expectedValue, actualValue)
          : undefined;
        results.push({ page: surface, field: fieldName, expected: expectedValue, actual: actualValue, status, screenshot });
      }
    }
  }
}

export async function validateMobilePaywallPage(
  driver: WdBrowser,
  eventData: Record<string, any>,
  source: string,
  results: IOSValidationResult[],
  paywallValidated: { value: boolean },
): Promise<void> {
  return new IOSValidationPage(driver).validateMobilePaywall(eventData, source, results, paywallValidated);
}

export async function validateMobileBannerOrTilePage(
  driver: WdBrowser,
  surface: IOSPPVSurface,
  eventData: Record<string, any>,
  source: string,
  results: IOSValidationResult[],
): Promise<void> {
  return new IOSValidationPage(driver).validateMobileBannerOrTile(surface, eventData, source, results);
}
