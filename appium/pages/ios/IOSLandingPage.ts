import {
  IOSBasePage,
  IOSFlowHooks,
  IOSPPVSurface,
  WdBrowser,
} from './IOSBasePage';
import { holdBannerCarousel } from '../../utils/bannerInteraction';

export interface IOSBannerFlowOptions {
  label: string;
  pageName?: string;
  missingScreenshot: string;
  foundScreenshot: string;
  buyMissingScreenshot: string;
  validateSurface?: IOSPPVSurface;
  immediatePaywall?: boolean;
  keepCarouselLockedForCopy?: boolean;
  recordPage?: string;
  ensureBannerStillVisibleBeforeBuy?: boolean;
  waitForBannerImageBeforeBuy?: boolean;
}

export class IOSLandingPage extends IOSBasePage {
  async openBannerPaywall(options: IOSBannerFlowOptions, hooks: IOSFlowHooks = {}): Promise<boolean> {
    console.log(`${options.label} -> Find PPV banner -> Buy now`);
    console.log(`  Finding PPV banner for "${this.ppvName}" on ${options.pageName || options.label}...`);

    const found = await this.findBannerOnCurrentPage(this.ppvName);
    if (!found) {
      const shot = hooks.saveScreenshot
        ? await hooks.saveScreenshot(options.missingScreenshot)
        : await this.driver.saveScreenshot(options.missingScreenshot)
          .then(() => options.missingScreenshot)
          .catch(() => undefined);
      hooks.recordAvailability?.(false, shot, options.recordPage);
      await hooks.generateAvailabilityFailureReport?.(`PPV banner "${this.ppvName}" not found on ${options.pageName || options.label}`);
      throw new Error(`PPV banner "${this.ppvName}" not found. See ${options.missingScreenshot}`);
    }

    hooks.recordAvailability?.(true, undefined, options.recordPage);
    console.log(`  Verified banner title: "${this.ppvName}"`);
    await this.driver.saveScreenshot(options.foundScreenshot);

    if (options.waitForBannerImageBeforeBuy) {
      await this.waitForBannerImageBeforeBuy();
    }

    if (options.validateSurface) {
      await this.runSurfaceValidation(hooks, options.validateSurface);
    }

    if (options.ensureBannerStillVisibleBeforeBuy) {
      const stillOnPPVBanner = await this.findBannerOnCurrentPage(this.ppvName, {
        horizontalSwipes: 6,
        verticalScrolls: 0,
      });
      if (!stillOnPPVBanner) {
        await this.driver.saveScreenshot(options.buyMissingScreenshot);
        throw new Error(`PPV banner "${this.ppvName}" moved before Buy CTA tap. See ${options.buyMissingScreenshot}`);
      }
    }

    const isUltimateUser = ['active_ultimate_apm', 'active_ultimate_upfront'].includes(String(process.env.USER_STATE || '').toLowerCase().trim());
    const isLoginFirst = String(process.env.LOGIN_FIRST || '').toLowerCase() === 'true';

    if (isUltimateUser && isLoginFirst) {
      console.log('✨ [Ultimate Active User with LOGIN_FIRST=true] PPV banner verified. Skipping Buy click and returning true.');
      return true;
    }

    console.log('  Clicking "Buy now" on the PPV banner...');
    const buyTapped = await this.tapBuyCtaWithFallback();
    if (!buyTapped) {
      await this.driver.saveScreenshot(options.buyMissingScreenshot);
      throw new Error(`Could not tap Buy CTA on PPV banner. See ${options.buyMissingScreenshot}`);
    }

    if (!options.immediatePaywall) {
      await this.driver.pause(3000);
      console.log('  On paywall screen - will capture URL via Copy button');
    } else if (buyTapped && options.keepCarouselLockedForCopy) {
      console.log('  Holding PPV banner while checkout Copy control renders...');
      await holdBannerCarousel(this.driver, this.ppvName);
    }

    return true;
  }

  private async waitForBannerImageBeforeBuy(timeoutMs = 10000): Promise<void> {
    console.log('  Waiting for landing banner image before Buy Now...');
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      const source = await this.driver.getPageSource().catch(() => '');
      if (this.hasBannerImage(source)) {
        console.log(`  ✅ Landing banner image detected after ${Date.now() - startedAt}ms`);
        return;
      }
      await this.driver.pause(1000);
    }

    console.log(`  ⚠️ Landing banner image was not detected within ${timeoutMs}ms; running validation with current UI state.`);
  }

  private hasBannerImage(pageSource: string): boolean {
    return (
      pageSource.includes('XCUIElementTypeImage') ||
      /type="XCUIElementTypeImage"/i.test(pageSource) ||
      /name="[^"]*(image|poster|thumbnail|hero|banner)[^"]*"/i.test(pageSource) ||
      /label="[^"]*(image|poster|thumbnail|hero|banner)[^"]*"/i.test(pageSource)
    );
  }

  async openLandingBannerPaywall(hooks: IOSFlowHooks = {}): Promise<boolean> {
    return this.openBannerPaywall({
      label: 'Landing Page',
      pageName: 'Landing page',
      missingScreenshot: './test-results/ios_landing_ppv_banner_not_found.png',
      foundScreenshot: './test-results/ios_landing_ppv_banner_found.png',
      buyMissingScreenshot: './test-results/ios_landing_buy_cta_not_found.png',
      validateSurface: 'PPV Banner',
      immediatePaywall: true,
      keepCarouselLockedForCopy: true,
      recordPage: 'Landing',
      ensureBannerStillVisibleBeforeBuy: true,
      waitForBannerImageBeforeBuy: true,
    }, hooks);
  }
}

export async function openLandingBannerPaywall(
  driver: WdBrowser,
  ppvName: string,
  hooks: IOSFlowHooks = {},
): Promise<boolean> {
  return new IOSLandingPage(driver, ppvName).openLandingBannerPaywall(hooks);
}
