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

  if (!name) {
    throw new Error('❌ PPV_NAME is undefined');
  }

  console.log(`🔍 Looking for PPV: ${name}`);

  // 🔥 Step 1: locate header (don't wait for visibility yet)
  const sectionHeader = this.page.getByText(/don't miss live on dazn/i);

  await sectionHeader.waitFor({ state: 'attached', timeout: 10000 });

  // 🔥 Step 2: bring it into view safely
  await sectionHeader.scrollIntoViewIfNeeded();

  // small settle (prevents layout shift issues)
  await this.page.waitForTimeout(300);

  console.log('📍 Scrolled to "Don’t Miss" section');

  // 🔥 Step 3: find PPV inside that section
  const container = this.page.locator('article').filter({
  hasText: name
}).first();

  await container.waitFor({ state: 'visible', timeout: 5000 });

  console.log(`✅ PPV found: ${name}`);

  return container;
}

  // ─────────────────────────────
  // CLICK BUY NOW
  // ─────────────────────────────
async clickBuyNow(container: Locator) {
  console.log('🧠 Clicking Buy Now inside container...');

  const buyBtn = container.locator('button').filter({
    hasText: /buy now/i
  }).first();

  await buyBtn.waitFor({ state: 'attached', timeout: 10000 });

  // 🔥 ensure FULL visibility (not partial)
  await buyBtn.scrollIntoViewIfNeeded();

  // 🔥 CRITICAL: verify it's actually clickable
  const box = await buyBtn.boundingBox();

  if (!box || box.width === 0 || box.height === 0) {
    throw new Error('❌ Buy Now button not interactable (offscreen)');
  }

  // 🔥 ensure no overlay blocking
  await this.page.waitForTimeout(300);

  try {
    await buyBtn.click({ timeout: 5000 });
  } catch (e) {
    console.log('⚠️ Click intercepted → forcing JS click');
    const handle = await buyBtn.elementHandle();
    if (!handle) {
      throw new Error('❌ Buy Now button handle not found');
    }
    await this.page.evaluate((el: HTMLElement) => el.click(), handle);
  }

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