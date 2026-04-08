import { Page, Locator, expect } from '@playwright/test';

export class SchedulePage {
  private readonly SCHEDULE_URL = 'https://www.dazn.com/en-AU/schedule';
  private readonly DEFAULT_TIMEOUT = 10000;
  private readonly SCROLL_ATTEMPTS = 25;
  private readonly SCROLL_DELTA = 2000;

  constructor(private readonly page: Page) {}

  /**
   * Navigate to schedule page and wait for full readiness
   */
  async navigate(): Promise<void> {
    console.log('📅 Navigating to schedule page...');

    await this.page.goto(this.SCHEDULE_URL, { waitUntil: 'domcontentloaded' });
    await expect(this.page).toHaveURL(/schedule/, { timeout: this.DEFAULT_TIMEOUT });

    // Wait for network idle with safe timeout
    await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

    // Wait for content to render properly
    await this.page.waitForSelector('article', {
      state: 'attached',
      timeout: this.DEFAULT_TIMEOUT
    });

    console.log('✅ Schedule page loaded successfully');
  }

  /**
   * Select Boxing sport filter and wait for content update
   */
  async selectBoxing(): Promise<void> {
    console.log('🥊 Selecting Boxing filter...');

    const filterContainer = this.page.locator('#schedule-filter-container');
    await expect(filterContainer).toBeVisible({ timeout: this.DEFAULT_TIMEOUT });

    const boxingOption = filterContainer.getByText('Boxing', { exact: true });
    await expect(boxingOption).toBeEnabled();

    // Capture article count before click to detect changes
    const initialArticleCount = await this.page.locator('article').count();

    await boxingOption.click();

    // Wait for content to actually change after filter is applied
    await this.page.waitForFunction(
      (initialCount) => document.querySelectorAll('article').length !== initialCount,
      initialArticleCount,
      { timeout: this.DEFAULT_TIMEOUT }
    );

    // Wait for any remaining animations/transitions
    await this.page.waitForTimeout(300);

    console.log('✅ Boxing filter applied');
  }

  /**
   * Scroll through page to find specific event
   * @returns Locator for found event
   */
  async findEventWithScroll(eventNamePattern: RegExp = /(chisora.*wilder|wilder.*chisora)/i): Promise<Locator> {
    console.log('🔍 Searching for event...');

    // Reset scroll position to top
    await this.page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await this.page.waitForTimeout(200);

    for (let attempt = 0; attempt < this.SCROLL_ATTEMPTS; attempt++) {
      const event = this.page.locator('article')
        .filter({ hasText: eventNamePattern })
        .filter({ hasText: /full event replay/i })
        .first();

      if (await event.isVisible({ timeout: 300 }).catch(() => false)) {
        console.log(`✅ Event found after ${attempt + 1} scroll attempts`);
        return event;
      }

      await this.page.mouse.wheel(0, this.SCROLL_DELTA);
      await this.page.waitForTimeout(250);
    }

    throw new Error(`❌ Event not found after ${this.SCROLL_ATTEMPTS} scroll attempts`);
  }

  /**
   * Click event card reliably and verify modal opens
   * @param event Locator for event to click
   */
  async clickEvent(event: Locator): Promise<void> {
    console.log('🖱️ Clicking event card...');

    await event.scrollIntoViewIfNeeded({ timeout: 5000 });
    await this.page.waitForTimeout(300);

    // Use native Playwright click with built-in retries instead of manual mouse coordinates
    await event.click({
      timeout: this.DEFAULT_TIMEOUT,
      force: false,
      trial: false,
      position: { x: 0.5, y: 0.5 }
    });

    // Verify modal opened successfully
    await expect(this.page.getByText('Buy now').first()).toBeVisible({
      timeout: 7000
    });

    console.log('✅ Event modal opened successfully');
  }

  /**
   * Full workflow: Navigate -> Select Boxing -> Find event -> Click event
   */
  async openEvent(eventNamePattern?: RegExp): Promise<void> {
    await this.navigate();
    await this.selectBoxing();
    const event = await this.findEventWithScroll(eventNamePattern);
    await this.clickEvent(event);
  }
}