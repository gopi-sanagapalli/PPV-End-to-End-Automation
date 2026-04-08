import { Page, Locator, expect } from '@playwright/test';

export class SchedulePage {
  constructor(private page: Page) {}

  // -------------------------------
  // NAVIGATION
  // -------------------------------
  async navigate() {
    console.log('📅 Navigating to schedule page...');

    await this.page.goto('https://www.dazn.com/en-AU/schedule');

    // URL must be correct
    await expect(this.page).toHaveURL(/schedule/);

    // SPA readiness (not just HTML load)
    await this.page.waitForLoadState('domcontentloaded');
    await this.page.waitForLoadState('networkidle').catch(() => {});

    // Ensure page actually rendered content
    await this.page.waitForFunction(() => {
      return document.querySelectorAll('article').length > 0;
    });

    console.log('✅ Schedule page loaded');
  }

  // -------------------------------
  // SELECT SPORT (BOXING)
  // -------------------------------
  async selectBoxing() {
  console.log('🥊 Selecting Boxing...');

  const filterContainer = this.page.locator('#schedule-filter-container');
  await expect(filterContainer).toBeVisible({ timeout: 10000 });

  const boxing = filterContainer.getByText('Boxing', { exact: true });

  await expect(boxing).toBeVisible();
  await boxing.click();

  // 🔥 WAIT for content to change AFTER click
  await this.page.waitForFunction(() => {
    const articles = document.querySelectorAll('article');
    return articles.length > 0;
  });

  // 🔥 Give UI time to stabilize (important for SPA)
  await this.page.waitForTimeout(1000);

  console.log('✅ Boxing selected');
}
  // -------------------------------
  // FIND EVENT (SCROLL-BASED)
  // -------------------------------
async findEventWithScroll(): Promise<Locator> {
  console.log('🔍 Searching for event...');

  const nameRegex = /(chisora.*wilder|wilder.*chisora)/i;

  await this.page.evaluate(() => window.scrollTo(0, 0));
  await this.page.waitForTimeout(500);

  for (let i = 0; i < 25; i++) {
    const event = this.page.locator('article')
      .filter({ hasText: nameRegex })
      .filter({ hasText: /full event replay/i })
      .first();

    if (await event.isVisible().catch(() => false)) {
      console.log('✅ Event found');
      return event;
    }

    await this.page.mouse.wheel(0, 2000);
    await this.page.waitForTimeout(400);
  }

  throw new Error('❌ Event not found');
}

  // -------------------------------
  // CLICK EVENT
  // -------------------------------
async clickEvent(event: Locator) {
  console.log('🖱️ Clicking event...');

  await event.scrollIntoViewIfNeeded();
  await this.page.waitForTimeout(500);

  const box = await event.boundingBox();
  if (!box) throw new Error('❌ Event not clickable');

  await this.page.mouse.click(
    box.x + box.width / 2,
    box.y + box.height / 2
  );

  // 🔥 REAL validation
  await expect(this.page.locator('text=Buy now')).toBeVisible({
    timeout: 7000
  });

  console.log('✅ Modal opened');
}
async clickBuyNow() {
  console.log('💳 Clicking Buy Now CTA...');

  const buyNow = this.page.locator('button:has-text("Buy now")').first();

  await expect(buyNow).toBeVisible({ timeout: 5000 });

  await this.page.waitForTimeout(500); // allow modal settle

  const box = await buyNow.boundingBox();
  if (!box) throw new Error('❌ Buy Now not clickable');

  await this.page.mouse.click(
    box.x + box.width / 2,
    box.y + box.height / 2
  );

  console.log('✅ Buy Now clicked');

  // 🔥 verify navigation
  await this.page.waitForLoadState('domcontentloaded');

  const url = this.page.url();
  console.log(`🌍 After Buy Now URL: ${url}`);

  if (url.includes('schedule')) {
    throw new Error('❌ Buy Now did not navigate');
  }
}}