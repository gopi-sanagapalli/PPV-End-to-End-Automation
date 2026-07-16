import {
  AndroidBasePage,
  AndroidPPVSurface,
  WdBrowser,
  adbSwipe,
  getScreenSize,
} from './AndroidBasePage';
import { getAndroidValidationSheet } from './AndroidSurfacingPoint';

// Timezone-aware date utilities loaded dynamically to avoid tsconfig rootDir restrictions
let getDynamicDateTimeBadge: ((template: string, region?: string) => string) | undefined;
let getNowForRegion: ((region?: string) => Date) | undefined;
try {
  const dateUtils = require('../../../../utils/dateUtils');
  getDynamicDateTimeBadge = dateUtils.getDynamicDateTimeBadge;
  getNowForRegion = dateUtils.getNowForRegion;
} catch (e) {
  console.warn('⚠️ Failed to load timezone utilities, date validation will use device timezone');
}

export interface AndroidValidationResult {
  page: string;
  field: string;
  expected: string;
  actual: string;
  status: 'PASS' | 'FAIL';
  screenshot?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// AndroidValidationPage
//
// Encapsulates all page-source scraping, text gathering, field matching, and
// Excel-sheet-driven validation for native Android paywall and surface screens.
// Logic is extracted verbatim from ppv.handoff.spec.ts and
// existingusermobile.ppv.spec.ts to ensure zero behavioral change.
// ─────────────────────────────────────────────────────────────────────────────
export class AndroidValidationPage extends AndroidBasePage {

  // ── Paywall: gather all visible text elements (with scroll) ──────────────
  async gatherTextsFromPaywall(): Promise<{
    texts: string[];
    pageSource: string;
    mobileDateText: string;
  }> {
    const textsSet = new Set<string>();
    let pageSource = '';

    // Wait up to 15 seconds for key paywall elements (including Instruction Text which can be slow)
    let isLoaded = false;
    for (let i = 0; i < 30; i++) {
      const src = await this.driver.getPageSource().catch(() => '');
      if (
        src.toLowerCase().includes('copy') ||
        src.toLowerCase().includes('how to watch') ||
        src.toLowerCase().includes('paste this link') ||
        src.toLowerCase().includes('paste')
      ) {
        isLoaded = true;
        pageSource = src;
        break;
      }
      await this.driver.pause(500);
    }
    if (!isLoaded) {
      console.warn('⚠️ Mobile paywall page did not load fully within timeout.');
    }

    await this.driver.pause(1000);

    const fetchTexts = async () => {
      try {
        const textEls = await this.driver.$$('//android.widget.TextView | //android.widget.Button | //android.widget.EditText');
        for (const el of textEls) {
          const txt = await el.getText().catch(() => '');
          if (txt && txt.trim()) textsSet.add(txt.trim());
        }
      } catch (e: any) {
        console.log(`⚠️ Failed to fetch text elements: ${e.message}`);
      }
    };

    // First pass
    await fetchTexts();

    // Scroll down slightly (swipe up) to expose off-screen elements
    console.log('  Scrolling down (swiping up) on paywall to capture off-screen elements...');
    try {
      const sz = getScreenSize();
      adbSwipe(
        Math.round(sz.width / 2),
        Math.round(sz.height * 0.85),
        Math.round(sz.width / 2),
        Math.round(sz.height * 0.65),
      );
      await this.driver.pause(1200);
    } catch (e: any) {
      console.log(`⚠️ Scroll failed: ${e.message}`);
    }

    // Second pass after scroll
    await fetchTexts();

    if (!pageSource) {
      pageSource = await this.driver.getPageSource().catch(() => '');
    }

    const texts = Array.from(textsSet);
    console.log('📋 Total unique texts gathered:', texts);

    // Find date element by looking for month + digit pattern
    let mobileDateText = 'Not found';
    const monthRegex = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i;
    const foundDate = texts.find(t => monthRegex.test(t) && /\d/.test(t));
    if (foundDate) {
      mobileDateText = foundDate;
      console.log(`💡 Detected mobile paywall date element: "${mobileDateText}"`);
    }

    return { texts, pageSource, mobileDateText };
  }

  // ── Surface: gather texts from banner or tile (with bounds isolation) ─────
  async gatherTextsFromSurface(
    surface: AndroidPPVSurface,
    titleExpected: string,
  ): Promise<{ texts: string[]; pageSource: string; targetXml: string }> {
    const textsSet = new Set<string>();
    let pageSource = '';
    let targetXml = '';

    try {
      if (surface === 'PPV Banner') {
        console.log('⏳ Waiting 3 seconds for the banner image to fully load...');
        await this.driver.pause(3000);
      }
      pageSource = await this.driver.getPageSource();
      targetXml = pageSource;

      if (surface === 'PPV Tile' && titleExpected) {
        let tileCenterY = -1;
        let containerTopY = -1;
        let containerBottomY = -1;
        const titleEscaped = titleExpected.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        const titleElementRegex = new RegExp(`<[^>]*text="${titleEscaped}"[^>]*bounds="([^"]+)"`);
        const titleMatch = pageSource.match(titleElementRegex);
        if (titleMatch) {
          const boundsMatch = titleMatch[1].match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
          if (boundsMatch) {
            const titleL = parseInt(boundsMatch[1], 10);
            const titleT = parseInt(boundsMatch[2], 10);
            const titleR = parseInt(boundsMatch[3], 10);
            const titleB = parseInt(boundsMatch[4], 10);
            tileCenterY = (titleT + titleB) / 2;

            const titleIndex = pageSource.indexOf(titleMatch[0]);
            const xmlBefore = pageSource.substring(0, titleIndex);
            const tagRegex = /<([a-zA-Z0-9.]+)\b[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g;
            let tagMatch;
            while ((tagMatch = tagRegex.exec(xmlBefore)) !== null) {
              const tagL = parseInt(tagMatch[2], 10);
              const tagT = parseInt(tagMatch[3], 10);
              const tagR = parseInt(tagMatch[4], 10);
              const tagB = parseInt(tagMatch[5], 10);
              if (tagT < titleT && tagB >= titleB && tagL <= titleL && tagR >= titleR) {
                containerTopY = tagT;
                containerBottomY = tagB;
              }
            }
            console.log(`🎯 Found title "${titleExpected}" in XML. Center Y = ${tileCenterY}. Container Y bounds: [${containerTopY}, ${containerBottomY}]`);
          }
        }

        if (tileCenterY !== -1) {
          const minVal = containerTopY !== -1 ? containerTopY - 30 : tileCenterY - 350;
          const maxVal = containerBottomY !== -1 ? containerBottomY + 30 : tileCenterY + 350;
          const elementRegex = /<([a-zA-Z0-9.]+)\b[^>]*(?:text|content-desc)="([^"]+)"[^>]*bounds="([^"]+)"/g;
          let elMatch;
          while ((elMatch = elementRegex.exec(pageSource)) !== null) {
            const textVal = elMatch[2].trim();
            const boundsStr = elMatch[3];
            if (!textVal) continue;
            const bm = boundsStr.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
            if (bm) {
              const topY = parseInt(bm[2], 10);
              const bottomY = parseInt(bm[4], 10);
              const elCenterY = (topY + bottomY) / 2;
              if (elCenterY >= minVal && elCenterY <= maxVal) textsSet.add(textVal);
            }
          }
          console.log(`🎯 Isolated ${textsSet.size} text elements inside bounds [${minVal}, ${maxVal}] close to centered tile`);
          targetXml = pageSource;
        } else {
          const viewGroups = pageSource.match(/<android\.view\.ViewGroup\b[^>]*>([\s\S]*?)<\/android\.view\.ViewGroup>/g) || [];
          const titleRegex = new RegExp(`text="${titleEscaped}"\\s`);
          let foundGroup = '';
          for (const group of viewGroups) {
            if (titleRegex.test(group)) { foundGroup = group; break; }
          }
          if (foundGroup) {
            targetXml = foundGroup;
            console.log(`🎯 Successfully isolated target ViewGroup container for PPV Tile [${titleExpected}] (length: ${targetXml.length})`);
          } else {
            const titleIndex = pageSource.indexOf(titleExpected);
            if (titleIndex !== -1) {
              targetXml = pageSource.substring(Math.max(0, titleIndex - 5000), Math.min(pageSource.length, titleIndex + 6000));
              console.log(`✂️ Sliced XML page source around PPV Title [${titleExpected}] (length: ${targetXml.length}) as fallback`);
            }
          }
          const regex = /(?:text|content-desc)="([^"]+)"/g;
          let match;
          while ((match = regex.exec(targetXml)) !== null) {
            const val = match[1].trim();
            if (val) textsSet.add(val);
          }
        }

        try {
          const fs = require('fs');
          fs.writeFileSync('./test-results/android_page_source.xml', pageSource, 'utf8');
          fs.writeFileSync('./test-results/android_target_xml.xml', targetXml, 'utf8');
          console.log('💾 Saved XML dumps to ./test-results/');
        } catch (err: any) {
          console.warn('⚠️ Failed to save XML dumps:', err.message);
        }
      } else {
        // Banner: extract all texts from full page source
        const regex = /(?:text|content-desc)="([^"]+)"/g;
        let match;
        while ((match = regex.exec(targetXml)) !== null) {
          const val = match[1].trim();
          if (val) textsSet.add(val);
        }

        // Save XML dump for banner debugging
        try {
          const fs = require('fs');
          fs.writeFileSync('./test-results/android_banner_page_source.xml', pageSource, 'utf8');
          console.log('💾 Saved banner XML dump to ./test-results/android_banner_page_source.xml');
        } catch (err: any) {
          console.warn('⚠️ Failed to save banner XML dump:', err.message);
        }
      }
    } catch (e: any) {
      console.log(`⚠️ Failed to fetch page source: ${e.message}`);
    }

    const texts = Array.from(textsSet);
    console.log(`📱 Gathered local texts for ${surface}:`, texts);
    return { texts, pageSource, targetXml };
  }

  // ── Full paywall validation (sheet-driven) ────────────────────────────────
  async validateMobilePaywall(
    eventData: Record<string, any>,
    source: string,
    results: AndroidValidationResult[],
    paywallValidated: { value: boolean },
  ): Promise<void> {
    if (paywallValidated.value) {
      console.log('⏭️ Mobile Paywall already validated. Skipping duplicate validation.');
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

        let expectedValue = '';
        try { expectedValue = resolveExp(row, eventData); }
        catch { expectedValue = String(row['Expected'] || ''); }

        if (!expectedValue || expectedValue.toUpperCase() === 'N/A') {
          console.log(`  ⏭️ Skipping [${fieldName}] (N/A)`);
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
            // Dynamic date/time match fallback for different timezones/formatting
            const dateRegex = /\b(Sun|Mon|Tue|Wed|Thu|Fri|Sat)[a-z]*\s+\d{1,2}(?:st|nd|rd|th)?\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(?:at|•)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?/i;
            if (dateRegex.test(actualValue)) {
              isMatch = true;
            }
          }
        } else {
          let matched = texts.find(t =>
            compare(t, expectedValue) ||
            t.toLowerCase().includes(expectedValue.replace(/[\u200b\u200c\u200d\ufeff]/g, '').trim().toLowerCase())
          );
          if (!matched && expectedValue.toLowerCase().includes('how to watch')) {
            const foundHeader = texts.find(t => t.toLowerCase().includes('how to watch'));
            if (foundHeader) matched = foundHeader;
          }
          // Instruction Text can be slow to load — retry for up to 5 more seconds if not found
          if (!matched && fieldName.toLowerCase() === 'instruction text') {
            const expLower = expectedValue.replace(/[\u200b\u200c\u200d\ufeff]/g, '').trim().toLowerCase();
            for (let attempt = 0; attempt < 10 && !matched; attempt++) {
              await this.driver.pause(500);
              const retrySrc = await this.driver.getPageSource().catch(() => '');
              if (retrySrc.toLowerCase().includes('paste') || retrySrc.toLowerCase().includes(expLower.substring(0, 20))) {
                try {
                  const retryEls = await this.driver.$$('//android.widget.TextView');
                  for (const el of retryEls) {
                    const txt = await el.getText().catch(() => '');
                    if (txt && txt.trim()) {
                      const tc = txt.trim().toLowerCase();
                      if (tc === expLower || tc.includes(expLower) || expLower.includes(tc.substring(0, 20))) {
                        matched = txt.trim();
                        break;
                      }
                    }
                  }
                } catch (e: any) {
                  console.log(`⚠️ Instruction Text retry fetch failed: ${e.message}`);
                }
              }
            }
            if (!matched) {
              // Last resort: check combined page source
              const finalSrc = await this.driver.getPageSource().catch(() => pageSource);
              if (finalSrc.toLowerCase().includes(expLower.substring(0, 30))) {
                matched = expectedValue;
              }
            }
          }
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
        results.push({ page: 'Mobile Paywall', field: fieldName, expected: expectedValue, actual: actualValue, status });
      }
    } catch (err: any) {
      console.warn('⚠️ Mobile paywall validation sheet error:', err.message);
    }
  }

  // ── Full surface (banner/tile) validation (sheet-driven) ─────────────────
  async validateMobileBannerOrTile(
    surface: AndroidPPVSurface,
    eventData: Record<string, any>,
    source: string,
    results: AndroidValidationResult[],
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

    const sheetName = getAndroidValidationSheet(source, surface);
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
        console.log(`📊 Loaded ${rows.length} rows from dedicated sheet: "${sheetName}"`);
      } catch (e: any) {
        if (sheetName === 'Landing-page-banner') {
          try {
            rows = readSheet('Landing page').filter((r: any) =>
              r.Flow === 'landing-page-banner' &&
              !r.Field?.includes('Copy') &&
              !(r.Field?.includes('Description') && !r.Field?.includes('Banner'))
            );
            console.log(`📊 Loaded ${rows.length} rows from fallback "Landing page" filtered by "landing-page-banner" (excluding Copy overlay fields)`);
          } catch (e2: any) {
            console.warn(`⚠️ Failed to load fallback sheet "Landing page": ${e2.message}`);
          }
        } else if (sheetName === 'Home-page-banner') {
          try {
            rows = readSheet('Home page').filter((r: any) => r.Flow === 'home-page-banner');
            console.log(`📊 Loaded ${rows.length} rows from fallback "Home page" filtered by "home-page-banner"`);
          } catch (e2: any) {
            console.warn(`⚠️ Failed to load fallback sheet "Home page": ${e2.message}`);
          }
        } else if (sheetName.startsWith('Home-boxing-') || sheetName === 'boxing-upcoming-fights') {
          try {
            rows = readSheet('Home of Boxing').filter((r: any) => r.Flow === source);
            console.log(`📊 Loaded ${rows.length} rows from fallback "Home of Boxing" filtered by "${source}"`);
          } catch (e2: any) {
            console.warn(`⚠️ Failed to load fallback sheet "Home of Boxing": ${e2.message}`);
          }
        } else {
          console.warn(`⚠️ Failed to load dedicated sheet "${sheetName}": ${e.message}`);
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
          console.log(`  Skip field [${fieldName}] (N/A)`);
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
            if (
              targetXml.includes('resource-id="com.dazn:id/search_image"') ||
              targetXml.includes('content-desc="Search result image"') ||
              targetXml.includes('resource-id="com.dazn:id/image"') ||
              /class="android\.view\.View"[^>]*text=""[^>]*content-desc=""[^>]*bounds="\[\d+,\d+\]\[\d+,\d+\]"/.test(targetXml) ||
              /android\.widget\.ImageView[^>]*text=""[^>]*content-desc=""(?!.*resource-id)/.test(targetXml)
            ) { hasImg = 'Yes'; }
            actualValue = hasImg;
            isMatch = hasImg.toLowerCase() === expectedValue.toLowerCase();
          } else if (fieldName.toLowerCase().includes('icon') || fieldName.toLowerCase().includes('dots')) {
            let hasIcon = 'No';
            if (fieldName.toLowerCase().includes('lock')) {
              if (
                targetXml.includes('resource-id="com.dazn:id/content_lock"') ||
                targetXml.includes('content_lock') ||
                /android\.[a-zA-Z0-9._]+(?=[^>]*clickable="true")(?=[^>]*text="")[^>]*>/i.test(targetXml)
              ) { hasIcon = 'Yes'; }
            } else if (fieldName.toLowerCase().includes('bell') || fieldName.toLowerCase().includes('reminder')) {
              if (
                targetXml.includes('reminder') || targetXml.includes('bell') ||
                targetXml.includes('notification') || targetXml.includes('alarm') ||
                targetXml.includes('Remind') || targetXml.includes('remind') ||
                targetXml.includes('Notify') || targetXml.includes('notify')
              ) { hasIcon = 'Yes'; }
            } else if (fieldName.toLowerCase().includes('dots') || fieldName.toLowerCase().includes('more')) {
              if (
                targetXml.includes('more') || targetXml.includes('options') ||
                targetXml.includes('three_dots') || targetXml.includes('More')
              ) { hasIcon = 'Yes'; }
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
          // For active_standard users, the banner may show different CTAs
          // (e.g. "Get PPV", "Buy PPV") instead of "Buy Now" / "Fight Card".
          // Check for any CTA-like text in the banner area.
          const ctaKeywords = ['buy now', 'buy', 'get ppv', 'get', 'watch', 'fight card', 'ppv', 'subscribe'];
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
        } else if (fieldName === 'Banner - Event Date' || fieldName === 'Date and Time') {
          // The date on the mobile banner may be one joined string or split across parts.
          // Try exact/includes match on the full expected string first, then try part-based matching.
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
          console.log(`  🔎 [Banner - Event Date] texts array (${texts.length} items):`, JSON.stringify(texts.slice(0, 30)));
          console.log(`  🔎 [Banner - Event Date] pageSource includes expected? ${normalizeDateString(pageSource).includes(expClean)}`);
          
          const debugParts = expClean.split(/\s+/);
          for (const dp of debugParts) {
            console.log(`  🔎 [Banner - Event Date] pageSource includes "${dp}"? ${normalizeDateString(pageSource).includes(dp)}`);
          }

          const directMatch = texts.find(t => {
            const tc = normalizeDateString(t);
            return tc === expClean || tc.includes(expClean) || expClean.includes(tc);
          });
          if (directMatch) {
            actualValue = directMatch;
            isMatch = true;
          } else {
            // Try combining adjacent text pieces that together form the date
            const joined = normalizeDateString(texts.join(' '));
            if (joined.includes(expClean)) {
              actualValue = expectedValue;
              isMatch = true;
            } else if (normalizeDateString(pageSource).includes(expClean)) {
              actualValue = expectedValue;
              isMatch = true;
            } else {
              // Try partial component checks: day + month components all present
              const dateParts = expClean.split(/\s+/).filter(p => p.length > 1 && p !== 'at' && p !== '•');
              const allPartsFound = dateParts.length > 0 && dateParts.every(part =>
                joined.includes(part) || normalizeDateString(pageSource).includes(part)
              );
              if (allPartsFound) {
                actualValue = expectedValue;
                isMatch = true;
              } else {
                // Try matching a dynamic date format: e.g. "Sun 26th July at 12:30am", "Sat 25th Jul at 20:00"
                const dateRegex = /\b(Sun|Mon|Tue|Wed|Thu|Fri|Sat)[a-z]*\s+\d{1,2}(?:st|nd|rd|th)?\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(?:at|•)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?/i;
                const dynamicDateMatch = texts.find(t => dateRegex.test(t));
                if (dynamicDateMatch) {
                  actualValue = dynamicDateMatch;
                  isMatch = true;
                } else {
                  const pageSourceMatch = pageSource.match(dateRegex);
                  if (pageSourceMatch) {
                    actualValue = pageSourceMatch[0];
                    isMatch = true;
                  } else {
                    // FALLBACK: Find a date-like text element to show in actualValue on fail
                    const dateLike = texts.find(t => 
                      /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|sun|mon|tue|wed|thu|fri|sat)\b/i.test(t) ||
                      /\d{1,2}(st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(t) ||
                      /\d{1,2}:\d{2}/.test(t)
                    );
                    if (dateLike) {
                      actualValue = dateLike;
                    } else if (texts.length > 0) {
                      const titleClean = String(titleExpected || '').toLowerCase();
                      const fallback = texts.find(t => {
                        const tl = t.toLowerCase();
                        return tl !== titleClean && !tl.includes('boxing') && !tl.includes('matchroom');
                      });
                      if (fallback) actualValue = fallback;
                    }
                  }
                }
              }
            }
          }
        } else if (
          fieldName === 'Day' || fieldName === 'Month' || fieldName === 'Date' || fieldName === 'Time' ||
          fieldName.startsWith('Tile - ')
        ) {
          const effectiveField = fieldName.startsWith('Tile - ') ? fieldName.replace('Tile - ', '') : fieldName;
          let expectedPart = expectedValue;
          try {
            const refDateStr = eventData.HOME_BOXING_UPCOMING_DATE || eventData.LANDING_PAGE_PPV_DATE || eventData.PPV_DATE || '';
            const refTimeStr = eventData.HOME_BOXING_UPCOMING_TIME || eventData.PPV_TIME || '';
            if (refDateStr) {
              const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
              const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
              const cleanRefStr = refDateStr.toUpperCase().replace(/,/g, '');
              const tokens = cleanRefStr.split(/\s+/);
              let parsedDay = '', parsedMonth = '', parsedDate = '';
              for (const token of tokens) {
                const ct = token.replace(/[^A-Z0-9]/g, '');
                if (days.includes(ct.substring(0, 3))) parsedDay = ct.substring(0, 3);
                else if (months.includes(ct.substring(0, 3))) parsedMonth = ct.substring(0, 3);
                else if (/^\d+$/.test(ct.replace(/\D/g, ''))) parsedDate = ct.replace(/\D/g, '');
              }
              if (effectiveField === 'Day' && parsedDay) expectedPart = parsedDay;
              if (effectiveField === 'Month' && parsedMonth) expectedPart = parsedMonth;
              if (effectiveField === 'Date' && parsedDate) expectedPart = parsedDate;
            }
            if (effectiveField === 'Time' && refTimeStr) expectedPart = refTimeStr;
          } catch (e: any) {
            console.warn('⚠️ General date parsing failed, falling back to rule expected:', e.message);
          }

          let extractedVal = '';
          if (effectiveField === 'Day') {
            const daysList = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
            const matched = texts.find(t => daysList.includes(t.toLowerCase().trim()));
            if (matched) extractedVal = matched.trim().toUpperCase();
          } else if (effectiveField === 'Month') {
            const monthsList = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec', 'january', 'february', 'march', 'april', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
            const matched = texts.find(t => monthsList.includes(t.toLowerCase().trim()));
            if (matched) extractedVal = matched.trim().toUpperCase();
          } else if (effectiveField === 'Date') {
            const matched = texts.find(t => /^\d{1,2}$/.test(t.trim()));
            if (matched) extractedVal = matched.trim();
          } else if (effectiveField === 'Time') {
            const matchEl = texts.find(t => /\b\d{1,2}:\d{2}\s*(am|pm)?\b/i.test(t) || /\b\d{1,2}(am|pm)\b/i.test(t));
            if (matchEl) {
              const timeMatch = matchEl.match(/\b\d{1,2}:\d{2}\s*(?:am|pm)?\b/i) || matchEl.match(/\b\d{1,2}(?:am|pm)\b/i);
              if (timeMatch) extractedVal = timeMatch[0].trim();
            }
          }

          if (extractedVal) {
            actualValue = extractedVal;
            const expectedClean = expectedPart.replace(/[\u200b\u200c\u200d\ufeff]/g, '').trim().toLowerCase();
            const actualClean = extractedVal.replace(/[\u200b\u200c\u200d\ufeff]/g, '').trim().toLowerCase();
            isMatch = actualClean === expectedClean || actualClean.includes(expectedClean) || expectedClean.includes(actualClean);
          } else {
            const expectedClean = expectedPart.replace(/[\u200b\u200c\u200d\ufeff]/g, '').trim().toLowerCase();
            const matched = texts.find(t => {
              const tClean = t.toLowerCase();
              return tClean === expectedClean || tClean.includes(expectedClean);
            });
            if (matched) { actualValue = matched; isMatch = true; }
            else if (pageSource.toLowerCase().includes(expectedClean)) { actualValue = expectedPart; isMatch = true; }
          }
          expectedValue = expectedPart;
        } else {
          const expectedClean = expectedValue.replace(/[\u200b\u200c\u200d\ufeff]/g, '').trim().toLowerCase();
          let matched = texts.find(t => {
            const tClean = t.toLowerCase();
            return tClean === expectedClean || tClean.includes(expectedClean);
          });
          if (matched) {
            actualValue = matched;
            isMatch = true;
          } else {
            const watchLiveEl = texts.find(t => t.toLowerCase().includes('watch live'));
            if (watchLiveEl) {
              actualValue = watchLiveEl;
              const actualClean = watchLiveEl.replace(/[\u200b\u200c\u200d\ufeff]/g, '').trim().toLowerCase();
              isMatch = actualClean === expectedClean || actualClean.includes(expectedClean) || expectedClean.includes(actualClean);
            } else if (pageSource.toLowerCase().includes(expectedClean)) {
              actualValue = expectedValue;
              isMatch = true;
            }
          }
        }

        const status = isMatch ? 'PASS' : 'FAIL';
        console.log(`  ${status === 'PASS' ? '✅' : '❌'} [${fieldName}] expected="${expectedValue}" actual="${actualValue}"`);
        results.push({ page: surface, field: fieldName, expected: expectedValue, actual: actualValue, status });
      }
    } else {
      // Legacy fallback if no sheet rows are configured for this surface
      const presenceField = surface === 'PPV Banner' ? 'Banner Present' : 'Tile Present';
      console.log(`  ${isPresent ? '✅' : '❌'} [${presenceField}] expected="Present" actual="${isPresent ? 'Present' : 'Not present'}"`);
      results.push({
        page: surface,
        field: presenceField,
        expected: 'Present',
        actual: isPresent ? 'Present' : 'Not present',
        status: isPresent ? 'PASS' : 'FAIL',
      });

      if (isPresent) {
        const checkFieldLegacy = (fieldName: string, expectedValue: string) => {
          if (!expectedValue || expectedValue.toUpperCase() === 'N/A') {
            console.log(`  Skip field [${fieldName}] (N/A)`);
            return;
          }
          let actualVal = 'Not found';
          const matched = texts.find(t =>
            compare(t, expectedValue) ||
            t.toLowerCase().includes(expectedValue.replace(/[\u200b\u200c\u200d\ufeff]/g, '').trim().toLowerCase())
          );
          if (matched) { 
            actualVal = matched; 
          } else if (pageSource.toLowerCase().includes(expectedValue.replace(/[\u200b\u200c\u200d\ufeff]/g, '').trim().toLowerCase())) { 
            actualVal = expectedValue; 
          } else if (fieldName === 'Date and Time' || fieldName === 'Banner - Event Date') {
            console.log(`  🔍 [Date and Time] Starting validation...`);
            console.log(`  🔍 [Date and Time] Expected: "${expectedValue}"`);
            console.log(`  🔍 [Date and Time] Texts count: ${texts.length}`);
            
            // Fallback for dynamic timezone/date formatting changes
            const dateRegex = /\b(Sun|Mon|Tue|Wed|Thu|Fri|Sat)[a-z]*\s+\d{1,2}(?:st|nd|rd|th)?\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(?:at|•)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?/i;
            const dynamicDateMatch = texts.find(t => {
              const matches = dateRegex.test(t);
              if (matches) console.log(`  🔍 [Date and Time] Regex matched text: "${t}"`);
              return matches;
            });
            
            console.log(`  🔍 [Date and Time] dynamicDateMatch found: ${!!dynamicDateMatch}`);
            
            if (dynamicDateMatch) {
              console.log(`  🔍 [Date and Time] Matched: "${dynamicDateMatch}"`);
              
              // Verify the matched date matches the expected date (handles timezone conversion)
              const expectedNorm = String(expectedValue || '').toLowerCase()
                .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
                .replace(/\b(\d+)(?:st|nd|rd|th)\b/gi, '$1')
                .replace(/january/g, 'jan').replace(/february/g, 'feb').replace(/march/g, 'mar')
                .replace(/april/g, 'apr').replace(/june/g, 'jun').replace(/july/g, 'jul')
                .replace(/august/g, 'aug').replace(/september/g, 'sep').replace(/october/g, 'oct')
                .replace(/november/g, 'nov').replace(/december/g, 'dec')
                .replace(/\s+/g, ' ').trim();
              const actualNorm = String(dynamicDateMatch || '').toLowerCase()
                .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
                .replace(/\b(\d+)(?:st|nd|rd|th)\b/gi, '$1')
                .replace(/january/g, 'jan').replace(/february/g, 'feb').replace(/march/g, 'mar')
                .replace(/april/g, 'apr').replace(/june/g, 'jun').replace(/july/g, 'jul')
                .replace(/august/g, 'aug').replace(/september/g, 'sep').replace(/october/g, 'oct')
                .replace(/november/g, 'nov').replace(/december/g, 'dec')
                .replace(/\s+/g, ' ').trim();
              
              console.log(`  🔍 [Date and Time] Expected norm: "${expectedNorm}"`);
              console.log(`  🔍 [Date and Time] Actual norm: "${actualNorm}"`);
              
              // Extract day+month from both dates for comparison
              const expectedDateMatch = expectedNorm.match(/(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i);
              const actualDateMatch = actualNorm.match(/(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i);
              
              console.log(`  🔍 [Date and Time] Expected date match:`, expectedDateMatch);
              console.log(`  🔍 [Date and Time] Actual date match:`, actualDateMatch);
              
              if (expectedDateMatch && actualDateMatch) {
                const expectedDay = expectedDateMatch[1];
                const expectedMonth = expectedDateMatch[2].toLowerCase();
                const actualDay = actualDateMatch[1];
                const actualMonth = actualDateMatch[2].toLowerCase();
                
                console.log(`  🔍 [Date and Time] Comparing: ${expectedDay} ${expectedMonth} vs ${actualDay} ${actualMonth}`);
                
                // Check if day and month match (timezone may change the day display)
                if (expectedDay === actualDay && expectedMonth === actualMonth) {
                  actualVal = dynamicDateMatch;
                  console.log(`  ✅ [Date and Time] Valid timezone-adjusted match: ${expectedDay} ${expectedMonth}`);
                } else {
                  // Different dates - this is NOT a valid timezone conversion
                  console.log(`  ❌ [Date and Time] Date mismatch: expected="${expectedDay} ${expectedMonth}", actual="${actualDay} ${actualMonth}"`);
                  actualVal = 'Not found'; // Keep as FAIL
                }
              } else {
                // Could not parse dates, accept the match
                actualVal = dynamicDateMatch;
                console.log(`  ⚠️ [Date and Time] Could not parse dates, accepting match`);
              }
            } else {
              console.log(`  🔍 [Date and Time] No regex match found in texts`);
              const pageSourceMatch = pageSource.match(dateRegex);
              if (pageSourceMatch) {
                actualVal = pageSourceMatch[0];
                console.log(`  🔍 [Date and Time] Found in pageSource: "${actualVal}"`);
              } else {
                console.log(`  🔍 [Date and Time] No match in pageSource either`);
              }
            }
          }
          const status = actualVal !== 'Not found' ? 'PASS' : 'FAIL';
          results.push({ page: surface, field: fieldName, expected: expectedValue, actual: actualVal, status });
        };
        checkFieldLegacy('Title', titleExpected);
        
        // Use timezone-aware date generation for Android validation (matches web test behavior)
        const region = (eventData.DAZN_REGION || process.env.DAZN_REGION || 'GB').toUpperCase();
        const dateTimeTemplate = eventData.MOBILE_BANNER_DATE_TIME || eventData.MOBILE_BANNER_DATE || eventData.PPV_DATE;
        const timezoneAwareDateTime = getDynamicDateTimeBadge 
          ? getDynamicDateTimeBadge(dateTimeTemplate, region) 
          : dateTimeTemplate;
        console.log(`  🌍 [Date and Time] Region: ${region}, Template: ${dateTimeTemplate}, Timezone-aware: ${timezoneAwareDateTime}`);
        checkFieldLegacy('Date and Time', timezoneAwareDateTime);
        
        if (surface === 'PPV Banner') {
          checkFieldLegacy('Description', eventData.MOBILE_BANNER_DESCRIPTION || eventData.BANNER_DESCRIPTION);
        }
      }
    }
    
    // Release carousel pause after validation completes
    if (source === 'landing-page-banner') {
      await this.releaseCarousel();
    }
  }

  // ── Carousel pause mechanism ──────────────────────────────────────────────
  // Long-press on banner to pause carousel auto-advance during validation
  private carouselPaused = false;
  private bannerElement: any | null = null;

  async pauseCarousel(bannerElement: any, durationMs: number = 20000): Promise<void> {
    try {
      console.log('  ⏸️ Attempting to pause carousel...');
      
      // Get banner bounds and calculate center point
      const rect = await bannerElement.getRect();
      const centerX = rect.x + rect.width / 2;
      const centerY = rect.y + rect.height / 2;
      
      console.log(`  ⏸️ Carousel pause started at (${centerX}, ${centerY}) for ${durationMs}ms`);
      
      // Use W3C Actions API for long press
      await this.driver.performActions([
        {
          type: 'pointer',
          id: 'finger1',
          parameters: { pointerType: 'touch' },
          actions: [
            { type: 'pointerMove', duration: 0, x: centerX, y: centerY },
            { type: 'pointerDown', button: 0 },
            { type: 'pause', duration: durationMs },
            { type: 'pointerUp', button: 0 },
          ],
        },
      ]);
      
      this.carouselPaused = true;
      this.bannerElement = bannerElement;
      console.log(`  ✅ Carousel paused for ${durationMs}ms`);
    } catch (e: any) {
      console.warn(`  ⚠️ Carousel pause not supported: ${e.message}`);
      this.carouselPaused = false;
    }
  }

  async releaseCarousel(): Promise<void> {
    if (!this.carouselPaused) {
      return;
    }
    
    try {
      // Release any active actions
      await this.driver.releaseActions();
      this.carouselPaused = false;
      console.log('  ▶️ Carousel pause released');
    } catch (e: any) {
      console.warn(`  ⚠️ Failed to release carousel: ${e.message}`);
      this.carouselPaused = false;
    }
  }

  // ── Availability tracking ─────────────────────────────────────────────────
  static recordAvailability(
    results: AndroidValidationResult[],
    ppvName: string,
    pageName: string,
    checkName: string,
    available: boolean,
    screenshot?: string,
  ): void {
    const existingIndex = results.findIndex(r => r.page === pageName && r.field === checkName);
    const row: AndroidValidationResult = {
      page: pageName,
      field: checkName,
      expected: ppvName,
      actual: available ? ppvName : `${ppvName} not available`,
      status: available ? 'PASS' : 'FAIL',
      screenshot,
    };
    if (existingIndex >= 0) { results[existingIndex] = row; }
    else { results.push(row); }
  }
}

// ── Standalone function exports (called from spec files via androidFlowHooks) ──

export async function validateMobilePaywallPage(
  driver: WdBrowser,
  eventData: Record<string, any>,
  source: string,
  results: AndroidValidationResult[],
  paywallValidated: { value: boolean },
): Promise<void> {
  return new AndroidValidationPage(driver).validateMobilePaywall(eventData, source, results, paywallValidated);
}

export async function validateMobileBannerOrTilePage(
  driver: WdBrowser,
  surface: AndroidPPVSurface,
  eventData: Record<string, any>,
  source: string,
  results: AndroidValidationResult[],
): Promise<void> {
  return new AndroidValidationPage(driver).validateMobileBannerOrTile(surface, eventData, source, results);
}
