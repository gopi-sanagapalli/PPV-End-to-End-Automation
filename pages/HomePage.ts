import { Page } from '@playwright/test';
import { LandingPage } from './LandingPage';

export class HomePage extends LandingPage {
  protected baseUrl: string;

  constructor(page: Page, baseUrl: string = '') {
    super(page);
    this.baseUrl = baseUrl;
  }

  // Navigation for home-page flows
  override async navigate(baseUrl: string, source?: string, eventData?: Record<string, string>): Promise<void> {
    const welcomeUrl = `${baseUrl}/welcome`;
    console.log(`🌍 [HomePage] Navigating to Welcome page: ${welcomeUrl}`);
    await this.page.goto(welcomeUrl, { waitUntil: 'domcontentloaded' });
    await this.page.waitForLoadState('domcontentloaded', { timeout: 1000 }).catch(() => { });



    console.log(`✅ [HomePage] Welcome page loaded: ${this.page.url()}`);
    await this.clickExplore();

    console.log(`✅ [HomePage] Home page loaded: ${this.page.url()}`);

    // Wait for the hero banner or swiper component to render and be visible
    const bannerLocator = this.page.locator('main [class*="banner"], [class*="hero-banner-slider"], .swiper').first();
    await bannerLocator.waitFor({ state: 'visible', timeout: 10000 }).catch((e) => {
      console.log('⚠️ [HomePage] Timeout waiting for hero banner/swiper: ' + e.message);
    });
  }

  private async clickExplore(): Promise<void> {
    console.log('🔍 Looking for "Explore" button on welcome page...');

    const exploreSelectors = [
      'a:has-text("Explore")',
      'button:has-text("Explore")',
      'a[href*="/home" i]',
      'a:has-text("Explore DAZN")',
      'a:has-text("Explore without subscribing")',
      'a:has-text("Explore for free")',
      '[class*="explore" i]',
    ];

    const combinedSelector = exploreSelectors.join(', ');
    const anyExplore = this.page.locator(combinedSelector).first();
    const found = await anyExplore.waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false);

    if (found) {
      console.log(`📍 Found Explore button`);
      await anyExplore.scrollIntoViewIfNeeded().catch(() => { });
      await anyExplore.click({ force: true });
      await this.page.waitForURL((url: URL) => url.toString().includes('/home'), { timeout: 15000 }).catch(() => { });
    } else {
      console.log('⚠️ Explore button not found — trying direct navigation to /home');
      const currentUrl = this.page.url();
      const baseMatch = currentUrl.match(/(https:\/\/[a-z0-9.-]*dazn\.com\/en-[A-Z]+)/i);
      const base = baseMatch?.[1] || this.getFallbackBaseUrl();
      await this.page.goto(`${base}/home`, { waitUntil: 'domcontentloaded' });
    }

    await this.page.waitForLoadState('domcontentloaded').catch(() => { });
  }

  // Find container logic:
  // For home-page-banner: uses LandingPage.findPPVInBanner
  // For home-page-dont-miss: finds tile, clicks it to open modal, and returns the modal popup!
  override async findPPVContainer(eventData: Record<string, string>, source?: string): Promise<any> {
    const src = (source || '').toLowerCase();

    if (src === 'home-page-banner') {
      return super.findPPVInBanner(eventData);
    }

    if (src === 'home-page-dont-miss') {
      console.log('🔍 [HomePage Tile] Flow: Tile + Modal popup flow');

      // 1. Scroll to section heading
      const sectionPattern = /don.t miss/i;
      const railHeader = this.page.getByText(sectionPattern).first();

      let foundHeading = false;
      for (let i = 0; i < 8; i++) {
        if (await railHeader.isVisible().catch(() => false)) {
          foundHeading = true;
          break;
        }
        const scrollPos = (i + 1) * 800;
        await this.page.evaluate((pos) => {
          window.scrollTo({ top: pos, behavior: 'instant' });
        }, scrollPos).catch(() => { });

        foundHeading = await railHeader.waitFor({ state: 'attached', timeout: 200 }).then(() => true).catch(() => false);
        if (foundHeading) break;
      }

      if (!foundHeading) {
        throw new Error(`❌ [HomePage Tile] "Don't Miss" rail heading not found in DOM`);
      }

      await railHeader.scrollIntoViewIfNeeded().catch(() => { });
      console.log(`✅ [HomePage Tile] Section heading is visible`);

      // 2. Locate rail wrapper
      const railWrapper = railHeader.locator('xpath=ancestor::*[contains(@class,"rail__rail-wrapper")][1] | ancestor::section[contains(@class,"rail")][1] | ancestor::div[contains(@class,"rail")][1] | ancestor::*[contains(@class,"railWrapper")][1]');
      await railWrapper.waitFor({ state: 'visible', timeout: 10000 }).catch(() => { });
      console.log('✅ [HomePage Tile] Found rail wrapper');

      // 3. Build search parameters for tile (same as LandingPage.ts)
      const ppvName = eventData.PPV_NAME || '';
      const vsMatch = ppvName.match(/(\w+)\s+vs\.?\s+(\w+)/i);
      const fighter1 = vsMatch ? vsMatch[1] : '';
      const fighter2 = vsMatch ? vsMatch[2] : '';
      console.log(`🔍 [HomePage Tile] Searching tile for event: "${ppvName}" (fighter1="${fighter1}", fighter2="${fighter2}")`);

      const cleanStr = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
      const nameParts = ppvName.split(/[:\-–]/).map(p => p.trim()).filter(p => p.length > 3);
      const partsWordLists = nameParts.map(part => cleanStr(part).split(/\s+/).filter(Boolean)).filter(list => list.length > 0);

      const matchesTileText = (text: string): boolean => {
        const ct = cleanStr(text);
        const matchTitle = partsWordLists.some(words => words.every(w => ct.includes(w)));
        const matchFighters = !!(fighter1 && fighter2 && ct.includes(fighter1.toLowerCase()) && ct.includes(fighter2.toLowerCase()));
        return matchTitle || matchFighters;
      };

      const exclusions = [
        'press conference', 'weigh-in', 'workout', 'replay', 'highlights',
        'preview', 'promo', 'interview', 'behind the scenes', 'episode',
        'documentary', 'face off'
      ];
      const exclusionSelector = exclusions.map(term => `:not([alt*="${term}" i])`).join('');

      let imgSelector = '';
      if (fighter1 && fighter2) {
        imgSelector = `img[alt*="${fighter1}" i][alt*="${fighter2}" i]${exclusionSelector}:not(.swiper-slide-duplicate img)`;
      } else if (fighter1) {
        imgSelector = `img[alt*="${fighter1}" i]${exclusionSelector}:not(.swiper-slide-duplicate img)`;
      } else {
        imgSelector = `img[alt*="${ppvName}" i]${exclusionSelector}:not(.swiper-slide-duplicate img)`;
      }

      const ppvImg = railWrapper.locator(imgSelector).first();
      const ppvTileLink = ppvImg.locator('xpath=ancestor::a[1]');

      const isTileInView = async (): Promise<any> => {
        // First check candidates by text
        const tileCandidates = railWrapper.locator('a[class*="tile__link" i], a[class*="tile" i], div[class*="tile" i], div[class*="card" i], a, button');
        const candidateCount = await tileCandidates.count().catch(() => 0);

        let bestTile: any = null;
        let bestScore = 0;

        for (let i = 0; i < candidateCount; i++) {
          const tile = tileCandidates.nth(i);
          if (await tile.isVisible().catch(() => false)) {
            const text = await tile.textContent().catch(() => '');
            if (text && matchesTileText(text)) {
              const inView = await tile.evaluate((el: HTMLElement) => {
                const r = el.getBoundingClientRect();
                return r.width > 0 && r.right > 0 && r.left < window.innerWidth;
              }).catch(() => false);
              if (inView) {
                const score = this.scorePPVMatch(text, ppvName);
                if (score > bestScore) {
                  bestScore = score;
                  bestTile = tile;
                }
              }
            }
          }
        }

        if (bestTile) {
          const tileText = await bestTile.textContent().catch(() => '');
          console.log(`✅ [HomePage Tile] Best matching tile (score=${bestScore}): "${(tileText || '').trim().replace(/\s+/g, ' ').substring(0, 80)}"`);
          return bestTile;
        }

        // Fallback to image alt matching
        for (let retry = 0; retry < 2; retry++) {
          const imgCount = await ppvImg.count().catch(() => 0);
          if (imgCount === 0) {
            if (retry === 0) {
              await this.page.waitForTimeout(100);
              continue;
            }
            break;
          }
          const inView = await ppvImg.evaluate((el: HTMLElement) => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.right > 0 && r.left < window.innerWidth;
          }).catch(() => false);
          if (inView) {
            return ppvTileLink;
          }
        }
        return null;
      };

      const nextBtn = railWrapper.locator([
        'button[aria-label="Next slide"]',
        'button[class*="swiper-button-next"]',
        '.custom-swiper-button-next',
        '[class*="next" i]',
      ].join(', ')).first();

      await nextBtn.waitFor({ state: 'attached', timeout: 5000 }).catch(() => {
        console.log('⚠️ [HomePage Tile] Swiper next button not attached after 5s');
      });

      await railWrapper.hover({ force: true }).catch(() => { });
      await this.page.waitForTimeout(100);

      let clicks = 0;
      const maxClicks = 30;
      let found = await isTileInView();

      while (!found && clicks < maxClicks) {
        if (this.page.isClosed()) throw new Error('Page closed during swiper navigation');

        const nextDisabled = await nextBtn.evaluate((el: Element) => {
          return el.classList.contains('swiper-button-disabled') ||
            el.classList.contains('rail-module__disable') ||
            el.className.includes('disable') ||
            el.hasAttribute('disabled');
        }).catch(() => false);

        if (nextDisabled) {
          console.log('⚠️ [HomePage Tile] Next button disabled — end of rail reached');
          break;
        }

        let nextCount = await nextBtn.count().catch(() => 0);
        if (nextCount === 0) {
          await this.page.waitForTimeout(100);
          nextCount = await nextBtn.count().catch(() => 0);
          if (nextCount === 0) {
            console.log('⚠️ [HomePage Tile] Next button not found in DOM after retry');
            break;
          }
        }

        await nextBtn.click({ timeout: 5000, force: true }).catch((e: any) => {
          console.log('⚠️ Next click error:', e.message);
        });
        clicks++;

        await this.page.waitForTimeout(250);
        found = await isTileInView();
      }

      console.log(`✅ [HomePage Tile] Swiper "Next" clicks performed: ${clicks}`);

      if (!found && (await ppvImg.count()) > 0) {
        console.log('🔍 [HomePage Tile] Tile in DOM but not visible — scrolling into view');
        await ppvImg.scrollIntoViewIfNeeded().catch(() => { });
        await this.page.waitForTimeout(150);
        found = await isTileInView();
      }

      if (!found) {
        const dump = await railWrapper.evaluate((el: HTMLElement) => {
          const imgs = Array.from(el.querySelectorAll('img')).slice(0, 20).map((img: HTMLImageElement) => ({
            alt: img.alt,
            src: img.src?.substring(0, 80),
            w: img.width,
            h: img.height,
          }));
          return {
            nextDisabled: el.querySelector('button[aria-label="Next slide"]')?.classList.contains('swiper-button-disabled'),
            imgs,
          };
        }).catch(() => null);

        console.log('=== RAIL DEBUG ===');
        console.log('Next disabled:', dump?.nextDisabled);
        console.log('Images:', JSON.stringify(dump?.imgs, null, 2));
        throw new Error(`❌ [HomePage Tile] Could not find "${fighter1 || ppvName}" tile in "Don't Miss" rail after ${clicks} clicks`);
      }

      console.log(`📌 [HomePage Tile] Found PPV tile, clicking to open modal...`);
      await found.scrollIntoViewIfNeeded().catch(() => { });
      await this.page.waitForTimeout(150);

      const beforeUrl = this.page.url();
      try {
        await found.click({ force: true, timeout: 10000 });
        console.log(`✅ [HomePage Tile] Clicked PPV tile`);
      } catch (e: any) {
        console.log('⚠️ Standard click failed → trying JS click');
        const handle = await found.elementHandle();
        if (handle) {
          await this.page.evaluate((el: any) => el.click(), handle);
          console.log(`✅ [HomePage Tile] JS click executed on PPV tile`);
        } else {
          throw new Error('❌ PPV tile click failed: ' + e.message);
        }
      }

      let modal: any = null;
      for (let attempt = 0; attempt < 15; attempt++) {
        if (this.page.url() !== beforeUrl) {
          console.log(`✅ [HomePage Tile] Tile click navigated to: ${this.page.url()}`);
          return this.page.locator('body');
        }
        modal = await this.waitForModal();
        if (modal) {
          break;
        }
        await this.page.waitForTimeout(150);
      }

      if (!modal) {
        throw new Error('❌ [HomePage Tile] Modal popup did not appear after clicking tile');
      }

      console.log(`✅ [HomePage Tile] Modal popup found`);
      return modal;
    }

    // For home-page-get-started: locate the "Get Started" CTA on the welcome/home page
    if (src === 'home-page-get-started') {
      console.log('🔍 [HomePage] Finding "Get Started" CTA (preferring header)...');
      
      // Look in header first to trigger default signup flow without event context
      let getStartedBtn = this.page.locator([
        'header a:has-text("Get started")',
        'header button:has-text("Get started")',
        'header a:has-text("Sign up")',
        'header button:has-text("Sign up")',
        '[class*="header" i] a:has-text("Get started")',
        '[class*="header" i] button:has-text("Get started")',
        '[class*="header" i] a:has-text("Sign up")',
        '[class*="header" i] button:has-text("Sign up")'
      ].join(', ')).first();

      let found = await getStartedBtn.waitFor({ state: 'visible', timeout: 3000 })
        .then(() => true)
        .catch(() => false);

      if (found) {
        console.log('✅ [HomePage] Found "Get Started" CTA in header');
        return getStartedBtn;
      }

      console.log('⚠️ [HomePage] Header "Get Started" CTA not visible — trying page-wide search');
      getStartedBtn = this.page.locator(
        'button:has-text("Get started "), a:has-text("Get started"), ' +
        'button:has-text("Get started"), a:has-text("Get started")'
      ).first();

      found = await getStartedBtn.waitFor({ state: 'visible', timeout: 12000 })
        .then(() => true)
        .catch(() => false);

      if (!found) {
        // Scroll down to find it if not immediately visible
        for (let i = 1; i <= 5; i++) {
          await this.page.evaluate((pos: number) => {
            window.scrollTo({ top: pos, behavior: 'instant' });
          }, i * 600).catch(() => { });
          const visible = await getStartedBtn.isVisible().catch(() => false);
          if (visible) break;
        }
      }

      if (!(await getStartedBtn.isVisible().catch(() => false))) {
        throw new Error('❌ [HomePage] "Get Started" CTA not found on welcome/home page');
      }

      console.log('✅ [HomePage] "Get Started" CTA found');
      return getStartedBtn;
    }

    // Strict source validation — no cross-source fallback
    throw new Error(
      `❌ PPV not found in expected source: "${source || 'unknown'}". ` +
      `No fallback search will be attempted. Valid sources: home-page-banner, home-page-dont-miss, home-page-get-started.`
    );
  }

  private async waitForModal(): Promise<any> {
    const modalSelectors = [
      '[role="dialog"]',
      '[class*="modal" i]',
      '[class*="popup" i]',
      '[aria-modal="true"]',
      '[class*="overlay" i]',
    ];

    for (const selector of modalSelectors) {
      const modal = this.page.locator(selector).first();
      if (await modal.isVisible().catch(() => false)) {
        const hasBtn = await modal.locator('button, a').first().isVisible().catch(() => false);
        if (hasBtn) {
          return modal;
        }
      }
    }
    return null;
  }

  // Click Buy Now logic:
  // For home-page-banner: uses LandingPage clickBuyNow (direct banner navigation)
  // For home-page-dont-miss: clicks Buy Now inside the modal popup
  override async clickBuyNow(container: any, source?: string): Promise<void> {
    const src = (source || '').toLowerCase();

    if (src === 'home-page-banner') {
      await super.clickBuyNow(container, 'banner');
      return;
    }

    if (src === 'home-page-get-started') {
      console.log('🖱️ [HomePage] Clicking "Get Started" CTA...');
      if (!container) {
        throw new Error('❌ [HomePage] Get Started container is null');
      }
      await container.scrollIntoViewIfNeeded().catch(() => { });
      await container.click({ force: true, timeout: 10000 });
      console.log('✅ [HomePage] Clicked "Get Started" CTA');
      return;
    }

    if (src === 'home-page-dont-miss') {
      console.log('💳 [HomePage Tile] Clicking "Buy now" in modal popup...');

      if (!container) {
        throw new Error('❌ [HomePage Tile] Modal container is null');
      }

      const dialog = container.locator('[role="dialog"], [aria-modal="true"], [class*="modal" i]').first();
      let buyNowBtn = dialog
        .locator('button:has-text("Buy now"), a:has-text("Buy now"), button:has-text("Buy Now")')
        .first();

      let visible = await buyNowBtn.isVisible({ timeout: 2000 }).catch(() => false);
      if (!visible) {
        console.log('⏳ [HomePage Tile] Dialog selector not active. Trying generic container check...');
        buyNowBtn = container
          .locator('button:has-text("Buy now"), a:has-text("Buy now"), button:has-text("Buy Now")')
          .first();
        visible = await buyNowBtn.isVisible({ timeout: 2000 }).catch(() => false);
      }

      if (!visible) {
        console.log('⏳ [HomePage Tile] Waiting for Buy now button in modal...');
        await this.page.waitForTimeout(1000);
        visible = await buyNowBtn.isVisible({ timeout: 3000 }).catch(() => false);
      }

      if (!visible) {
        console.log('🔍 [HomePage Tile] Searching entire page for Buy now...');
        const pageBuyNow = this.page.locator(
          'button:has-text("Buy now"), a:has-text("Buy now"), button:has-text("Buy Now")'
        ).first();
        if (await pageBuyNow.isVisible({ timeout: 3000 }).catch(() => false)) {
          console.log(`✅ [HomePage Tile] Found Buy now on page`);
          await pageBuyNow.click({ force: true, timeout: 8000 });
          return;
        }
        throw new Error('❌ [HomePage Tile] Buy now button not found/visible inside modal popup or page');
      }

      await buyNowBtn.click({ force: true, timeout: 8000 });
      console.log('✅ [HomePage Tile] Clicked Buy now in modal');
      return;
    }

    await super.clickBuyNow(container, source);
  }

  // --- EXISTING METHODS PRESERVED FOR BACKWARD COMPATIBILITY ---

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

          const cx = Math.round(box.x + box.width / 2);
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

    // ── Wait for dropdown to appear after click ───────────────
    await this.page.waitForTimeout(200);

    // ── Wait for My Account link and click ────────────────────
    const myAccountLink = this.page.locator(
      'a[href*="myaccount" i], ' +
      'a:has-text("My Account"), ' +
      'a:has-text("Account"), ' +
      '[data-testid*="myaccount" i], ' +
      'li:has-text("My Account") a, ' +
      '[class*="dropdown" i] a, ' +
      '[class*="menu" i] a[href*="account" i]'
    ).first();

    const linkVisible = await myAccountLink
      .isVisible({ timeout: 5000 })
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

  private getFallbackBaseUrl(): string {
    const env = (process.env.DAZN_ENV || 'stag').toLowerCase();
    const region = (process.env.DAZN_REGION || 'GB').toUpperCase();
    let domain = 'stag.dazn.com';
    if (env === 'beta') domain = 'beta.dazn.com';
    if (env === 'prod') domain = 'www.dazn.com';
    return `https://${domain}/en-${region}`;
  }

  private async navigateDirectly(): Promise<void> {
    const currentUrl = this.page.url();
    const baseUrlMatch = currentUrl.match(/(https:\/\/[a-z0-9.-]*dazn\.com\/en-[A-Z]+)/i);
    const cleanBase = baseUrlMatch?.[1]
      || this.baseUrl
      || this.getFallbackBaseUrl();

    console.log(`🔗 Direct navigation to: ${cleanBase}/myaccount`);
    await this.page.goto(`${cleanBase}/myaccount`, {
      waitUntil: 'domcontentloaded',
    });
    await this.page.waitForURL(/myaccount/i, { timeout: 15000 }).catch(() => { });
    await this.page.waitForLoadState('domcontentloaded').catch(() => { });
    console.log(`✅ On My Account: ${this.page.url()}`);
  }

  async dismissPopup(): Promise<void> {
    console.log('🔍 Checking for popups...');
    try {
      const dismissSelectors =
        'button:has-text("Maybe later"), ' +
        'button:has-text("Maybe Later"), ' +
        'button:has-text("No thanks"), ' +
        'button:has-text("No Thanks"), ' +
        'button:has-text("Not now"), ' +
        'button:has-text("Not Now"), ' +
        'button:has-text("Close"), ' +
        'button:has-text("Dismiss"), ' +
        'button:has-text("Skip"), ' +
        'button:has-text("Got it"), ' +
        'button:has-text("Got It"), ' +
        'button:has-text("OK"), ' +
        'button:has-text("Cancel"), ' +
        'button:has-text("Done"), ' +
        'button:has-text("Use web version"), ' +
        'button:has-text("Not interested"), ' +
        'button:has-text("Remind me later"), ' +
        'button:has-text("No, thanks"), ' +
        '[aria-label="Close"], ' +
        '[aria-label="close"], ' +
        '[aria-label*="close" i], ' +
        '[aria-label*="dismiss" i], ' +
        '[data-testid*="close" i], ' +
        '[data-testid*="dismiss" i], ' +
        '[role="dialog"] button[class*="close" i], ' +
        '[role="dialog"] button[aria-label*="close" i], ' +
        'button[class*="close" i]:not(input), ' +
        'button[class*="dismiss" i]:not(input)';

      for (let attempt = 0; attempt < 3; attempt++) {
        const popup = this.page.locator(dismissSelectors).first();

        if (await popup.isVisible({ timeout: attempt === 0 ? 2000 : 1000 }).catch(() => false)) {
          const btnText = await popup.textContent().catch(() => '');
          await popup.click({ force: true });
          await this.page.waitForTimeout(200);
          console.log(`✅ Dismissed popup (attempt ${attempt + 1}): "${btnText?.trim()}"`);
          continue;
        }
        break;
      }

      const modal = this.page.locator(
        '[role="dialog"]:not([aria-hidden="true"]), ' +
        '[role="alertdialog"], ' +
        '[class*="modal" i]:not([aria-hidden="true"]), ' +
        '[class*="overlay" i]:not([aria-hidden="true"]), ' +
        '[class*="popup" i]:not([aria-hidden="true"]), ' +
        '[class*="drawer" i]:not([aria-hidden="true"])'
      ).first();

      if (await modal.isVisible({ timeout: 1000 }).catch(() => false)) {
        const closeBtn = modal.locator(
          'button[aria-label*="close" i], ' +
          'button[class*="close" i], ' +
          '[data-testid*="close" i]'
        ).first();

        if (await closeBtn.isVisible({ timeout: 500 }).catch(() => false)) {
          await closeBtn.click({ force: true });
          await this.page.waitForTimeout(200);
          console.log('✅ Dismissed modal via close button');
          return;
        }

        const modalBtn = modal.locator('button').last();
        if (await modalBtn.isVisible({ timeout: 500 }).catch(() => false)) {
          const btnText = await modalBtn.textContent().catch(() => '');
          const dangerous = /confirm|subscribe|buy|pay|upgrade|continue with dazn/i;
          if (!dangerous.test(btnText || '')) {
            await modalBtn.click({ force: true });
            await this.page.waitForTimeout(200);
            console.log(`✅ Dismissed modal via last button: "${btnText?.trim()}"`);
            return;
          }
        }

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