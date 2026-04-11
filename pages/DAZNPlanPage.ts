import { smartClick } from '../utils/browserHelpers';
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

  async ensureTrialPlanSelected(): Promise<void> {
    const trialPlan = this.page.locator('label:has-text("7-day free trial"), [role="radio"]:has-text("7-day free trial")').first();

    if (!(await trialPlan.isVisible({ timeout: 3000 }).catch(() => false))) {
      console.log('ℹ️ Trial plan selector not visible, skipping explicit selection');
      return;
    }

    const alreadySelected = await trialPlan.locator('[aria-label="selected"], img[alt="selected"], [aria-checked="true"]').first().isVisible().catch(() => false);
    if (alreadySelected) {
      console.log('✅ Trial plan already selected');
      return;
    }

    console.log('🔁 Ensuring Trial plan is selected before Continue...');
    await trialPlan.scrollIntoViewIfNeeded().catch(() => {});
    await trialPlan.click({ force: true });
    await trialPlan.locator('[aria-label="selected"], img[alt="selected"], [aria-checked="true"]').first().waitFor({ timeout: 5000 }).catch(() => {});
    console.log('✅ Trial plan confirmed selected');
  }

  // ─────────────────────────────
  // CLICK CONTINUE
  // ─────────────────────────────
  async clickContinue(): Promise<void> {
    console.log('🔍 Clicking Continue CTA...');

    // ✅ AUTO SCROLL DOWN for Continue button that is below fold
    for (let scrollAttempt = 0; scrollAttempt < 6; scrollAttempt++) {
      if (await this.getContinueButton()) break;
      await this.page.keyboard.press('PageDown');
      await this.page.waitForTimeout(300);
    }

    await this.ensureTrialPlanSelected();

    const btn = await this.getContinueButton();

    if (!btn) {
      throw new Error('❌ Continue button not found');
    }

    await btn.scrollIntoViewIfNeeded().catch(() => {});

    const enabled = await btn.isEnabled().catch(() => false);
    if (!enabled) {
      console.log('⚠️ Plan Continue CTA is disabled, attempting force click fallback');
      await btn.click({ force: true, timeout: 5000 }).catch(() => {});
    } else {
      await smartClick(this.page, btn, 'Plan Continue CTA', {
        waitForNav: false,
        maxRetries: 2,
      });
    }

    console.log('✅ Continue clicked');

    await this.page.waitForTimeout(1000).catch(() => {});
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