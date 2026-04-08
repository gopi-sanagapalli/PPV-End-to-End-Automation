import { Page } from '@playwright/test';
import { smartClick } from '../utils/browserHelpers';

export class PPVPage {
  constructor(private page: Page) {}

  // ─────────────────────────────────────────────
  // WAIT FOR PAGE LOAD
  // ─────────────────────────────────────────────
  async waitForLoad() {
    await this.page.waitForLoadState('load');
  }

  // ─────────────────────────────────────────────
  // DETECT VARIANT
  // ─────────────────────────────────────────────
  async detectVariant(): Promise<string> {
    const text = await this.page.locator('body').innerText();
    const lower = text.toLowerCase();

    if (lower.includes('bundle')) return 'variant3';
    if (lower.includes('free trial')) return 'variant2';
    return 'variant1';
  }

  // ─────────────────────────────────────────────
  // ✅ FIX: CHECK VARIANT INDICATORS (MISSING)
  // ─────────────────────────────────────────────
  async areVariantIndicatorsVisible(): Promise<boolean> {
    try {
      const indicators = this.page.locator(
        'text=/choose your plan|free trial|bundle/i'
      );

      return await indicators.first().isVisible({ timeout: 2000 });
    } catch {
      return false;
    }
  }

  // ─────────────────────────────────────────────
  // CHECK IF ON PLAN PAGE
  // ─────────────────────────────────────────────
  async isPlanPage(): Promise<boolean> {
    try {
      const header = this.page.locator(
        'text=/choose your plan|choose your pass/i'
      );

      return await header.first().isVisible({ timeout: 5000 });
    } catch {
      return false;
    }
  }

  // ─────────────────────────────────────────────
  // CLICK CONTINUE CTA
  // ─────────────────────────────────────────────
  async clickContinue() {
    const continueBtn = this.page.getByRole('button', {
      name: /continue|next|proceed/i
    }).first();

    await smartClick(this.page, continueBtn, 'PPV Continue CTA');

    console.log('✅ Clicked Continue on PPV page');
  }
}