import { Page } from '@playwright/test';

export class HomePage {
  private baseUrl: string;

  constructor(private page: Page, baseUrl: string = '') {
    this.baseUrl = baseUrl;
  }

  async navigateToMyAccount(): Promise<void> {
    console.log('👤 Navigating to My Account...');

    // ── Wait for page to be fully loaded ─────────────────────
    await this.page.waitForLoadState('domcontentloaded');

    // ── Dismiss any popup that may be blocking the page ──────
    // NOTE: Never scroll on home page — just dismiss popups
    console.log('⏳ Waiting for home page header...');
    await this.dismissPopup();
    await this.dismissPopup();

    // ── Click profile button ──────────────────────────────────
   // ── Click profile button ──────────────────────────────────
console.log('🖱️  Clicking profile button...');

// Try multiple selectors — UK uses XPath, IN uses avatar button
const profileSelectors = [
  'xpath=//header//nav//ul[2]//li[2]//button',  // UK structure
  'button[class*="avatar" i]',
  'button[class*="profile" i]',
  '[class*="avatar" i] button',
  // IN structure — circle button with initial top right
  'header button:has([class*="avatar" i])',
  'header button:has([class*="initial" i])',
  // Generic — last button in header nav area
  'header nav button:last-child',
  'header > div button:last-child',
  // The dropdown arrow button next to avatar
  'header button[aria-haspopup]',
  'header button[aria-expanded]',
];

let clicked = false;

for (const selector of profileSelectors) {
  try {
    const btn = this.page.locator(selector).first();
    const box = await btn.boundingBox({ timeout: 1500 }).catch(() => null);

    if (box && box.width > 0 && box.height > 0) {
      // Verify it's in the top-right area (x > 60% of viewport)
      const viewportWidth = this.page.viewportSize()?.width || 1920;
      if (box.x < viewportWidth * 0.5) continue; // skip if not on right side

      console.log(`📍 Profile button found via: ${selector}`);
      console.log(`📍 boundingBox: ${JSON.stringify(box)}`);

      const cx = Math.round(box.x + box.width  / 2);
      const cy = Math.round(box.y + box.height / 2);
      console.log(`🖱️  Clicking at: x=${cx} y=${cy}`);

      await this.page.mouse.move(cx, cy);
      await this.page.waitForTimeout(300);
      await this.page.mouse.click(cx, cy);
      console.log('✅ Profile button clicked');
      clicked = true;
      break;
    }
  } catch {
    // try next
  }
}

if (!clicked) {
  console.log('⚠️  Profile button not found — navigating directly');
  await this.navigateDirectly();
  return;
}

    // ── Wait for My Account link and click ────────────────────
// ── Wait for dropdown to appear after click ───────────────
await this.page.waitForTimeout(200);

// ── Wait for My Account link and click ────────────────────
const myAccountLink = this.page.locator(
  'a[href*="myaccount" i], '        +
  'a:has-text("My Account"), '      +
  'a:has-text("Account"), '         +
  '[data-testid*="myaccount" i], '  +
  'li:has-text("My Account") a, '   +
  '[class*="dropdown" i] a, '       +
  '[class*="menu" i] a[href*="account" i]'
).first();

const linkVisible = await myAccountLink
  .isVisible({ timeout: 5000 })  // ← increase from 3000 to 5000
  .catch(() => false);

    console.log(`🔍 My Account link visible: ${linkVisible}`);

    if (linkVisible) {
      await myAccountLink.click({ force: true });
      console.log('✅ Clicked My Account');
    } else {
      console.log('⚠️  My Account link not visible — navigating directly');
      await this.navigateDirectly();
      return;
    }

    // ── Wait for My Account URL ───────────────────────────────
    try {
      await this.page.waitForURL(/myaccount/i, { timeout: 15000 });
      console.log(`✅ On My Account: ${this.page.url()}`);
    } catch {
      console.log('⚠️  URL did not change — navigating directly');
      await this.navigateDirectly();
    }
  }

  private async navigateDirectly(): Promise<void> {
    const currentUrl   = this.page.url();
    const baseUrlMatch = currentUrl.match(/(https:\/\/www\.dazn\.com\/en-[A-Z]+)/i);
    const cleanBase    = baseUrlMatch?.[1]
                      || this.baseUrl
                      || 'https://www.dazn.com/en-GB';

    console.log(`🔗 Direct navigation to: ${cleanBase}/myaccount`);
    await this.page.goto(`${cleanBase}/myaccount`, {
      waitUntil: 'domcontentloaded',
    });
    await this.page.waitForURL(/myaccount/i, { timeout: 15000 }).catch(() => {});
    await this.page.waitForLoadState('domcontentloaded').catch(() => {});
    console.log(`✅ On My Account: ${this.page.url()}`);
  }

  async dismissPopup(): Promise<void> {
    console.log('🔍 Checking for popups...');
    try {
      // ── Step 1: Try all known dismiss button texts ─────────────
      // Covers: IN app download, promo banners, generic modals
      const dismissSelectors =
        'button:has-text("Maybe later"), '   +
        'button:has-text("Maybe Later"), '   +
        'button:has-text("No thanks"), '     +
        'button:has-text("No Thanks"), '     +
        'button:has-text("Not now"), '       +
        'button:has-text("Not Now"), '       +
        'button:has-text("Close"), '         +
        'button:has-text("Dismiss"), '       +
        'button:has-text("Skip"), '          +
        'button:has-text("Got it"), '        +
        'button:has-text("Got It"), '        +
        'button:has-text("OK"), '            +
        'button:has-text("Cancel"), '        +
        'button:has-text("Done"), '          +
        // IN-specific: app download popup
        'button:has-text("Use web version"), '  +
        'button:has-text("Not interested"), '   +
        'button:has-text("Remind me later"), '  +
        'button:has-text("No, thanks"), '       +
        // Close icon buttons
        '[aria-label="Close"], '             +
        '[aria-label="close"], '             +
        '[aria-label*="close" i], '          +
        '[aria-label*="dismiss" i], '        +
        '[data-testid*="close" i], '         +
        '[data-testid*="dismiss" i], '       +
        // FIX: DAZN PPV promo modal — × close button specifically
        // Target by position: small button in top-right of dialog
        '[role="dialog"] button[class*="close" i], ' +
        '[role="dialog"] button[aria-label*="close" i], ' +
        // Class-based close buttons (not inputs)
        'button[class*="close" i]:not(input), ' +
        'button[class*="dismiss" i]:not(input)';

      // Try up to 3 times — some popups appear after others close
      for (let attempt = 0; attempt < 3; attempt++) {
        const popup = this.page.locator(dismissSelectors).first();

        if (await popup.isVisible({ timeout: attempt === 0 ? 2000 : 1000 }).catch(() => false)) {
          const btnText = await popup.textContent().catch(() => '');
          await popup.click({ force: true });
          await this.page.waitForTimeout(200);
          console.log(`✅ Dismissed popup (attempt ${attempt + 1}): "${btnText?.trim()}"`);

          // Check if another popup appeared
          continue;
        }
        break;
      }

      // ── Step 2: Check for modal/overlay still blocking ─────────
      const modal = this.page.locator(
        '[role="dialog"]:not([aria-hidden="true"]), ' +
        '[role="alertdialog"], '                      +
        '[class*="modal" i]:not([aria-hidden="true"]), ' +
        '[class*="overlay" i]:not([aria-hidden="true"]), ' +
        '[class*="popup" i]:not([aria-hidden="true"]), '   +
        '[class*="drawer" i]:not([aria-hidden="true"])'
      ).first();

      if (await modal.isVisible({ timeout: 1000 }).catch(() => false)) {
        // Try close button inside modal first
        const closeBtn = modal.locator(
          'button[aria-label*="close" i], ' +
          'button[class*="close" i], '      +
          '[data-testid*="close" i]'
        ).first();

        if (await closeBtn.isVisible({ timeout: 500 }).catch(() => false)) {
          await closeBtn.click({ force: true });
          await this.page.waitForTimeout(200);
          console.log('✅ Dismissed modal via close button');
          return;
        }

        // Try last button in modal (usually dismiss/cancel)
        const modalBtn = modal.locator('button').last();
        if (await modalBtn.isVisible({ timeout: 500 }).catch(() => false)) {
          const btnText = await modalBtn.textContent().catch(() => '');
          // Don't click confirm/subscribe/buy buttons
          const dangerous = /confirm|subscribe|buy|pay|upgrade|continue with dazn/i;
          if (!dangerous.test(btnText || '')) {
            await modalBtn.click({ force: true });
            await this.page.waitForTimeout(200);
            console.log(`✅ Dismissed modal via last button: "${btnText?.trim()}"`);
            return;
          }
        }

        // Try Escape key as last resort
        await this.page.keyboard.press('Escape');
        await this.page.waitForTimeout(200);
        console.log('✅ Dismissed modal via Escape');
        return;
      }

      console.log('ℹ️  No popup found');
    } catch {
      console.log('ℹ️  No popup found');
    }
  }
}