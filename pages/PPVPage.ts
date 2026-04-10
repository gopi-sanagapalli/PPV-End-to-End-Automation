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

    // handle lazy content
    await this.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
    await this.page.waitForTimeout(800);
    await this.page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
    await this.page.waitForTimeout(400);
  }

  // ─────────────────────────────
  // OPTIONAL: VERIFY CORE ELEMENT
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
}