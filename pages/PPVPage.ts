import { Page } from '@playwright/test';
import selectors from '../config/selectors.json';

export class PPVPage {
  constructor(private page: Page) {}

  // ─────────────────────────────
  // CHECK IF ON PPV PAGE
  // ─────────────────────────────
  async isPPVPage(): Promise<boolean> {
    try {
      const heading = this.page.locator(selectors.ppv.pageTitle).first();
      return await heading.isVisible({ timeout: 5000 });
    } catch {
      return false;
    }
  }

  // ─────────────────────────────
  // WAIT FOR PAGE STABLE
  // ─────────────────────────────
  async waitForLoad() {
    await this.page.waitForLoadState('domcontentloaded');

    // Scroll to trigger lazy content
    await this.page.evaluate(
      () => window.scrollTo(0, document.body.scrollHeight)
    ).catch(() => {});
    await this.page.waitForTimeout(800);

    // Scroll back to top
    await this.page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
    await this.page.waitForTimeout(400);
  }

  // ─────────────────────────────
  // SCROLL TO AND CLICK CTA
  // ─────────────────────────────
  async clickContinueCTA(ctaText: string = 'Continue'): Promise<void> {
    console.log(`🔍 Looking for CTA: "${ctaText}"`);

    const btn = this.page
      .locator(`button:has-text("${ctaText}"):visible`)
      .first();

    // Wait for button to appear
    await btn.waitFor({ state: 'visible', timeout: 10000 });

    // Scroll into view before clicking
    await btn.scrollIntoViewIfNeeded().catch(() => {});
    await this.page.waitForTimeout(300);

    await btn.click({ force: true });
    console.log(`✅ CTA "${ctaText}" clicked`);
  }

  // ─────────────────────────────
  // CHECK BUY CTA EXISTS
  // ─────────────────────────────
  async hasBuyCTA(): Promise<boolean> {
    try {
      return await this.page
        .locator(selectors.ppv.buyCTA)
        .first()
        .isVisible({ timeout: 3000 });
    } catch {
      return false;
    }
  }

  // ─────────────────────────────
  // SELECT PPV RADIO
  // ─────────────────────────────
  async selectPPVRadio(selector: string = 'input[type="radio"]'): Promise<void> {
    const radio = this.page.locator(`${selector}:visible`).first();

    if (await radio.isVisible({ timeout: 3000 }).catch(() => false)) {
      await radio.scrollIntoViewIfNeeded().catch(() => {});
      await radio.click({ force: true });
      await this.page.waitForTimeout(300);
      console.log('✅ PPV radio selected');
    } else {
      console.log('ℹ️  PPV radio not visible — skipping selection');
    }
  }

  // ─────────────────────────────
  // FULL PPV FLOW ACTION
  // Selects radio + scrolls to CTA + clicks
  // ─────────────────────────────
  async proceedWithPPV(
    ppvSelector: string = 'input[type="radio"]',
    ctaText:     string = 'Continue'
  ): Promise<void> {
    await this.selectPPVRadio(ppvSelector);
    await this.clickContinueCTA(ctaText);
  }
}