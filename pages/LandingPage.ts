import { Page, Locator } from '@playwright/test';
import { smartClick, removeOverlays } from '../utils/browserHelpers';

export class LandingPage {
  constructor(private page: Page) {}

  // ─────────────────────────────────────────────
  // NAVIGATION
  // ─────────────────────────────────────────────
  async navigate() {
    await this.page.goto('https://www.dazn.com/en-AU/welcome', {
      waitUntil: 'domcontentloaded'
    });

    await this.page.waitForLoadState('load');
  }

  // ─────────────────────────────────────────────
  // FIND PPV BANNER (CORE)
  // ─────────────────────────────────────────────
  async findPPVBanner(): Promise<Locator> {
    console.log('🔍 Looking for PPV banner...');

    const banner = this.page.locator('article, section, div')
      .filter({
       has: this.page.locator(
  'button:has-text("Buy"), a:has-text("Buy"), button:has-text("Watch"), a:has-text("Watch")'
)
      })
      .first();

    await banner.waitFor({ state: 'visible', timeout: 15000 });

    console.log('✅ PPV banner found');
    return banner;
  }

  // ─────────────────────────────────────────────
  // WAIT FOR IMAGE (PREVENT HALF-LOADED UI)
  // ─────────────────────────────────────────────
  async waitForBannerImageLoad(banner: Locator) {
    const img = banner.locator('img').first();

    if (await img.isVisible().catch(() => false)) {
      await img.evaluate(async (el: HTMLImageElement) => {
        if (el.complete && el.naturalWidth > 0) return;

        await new Promise<void>((resolve) => {
          const done = () => resolve();
          el.addEventListener('load', done, { once: true });
          el.addEventListener('error', done, { once: true });
          setTimeout(done, 5000);
        });
      }).catch(() => {});
    }
  }

  // ─────────────────────────────────────────────
  // CLICK CTA
  // ─────────────────────────────────────────────
  async clickBuyNow() {
    const banner = await this.findPPVBanner();

    const buyBtn = banner.locator(
     'button:has-text("Buy"), a:has-text("Buy")'
    ).first();

    await removeOverlays(this.page);


    console.log('✅ Clicked Buy Now from Landing');
  }

  // ─────────────────────────────────────────────
  // VALIDATION HELPERS (IMPORTANT FIX)
  // ─────────────────────────────────────────────

  // ✅ FIX: Only reads banner text (not whole page)
  async getEventName(banner: Locator): Promise<string> {
    const el = banner.locator('text=/vs\\.?/i').first();
    return (await el.innerText().catch(() => 'N/A')).trim();
  }

  async getEventDescription(banner: Locator): Promise<string> {
  const paragraphs = banner.locator('p');
  const count = await paragraphs.count();

  for (let i = 0; i < count; i++) {
    const text = await paragraphs.nth(i).innerText().catch(() => '');
    const clean = text.toLowerCase();

    if (
      text.length > 40 &&
      !clean.includes('highlight') &&
      !clean.includes('login') &&
      !clean.includes('free') &&
      !clean.includes('watch')
    ) {
      return text.trim();
    }
  }

  return 'N/A';
}

  async hasBuyButton(selectors: string[]): Promise<boolean> {
    for (const sel of selectors) {
      const el = this.page.locator(sel).first();
      if (await el.isVisible().catch(() => false)) {
        return true;
      }
    }
    return false;
  }

  async findBuyNowButton(banner: Locator, selectors: string[]) {
    for (const sel of selectors) {
      const el = banner.locator(sel).first();
      if (await el.isVisible().catch(() => false)) {
        return el;
      }
    }
    return null;
  }
async getEventDate(selectors: string[]): Promise<string> {
  for (const sel of selectors) {
    const el = this.page.locator(sel).first();

    if (await el.isVisible().catch(() => false)) {
      const text = await el.innerText().catch(() => '');
      if (text && text.trim().length > 0) {
        return text.trim();
      }
    }
  }

  return 'N/A';
}}