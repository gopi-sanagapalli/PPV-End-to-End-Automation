import { Page, Locator } from '@playwright/test';

export class DAZNPlanPage {
  constructor(private page: Page) {}

  // ─────────────────────────────────────────────
  // DETECT PLAN PAGE
  // ─────────────────────────────────────────────
  async isPlanPage(): Promise<boolean> {
    try {
      const title = this.page.getByText("Choose a plan that's right").first();
      return await title.isVisible({ timeout: 3000 });
    } catch {
      return false;
    }
  }

  // ─────────────────────────────────────────────
  // FIND CONTINUE BUTTON
  // Tries data-test-id first, then broad fallbacks.
  // This is shared between validation (CTA present
  // check) and clickContinue() so behaviour is
  // consistent — no more "validates OK but fails
  // to click" mismatch.
  // ─────────────────────────────────────────────
  async findContinueButton(): Promise<Locator | null> {
    const selectors = [
      // Most specific first
      '[data-test-id="plan-details__button"]',
      '[data-testid="plan-details__button"]',
      // Text-based
      'button:has-text("Continue with PPV")',
      'button:has-text("Continue")',
      'button:has-text("Next")',
      'button:has-text("Sign up")',
      'button:has-text("Get started")',
      // Attribute-based
      '[data-testid*="continue"]',
      '[data-test-id*="continue"]',
      '[data-testid*="cta"]',
      '[data-test-id*="cta"]',
      // Class-based
      '[class*="continue"] button',
      // Generic submit
      'button[type="submit"]',
    ];

    for (const sel of selectors) {
      const btn = this.page.locator(sel).first();
      if (await btn.isVisible({ timeout: 1500 }).catch(() => false)) {
        console.log(`✅ Continue button found via: ${sel}`);
        return btn;
      }
    }

    // Last resort: any enabled visible button with matching text
    const anyBtn = this.page
      .locator('button:enabled')
      .filter({ hasText: /continue|next|proceed|get started|sign up/i })
      .first();
    if (await anyBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      console.log('✅ Continue button found via generic enabled button fallback');
      return anyBtn;
    }

    // Debug: log all button texts so failures are diagnosable
    const allBtnTexts = await this.page.locator('button').allTextContents().catch(() => []);
    console.log('🧪 All button texts on page:', allBtnTexts.map(t => t.trim()).filter(Boolean));

    return null;
  }

  // ─────────────────────────────────────────────
  // CLICK CONTINUE
  // REQ 5: waits 3s before clicking, three-tier
  // click escalation (normal → force → JS eval).
  // ─────────────────────────────────────────────
  async clickContinue(): Promise<void> {
    console.log('🔍 REQ 5 – Looking for Continue CTA on DAZN Plan page...');

    // Let page settle after plan validation card clicks
    await this.page.waitForTimeout(500);

    const btn = await this.findContinueButton();

    if (!btn) {
      throw new Error('❌ Continue button not found on DAZN Plan page');
    }

    // Scroll into view
    await btn.scrollIntoViewIfNeeded().catch(() => {});
    await this.page.waitForTimeout(300);

    // Wait for enabled state
    const isEnabled = await btn.isEnabled().catch(() => false);
    if (!isEnabled) {
      console.log('⚠️ Button disabled, waiting 1.5s...');
      await this.page.waitForTimeout(1500);
    }

    // REQ 5: 3-second deliberate wait before clicking
    console.log('⏳ REQ 5 – Waiting 3 seconds before clicking Continue...');
    await this.page.waitForTimeout(3000);

    // Attempt 1: normal click
    try {
      await btn.click({ timeout: 5000 });
      console.log('✅ Continue clicked (normal click)');
    } catch {
      // Attempt 2: force click
      try {
        await btn.click({ force: true, timeout: 3000 });
        console.log('✅ Continue clicked (force click)');
      } catch {
        // Attempt 3: JavaScript click
        await btn.evaluate((el: HTMLElement) => el.click());
        console.log('✅ Continue clicked (JS click)');
      }
    }

    await this.page.waitForLoadState('domcontentloaded').catch(() => {});
    await this.page.waitForTimeout(500);
    console.log('📍 URL after Continue click:', this.page.url());
  }

  // ─────────────────────────────────────────────
  // IS ON SIGNUP PAGE
  // ─────────────────────────────────────────────
  async isOnSignupPage(): Promise<boolean> {
    try {
      return await this.page
        .locator('input[type="email"], input[name="email"]')
        .first()
        .isVisible({ timeout: 3000 });
    } catch {
      return false;
    }
  }
}