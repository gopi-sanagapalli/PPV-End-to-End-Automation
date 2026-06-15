import { Page, Locator, expect } from '@playwright/test';
import { handleCookies, stabilisePage } from '../utils/helpers';

export class SchedulePage {
  constructor(private page: Page) {}

  // ── NAVIGATE ──────────────────────────────────────────────────
  async navigate(baseUrl: string) {
    const url = `${baseUrl}/schedule`;
    console.log(`📅 Navigating to: ${url}`);
    await this.page.goto(url);
    await expect(this.page).toHaveURL(/schedule/);
    await this.page.waitForLoadState('domcontentloaded');
    await this.page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
    await this.page.waitForSelector('body', { timeout: 15000 });

    // Accept cookies immediately after page load
    await handleCookies(this.page);
    await stabilisePage(this.page);

    console.log('✅ Schedule page loaded');
  }

  // ── SELECT SPORT ──────────────────────────────────────────────
  async selectSport(sport: string) {
    if (!sport) {
      throw new Error('❌ selectSport() called with undefined — check config has SPORT field');
    }
    console.log(`🥊 Selecting ${sport}...`);

    const filterContainer = this.page.locator('#schedule-filter-container');
    await expect(filterContainer).toBeVisible({ timeout: 10000 });

    const sportEl = filterContainer.getByText(sport, { exact: true });
    await expect(sportEl).toBeVisible({ timeout: 8000 });
    await sportEl.click();

    await this.page.waitForFunction(
      () => document.querySelectorAll('article').length > 0
    );
    await this.page.waitForTimeout(1000);

    // Reset scroll to top after sport filter applied
    await this.page.evaluate(() => window.scrollTo(0, 0));
    console.log(`✅ ${sport} selected`);
  }

  // ── FIND EVENT ────────────────────────────────────────────────
  async findEvent(eventName: string): Promise<Locator> {
    console.log(`🔍 Searching for event: ${eventName}`);

    const regex = new RegExp(
      eventName.replace(/\s+/g, '.*'),
      'i'
    );

    // Non-PPV event keywords to skip
    const skipKeywords = [
      'press conference', 'weigh-in', 'weigh in',
      'preview', 'undercard', 'open workout',
    ];

    await this.page.evaluate(() => window.scrollTo(0, 0));
    await this.page.waitForTimeout(300);

    for (let i = 0; i < 25; i++) {
      const articles = this.page
        .locator('article')
        .filter({ hasText: regex });

      const count = await articles.count().catch(() => 0);

      for (let j = 0; j < count; j++) {
        const article = articles.nth(j);
        if (await article.isVisible().catch(() => false)) {
          const text = await article.innerText().catch(() => '');
          const lower = text.toLowerCase();

          // Skip non-PPV events (press conferences, weigh-ins, etc.)
          const isNonPPV = skipKeywords.some(kw => lower.includes(kw));
          if (isNonPPV) {
            const label = text.split('\n').find(l => l.trim()) || text.slice(0, 40);
            console.log(`⏭️  Skipping non-PPV: "${label.trim()}"`);
            continue;
          }

          console.log('✅ Event found');
          return article;
        }
      }

      await this.page.evaluate(() => {
        window.scrollBy({ top: window.innerHeight, behavior: 'instant' });
      });
      await this.page.waitForTimeout(300);
    }

    throw new Error(`❌ Event "${eventName}" not found on schedule page`);
  }

  // ── CLICK EVENT (open modal) ──────────────────────────────────
  async clickEvent(event: Locator) {
    console.log('🖱️ Clicking event...');

    // Save scroll position BEFORE any scrolling
    const scrollY = await this.page.evaluate(() => window.scrollY);

    // Scroll into view only if not already visible
    const box0 = await event.boundingBox();
    if (!box0 || box0.y < 0 || box0.y > 700) {
      await event.scrollIntoViewIfNeeded();
      await this.page.waitForTimeout(300);
    }

    const box = await event.boundingBox();
    if (!box) throw new Error('❌ Event not clickable — no bounding box');

    await this.page.mouse.click(
      box.x + box.width  / 2,
      box.y + box.height / 2
    );

    const buyNowButton = this.page.locator(
      'a:has-text("Buy now"), '      +
      'button:has-text("Buy now"), ' +
      'a:has-text("Buy Now"), '      +
      'button:has-text("Buy Now")'
    ).first();

    await expect(buyNowButton).toBeVisible({ timeout: 15000 });

    // Restore scroll + lock background
    await this.page.evaluate((y) => {
      window.scrollTo(0, y);
      document.body.style.overflow = 'hidden';
      document.documentElement.style.overflow = 'hidden';
    }, scrollY);

    console.log('🔒 Background scroll locked');
    console.log('✅ Modal opened & Buy button located');
  }

  // ── CLICK BUY NOW ─────────────────────────────────────────────
  async clickBuyNow(): Promise<void> {
    console.log('💳 Clicking Buy Now CTA...');
    const buyNow = this.page.locator(
      'a:has-text("Buy now"), '      +
      'button:has-text("Buy now"), ' +
      'a:has-text("Buy Now"), '      +
      'button:has-text("Buy Now")'
    ).first();

    await expect(buyNow).toBeVisible({ timeout: 8000 });
    await buyNow.click({ force: true });
    console.log('✅ Buy Now clicked');
  }
}
