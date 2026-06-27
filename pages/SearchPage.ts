import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './BasePage';
import { dismissMarketingPopup, handleCookies } from '../utils/helpers';

export class SearchPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  // ── NAVIGATE ──────────────────────────────────────────────────
  async navigate(baseUrl: string) {
    const url = `${baseUrl}/search`;
    console.log(`🔍 Navigating to: ${url}`);
    await this.page.goto(url);
    await this.waitForPageReady();
    await this.waitForConsentAndDismiss();
    console.log('✅ Search page loaded');
  }

  // ── SEARCH FOR EVENT ──────────────────────────────────────────
  async searchForEvent(eventName: string) {
    console.log(`🔍 Searching for: ${eventName}`);

    // Wait for search input
    const searchInput = this.page.locator(
      'input[type="search"], ' +
      'input[placeholder*="search" i], ' +
      'input[placeholder*="Search" i], ' +
      '[class*="search" i] input, ' +
      '[data-testid*="search" i] input'
    ).first();

    await expect(searchInput).toBeVisible({ timeout: 10000 });
    await searchInput.click();
    await searchInput.fill(eventName);
    await searchInput.press('Enter');
    await this.page.waitForTimeout(1000);

    // Wait for results to load — wait for spinner to disappear
    await this.page.waitForFunction(() => {
      const spinner = document.querySelector('[class*="spinner" i], [class*="loading" i], [class*="loader" i]');
      return !spinner || getComputedStyle(spinner).display === 'none';
    }, { timeout: 10000 }).catch(() => { });

    // Also wait for at least one result to appear
    await this.page.waitForFunction(
      (name: string) => {
        const els = Array.from(document.querySelectorAll('article, li, [class*="tile" i], [class*="card" i], [class*="result" i]'));
        return els.some(el => (el as HTMLElement).innerText?.toLowerCase().includes(name.toLowerCase().split(' ')[0]));
      },
      eventName,
      { timeout: 15000 }
    ).catch(() => console.log('⚠️  Results may not have loaded fully'));

    await this.page.waitForTimeout(2000);
    console.log(`✅ Search completed for: ${eventName}`);
  }

  // ── SCORE EVENT TILES ─────────────────────────────────────────
  async findAndScoreTiles(ppvName: string, promoter?: string): Promise<{ tile: Locator; score: number; text: string }[]> {
    // Split query by removing dots first to avoid word boundary issues
    const baseQuery = ppvName.includes(':') ? (ppvName.split(':').pop()?.trim() || ppvName) : ppvName;
    const cleanName = baseQuery.replace(/\./g, '');
    const separatorRegex = /\b(?:vs|v|and)\b|[-]/i;
    const fighters = cleanName.split(separatorRegex).map(p => {
      const words = p.trim().split(/\s+/).filter(w => w.length > 1);
      return words[words.length - 1] || '';
    }).filter(Boolean);

    console.log(`🔍 Extracted fighters for scoring: ${JSON.stringify(fighters)}`);

    const selectors = [
      'article',
      '[class*="EventTile" i]',
      '[class*="event-tile" i]',
      '[class*="SearchResult" i]',
      '[class*="search-result" i]',
      '[class*="tile" i]',
      '[class*="card" i]',
      'li[class*="result" i]',
      'li',
    ];

    const scoredTiles: { tile: Locator; score: number; text: string }[] = [];
    const seenTexts = new Set<string>();

    for (const selector of selectors) {
      const tilesLocator = this.page.locator(selector);
      const count = await tilesLocator.count().catch(() => 0);
      if (count === 0) continue;

      for (let i = 0; i < count; i++) {
        const tile = tilesLocator.nth(i);
        let text = await tile.textContent().catch(() => '');
        if (!text || text.length > 800) continue;

        // Deduplicate before scoring to avoid double logging
        const cleanText = text.trim().replace(/\s+/g, ' ');
        if (seenTexts.has(cleanText)) {
          continue;
        }
        seenTexts.add(cleanText);

        let textLower = text.toLowerCase();

        // 3. Contains first fighter surname: +30
        const firstFighterMatched = !!(fighters[0] && textLower.includes(fighters[0].toLowerCase()));

        // 4. Contains second fighter surname: +30
        const secondFighterMatched = !!(fighters[1] && textLower.includes(fighters[1].toLowerCase()));

        // 2. Has "vs" or "v.": +40
        const hasVs = /\b(?:vs|v)\b/i.test(textLower.replace(/\./g, ''));

        // 1. Lock detection
        let hasLock = false;
        let lockPaths: string[] = [];

        // 1a. Try stable application-specific attributes (data-testid, aria-label, class-names) first
        const stableLockSelector = '[data-testid*="lock" i], [data-testid*="ppv" i], [aria-label*="lock" i], [aria-label*="ppv" i], [class*="lock" i], [class*="premium" i], [class*="ppv" i]';
        let hasStableLock = await tile.locator(stableLockSelector).first().isVisible({ timeout: 100 }).catch(() => false);

        if (!hasStableLock && firstFighterMatched && secondFighterMatched && hasVs) {
          console.log(`⏳ Detected strong text match for PPV tile but lock icon not visible yet. Waiting up to 5s for lock icon...`);
          await tile.locator(stableLockSelector).first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
          hasStableLock = await tile.locator(stableLockSelector).first().isVisible({ timeout: 100 }).catch(() => false);
          
          const newText = await tile.textContent().catch(() => '');
          if (newText) {
            text = newText;
            textLower = text.toLowerCase();
          }
        }

        if (hasStableLock) {
          hasLock = true;
        } else {
          // 1b. Fallback to SVG path matching
          lockPaths = await tile.evaluate((el) => {
            const svgs = el.querySelectorAll('svg');
            return Array.from(svgs).map(svg => svg.querySelector('path')?.getAttribute('d') || '');
          }).catch(() => [] as string[]);

          for (const d of lockPaths) {
            if (d.startsWith('M12 2C8.68629') || d.includes('12 2C8.68629')) {
              hasLock = true;
              break;
            }
          }
        }

        let score = 0;
        if (hasLock) {
          score += 100;
        }

        if (hasVs) {
          score += 40;
        }

        if (firstFighterMatched) {
          score += 30;
        }

        if (secondFighterMatched) {
          score += 30;
        }

        // 5. Contains promoter: +10
        const promoterMatched = !!(promoter && promoter !== 'N/A' && textLower.includes(promoter.toLowerCase()));
        if (promoterMatched) {
          score += 10;
        }

        // 6. Excluded keywords: -200 each
        const excludedRegexes = [
          /\bweigh(?:-|\b)/i,
          /\bprelim/i,
          /\bespanol/i,
          /\bspanish/i,
          /\breplay/i,
          /\bhighlight/i,
          /\binterview/i,
          /\bworkout/i,
          /\bpress\b/i,
          /\bconference\b/i,
          /\bbehind the scenes/i,
          /\bepisode\b/i,
          /\bdocumentary\b/i,
          /\bpromo\b/i,
          /\bpreview\b/i
        ];

        let matchedExcludedKeyword = 'none';
        for (const regex of excludedRegexes) {
          const match = textLower.match(regex);
          if (match) {
            score -= 200;
            matchedExcludedKeyword = match[0];
          }
        }

        // Decision logic
        let decision = 'ACCEPT';
        let rejectionReason = 'none';

        if (!hasLock) {
          decision = 'REJECT';
          rejectionReason = 'no lock icon';
        } else if (fighters.length > 0 && !firstFighterMatched && !secondFighterMatched) {
          decision = 'REJECT';
          rejectionReason = 'no fighter surname matched';
        } else if (score < 130) {
          decision = 'REJECT';
          rejectionReason = `score (${score}) below threshold (130)`;
        }

        console.log(`\nCandidate:\nTitle: "${cleanText.substring(0, 120)}..."\nLock: ${hasLock}\nVS: ${hasVs}\nFirst fighter matched: ${firstFighterMatched}\nSecond fighter matched: ${secondFighterMatched}\nPromoter matched: ${promoterMatched}\nExcluded keyword: ${matchedExcludedKeyword}\nFinal score: ${score}\nDecision: ${decision}${rejectionReason !== 'none' ? `\nRejection reason: ${rejectionReason}` : ''}`);

        if (lockPaths.length > 0) {
          console.log(`  DEBUG paths: ${JSON.stringify(lockPaths.map(p => p.substring(0, 40)))}`);
        }

        // Only add to candidates list if accepted
        if (decision === 'ACCEPT') {
          scoredTiles.push({ tile, score, text });
        }
      }
    }

    // Sort by score descending
    scoredTiles.sort((a, b) => b.score - a.score);
    return scoredTiles;
  }

  // ── REVERT SEARCH STATE ────────────────────────────────────────
  async revertSearchState(searchUrl: string): Promise<void> {
    console.log('🔄 Reverting search state...');
    // Try pressing Escape to close any popups
    await this.page.keyboard.press('Escape').catch(() => {});
    await this.page.waitForTimeout(500);

    // Check if we are still on search page. If not, go back
    if (!this.page.url().includes('/search')) {
      console.log(`🧭 Not on search page anymore (current: ${this.page.url()}). Going back...`);
      await this.page.goBack().catch(() => {});
      await this.page.waitForLoadState('domcontentloaded').catch(() => {});
    }
    
    // If still not on search page, force navigate to searchUrl
    if (!this.page.url().includes('/search')) {
      console.log(`🧭 Force navigating back to search: ${searchUrl}`);
      await this.page.goto(searchUrl);
      await this.page.waitForLoadState('domcontentloaded').catch(() => {});
    }
  }

  // ── FIND AND CLICK PPV TILE (LEGACY/COMPATIBILITY) ────────────
  async clickPPVTile(eventName: string): Promise<void> {
    console.log(`🎯 Looking for PPV tile using scoring method: ${eventName}`);
    const scoredTiles = await this.findAndScoreTiles(eventName);
    if (scoredTiles.length === 0) {
      throw new Error(`❌ No event tiles found on the page for: ${eventName}`);
    }

    const uniqueTiles: typeof scoredTiles = [];
    const seenTexts = new Set<string>();
    for (const item of scoredTiles) {
      const cleanText = item.text.trim().replace(/\s+/g, ' ');
      if (!seenTexts.has(cleanText)) {
        seenTexts.add(cleanText);
        uniqueTiles.push(item);
      }
    }

    const bestCandidate = uniqueTiles[0];
    if (bestCandidate && bestCandidate.score >= 130) {
      console.log(`✅ Best PPV tile found (Score: ${bestCandidate.score}): "${bestCandidate.text.trim().replace(/\s+/g, ' ').substring(0, 100)}..."`);
      const tile = bestCandidate.tile;
      
      const scrollY = await this.page.evaluate(() => window.scrollY);
      await tile.scrollIntoViewIfNeeded().catch(() => { });
      await this.page.waitForTimeout(300);

      const box = await tile.boundingBox();
      if (!box) {
        throw new Error(`❌ Selected PPV tile bounding box is null.`);
      }

      await this.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

      const buyNowButton = this.page.locator(
        'a:has-text("Buy now"), button:has-text("Buy now"), ' +
        'a:has-text("Buy Now"), button:has-text("Buy Now"), ' +
        'a:has-text("Continue"), button:has-text("Continue")'
      ).first();

      await expect(buyNowButton).toBeVisible({ timeout: 15000 });

      await this.page.evaluate((y) => {
        window.scrollTo(0, y);
        document.body.style.overflow = 'hidden';
        document.documentElement.style.overflow = 'hidden';
      }, scrollY);

      console.log('🔒 Background scroll locked');
      console.log('✅ PPV popup opened & Buy button located');
      return;
    }

    throw new Error(`❌ PPV tile not found or score below threshold for: ${eventName}`);
  }

  // ── SEARCH AND OPEN BEST PPV TILE (RECOMMENDED) ───────────────
  async searchAndOpenBestPpvTile(
    options: {
      ppvName: string;
      promoter?: string;
      onTileSelected?: (tileLocator: Locator) => Promise<void>;
    } | string,
    legacyPromoter?: string
  ): Promise<void> {
    let ppvName: string;
    let promoter: string | undefined;
    let onTileSelected: ((tileLocator: Locator) => Promise<void>) | undefined;

    if (typeof options === 'object') {
      ppvName = options.ppvName;
      promoter = options.promoter;
      onTileSelected = options.onTileSelected;
    } else {
      ppvName = options;
      promoter = legacyPromoter;
    }

    console.log(`🎯 Starting searchAndOpenBestPpvTile for PPV: "${ppvName}" (Promoter: "${promoter}")`);

    // 1. Generate search queries
    const baseQuery = ppvName.includes(':') ? (ppvName.split(':').pop()?.trim() || ppvName) : ppvName;
    const queries: string[] = [baseQuery];

    // Add query + " upcoming"
    queries.push(`${baseQuery} upcoming`);

    // Add promoter if available
    if (promoter && promoter !== 'N/A') {
      queries.push(promoter);
    }

    // Extract fighter surnames and add them as individual fallbacks
    const separatorRegex = /\b(?:vs\.?|v\.?|and)\b|[-]/i;
    const fighters = baseQuery.split(separatorRegex).map(p => {
      const words = p.trim().split(/\s+/).filter(w => w.length > 1);
      return words[words.length - 1] || '';
    }).filter(Boolean);

    for (const fighter of fighters) {
      if (fighter && !queries.includes(fighter)) {
        queries.push(fighter);
      }
    }

    console.log(`📋 Generated search query fallbacks in order: ${JSON.stringify(queries)}`);

    const searchUrl = this.page.url().split('/search')[0] + '/search';

    // 2. Try each query
    for (const query of queries) {
      try {
        await this.searchForEvent(query);

        // Score the tiles on the page
        const scoredTiles = await this.findAndScoreTiles(ppvName, promoter);
        if (scoredTiles.length === 0) {
          console.log(`⚠️ No event tiles found on the page for query: "${query}"`);
          continue;
        }

        // Deduplicate tiles by text content
        const uniqueTiles: typeof scoredTiles = [];
        const seenTexts = new Set<string>();
        for (const item of scoredTiles) {
          const cleanText = item.text.trim().replace(/\s+/g, ' ');
          if (!seenTexts.has(cleanText)) {
            seenTexts.add(cleanText);
            uniqueTiles.push(item);
          }
        }

        // Print top 3 candidates for debugging
        console.log(`📊 Top search result candidates for query "${query}":`);
        uniqueTiles.slice(0, 3).forEach((item, index) => {
          console.log(`  [Candidate ${index + 1}] Score: ${item.score} | Text: "${item.text.trim().replace(/\s+/g, ' ').substring(0, 100)}..."`);
        });

        const bestCandidate = uniqueTiles[0];
        if (bestCandidate && bestCandidate.score >= 130) {
          console.log(`✅ Best PPV tile selected (Score: ${bestCandidate.score}): "${bestCandidate.text.trim().replace(/\s+/g, ' ').substring(0, 100)}..."`);
          
          const tile = bestCandidate.tile;

          // Run tile validation callback before clicking
          if (onTileSelected) {
            try {
              await onTileSelected(tile);
            } catch (err: any) {
              console.error(`❌ Error running onTileSelected validation: ${err.message}`);
            }
          }

          // Ensure tile is scrolled back into view and get fresh coordinates (since onTileSelected may have scrolled the page)
          await tile.scrollIntoViewIfNeeded().catch(() => { });
          await this.page.waitForTimeout(300);
          const scrollY = await this.page.evaluate(() => window.scrollY);

          const box = await tile.boundingBox();
          if (!box) {
            console.log('⚠️ Selected tile bounding box is null, trying next query/candidate...');
            continue;
          }

          await this.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

          const buyNowButton = this.page.locator(
            'a:has-text("Buy now"), button:has-text("Buy now"), ' +
            'a:has-text("Buy Now"), button:has-text("Buy Now"), ' +
            'a:has-text("Continue"), button:has-text("Continue")'
          ).first();

          try {
            await expect(buyNowButton).toBeVisible({ timeout: 10000 });

            await this.page.evaluate((y) => {
              window.scrollTo(0, y);
              document.body.style.overflow = 'hidden';
              document.documentElement.style.overflow = 'hidden';
            }, scrollY);

            console.log('🔒 Background scroll locked');
            console.log('✅ PPV popup opened & Buy button located');
            return; // Success!
          } catch (err: any) {
            console.log(`⚠️ Expected PPV popup did not open on clicking tile: ${err.message}`);
            await this.revertSearchState(searchUrl);
            // Loop continues to next query fallback
          }
        } else {
          console.log(`⚠️ Best candidate score (${bestCandidate ? bestCandidate.score : 'N/A'}) is below threshold 130. Trying next query fallback...`);
        }
      } catch (err: any) {
        console.log(`⚠️ Error searching or clicking tile with query "${query}": ${err.message}. Trying next query fallback...`);
      }
    }

    // If we get here, all search queries failed to find a valid PPV tile
    const allText = await this.page.evaluate(() => {
      return Array.from(document.querySelectorAll('article, li, [class*="result" i]'))
        .map(el => (el as HTMLElement).innerText?.substring(0, 100))
        .filter(t => t && t.length > 5)
        .slice(0, 10)
        .join('\n');
    }).catch(() => 'N/A');
    console.log('📋 Page content sample on failure:\n', allText);

    throw new Error(`❌ PPV event "${ppvName}" not found or failed to match/click any event tile.`);
  }

  // ── CLICK BUY NOW ─────────────────────────────────────────────
  async clickBuyNow(): Promise<void> {
    console.log('💳 Clicking Buy Now CTA...');
    const buyNow = this.page.locator(
      'a:has-text("Buy now"), button:has-text("Buy now"), ' +
      'a:has-text("Buy Now"), button:has-text("Buy Now"), ' +
      'a:has-text("Subscribe"), button:has-text("Subscribe"), ' +
      'a:has-text("Continue"), button:has-text("Continue")'
    ).first();

    await expect(buyNow).toBeVisible({ timeout: 8000 });
    await buyNow.click({ force: true });
    console.log('✅ Buy Now clicked');
  }

  // ═══════════════════════════════════════════════════════════════
  // DEV MODE: Enable dev mode to bypass phone number page
  // Flow: Landing → Explore → Home → Search → dev_mode_on → Copy ID → Back 2x → Back to Landing
  // ═══════════════════════════════════════════════════════════════
  async enableDevMode(): Promise<void> {
    console.log('\n═══════════════════════════════════════════════════');
    console.log('  🎭 ENABLING DEV MODE to bypass phone number page');
    console.log('═══════════════════════════════════════════════════\n');

    const originalUrl = this.page.url();
    console.log(`Original URL before dev mode: ${originalUrl}`);

    try {
      // ── Step 0: Check if dev mode is already active ────────────
      const yellowDot = this.page.locator('div[class*="dev-mode__circle"], [class*="dev-mode"]').first();
      const alreadyActive = await yellowDot.isVisible({ timeout: 1500 }).catch(() => false);
      if (alreadyActive) {
        console.log('✅ Dev mode is already active (yellow dot visible). Skipping activation flow.');
        return;
      }

      // ── Step 1: Navigate to search page ───────────
      const searchLink = this.page.locator('header a[href*="/search"], a[href*="/search"]').first();
      const searchVisible = await searchLink.isVisible({ timeout: 2000 }).catch(() => false);

      if (searchVisible) {
        console.log('✅ Found search link — navigating via client-side click');
        await Promise.all([
          this.page.waitForURL('**/search', { timeout: 10000 }).catch(() => { }),
          searchLink.click({ force: true })
        ]);
        await this.page.waitForLoadState('domcontentloaded').catch(() => { });
      } else {
        const baseUrl = this.page.url().match(/https:\/\/[^\/]+\/en-[A-Z]+/i)?.[0] || 'https://www.dazn.com/en-GB';
        const searchUrl = `${baseUrl}/search`;
        console.log(`🧭 Search link not visible — navigating directly to: ${searchUrl}`);
        await this.page.goto(searchUrl, { waitUntil: 'domcontentloaded' });
        await this.waitForConsentAndDismiss().catch(() => { });
      }
      console.log(`✅ On search page: ${this.page.url()}`);

      // ── Step 2: Type [dev_mode_on] and press Enter ────────────
      console.log('⌨️  Entering "[dev_mode_on]" in search...');

      // Dismiss cookie banner that re-appears after page navigation
      await handleCookies(this.page, 3000).catch(() => {});

      const searchInput = this.page.locator(
        'input[type="search"], ' +
        'input[placeholder*="search" i], ' +
        'input[placeholder*="Search" i], ' +
        '[class*="search" i] input, ' +
        '[data-testid*="search" i] input'
      ).first();
      await searchInput.waitFor({ state: 'visible', timeout: 30000 });

      // Dismiss any marketing/promotion popup that is already visible
      await dismissMarketingPopup(this.page).catch(() => {});

      try {
        await searchInput.click({ timeout: 5000 });
      } catch (clickError) {
        console.log('⚠️ Search input click was intercepted or failed. Dismissing overlays and retrying...');
        await handleCookies(this.page, 3000).catch(() => {});
        await dismissMarketingPopup(this.page, 4000).catch(() => {});
        await searchInput.click({ timeout: 10000 });
      }

      await searchInput.fill('[dev_mode_on]');
      await this.page.keyboard.press('Enter');
      console.log('✅ Text entered and Enter pressed');

      // ── Step 3: Wait for UUID popup and copy ID ────────────
      await this.page.waitForFunction(() => {
        const body = document.body.innerText || '';
        return /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(body) ||
          body.includes('Copy ID');
      }, { timeout: 5000 }).catch(() => { });

      const bodyContent = await this.page.innerText('body').catch(() => '');
      const uuidMatch = bodyContent.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
      const devModeId = uuidMatch ? uuidMatch[0] : null;
      console.log(`🔑 Extracted Dev Mode ID: ${devModeId}`);

      if (devModeId) {
        await this.page.evaluate((id) => {
          const textarea = document.createElement('textarea');
          textarea.value = id;
          document.body.appendChild(textarea);
          textarea.select();
          try { document.execCommand('copy'); } catch (e) { }
          document.body.removeChild(textarea);
          const clipboardData = new DataTransfer();
          clipboardData.setData('text/plain', id);
          document.dispatchEvent(new ClipboardEvent('copy', { clipboardData, bubbles: true, cancelable: true }));
        }, devModeId).catch((err) => console.warn('⚠️ Copy error:', err.message));
      }

      // Capture search URL before copy (DAZN may auto-redirect after Copy ID)
      const searchPageUrl = this.page.url();
      console.log(`📌 Current search URL: ${searchPageUrl}`);

      const copyButton = this.page.locator('button:has-text("Copy ID")').first();
      const copyButtonVisible = await copyButton.isVisible({ timeout: 3000 }).catch(() => false);
      if (copyButtonVisible) {
        await copyButton.click();
        console.log('✅ Clicked Copy ID button');
      }

      // ── Step 4: Ensure we're on search page, refresh, verify yellow dot ──────
      // DAZN may auto-redirect to home after Copy ID — navigate back to search
      const currentUrl = this.page.url();
      if (!currentUrl.includes('/search')) {
        console.log(`⚠️ Redirected away from search to: ${currentUrl}`);
        console.log(`🔄 Navigating back to search page: ${searchPageUrl}`);
        await this.page.goto(searchPageUrl, { waitUntil: 'domcontentloaded' });
      }

      console.log('🔄 Refreshing search page to verify yellow dot...');
      await this.page.reload({ waitUntil: 'domcontentloaded' });
      await this.page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => { });

      const yellowDotVisible = await yellowDot.isVisible({ timeout: 5000 }).catch(() => false);
      if (yellowDotVisible) {
        console.log('✅ Yellow dot visible on search page — dev mode CONFIRMED ✨');
        await this.page.screenshot({ path: 'test-results/devmode-yellow-dot-confirmed.png', fullPage: false }).catch(() => { });

        // Navigate back to the original URL to continue the flow
        console.log(`🔄 Navigating back to original URL: ${originalUrl}`);
        await this.page.goto(originalUrl, { waitUntil: 'domcontentloaded' });
        await this.waitForConsentAndDismiss().catch(() => { });
      } else {
        console.log('❌ Yellow dot NOT visible — dev mode activation FAILED');
        await this.page.screenshot({ path: 'test-results/devmode-error-yellow-dot.png', fullPage: true }).catch(() => { });
        throw new Error('❌ Yellow dot not visible on search page after dev mode activation');
      }

      // ── Done — caller navigates to home/source ──────
      console.log('✅ Dev mode enabled — returning to caller for navigation');
      console.log('═══════════════════════════════════════════════════\n');

    } catch (e: any) {
      console.warn('⚠️  Dev mode error:', e.message);
      await this.page.screenshot({ path: 'test-results/devmode-error.png', fullPage: true }).catch(() => { });
      throw e;
    }
  }

}
