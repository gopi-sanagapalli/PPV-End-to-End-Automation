import { Page } from '@playwright/test';
import { LandingPage } from './LandingPage';

export class BoxingPage extends LandingPage {
  constructor(page: Page) {
    super(page);
  }

  // ─────────────────────────────
  // NAVIGATE TO BOXING URL
  // ─────────────────────────────
  override async navigate(baseUrl: string, source?: string): Promise<void> {
    const url = `${baseUrl}/p/boxing`;
    console.log(`🌍 Navigating to Boxing page: ${url}`);
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
    await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => { });
    await this.dismissConsentIfPresent();
    const isStag = url.includes('stag') || (process.env.DAZN_ENV || '').toLowerCase() === 'stag';
    const waitTimeout = isStag ? 2000 : 15000;
    await this.page.waitForSelector(
      'button:has-text("Buy this fight"), button:has-text("Get included")',
      { state: 'visible', timeout: waitTimeout }
    ).catch(() => { });
    console.log(`✅ Landed on: ${this.page.url()}`);
  }

  // ─────────────────────────────
  // FIND BUNDLE SECTION on /boxing page
  // ─────────────────────────────
  async findBundleSection(): Promise<any> {
    console.log('🔍 [Bundle] Looking for bundle section on boxing page...');

    // Scroll down to find the bundle section
    for (let scroll = 0; scroll < 5; scroll++) {
      await this.page.evaluate(() => {
        window.scrollBy(0, 600);
      }).catch(() => { });
      await this.page.waitForTimeout(500);

      // Check if bundle section is visible
      const bundleHeading = this.page.locator('text=/Save with a fight bundle/i').first();
      if (await bundleHeading.isVisible({ timeout: 1000 }).catch(() => false)) {
        console.log('✅ [Bundle] Found "Save with a fight bundle" section');
        break;
      }
    }

    // Wait for Get Started button
    const getStartedBtn = this.page.locator('button:has-text("Get Started"), a:has-text("Get Started")').first();
    await getStartedBtn.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {
      console.log('⚠️  [Bundle] "Get Started" button not found');
    });

    // Find the bundle card container
    const bundleCard = this.page.locator(
      '[class*="bundle" i], [class*="Bundle" i]'
    ).first();

    if (await bundleCard.isVisible({ timeout: 3000 }).catch(() => false)) {
      console.log('✅ [Bundle] Bundle card found');
      return bundleCard;
    }

    // Fallback: return the section containing the Get Started button
    if (await getStartedBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      console.log('✅ [Bundle] Returning section with Get Started button');
      return this.page.locator('body').first();
    }

    console.log('⚠️  [Bundle] Bundle section not found');
    return null;
  }

  override async findPPVContainer(eventData: Record<string, string>, source?: string): Promise<any> {
    if (source && (source.startsWith('boxing-bundle') || source.startsWith('boxing-page-bundle'))) {
      return this.findBundleSection();
    }
    return this.page.locator('body').first();
  }

  override async clickBuyNow(container: any, source?: string): Promise<void> {
    if (!container) {
      throw new Error('❌ No PPV container found — cannot click Buy Now');
    }

    console.log(`💳 Clicking Boxing CTA via source: ${source}...`);
    await this.stopCarouselAutoSlide();
    await this.dismissConsentIfPresent();

    let btn;
    if (source === 'boxing-bundle' || source === 'boxing-page-bundle' || source === 'boxing-bundle-ultimate') {
      if (source === 'boxing-bundle-ultimate') {
        // Look for container with Ultimate text and find its Get Started button
        const ultimateBtn = this.page.locator('div:has-text("Ultimate"), [class*="ultimate" i]')
          .locator('button:has-text("Get Started"), a:has-text("Get Started")')
          .first();
        if (await ultimateBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
          btn = ultimateBtn;
        } else {
          const btns = this.page.locator('button:has-text("Get Started"), a:has-text("Get Started")');
          if (await btns.count().catch(() => 0) > 1) {
            btn = btns.nth(1);
          } else {
            btn = btns.first();
          }
        }
      } else {
        btn = this.page.locator('button:has-text("Get Started"), a:has-text("Get Started")').first();
      }
    } else {
      let btnSelector = '';
      if (source === 'boxing-buy' || source === 'boxing-page-banner') {
        btnSelector = 'button:has-text("Buy this fight"), a:has-text("Buy this fight")';
      } else if (source === 'boxing-ultimate') {
        btnSelector = 'button:has-text("Get included in DAZN Ultimate"), a:has-text("Get included in DAZN Ultimate")';
      }
      btn = this.page.locator(btnSelector).first();
    }

    const isBtnVisible = await btn.isVisible({ timeout: 2000 }).catch(() => false);
    if (!isBtnVisible) {
      const isStag = this.page.url().includes('stag') || (process.env.DAZN_ENV || '').toLowerCase() === 'stag';
      if (isStag) {
        throw new Error(`❌ STAGING FAST FAIL: Boxing PPV banner not available on staging environment.`);
      }
      throw new Error(`❌ Boxing CTA button not visible on page (source: ${source})`);
    }

    await btn.waitFor({ state: 'visible', timeout: 5000 }).catch(async () => {
      await btn.scrollIntoViewIfNeeded().catch(() => { });
      await this.page.waitForTimeout(500);
    });

    await btn.scrollIntoViewIfNeeded().catch(() => { });
    await this.page.waitForTimeout(300);

    const beforeUrl = this.page.url();

    try {
      await btn.click({ force: true, timeout: 5000 });
    } catch {
      console.log('⚠️  Click intercepted → forcing JS click');
      const handle = await btn.elementHandle({ timeout: 2000 });
      if (!handle) throw new Error('❌ Boxing CTA element handle not found');
      await this.page.evaluate((el: any) => el.click(), handle);
    }

    console.log(`✅ Clicked Boxing CTA`);
    await this.page.waitForLoadState('domcontentloaded').catch(() => { });

    const newUrl = this.page.url();
    console.log(`✅ Navigated to: ${newUrl}`);

    // Verify navigation
    if (newUrl !== beforeUrl && !newUrl.includes('ppv') &&
      !newUrl.includes('contextualPpv') && !newUrl.includes('signup')) {
      console.log(`⚠️  WARNING: Unexpected URL: ${newUrl}`);
    }
  }
}
