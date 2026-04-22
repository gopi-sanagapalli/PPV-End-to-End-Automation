import { Page, Locator, expect } from '@playwright/test';
import { handleCookies, stabilisePage } from '../utils/helpers';

export class SearchPage {
  constructor(private page: Page) {}

  // ── NAVIGATE ──────────────────────────────────────────────────
  async navigate(baseUrl: string) {
    const url = `${baseUrl}/search`;
    console.log(`🔍 Navigating to: ${url}`);
    await this.page.goto(url);
    await this.page.waitForLoadState('domcontentloaded');
    await this.page.waitForLoadState('networkidle').catch(() => {});

    // Accept cookies immediately
    await handleCookies(this.page);
    await stabilisePage(this.page);

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

    // Wait for results to load — wait for spinner to disappear
    await this.page.waitForFunction(() => {
      const spinner = document.querySelector('[class*="spinner" i], [class*="loading" i], [class*="loader" i]');
      return !spinner || getComputedStyle(spinner).display === 'none';
    }, { timeout: 10000 }).catch(() => {});

    // Also wait for at least one result to appear
    await this.page.waitForFunction(
      (name: string) => {
        const els = Array.from(document.querySelectorAll('article, li, [class*="tile" i], [class*="card" i], [class*="result" i]'));
        return els.some(el => (el as HTMLElement).innerText?.toLowerCase().includes(name.toLowerCase().split(' ')[0]));
      },
      eventName,
      { timeout: 15000 }
    ).catch(() => console.log('⚠️  Results may not have loaded fully'));

    await this.page.waitForTimeout(1000);
    console.log(`✅ Search completed for: ${eventName}`);
  }

  // ── FIND AND CLICK PPV TILE ───────────────────────────────────
  async clickPPVTile(eventName: string): Promise<void> {
    console.log(`🎯 Looking for PPV tile: ${eventName}`);

    const regex = new RegExp(eventName.replace(/\s+/g, '.*'), 'i');

    // Try multiple selectors for search result tiles
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

    for (const selector of selectors) {
      const tiles = this.page.locator(selector).filter({ hasText: regex });
      const count = await tiles.count().catch(() => 0);

      if (count > 0) {
        console.log(`🔍 Found ${count} tiles with selector: ${selector}`);

        for (let i = 0; i < count; i++) {
          const tile = tiles.nth(i);
          const text = await tile.textContent().catch(() => '');
          if (!text || text.length > 800) continue;

          console.log(`  Tile ${i}: "${text.substring(0, 80).trim()}"`);

          // Check for date badge (PPV tile indicator)
          const hasDate = await tile.locator('[class*="badge" i], [class*="date" i], time').isVisible({ timeout: 500 }).catch(() => false);
          const hasLock = await tile.locator('[class*="lock" i], [class*="ppv" i]').isVisible({ timeout: 500 }).catch(() => false);
          const hasMay = text.includes('MAY') || text.includes('May') || text.includes('9 MAY') || text.includes('20:30');

          if (hasDate || hasLock || hasMay) {
            console.log(`✅ PPV tile found: "${text.substring(0, 80).trim()}"`);

            const scrollY = await this.page.evaluate(() => window.scrollY);
            await tile.scrollIntoViewIfNeeded().catch(() => {});
            await this.page.waitForTimeout(300);

            const box = await tile.boundingBox();
            if (!box) continue;

            await this.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

            const buyNowButton = this.page.locator(
              'a:has-text("Buy now"), button:has-text("Buy now"), ' +
              'a:has-text("Buy Now"), button:has-text("Buy Now")'
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
        }
      }
    }

    // Debug — dump what's on the page
    const allText = await this.page.evaluate(() => {
      return Array.from(document.querySelectorAll('article, li, [class*="result" i]'))
        .map(el => (el as HTMLElement).innerText?.substring(0, 100))
        .filter(t => t && t.length > 5)
        .slice(0, 10)
        .join('\n');
    }).catch(() => 'N/A');
    console.log('📋 Page content sample:\n', allText);

    throw new Error(`❌ PPV tile not found for: ${eventName}`);
  }

  // ── CLICK BUY NOW ─────────────────────────────────────────────
  async clickBuyNow(): Promise<void> {
    console.log('💳 Clicking Buy Now CTA...');
    const buyNow = this.page.locator(
      'a:has-text("Buy now"), button:has-text("Buy now"), ' +
      'a:has-text("Buy Now"), button:has-text("Buy Now")'
    ).first();

    await expect(buyNow).toBeVisible({ timeout: 8000 });
    await buyNow.click({ force: true });
    console.log('✅ Buy Now clicked');
  }
}
