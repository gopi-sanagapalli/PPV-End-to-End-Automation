import { Page, Locator, expect } from '@playwright/test';
import { smartClick, removeOverlays } from '../utils/browserHelpers';
import selectors from '../config/selectors.json';

export class LandingPage {
  constructor(private page: Page) {}

  // ─────────────────────────────
  // NAVIGATION
  // ─────────────────────────────
  async navigate() {
    await this.page.goto('https://www.dazn.com/en-AU/welcome', {
      waitUntil: 'domcontentloaded'
    });

    await this.page.waitForLoadState('load');
  }

  // ─────────────────────────────
  // FIND PPV CONTAINER (BANNER OR TILE)
  // ─────────────────────────────
 async findPPVContainer(eventData: any) {
  const name = eventData.PPV_NAME;

  console.log(`🔍 Looking for PPV: ${name}`);

  // 🔥 target article card that contains event name
  const container = this.page
    .getByRole('article')
    .filter({ hasText: name })
    .first();

  await container.waitFor({ state: 'visible', timeout: 10000 });

  console.log(`✅ PPV found: ${name}`);

  return container;
}

  // ─────────────────────────────
  // CLICK BUY NOW
  // ─────────────────────────────
async clickBuyNow(eventData: any) {
  const container = await this.findPPVContainer(eventData);

  const buyBtn = container.getByRole('button', {
    name: /buy now/i
  });

  await buyBtn.waitFor({ state: 'visible', timeout: 5000 });

  await buyBtn.click();

  console.log('✅ Clicked Buy Now from correct PPV tile');
}

  // ─────────────────────────────
  // READ HELPERS (FROM CORRECT CONTAINER)
  // ─────────────────────────────
  async getEventName(container: Locator): Promise<string> {
    const el = container.locator('h1, h2, h3').first();
    return (await el.textContent().catch(() => 'N/A'))?.trim() || 'N/A';
  }

  async getEventDescription(container: Locator): Promise<string> {
    const el = container.locator('p').first();
    return (await el.textContent().catch(() => 'N/A'))?.trim() || 'N/A';
  }

  async getEventDate(container: Locator): Promise<string> {
    const el = container.locator('time, span').first();
    return (await el.textContent().catch(() => 'N/A'))?.trim() || 'N/A';
  }

  async hasBuyButton(container: Locator): Promise<boolean> {
    const btn = container.locator('button, a').first();
    return await btn.isVisible().catch(() => false);
  }
}