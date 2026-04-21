import { Page, Locator } from '@playwright/test';

export class LandingPage {
  constructor(private page: Page) {}

  // ─────────────────────────────
  // NAVIGATE TO BASE URL
  // 1. Land on welcome
  // 2. Wait for cookies → accept
  // 3. Ready for PPV interaction
  // ─────────────────────────────
  async navigate(baseUrl: string): Promise<void> {
    const url = `${baseUrl}/welcome`;
    console.log(`🌍 Navigating to: ${url}`);
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });

    // Step 1 — Wait for page to settle
    await this.page.waitForLoadState('networkidle').catch(() => {});

    // Step 2 — Accept cookies before anything else
    await this.dismissConsentIfPresent();

    // Step 3 — Wait for PPV content to be visible
    await this.page.waitForSelector(
      'a:has-text("Buy now"), button:has-text("Buy now")',
      { state: 'visible', timeout: 15000 }
    ).catch(() => {});

    console.log(`✅ Landed on: ${this.page.url()}`);
  }

  // ─────────────────────────────
  // DISMISS CONSENT
  // Wait up to 8s — same as handleCookies in helpers.ts
  // ─────────────────────────────
  async dismissConsentIfPresent(): Promise<void> {
    const acceptBtn = this.page.locator(
      '#onetrust-accept-btn-handler, '   +
      'button:has-text("Accept All"), '  +
      'button:has-text("Accept"), '      +
      'button:has-text("Agree"), '       +
      'button:has-text("Allow all"), '   +
      'button:has-text("Essential Only")'
    ).first();

    const visible = await acceptBtn.isVisible({ timeout: 8000 }).catch(() => false);
    if (visible) {
      console.log('🍪 Consent overlay detected — dismissing...');
      await acceptBtn.click({ force: true }).catch(() => {});
      await acceptBtn.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});

      // Remove OneTrust from DOM completely
      await this.page.evaluate(() => {
        [
          '#onetrust-banner-sdk',
          '#onetrust-consent-sdk',
          '#onetrust-pc-sdk',
          '.onetrust-pc-dark-filter',
        ].forEach(sel =>
          document.querySelectorAll<HTMLElement>(sel)
            .forEach(el => el.remove())
        );
      }).catch(() => {});

      console.log('🍪 Consent dismissed');
    } else {
      console.log('ℹ️  No consent overlay found');
    }
  }

  // ─────────────────────────────
  // FIND PPV CONTAINER
  // ─────────────────────────────
  async findPPVContainer(eventData: Record<string, string>): Promise<any> {
    const ppvName = eventData.PPV_NAME || '';
    console.log(`🔍 Finding PPV container for: ${ppvName}`);

    const regex = new RegExp(ppvName.split(/\s+/).join('.*'), 'i');
    const candidates = this.page.locator('div, li, article, section')
      .filter({ hasText: regex });

    const count = await candidates.count().catch(() => 0);
    console.log(`🔍 PPV container candidates: ${count}`);

    for (let i = 0; i < count; i++) {
      const el = candidates.nth(i);
      const text = await el.textContent().catch(() => '');
      if (!text || text.length > 500) continue;

      const hasBuyNow = await el
        .locator('a, button')
        .filter({ hasText: /buy now/i })
        .isVisible({ timeout: 1000 })
        .catch(() => false);

      if (hasBuyNow) {
        console.log(`✅ PPV container found: "${text.substring(0, 80).trim()}"`);
        return el;
      }
    }

    console.log('⚠️  PPV container not found — returning null');
    return null;
  }

  // ─────────────────────────────
  // CLICK BUY NOW
  // ─────────────────────────────
  async clickBuyNow(container: any): Promise<void> {
    console.log('💳 Clicking Buy Now via container...');

    const buyNowBtn = container
      .locator('a, button')
      .filter({ hasText: /buy now/i })
      .first();

    await buyNowBtn.scrollIntoViewIfNeeded().catch(() => {});
    await this.page.waitForTimeout(300);

    // Dismiss any consent that appeared during scroll
    await this.dismissConsentIfPresent();

    const box = await buyNowBtn.boundingBox();
    if (!box || box.width === 0 || box.height === 0) {
      throw new Error('❌ Buy Now button not interactable — zero bounding box');
    }

    try {
      await buyNowBtn.click({ force: true, timeout: 5000 });
    } catch {
      console.log('⚠️  Click intercepted → forcing JS click');
      const handle = await buyNowBtn.elementHandle();
      if (!handle) throw new Error('❌ Buy Now element handle not found');
      await this.page.evaluate((el: HTMLElement) => el.click(), handle);
    }

    console.log(`✅ Clicked Buy Now`);
    await this.page.waitForLoadState('domcontentloaded').catch(() => {});
    console.log(`✅ Navigated to: ${this.page.url()}`);
  }

  // ─────────────────────────────
  // LEGACY METHODS — kept for compatibility
  // ─────────────────────────────
  async getSubscriptionTier(): Promise<string> {
    const el = this.page
      .locator('text=/DAZN (Free|Standard|Ultimate|VIP)/i')
      .first();
    return (await el.textContent({ timeout: 5000 }).catch(() => 'N/A'))?.trim() || 'N/A';
  }

  async getSubscriptionStatus(): Promise<string> {
    const resubscribe = this.page.locator('button:has-text("Resubscribe")').first();
    if (await resubscribe.isVisible({ timeout: 3000 }).catch(() => false)) return 'Resubscribe';
    const upgrade = this.page.locator('button:has-text("Upgrade now")').first();
    if (await upgrade.isVisible({ timeout: 3000 }).catch(() => false)) return 'Upgrade now';
    return 'Active';
  }

  async isPPVSectionPresent(): Promise<boolean> {
    const heading = this.page
      .locator('h2, h3')
      .filter({ hasText: /pay-per-view/i })
      .first();
    return await heading.isVisible({ timeout: 5000 }).catch(() => false);
  }

  async getPPVName(ppvName: string): Promise<string> {
    return ppvName;
  }

  async getPPVDate(ppvName: string): Promise<string> {
    return 'N/A';
  }

  async getPPVPrice(ppvName: string): Promise<string> {
    return 'N/A';
  }

  async getPPVStatus(ppvName: string): Promise<string> {
    return 'N/A';
  }

  async getEventDate(container: any): Promise<string> {
    if (!container) return 'N/A';
    try {
      const allEls = container.locator('span, p, div, time');
      const count = await allEls.count().catch(() => 0);
      for (let i = 0; i < count; i++) {
        const text = (await allEls.nth(i).textContent().catch(() => ''))?.trim() || '';
        if (
          /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/i.test(text) &&
          text.length < 60
        ) return text;
        if (
          /\d{1,2}(st|nd|rd|th)?\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i.test(text) &&
          text.length < 60
        ) return text;
      }
    } catch {}
    return 'N/A';
  }

  async scrollToPPVSection(): Promise<void> {
    // No-op — PPV section visible without scrolling on welcome page
  }

  async findPPVRow(ppvName: string): Promise<Locator | null> {
    return null;
  }
}
