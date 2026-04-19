import { Page, Locator, expect } from '@playwright/test';

export class LandingPage {
  constructor(private page: Page) {}

  // ─────────────────────────────
  // NAVIGATION
  // ─────────────────────────────
  async navigate(baseUrl: string) {
    const url = `${baseUrl}/welcome`;
    console.log(`📅 Navigating to: ${url}`);

    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
    await expect(this.page).toHaveURL(/welcome/);
    await this.page.waitForSelector('body', { timeout: 15000 });

    const pos1 = await this.page.evaluate(() => window.scrollY).catch(() => -1);
    console.log(`📍 Scroll after domcontentloaded: ${pos1}px`);

    // ── Step 1: Accept cookie banner ──────────────────────────
    console.log('🍪 Waiting for cookie banner...');
    try {
      await this.page.waitForSelector(
        '#onetrust-accept-btn-handler, '  +
        'button:has-text("Accept All"), ' +
        'button:has-text("Accept"), '     +
        'button:has-text("Agree"), '      +
        'button:has-text("Allow all")',
        { timeout: 10000, state: 'visible' }
      );

      console.log('🍪 Cookie banner appeared - accepting...');
      const acceptBtn = this.page.locator(
        '#onetrust-accept-btn-handler, '  +
        'button:has-text("Accept All"), ' +
        'button:has-text("Accept"), '     +
        'button:has-text("Agree"), '      +
        'button:has-text("Allow all")'
      ).first();

      await acceptBtn.click({ force: true }).catch(() => {});
      await acceptBtn.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
      console.log('🍪 Cookies accepted');

      await this.page.evaluate(() => {
        ['#onetrust-banner-sdk',
         '#onetrust-consent-sdk',
         '[class*="cookie-banner" i]',
         '[class*="consent-banner" i]']
          .forEach(sel =>
            document.querySelectorAll<HTMLElement>(sel)
              .forEach(el => { el.style.display = 'none'; })
          );
      }).catch(() => {});

    } catch {
      console.log('ℹ️  No cookie banner - continuing');
    }

    await this.page.evaluate(() =>
      window.scrollTo({ top: 0, behavior: 'instant' })
    ).catch(() => {});

    const pos2 = await this.page.evaluate(() => window.scrollY).catch(() => -1);
    console.log(`📍 Scroll after cookies: ${pos2}px`);

    await this.page.waitForTimeout(500);

    const pos3 = await this.page.evaluate(() => window.scrollY).catch(() => -1);
    console.log(`📍 Final scroll position: ${pos3}px`);

    console.log('✅ Landing page loaded');
  }

  // ─────────────────────────────
  // FIND PPV CONTAINER
  // ─────────────────────────────
  async findPPVContainer(eventData: any): Promise<Locator> {
    const name = eventData.PPV_NAME;
    if (!name) throw new Error('❌ PPV_NAME is undefined');

    console.log(`🔍 Looking for PPV: ${name}`);

    await this.page.evaluate(() =>
      window.scrollTo({ top: 0, behavior: 'instant' })
    );
    await this.page.waitForTimeout(200);

    console.log(`⏳ Waiting for PPV article in DOM...`);
    await this.page.waitForFunction(
      (namePattern) => {
        const articles = Array.from(document.querySelectorAll('article'));
        return articles.some(a =>
          new RegExp(namePattern, 'i').test((a as HTMLElement).innerText || '')
        );
      },
      name.replace(/\s+/g, '.*'),
      { timeout: 15000, polling: 500 }
    ).catch(() => console.log('⚠️ Article not found in DOM after 15s'));

    console.log(`📍 Scrolling to "Don't Miss Live on DAZN" section...`);
    const targetScrollY = await this.page.evaluate(() => {
      const allEls = Array.from(
        document.querySelectorAll('h1,h2,h3,h4,h5,p,span')
      );
      for (const el of allEls) {
        const text = (el as HTMLElement).innerText?.trim().toLowerCase() || '';
        if (text === "don't miss live on dazn" ||
            text.includes("don't miss live on dazn")) {
          const rect = el.getBoundingClientRect();
          const target = Math.max(0, window.scrollY + rect.top - 100);
          window.scrollTo({ top: target, behavior: 'instant' });
          return target;
        }
      }
      return -1;
    }).catch(() => -1);

    if (targetScrollY >= 0) {
      console.log(`✅ Scrolled to "Don't Miss" section at ${targetScrollY}px`);

      await this.page.evaluate((lockedY) => {
        const lockScroll = () => {
          if (Math.abs(window.scrollY - lockedY) > 50) {
            window.scrollTo({ top: lockedY, behavior: 'instant' });
          }
        };
        const interval = setInterval(lockScroll, 50);
        setTimeout(() => clearInterval(interval), 2000);
      }, targetScrollY);

    } else {
      console.log(`⚠️  Section not found - small nudge`);
      await this.page.evaluate(() =>
        window.scrollBy({ top: 400, behavior: 'instant' })
      );
    }

    await this.page.waitForTimeout(2000);

    const regex = new RegExp(name.replace(/\s+/g, '.*'), 'i');
    const container = this.page
      .locator('article')
      .filter({ hasText: regex })
      .first();

    const isVisible = await container.isVisible().catch(() => false);
    console.log(isVisible
      ? `✅ PPV found: ${name}`
      : `⚠️  PPV card not visible after scroll`
    );

    return container;
  }

  // ─────────────────────────────
  // CLICK BUY NOW
  // ─────────────────────────────
  async clickBuyNow(container?: Locator): Promise<void> {
    console.log('💳 Clicking Buy Now on PPV card...');

    const buyBtn = container
      ? container
          .locator('button, a')
          .filter({ hasText: /buy now/i })
          .first()
      : this.page.locator(
          'button:has-text("Buy Now"), ' +
          'button:has-text("Buy now"), ' +
          'a:has-text("Buy Now"), '      +
          'a:has-text("Buy now")'
        ).first();

    await expect(buyBtn).toBeVisible({ timeout: 10000 });

    const box = await buyBtn.boundingBox();
    if (!box || box.width === 0 || box.height === 0) {
      throw new Error('❌ Buy Now button not interactable');
    }

    await this.page.waitForTimeout(300);

    try {
      await buyBtn.click({ force: true, timeout: 5000 });
    } catch {
      console.log('⚠️  Click intercepted → forcing JS click');
      const handle = await buyBtn.elementHandle();
      if (!handle) throw new Error('❌ Buy Now button handle not found');
      await this.page.evaluate(
        (el: HTMLElement) => el.click(), handle
      );
    }

    console.log('✅ Buy Now clicked');
  }

  // ─────────────────────────────
  // READ HELPERS
  // ─────────────────────────────
  async getEventName(container: Locator): Promise<string> {
    const el = container.locator('h1, h2, h3').first();
    return (await el.textContent().catch(() => 'N/A'))?.trim() || 'N/A';
  }

  async getEventDescription(container: Locator): Promise<string> {
    const el = container.locator('p').first();
    return (await el.textContent().catch(() => 'N/A'))?.trim() || 'N/A';
  }

  // ✅ Fixed getEventDate — searches for date pattern in container
  async getEventDate(container: Locator): Promise<string> {
    const allEls = container.locator('span, div, time, p');
    const count  = await allEls.count().catch(() => 0);

    // ── Pass 1: Match "Sat 9th May at 23:30" pattern ──────────
    for (let i = 0; i < count; i++) {
      const el   = allEls.nth(i);
      const text = (await el.textContent().catch(() => ''))?.trim() || '';

      if (
        /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/i.test(text) &&
        /\d{1,2}(st|nd|rd|th)?\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i.test(text) &&
        text.length < 60
      ) {
        return text;
      }
    }

    // ── Pass 2: Match any text with time pattern ───────────────
    for (let i = 0; i < count; i++) {
      const el   = allEls.nth(i);
      const text = (await el.textContent().catch(() => ''))?.trim() || '';
      if (/\d{1,2}:\d{2}/.test(text) && text.length < 60) {
        return text;
      }
    }

    return 'N/A';
  }

  async hasBuyButton(container: Locator): Promise<boolean> {
    const btn = container.locator('button, a').first();
    return await btn.isVisible().catch(() => false);
  }
}