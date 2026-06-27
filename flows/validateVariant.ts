import { resolveExpected } from '../utils/resolveExpected';
import { getActualValue } from '../utils/getActualValue';
import { compare } from '../utils/compare';
import { getPageSnapshot, DOMNode, stabilisePage } from '../utils/helpers';

import { captureFailures } from '../utils/failureCapture';
import selectors from '../config/selectors.json';

async function getVisibleTextList(locator: any): Promise<string[]> {
  try {
    return await locator.evaluate((el: HTMLElement) => {
      const clean = (s: string) => s.replace(/\u200B/g, '').replace(/\s+/g, ' ').trim();
      const texts: string[] = [];
      const walk = (node: Node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          const t = clean(node.textContent || '');
          if (t.length > 0) texts.push(t);
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          const htmlEl = node as HTMLElement;
          const tag = htmlEl.tagName.toUpperCase();
          if (tag === 'SCRIPT' || tag === 'STYLE') return;
          if (htmlEl.offsetWidth === 0 && htmlEl.offsetHeight === 0) return;
          for (let i = 0; i < htmlEl.childNodes.length; i++) {
            walk(htmlEl.childNodes[i]);
          }
        }
      };
      walk(el);
      return texts;
    });
  } catch {
    return [];
  }
}

export const validateVariant = async (
  page: any,
  variant: string,
  data: any[],
  results: any[],
  eventData: Record<string, string>,
  pageName: string = 'PPV',
  flow?: string,   // ← new optional param: 'myaccount' | 'landing' | undefined
  scopedLocator?: any
) => {
  console.log(`🔍 validateVariant entry: pageName = "${pageName}", variant = "${variant}", hasEventData = ${!!eventData}, typeof eventData = ${typeof eventData}, keys = ${eventData ? Object.keys(eventData).join(', ') : 'none'}`);
  if (!eventData) throw new Error('❌ eventData is missing');

  // Set page context dynamically so resolveExpected can apply page-specific overrides
  eventData.CURRENT_PAGE = pageName;
  eventData['CURRENT_PAGE'] = pageName;

  const normalizedVariant = variant.trim().toLowerCase();
  const normalizedFlow = (flow || '').trim().toLowerCase();

  // ── Read tier & ratePlan from eventData ───────────────────────
  const tier = (eventData.TIER || 'standard').toLowerCase();
  const ratePlan = (eventData.RATE_PLAN || 'monthly').toLowerCase();

  const rules = data.filter(r => {
    const rv = (r.Variant || '').trim().toLowerCase();
    const rt = (r.Tier || '').trim().toLowerCase();
    const rf = (r.Flow || '').trim().toLowerCase(); // ← new Flow column

    // ── Flow filtering ────────────────────────────────────────────
    // If row has a Flow restriction:
    //   - Only include if current flow matches
    //   - If no flow provided to validateVariant → exclude flow-restricted rows
    if (rf) {
      if (!normalizedFlow) return false; // no flow context → skip restricted rows
      // Exact flow match required. Flow='landing' rows only match flow='landing'
      // or tile-based landing flows (dont-miss) that don't have their own dedicated rows.
      // Banner flow has its own rows (Flow='landing-page-banner'), so exclude generic 'landing' rows.
      if (rf !== normalizedFlow) {
        if (rf === 'landing' && (normalizedFlow === 'landing-page-dont-miss-live' || normalizedFlow === 'landing-page-dont-miss')) {
          // Allow: tile flows without dedicated rows fall back to generic 'landing' rows
        } else {
          return false; // flow mismatch → skip
        }
      }
    }

    // ── Variant / Tier filtering (existing logic) ─────────────────
    if (rv) return rv === normalizedVariant;
    if (rt) return rt === tier || rt === 'common';

    // No filter column — include all rows (Landing, Schedule, etc.)
    return true;
  });

  if (!rules.length) {
    throw new Error(`❌ No rules for variant: "${variant}" / tier: "${tier}"`);
  }

  console.log(`\n🔍 Validating ${pageName} — ${rules.length} fields`);
  console.log(`   💎 Tier: ${tier} | 📋 Rate Plan: ${ratePlan}`);
  if (normalizedFlow) {
    console.log(`   🔀 Flow: ${normalizedFlow}`);
  }

  // ── Scroll to trigger lazy load before snapshot ───────────────
  // Only scroll on pages that need lazy loading
  const url = page.url();
  const urlLower = url.toLowerCase();
  const isModalOpen = await page.locator('[role="dialog"], [aria-modal="true"], [class*="modal" i]').first().isVisible().catch(() => false);
  const needsScroll =
    (urlLower.includes('/schedule') && !isModalOpen) ||
    urlLower.includes('/addon/purchase') ||     // Choose How To Buy
    urlLower.includes('upselltiershown=true') || // PPV page — upsell section is below fold
    (urlLower.includes('page=plandetails') && !urlLower.includes('upselltiershown=true'));

  if (needsScroll) {
    // Save original scroll position
    const originalScrollY = await page.evaluate(() => window.scrollY).catch(() => 0);

    // Multiple scroll passes to trigger all lazy-loaded content
    for (let pass = 0; pass < 3; pass++) {
      await page.evaluate(async () => {
        await new Promise<void>(resolve => {
          let scrolled = 0;
          const step = 300;
          const delay = 50;
          const timer = setInterval(() => {
            window.scrollBy(0, step);
            scrolled += step;
            if (scrolled >= document.body.scrollHeight) {
              clearInterval(timer);
              resolve();
            }
          }, delay);
        });
      }).catch(() => { });

      // Wait for lazy content to render between passes
      await page.waitForTimeout(300);
    }

    // Restore original scroll position instead of scrolling back to top (0, 0)
    // to prevent unwanted jumping/scrolling effects when clicking Buy Now.
    await page.evaluate((y: number) => window.scrollTo(0, y), originalScrollY).catch(() => { });
    await page.waitForTimeout(500);
  }

  // ── Wait for page content if on plan/upgrade/PPV pages ──────
  const snapUrl = page.url();
  const snapUrlLower = snapUrl.toLowerCase();
  if (snapUrlLower.includes('plandetails') || snapUrlLower.includes('signup') ||
    snapUrlLower.includes('addon/purchase') || snapUrlLower.includes('tierplans') ||
    pageName.toLowerCase().includes('ppv') || pageName.toLowerCase().includes('default signup')) {
    // Wait for page to load — look for radio buttons, continue button, or h1 heading
    await page.waitForSelector('input[type="radio"], button:has-text("Continue"), [data-test-id*="radio" i], h1',
      { state: 'visible', timeout: 10000 }
    ).catch(() => { });

    // FIX: If upgrade tier flow — wait for h1 to update from stale value
    // h1 may still show "Choose how to buy" from previous page
    if (snapUrl.includes('isUpgradeTierFlow=true')) {
      try {
        await page.waitForFunction(
          () => {
            const h1 = document.querySelector('h1');
            return h1 &&
              !h1.innerText.toLowerCase().includes('choose how to buy') &&
              h1.innerText.trim().length > 3;
          },
          { timeout: 4000 }
        );
        console.log('✅ h1 updated — taking snapshot');
      } catch {
        console.log('⚠️  h1 still stale — proceeding anyway');
      }
    }
  }
  if (snapUrl.includes('UpgradePlan')) {
    // Wait for confirm button
    await page.waitForSelector('button:has-text("Confirm")',
      { state: 'visible', timeout: 3000 }
    ).catch(() => { });
  }

  // Lightweight page readiness — page-specific waits already done above
  await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => { });
  await stabilisePage(page);

  // Wait for SPA hydration — ensure template placeholders like {price} are resolved
  try {
    await page.waitForFunction(() => {
      const body = document.body?.innerText || '';
      return !(/\{[a-zA-Z_]+\}/.test(body));
    }, { timeout: 10000 });
    console.log('✅ SPA hydration complete — no template placeholders detected');
  } catch {
    console.log('⚠️ Template placeholders may still be present — proceeding');
  }

  // Wait for dynamic text content to be populated (minimum length for SPA rendering)
  try {
    const minChars = parseInt(process.env.VALIDATION_MIN_CHARS || '30', 10);
    await page.waitForFunction((len: number) => {
      const text = document.body ? document.body.innerText.trim() : '';
      return text.length >= len;
    }, minChars, { timeout: 5000 });
    console.log(`✅ Page body text reached minimum length of ${minChars} chars`);
  } catch (e) {
    console.log('⚠️ Timeout waiting for body text rendering in validateVariant');
  }

  // ── Banner flow: re-freeze carousel and re-navigate to PPV slide before snapshot ──
  const isBannerFlow = normalizedFlow.includes('banner');
  if (isBannerFlow) {
    console.log('🔒 [Banner] Re-freezing carousel before snapshot...');
    // Re-inject CSS freeze and stop autoplay
    await page.evaluate(() => {
      try {
        // CSS freeze
        const styleId = '__ppv_freeze_carousel__';
        if (!document.getElementById(styleId)) {
          const style = document.createElement('style');
          style.id = styleId;
          style.textContent = `.swiper-wrapper { transition-duration: 0ms !important; }`;
          document.head.appendChild(style);
        }

        // Stop all swipers
        const stopSwiper = (swiper: any) => {
          if (!swiper) return;
          try { swiper.autoplay?.stop(); } catch { }
          try {
            swiper.params.autoplay = false;
            swiper.params.loop = false;
          } catch { }
          try {
            if (swiper.autoplay?.running) swiper.autoplay.stop();
          } catch { }
        };

        document.querySelectorAll('.swiper, [class*="swiper"], .swiper-container').forEach((el: any) => {
          if (el.swiper) stopSwiper(el.swiper);
        });
        if ((window as any).swiper) stopSwiper((window as any).swiper);
        document.querySelectorAll('*').forEach((el: any) => {
          if (el.swiper && typeof el.swiper === 'object' && el.swiper.autoplay) stopSwiper(el.swiper);
        });
      } catch { }
    }).catch(() => { });

    // Re-navigate to saved PPV slide index if available
    const savedSlideIndex = (eventData as any)._ppvBannerSlideIndex;
    if (savedSlideIndex !== undefined && savedSlideIndex !== null) {
      const slideIdx = parseInt(String(savedSlideIndex), 10);
      if (!isNaN(slideIdx)) {
        console.log(`🔄 [Banner] Re-navigating to PPV slide index: ${slideIdx}`);
        console.log(`🔄 [Banner] Re-navigating to PPV slide index: ${slideIdx}`);
        const ppvName = eventData.PPV_NAME || '';
        const carousel = page.locator([
          'main [class*="hero-banner" i]',
          'main [class*="heroBanner" i]',
          'main [class*="herobanner" i]',
          'main div.heroBannerSlider',
          'main [class*="bannersContainer" i]',
          'main [class*="hero-slider" i]',
          'main [class*="heroSlider" i]',
          'main [class*="hero" i] .swiper',
          'main [class*="banner" i] .swiper',
          '[class*="hero-banner" i]',
          '[class*="heroBanner" i]',
          '[class*="bannersContainer" i]',
        ].join(', ')).first();

        const activeSlideSelector = selectors.banner.activeSlide || ".swiper-slide-active:not(.swiper-slide-duplicate), [class*='swiper-slide-active']:not([class*='duplicate'])";
        const nextBtnSelectors = [
          selectors.banner.nextButton,
          '.swiper-button-next',
          '[class*="swiper-button-next"]',
          'button[data-test-id="CHEVRON_RIGHT_ICON"]',
          'svg[data-test-id="CHEVRON_RIGHT_ICON"]',
          '[aria-label="Next slide"]',
          'button[aria-label*="next" i]',
          'button[class*="swiper-next" i]',
          'button[class*="chevron" i]',
          '[class*="chevron-right" i]',
          '[class*="chevron-next" i]',
          '[class*="next-button" i]',
          '[class*="button-next" i]',
        ].filter(Boolean).join(', ');

        const nextBtn = carousel.locator(nextBtnSelectors).first();

        // Stop auto-slide
        await page.evaluate(() => {
          try {
            const stopSwiper = (swiper: any) => {
              if (swiper) {
                swiper.autoplay?.stop();
                swiper.params.autoplay = false;
                swiper.params.loop = false;
              }
            };
            document.querySelectorAll('.swiper, [class*="swiper"], .swiper-container').forEach((el: any) => {
              if (el.swiper) stopSwiper(el.swiper);
            });
          } catch { }
        }).catch(() => { });

        // Helper to match PPV name
        const cleanStr = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
        const matchesPPVName = (text: string, expected: string): boolean => {
          const nameParts = expected.split(/[:\-–]/).map(p => p.trim()).filter(p => p.length > 3);
          const cleanText = cleanStr(text);
          return nameParts.some(part => {
            const words = cleanStr(part).split(/\s+/).filter(Boolean);
            if (words.length === 0) return false;
            return words.every(w => cleanText.includes(w));
          });
        };

        for (let attempt = 0; attempt < 8; attempt++) {
          const activeSlide = carousel.locator(activeSlideSelector).locator(':visible').first();
          const activeText = await activeSlide.textContent().catch(() => '') || '';
          const currentIdx = await activeSlide.getAttribute('data-swiper-slide-index').catch(() => null);

          if (currentIdx === String(slideIdx) || (ppvName && matchesPPVName(activeText, ppvName))) {
            console.log(`✅ [Banner] Re-navigated to active slide: "${activeText.substring(0, 50)}..." (index: ${currentIdx})`);
            break;
          }

          if (await nextBtn.count().catch(() => 0) > 0) {
            console.log(`  [Banner] Re-navigating: slide is index ${currentIdx}, expected: ${slideIdx} — clicking next`);
            await nextBtn.click({ force: true }).catch(() => { });
            await page.waitForTimeout(500);
          } else {
            console.log('⚠️ [Banner] Next button not found during re-navigation');
            break;
          }
        }
        await page.waitForTimeout(300);
      }
    }

    // Scroll back to top to ensure banner is visible (not scrolled past)
    await page.evaluate(() => window.scrollTo(0, 0)).catch(() => { });
    await page.waitForTimeout(200);
  }

  // ── Pre-fetch DOM snapshot ONCE ───────────────────────────────
  const pageSnapshot = await getPageSnapshot(page);
  const scopedSnapshot = scopedLocator ? await getPageSnapshot(scopedLocator) : undefined;
  const snapshot = pageSnapshot; // For backward compatibility with any other direct refs
  console.log(`📸 ${pageName} page snapshot: ${pageSnapshot.length} nodes${scopedSnapshot ? `, scoped snapshot: ${scopedSnapshot.length} nodes` : ''}`);

  // ── DEBUG — log all snapshot texts ───────────────────────────
  if (pageName === 'Schedule' || pageName === 'Home of Boxing' || pageName === 'PPV' || pageName === 'DAZN Plan' || pageName === 'Upgrade Confirmation' || pageName === 'Payment' || pageName === 'Bundle PPV' || pageName === 'Boxing' || pageName === 'Landing') {
    console.log(`\n📋 Snapshot contents for ${pageName}:`);
    pageSnapshot.forEach((n, i) => {
      console.log(
        `  [${i}] ${n.tag.padEnd(6)} | ` +
        `children:${n.childCount} | ` +
        `modal:${n.isInModal} | ` +
        `classes:"${n.classes.substring(0, 40)}" | ` +
        `"${n.text.substring(0, 60)}"`
      );
    });
    console.log(`📋 End snapshot\n`);
  }

  // ── Run ALL field validations in parallel ─────────────────────
  const validations = rules.map(async (rule) => {
    const field = (rule.Field || '').trim();
    if (!field) return null;
    // Skip welcome back banner fields because there is no welcome back banner in the new UI
    if (field.toLowerCase().includes('welcome back')) {
      console.log(`  ⏭️  Skipping welcome back banner field validation: "${field}"`);
      return null;
    }

    // ── Skip rate plan rows that don't match current rate plan ───
    const rowRatePlan = (rule['Rate Plan'] || '').trim().toLowerCase();
    if (
      rowRatePlan &&
      rowRatePlan !== 'all' &&
      rowRatePlan !== ratePlan
    ) {
      console.log(
        `  ⏭️  Skipping [${field}] — rate plan "${rowRatePlan}" != "${ratePlan}"`
      );
      return null;
    }

    let expected: string;
    try {
      console.log(`🔍 validateVariant loop: field = "${field}", typeof eventData = ${typeof eventData}, eventData =`, eventData ? "defined" : "undefined");
      expected = resolveExpected(rule, eventData);
    } catch (e: any) {
      console.error(`❌ resolveExpected threw error for ${field}:`, e);
      expected = String(rule.Expected ?? '');
    }

    // Skip validation if expected is 'N/A' or empty
    const expectedNorm = (expected || '').trim().toUpperCase();
    const expectedOptions = expectedNorm.split('|').map(opt => opt.trim());
    const isAllNAOrEmpty = expectedOptions.every(opt => opt === 'N/A' || opt === '');
    if (isAllNAOrEmpty) {
      console.log(`  ⏭️  Skipping [${field}] — expected is "${expected}"`);
      return null;
    }

    let actual: string;
    try {
      const fieldLower = field.toLowerCase();
      const variantLower = (variant || '').toLowerCase().trim();
      const currentSnapshot = (variantLower === 'search' || variantLower === 'paywall') ? scopedSnapshot : (scopedSnapshot || pageSnapshot);
      actual = await getActualValue(page, field, variant, eventData, currentSnapshot);
    } catch (err: any) {
      actual = 'N/A';
      console.warn(`  ⚠️ getActualValue threw for [${field}]: ${err?.message?.substring(0, 80) || 'unknown'}`);
    }

    // ── Live DOM fallback: when actual is 'N/A' but expected is real text,
    //    try to extract what IS actually present in the DOM so the report
    //    shows real content instead of unhelpful 'N/A'. ──────────────────
    const isPresenceCheck = expectedNorm === 'YES' || expectedNorm === 'NO' || expectedNorm === 'VISIBLE' || expectedNorm === 'NOT VISIBLE' || expectedNorm === 'PRESENT' || expectedNorm === 'NOT FOUND';
    const isExpectedNA = expectedNorm === 'N/A' || expectedNorm === '';

    const variantLower = (variant || '').toLowerCase().trim();
    if (actual === 'N/A' && !isExpectedNA && !isPresenceCheck && variantLower !== 'search' && variantLower !== 'paywall') {
      try {
        const fieldLower = field.toLowerCase();
        const isPopupField = fieldLower.startsWith('popup');
        const isBannerField = fieldLower.startsWith('banner');

        // Determine DOM context: modal for popup fields, page for others
        if (isPopupField) {
          // Search visible modal/dialog for text content
          const modalSels = ['[role="dialog"]', '[aria-modal="true"]', '[class*="modal" i]', '[class*="popup" i]'];
          for (const sel of modalSels) {
            const modal = page.locator(sel).first();
            if (!await modal.isVisible({ timeout: 500 }).catch(() => false)) continue;
            const allText = await getVisibleTextList(modal);
            const cleanTexts = allText
              .map((t: string) => t.replace(/\s+/g, ' ').trim())
              .filter((t: string) => t.length > 2 && t.length < 200);

            if (cleanTexts.length > 0) {
              // Find the most relevant text based on field name keywords
              const fieldWords = fieldLower.replace(/popup\s*[-]?\s*/i, '').split(/\s+/).filter((w: string) => w.length > 2);
              let bestMatch = '';
              for (const txt of cleanTexts) {
                const tl = txt.toLowerCase();
                const matchScore = fieldWords.filter((w: string) => tl.includes(w)).length;
                if (matchScore > 0 && (!bestMatch || txt.length < bestMatch.length)) {
                  bestMatch = txt;
                }
              }
              // If no keyword match, return concatenated summary of modal content
              if (!bestMatch && cleanTexts.length > 0) {
                bestMatch = `[Modal content] ${cleanTexts.slice(0, 5).join(' | ')}`.substring(0, 200);
              }
              if (bestMatch) {
                actual = bestMatch;
                console.log(`  🔄 [${field}] Live DOM fallback from modal: "${actual.substring(0, 60)}"`);
              }
            }
            break;
          }
        } else if (isBannerField) {
          // Search banner/hero section
          const bannerSel = 'main [class*="banner"], main [class*="hero"], .swiper-slide-active';
          const banner = page.locator(bannerSel).first();
          if (await banner.isVisible({ timeout: 500 }).catch(() => false)) {
            const allText = await getVisibleTextList(banner);
            const cleanTexts = allText
              .map((t: string) => t.replace(/\s+/g, ' ').trim())
              .filter((t: string) => t.length > 2 && t.length < 200);
            if (cleanTexts.length > 0) {
              const fieldWords = fieldLower.replace(/banner\s*[-]?\s*/i, '').split(/\s+/).filter((w: string) => w.length > 2);
              let bestMatch = '';
              for (const txt of cleanTexts) {
                const tl = txt.toLowerCase();
                const matchScore = fieldWords.filter((w: string) => tl.includes(w)).length;
                if (matchScore > 0 && (!bestMatch || txt.length < bestMatch.length)) {
                  bestMatch = txt;
                }
              }
              if (!bestMatch && cleanTexts.length > 0) {
                bestMatch = `[Banner content] ${cleanTexts.slice(0, 5).join(' | ')}`.substring(0, 200);
              }
              if (bestMatch) {
                actual = bestMatch;
                console.log(`  🔄 [${field}] Live DOM fallback from banner: "${actual.substring(0, 60)}"`);
              }
            }
          }
        } else {
          // General fallback for ALL other fields (schedule tiles, PPV page, landing page, etc.)
          // Search the main visible content area for relevant text
          const isTileField = fieldLower.includes('tile') || fieldLower.includes('ppv');
          const isLandingField = fieldLower.includes('landing');

          let containerSel: string;
          if (isTileField) {
            // For tile/ppv fields, search inside articles first, then main
            containerSel = 'article, main, [class*="content" i]';
          } else if (isLandingField) {
            // For landing page fields, search main content
            containerSel = 'main, [class*="content" i], [class*="landing" i]';
          } else {
            // For any other field, search visible main area
            containerSel = 'main, [class*="content" i], body';
          }

          const containers = page.locator(containerSel);
          const containerCount = await containers.count().catch(() => 0);
          for (let ci = 0; ci < Math.min(containerCount, 3); ci++) {
            const container = containers.nth(ci);
            if (!await container.isVisible({ timeout: 500 }).catch(() => false)) continue;
            const allText = await getVisibleTextList(container);
            const cleanTexts = allText
              .map((t: string) => t.replace(/\s+/g, ' ').trim())
              .filter((t: string) => t.length > 2 && t.length < 200);

            if (cleanTexts.length > 0) {
              // Strip common field prefixes to get relevant keywords
              const stripped = fieldLower
                .replace(/^(ppv|landing\s*page?|schedule|home|tile|page)\s*[-]?\s*/i, '')
                .replace(/\s*(on\s+tile|present|visible)\s*$/i, '');
              const fieldWords = stripped.split(/\s+/).filter((w: string) => w.length > 2);

              let bestMatch = '';
              for (const txt of cleanTexts) {
                const tl = txt.toLowerCase();
                const matchScore = fieldWords.filter((w: string) => tl.includes(w)).length;
                if (matchScore > 0 && (!bestMatch || txt.length < bestMatch.length)) {
                  bestMatch = txt;
                }
              }
              if (!bestMatch && cleanTexts.length > 0) {
                const label = isTileField ? 'Tile content' : isLandingField ? 'Landing content' : 'Page content';
                bestMatch = `[${label}] ${cleanTexts.slice(0, 5).join(' | ')}`.substring(0, 200);
              }
              if (bestMatch) {
                actual = bestMatch;
                console.log(`  🔄 [${field}] Live DOM fallback from page: "${actual.substring(0, 60)}"`);
                break;
              }
            }
          }
        }
      } catch (fallbackErr: any) {
        console.warn(`  ⚠️ Live DOM fallback failed for [${field}]: ${fallbackErr?.message?.substring(0, 60) || 'unknown'}`);
      }
    }

    const status = compare(actual, expected, rule.Type) ? 'PASS' : 'FAIL';
    return { field, expected, actual, status };
  });

  const validationResults = await Promise.all(validations);

  for (const result of validationResults) {
    if (!result) continue;
    const { field, expected, actual, status } = result;
    console.log(
      `  ${status === 'PASS' ? '✅' : '❌'} [${field}]` +
      `  expected="${expected}"  actual="${actual}"`
    );

    // Print descriptive failure reason for each failed validation
    if (status === 'FAIL') {
      if (actual === 'N/A' || actual === 'Not found' || actual === 'Not found in banner' || actual === 'Not visible') {
        console.log(`  ⛔ FAIL REASON: ${field} not found in ${pageName} page`);
      } else {
        console.log(`  ⛔ FAIL REASON: ${field} mismatch in ${pageName} — expected "${expected}" but got "${actual}"`);
      }
    }

    results.push({
      page: pageName,
      variant,
      tier,
      ratePlan,
      field,
      expected,
      actual,
      status,
    });
  }

  // ── Capture red-boxed screenshots for any failed fields ──────────
  await captureFailures(page, results, pageName, scopedLocator);
};
