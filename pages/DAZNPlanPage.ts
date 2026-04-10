import { Page, Locator } from '@playwright/test';
import selectors from '../config/selectors.json';

export class DAZNPlanPage {
  constructor(private page: Page) {}

  // ─────────────────────────────
  // DETECT PLAN PAGE
  // ─────────────────────────────
  async isPlanPage(): Promise<boolean> {
    try {
      const title = this.page.locator(selectors.daznPlan.pageTitle).first();
      return await title.isVisible({ timeout: 3000 });
    } catch {
      return false;
    }
  }

  // ─────────────────────────────
  // GET CONTINUE BUTTON (SINGLE SOURCE)
  // ─────────────────────────────
  async getContinueButton(): Promise<Locator | null> {
    const btn = this.page.locator(selectors.daznPlan.ctaContinue).first();

    if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
      return btn;
    }

    // 🔥 Controlled fallback (NOT chaos)
    const fallback = this.page.getByRole('button', {
      name: /continue|next|proceed/i
    }).first();

    if (await fallback.isVisible({ timeout: 2000 }).catch(() => false)) {
      console.log('⚠️ Using fallback continue button');
      return fallback;
    }

    return null;
  }

  // ─────────────────────────────
  // CLICK CONTINUE
  // ─────────────────────────────
  async clickContinue(): Promise<void> {
    console.log('🔍 Clicking Continue CTA...');

    const btn = await this.getContinueButton();

    if (!btn) {
      throw new Error('❌ Continue button not found');
    }

    await btn.scrollIntoViewIfNeeded().catch(() => {});
 await this.page.waitForLoadState('networkidle').catch(() => {});
    // Wait if disabled
    if (!(await btn.isEnabled().catch(() => false))) {
      console.log('⚠️ Button disabled, waiting...');
      await this.page.waitForTimeout(1500);
    }

    // Stable click strategy
    try {
      await btn.click({ timeout: 5000 });
      console.log('✅ Continue clicked');
    } catch {
      await btn.click({ force: true });
      console.log('⚠️ Force click used');
    }

    await this.page.waitForLoadState('domcontentloaded').catch(() => {});
    console.log('📍 URL after click:', this.page.url());
  }

  // ─────────────────────────────
  // SIGNUP PAGE CHECK
  // ─────────────────────────────
  async isOnSignupPage(): Promise<boolean> {
    try {
      return await this.page
        .locator(selectors.signup.email)
        .first()
        .isVisible({ timeout: 3000 });
    } catch {
      return false;
    }
  }
}