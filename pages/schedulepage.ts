import { Page, Locator, expect } from '@playwright/test';
import selectors from '../config/selectors.json';

export class SchedulePage {
  constructor(private page: Page) {}

  // -------------------------------
  // NAVIGATION
  // -------------------------------
  async navigate() {
    console.log('📅 Navigating to schedule page...');

    await this.page.goto('https://www.dazn.com/en-AU/schedule');

    await expect(this.page).toHaveURL(/schedule/);

    await this.page.waitForLoadState('domcontentloaded');
    await this.page.waitForLoadState('networkidle').catch(() => {});

    await this.page.waitForFunction(() => {
      return document.querySelectorAll('article').length > 0;
    });

    console.log('✅ Schedule page loaded');
  }

  // -------------------------------
  // SELECT SPORT
  // -------------------------------
  async selectSport(sport: string = 'Boxing') {
    console.log(`🥊 Selecting ${sport}...`);

    const filterContainer = this.page.locator('#schedule-filter-container');
    await expect(filterContainer).toBeVisible({ timeout: 10000 });

    const sportEl = filterContainer.getByText(sport, { exact: true });

    await expect(sportEl).toBeVisible();
    await sportEl.click();

    await this.page.waitForFunction(() => {
      return document.querySelectorAll('article').length > 0;
    });

    await this.page.waitForTimeout(1000);

    console.log(`✅ ${sport} selected`);
  }

  // -------------------------------
  // FIND EVENT (GENERIC)
  // -------------------------------
  async findEvent(eventName: string): Promise<Locator> {
    console.log(`🔍 Searching for event: ${eventName}`);

    const regex = new RegExp(
      eventName.replace(/\s+/g, '.*'),
      'i'
    );

    await this.page.evaluate(() => window.scrollTo(0, 0));
    await this.page.waitForTimeout(500);

    for (let i = 0; i < 25; i++) {
      const event = this.page.locator('article').filter({
        hasText: regex
      }).first();

      if (await event.isVisible().catch(() => false)) {
        console.log('✅ Event found');
        return event;
      }

      await this.page.mouse.wheel(0, 2000);
      await this.page.waitForTimeout(400);
    }

    throw new Error(`❌ Event "${eventName}" not found`);
  }

  // -------------------------------
  // CLICK EVENT
  // -------------------------------
  async clickEvent(event: Locator) {
    console.log('🖱️ Clicking event...');

    await event.scrollIntoViewIfNeeded();
    await this.page.waitForTimeout(300);

    const box = await event.boundingBox();
    if (!box) throw new Error('❌ Event not clickable');

    await this.page.mouse.click(
      box.x + box.width / 2,
      box.y + box.height / 2
    );

    // Wait for modal
    await expect(this.page.locator(selectors.schedule.buyCTA)).toBeVisible({
      timeout: 7000
    });

    console.log('✅ Modal opened');
  }

  // -------------------------------
  // CLICK BUY NOW (GENERIC)
  // -------------------------------
  async clickBuyNow() {
    console.log('💳 Clicking Buy Now CTA...');

    const buyNow = this.page.locator(selectors.schedule.buyCTA).first();

    await expect(buyNow).toBeVisible({ timeout: 5000 });

    await this.page.waitForTimeout(300);

    await buyNow.click({ force: true });

    console.log('✅ Buy Now clicked');

    await this.page.waitForLoadState('domcontentloaded');

    const url = this.page.url();
    console.log(`🌍 After Buy Now URL: ${url}`);

    if (url.includes('schedule')) {
      throw new Error('❌ Buy Now did not navigate');
    }
  }
}