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

    await this.page.locator('article').first().waitFor({ state: 'visible', timeout: 15000 });

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

    // Wait for modal to open
    const buyNowButton = this.page.locator(selectors.schedule.buyCTA).first();
    
    // Scroll modal until button comes into view
    for (let scrollAttempt = 0; scrollAttempt < 5; scrollAttempt++) {
      if (await buyNowButton.isVisible().catch(() => false)) break;
      await this.page.keyboard.press('PageDown');
      await this.page.waitForTimeout(300);
    }
    
    await expect(buyNowButton).toBeVisible({ timeout: 10000 });
    
    // Scroll exactly to the button
    await buyNowButton.scrollIntoViewIfNeeded({ timeout: 5000 });
    
    console.log('✅ Modal opened & Buy button located');
  }

  // -------------------------------
  // CLICK BUY NOW (GENERIC - WORKS FOR ALL PPVs)
  // -------------------------------
  async clickBuyNow(): Promise<Page> {
    console.log('💳 Clicking Buy Now CTA...');

    const buyNow = this.page.locator(selectors.schedule.buyCTA).first();

    await expect(buyNow).toBeVisible({ timeout: 8000 });
    await this.page.waitForTimeout(400);

    // Setup universal handler for BOTH: new tab OR same page navigation
    let targetPage: Page | undefined;
    let gotNewTab = false;

    // Listen for new tab event (in case PPV opens new window)
    const newTabListener = (page: Page) => {
      targetPage = page;
      gotNewTab = true;
    };
    
    this.page.context().once('page', newTabListener);

    // Also listen for same page navigation
    const navigationPromise = this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => null);

    await buyNow.click({ force: true });
    console.log('✅ Buy Now clicked');

    // Wait for whichever happens first: new tab OR page navigation
    await Promise.race([
      this.page.waitForTimeout(500).then(() => gotNewTab),
      navigationPromise
    ]);

    // Remove listener to prevent memory leaks
    this.page.context().removeListener('page', newTabListener);

    // Determine which navigation type occurred
    if (gotNewTab && targetPage) {
      // New tab opened
      await targetPage.waitForLoadState('domcontentloaded');
      await targetPage.waitForLoadState('networkidle').catch(() => {});
      console.log(`✅ New PPV Page opened: ${targetPage.url()}`);
      return targetPage;
    } else {
      // Same page navigation
      await this.page.waitForLoadState('domcontentloaded');
      await this.page.waitForLoadState('networkidle').catch(() => {});
      console.log(`✅ PPV opened in same page: ${this.page.url()}`);
      return this.page;
    }
  }
}