import { Page, Locator, expect } from '@playwright/test';

export class SchedulePage {
  constructor(private page: Page) {}

  // ── NAVIGATE ──────────────────────────────────────────────────
  async navigate(baseUrl: string) {
    const url = `${baseUrl}/schedule`;
    console.log(`📅 Navigating to: ${url}`);
    await this.page.goto(url);
    await expect(this.page).toHaveURL(/schedule/);
    await this.page.waitForLoadState('domcontentloaded');
    await this.page.waitForLoadState('networkidle').catch(() => {});
    await this.page.waitForSelector('body', { timeout: 15000 });
    console.log('✅ Schedule page loaded');
  }

  // ── SELECT SPORT ──────────────────────────────────────────────
  async selectSport(sport: string) {
    console.log(`🥊 Selecting ${sport}...`);

    const filterContainer = this.page.locator('#schedule-filter-container');
    await expect(filterContainer).toBeVisible({ timeout: 10000 });

    // Use getByText — this is what worked originally
    const sportEl = filterContainer.getByText(sport, { exact: true });
    await expect(sportEl).toBeVisible({ timeout: 8000 });
    await sportEl.click();

    await this.page.waitForFunction(
      () => document.querySelectorAll('article').length > 0
    );
    await this.page.waitForTimeout(1000);
    console.log(`✅ ${sport} selected`);
  }

  // ── FIND EVENT ────────────────────────────────────────────────
  async findEvent(eventName: string): Promise<Locator> {
    console.log(`🔍 Searching for event: ${eventName}`);

    const regex = new RegExp(
      eventName.replace(/\s+/g, '.*'),
      'i'
    );

    // Start from top
    await this.page.evaluate(() => window.scrollTo(0, 0));
    await this.page.waitForTimeout(500);

    for (let i = 0; i < 25; i++) {
      const event = this.page
        .locator('article')
        .filter({ hasText: regex })
        .first();

      if (await event.isVisible().catch(() => false)) {
        console.log('✅ Event found');
        return event;
      }

      await this.page.mouse.wheel(0, 2000);
      await this.page.waitForTimeout(400);
    }

    throw new Error(`❌ Event "${eventName}" not found on schedule page`);
  }

  // ── CLICK EVENT (open modal) ──────────────────────────────────
  async clickEvent(event: Locator) {
    console.log('🖱️ Clicking event...');

    await event.scrollIntoViewIfNeeded();
    await this.page.waitForTimeout(300);

    // Get bounding box and click center
    const box = await event.boundingBox();
    if (!box) throw new Error('❌ Event not clickable — no bounding box');

    await this.page.mouse.click(
      box.x + box.width  / 2,
      box.y + box.height / 2
    );

    // Buy now button
    const buyNowButton = this.page.locator(
      'a:has-text("Buy now"), '      +
      'button:has-text("Buy now"), ' +
      'a:has-text("Buy Now"), '      +
      'button:has-text("Buy Now")'
    ).first();

    // Scroll down if needed to find button
    for (let i = 0; i < 5; i++) {
      if (await buyNowButton.isVisible().catch(() => false)) break;
      await this.page.keyboard.press('PageDown');
      await this.page.waitForTimeout(300);
    }

    await expect(buyNowButton).toBeVisible({ timeout: 10000 });
    await buyNowButton.scrollIntoViewIfNeeded({ timeout: 5000 });
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
    await buyNow.scrollIntoViewIfNeeded().catch(() => {});
    await buyNow.click({ force: true });
    console.log('✅ Buy Now clicked');
  }
}