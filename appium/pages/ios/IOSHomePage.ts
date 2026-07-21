import {
  IOSFlowHooks,
  WdBrowser,
} from './IOSBasePage';
import { IOSLandingPage } from './IOSLandingPage';

export class IOSHomePage extends IOSLandingPage {
  async ensureOnHome(): Promise<void> {
    const homeTabSel = '-ios predicate string:(name == "Home" OR label == "Home") AND type == "XCUIElementTypeButton"';
    const homeTab = await this.driver.$(homeTabSel);
    if (await homeTab.isDisplayed().catch(() => false)) {
      console.log('  Already on Home page');
      return;
    }

    const homeClicked = await this.tapByText('Home', 3000);
    if (!homeClicked) {
      console.log('  Could not tap Home by text; trying to click home button locator...');
      await homeTab.click().catch(() => {});
    }
    await this.driver.pause(3000);
  }

  async openHomeBannerPaywall(hooks: IOSFlowHooks = {}, options: { immediatePaywall?: boolean } = {}): Promise<boolean> {
    await this.ensureOnHome();
    await this.driver.pause(2000);

    return this.openBannerPaywall({
      label: 'Home Page',
      pageName: 'Home page',
      missingScreenshot: './test-results/ios_home_ppv_banner_not_found.png',
      foundScreenshot: './test-results/ios_home_ppv_banner_found.png',
      buyMissingScreenshot: './test-results/ios_home_buy_cta_not_found.png',
      validateSurface: 'PPV Banner',
      immediatePaywall: options.immediatePaywall ?? true,
      recordPage: 'Home Page',
    }, hooks);
  }

  async openGenericPPVPaywall(hooks: IOSFlowHooks = {}): Promise<boolean> {
    console.log(`Unknown source fallback - finding "${this.ppvName}" from current screen`);
    const found = await this.findPPVBanner(this.ppvName);
    if (!found) {
      const shot = hooks.saveScreenshot
        ? await hooks.saveScreenshot('./test-results/ios_ppv_not_found.png')
        : undefined;
      hooks.recordAvailability?.(false, shot);
      await hooks.generateAvailabilityFailureReport?.(`PPV "${this.ppvName}" not found`);
      throw new Error(`"${this.ppvName}" not found`);
    }

    hooks.recordAvailability?.(true);
    await this.runSurfaceValidation(hooks, 'PPV Banner');
    await this.tapByText(this.ppvName);
    await this.driver.pause(2000);

    const isUltimateUser = ['active_ultimate_apm', 'active_ultimate_upfront'].includes(String(process.env.USER_STATE || '').toLowerCase().trim());
    const isLoginFirst = String(process.env.LOGIN_FIRST || '').toLowerCase() === 'true';

    if (isUltimateUser && isLoginFirst) {
      console.log('✨ [Ultimate Active User with LOGIN_FIRST=true] Tile clicked (generic). Skipping Buy click and returning true.');
      return true;
    }

    return this.tapBuyCtaWithFallback(['Buy now', 'Buy Now', 'Buy'], { scrollBeforeFallback: false });
  }
}

export async function openHomeBannerPaywall(
  driver: WdBrowser,
  ppvName: string,
  hooks: IOSFlowHooks = {},
  options: { immediatePaywall?: boolean } = {},
): Promise<boolean> {
  return new IOSHomePage(driver, ppvName).openHomeBannerPaywall(hooks, options);
}

export async function openGenericPPVPaywall(
  driver: WdBrowser,
  ppvName: string,
  hooks: IOSFlowHooks = {},
): Promise<boolean> {
  return new IOSHomePage(driver, ppvName).openGenericPPVPaywall(hooks);
}
