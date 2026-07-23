import { BannerInteraction } from '../../utils/bannerInteraction';

export type WdBrowser = any;
export type WdElement = any;

export interface IOSScreenSize {
  width: number;
  height: number;
}

export type IOSPPVSurface = 'PPV Banner' | 'PPV Tile';

export interface IOSFlowHooks {
  validateSurface?: (surface: IOSPPVSurface) => Promise<void>;
  validatePaywall?: () => Promise<void>;
  recordAvailability?: (available: boolean, screenshot?: string, page?: string) => void;
  saveScreenshot?: (relativePath: string) => Promise<string | undefined>;
  generateAvailabilityFailureReport?: (errorMessage: string) => Promise<void>;
}

export class IOSBasePage {
  constructor(protected driver: WdBrowser, protected ppvName = process.env.PPV_NAME || 'Joshua') {}

  async findEl(sel: string, timeoutMs = 10000): Promise<WdElement> {
    try {
      const el = await this.driver.$(sel);
      await el.waitForDisplayed({ timeout: timeoutMs });
      return el;
    } catch {
      return null;
    }
  }

  // iOS-specific find helper using predicate string or class chain if prefix matches, or fallback
  async findByText(text: string, timeoutMs = 10000): Promise<WdElement> {
    const sel = `-ios predicate string:label CONTAINS[c] '${text}' OR name CONTAINS[c] '${text}'`;
    return await this.findEl(sel, timeoutMs);
  }

  async tapByText(text: string, timeoutMs = 10000): Promise<boolean> {
    const el = await this.findByText(text, timeoutMs);
    if (!el) return false;
    await el.click();
    return true;
  }

  async tapFirstText(texts: string[], timeoutMs = 6000): Promise<string> {
    for (const text of texts) {
      if (await this.tapByText(text, timeoutMs)) {
        console.log(`Tapped "${text}"`);
        return text;
      }
    }
    return '';
  }

  async isVisible(text: string, timeoutMs = 3000): Promise<boolean> {
    try {
      const sel = `-ios predicate string:label CONTAINS[c] '${text}' OR name CONTAINS[c] '${text}'`;
      const el = await this.driver.$(sel);
      await el.waitForDisplayed({ timeout: timeoutMs });
      return true;
    } catch {
      return false;
    }
  }

  async scrollToText(text: string): Promise<boolean> {
    // On iOS, scroll down using mobile action until text is visible or max swipes reached
    const sel = `-ios predicate string:label CONTAINS[c] '${text}' OR name CONTAINS[c] '${text}'`;
    try {
      for (let i = 0; i < 15; i++) {
        const el = await this.driver.$(sel);
        if (await el.isDisplayed().catch(() => false)) {
          return true;
        }
        await this.scrollDown();
      }
    } catch {}
    return false;
  }

  async swipeLeft(): Promise<void> {
    const { width, height } = await this.driver.getWindowSize();
    await this.driver.action('pointer')
      .move({ x: Math.round(width * 0.8), y: Math.round(height * 0.35) })
      .down()
      .pause(250)
      .move({ x: Math.round(width * 0.2), y: Math.round(height * 0.35) })
      .up()
      .perform();
    await this.driver.pause(1000);
  }

  async scrollDown(): Promise<void> {
    const { width, height } = await this.driver.getWindowSize();
    await this.driver.action('pointer')
      .move({ x: Math.round(width / 2), y: Math.round(height * 0.7) })
      .down()
      .pause(250)
      .move({ x: Math.round(width / 2), y: Math.round(height * 0.3) })
      .up()
      .perform();
    await this.driver.pause(600);
  }

  async findPPVBanner(ppvName = this.ppvName): Promise<boolean> {
    const simplifiedName = ppvName.split(/ vs/i)[0].trim().replace(/\./g, '');
    if (await this.isVisible(simplifiedName, 4000)) return true;
    for (let i = 0; i < 5; i++) {
      await this.swipeLeft();
      if (await this.isVisible(simplifiedName, 1500)) return true;
    }
    if (await this.scrollToText(simplifiedName)) return true;
    for (let i = 0; i < 8; i++) {
      await this.scrollDown();
      if (await this.isVisible(simplifiedName, 1500)) return true;
    }
    return false;
  }

  async findBannerOnCurrentPage(
    ppvName = this.ppvName,
    options: { horizontalSwipes?: number; verticalScrolls?: number } = {},
  ): Promise<boolean> {
    const horizontalSwipes = options.horizontalSwipes ?? 8;
    const verticalScrolls = options.verticalScrolls ?? 5;

    const simplifiedName = ppvName.split(/ vs/i)[0].trim().replace(/\./g, '');

    const isCurrentBannerPPV = async (timeoutMs: number): Promise<boolean> => {
      const titleVisible = await this.isVisible(simplifiedName, timeoutMs);
      if (!titleVisible) return false;
      for (const cta of ['Go to dazn.com/start', 'dazn.com/start', 'dazn.com']) {
        if (await this.isVisible(cta, 200)) return true;
      }
      return false;
    };

    console.log(`  Checking if "${ppvName}" is the active banner...`);
    for (let attempt = 0; attempt < 2; attempt++) {
      if (await isCurrentBannerPPV(500)) return true;
      await this.driver.pause(150);
    }

    console.log(`  PPV banner not immediately visible. Swiping left to find "${ppvName}"...`);
    for (let i = 0; i < horizontalSwipes; i++) {
      await this.swipeLeft();
      if (await isCurrentBannerPPV(150)) return true;
    }

    console.log('  Swiping left exhausted. Trying vertical scroll down...');
    for (let i = 0; i < verticalScrolls; i++) {
      await this.scrollDown();
      if (await isCurrentBannerPPV(150)) return true;
    }

    return false;
  }

  async tapBuyCtaWithFallback(
    ctas = [
      'Go to dazn.com/start',
      'dazn.com/start',
      'dazn.com',
      'Buy now',
      'Buy Now',
      'Buy this fight',
      'Buy',
      'Get PPV',
      'Purchase',
      'Continue',
    ],
    options: { primaryTimeoutMs?: number; fallbackTimeoutMs?: number; scrollBeforeFallback?: boolean } = {},
  ): Promise<boolean> {
    const primaryTimeoutMs = options.primaryTimeoutMs ?? 6000;
    const fallbackTimeoutMs = options.fallbackTimeoutMs ?? 3000;

    const primary = await this.tapFirstText(ctas, primaryTimeoutMs);
    if (primary) return true;

    if (options.scrollBeforeFallback !== false) {
      await this.scrollDown();
      await this.driver.pause(1000);
    }

    const fallback = await this.tapFirstText([
      'Go to dazn.com/start',
      'dazn.com/start',
      'dazn.com',
      'Buy now',
      'Buy Now',
      'Buy',
      'Get PPV',
      'Purchase',
    ], fallbackTimeoutMs);
    return !!fallback;
  }

  async runSurfaceValidation(hooks: IOSFlowHooks | undefined, surface: IOSPPVSurface): Promise<void> {
    if (!hooks?.validateSurface) return;
    try {
      if (surface === 'PPV Banner') {
        const bannerInteraction = new BannerInteraction(this.driver);
        await bannerInteraction.withLock(async () => {
          await hooks.validateSurface!(surface);
        }, this.ppvName);
      } else {
        await hooks.validateSurface(surface);
      }
    } catch (err: any) {
      console.warn(`Mobile ${surface.toLowerCase()} validation failed: ${err.message}`);
    }
  }

  async runPaywallValidation(hooks: IOSFlowHooks | undefined): Promise<void> {
    if (!hooks?.validatePaywall) return;
    try {
      await hooks.validatePaywall();
    } catch (err: any) {
      console.warn(`Mobile paywall validation failed: ${err.message}`);
    }
  }

  isValidCheckoutUrl(url: string): boolean {
    return !!url && (url.includes('dazn.com') || url.includes('amazonaws.com'));
  }

  async captureCheckoutUrl(): Promise<string> {
    try {
      const fs = require('fs');
      if (!fs.existsSync('./test-results')) {
        fs.mkdirSync('./test-results', { recursive: true });
      }
      await this.driver.saveScreenshot("./test-results/alert_screen.png");
      console.log('📸 Saved alert screen screenshot to ./test-results/alert_screen.png');
    } catch (e: any) {
      console.warn('⚠️ Failed to save alert screenshot:', e.message);
    }

    // 1. Try to click native Continue / Open buttons first (visible across apps on active screen)
    let alertHandled = false;
    console.log('🔍 Checking for App Store sheet "Continue" or standard "Open" buttons...');
    for (let attempt = 0; attempt < 5; attempt++) {
      for (const selector of [
        '//XCUIElementTypeButton[@name="Continue"]',
        '~Continue',
        '//XCUIElementTypeButton[@name="Open"]',
        '~Open',
        '//XCUIElementTypeButton[@name="Allow"]',
        '~Allow'
      ]) {
        try {
          const el = await this.driver.$(selector);
          if (await el.isDisplayed().catch(() => false)) {
            await el.click();
            console.log(`✅ Clicked redirect alert button via element locator: ${selector}`);
            alertHandled = true;
            await this.driver.pause(2000);
            break;
          }
        } catch {}
      }
      if (alertHandled) {
        // Wait a bit more and re-check if a second pop-up (e.g. Open) is now visible
        await this.driver.pause(1000);
        for (const selector of ['//XCUIElementTypeButton[@name="Open"]', '~Open']) {
          try {
            const el = await this.driver.$(selector);
            if (await el.isDisplayed().catch(() => false)) {
              await el.click();
              console.log(`✅ Clicked second redirect alert button: ${selector}`);
              await this.driver.pause(2000);
              break;
            }
          } catch {}
        }
        break;
      }
      await this.driver.pause(1000);
    }

    // 2. Fallback: perform precise sequential vertical-sweep coordinate taps
    if (!alertHandled) {
      try {
        const { width, height } = await this.driver.getWindowSize();

        // Step 1: Tap App Store sheet "Continue" (vertically stacked centered button area near bottom)
        const x1 = Math.round(width * 0.5);
        const yOffsets = [110, 140, 170];
        console.log(`📱 Fallback Step 1: Tapping App Store sheet "Continue" area at X=${x1} with Y-sweeps [110, 140, 170]...`);
        for (const offset of yOffsets) {
          const y = height - offset;
          await this.driver.action('pointer')
            .move({ x: x1, y })
            .down()
            .pause(100)
            .up()
            .perform();
          await this.driver.pause(200);
        }

        // Check if Chrome or Safari is already active in the foreground before doing Step 2
        let activeApp = await this.driver.execute('mobile: activeAppInfo').catch(() => null);
        const isBrowserActive = activeApp && (activeApp.bundleId === 'com.google.chrome.ios' || activeApp.bundleId === 'com.apple.mobilesafari');

        if (isBrowserActive) {
          console.log(`📱 Browser ${activeApp.bundleId} is already in the foreground. Skipping Step 2 tap to avoid click interference.`);
        } else {
          // Pause to let any subsequent browser confirmation popup render
          await this.driver.pause(3000);

          // Step 2: Tap "Open" on standard browser confirmation alerts (horizontally aligned right button near middle)
          const x2 = Math.round(width * 0.67);
          const yCenter = Math.round(height * 0.56);
          console.log(`📱 Fallback Step 2: Tapping browser prompt "Open" area at X=${x2} with Y-sweeps around Y=${yCenter}...`);
          for (const y of [yCenter - 15, yCenter, yCenter + 15]) {
            await this.driver.action('pointer')
              .move({ x: x2, y })
              .down()
              .pause(100)
              .up()
              .perform();
            await this.driver.pause(200);
          }
        }

        // Pause to let Safari/Chrome launch and load the deep link naturally
        await this.driver.pause(6000);
      } catch (e: any) {
        console.warn('⚠️ Coordinate tap sequence failed:', e.message);
      }
    }

    // Switch automation context to the active browser app to inspect its UI tree
    let activatedBrowser = '';

    // First, check if Safari or Chrome is already active in the foreground to avoid overriding it
    try {
      const activeApp = await this.driver.execute('mobile: activeAppInfo').catch(() => null);
      if (activeApp && (activeApp.bundleId === 'com.apple.mobilesafari' || activeApp.bundleId === 'com.google.chrome.ios')) {
        console.log(`📱 Browser ${activeApp.bundleId} is already in the foreground. Using it directly.`);
        activatedBrowser = activeApp.bundleId;
      }
    } catch (e: any) {
      console.warn('⚠️ Failed to query activeAppInfo:', e.message);
    }

    // Fallback: if neither browser is detected as active, try to activate Safari first, then Chrome
    if (!activatedBrowser) {
      for (const bundleId of ['com.apple.mobilesafari', 'com.google.chrome.ios']) {
        try {
          await this.driver.activateApp(bundleId);
          console.log(`📱 Fallback Activated browser context: ${bundleId}`);
          activatedBrowser = bundleId;
          await this.driver.pause(3000);
          break;
        } catch (e: any) {
          console.warn(`⚠️ Failed to activate browser app ${bundleId}:`, e.message);
        }
      }
    }

    // Try web context capture first
    for (let attempt = 0; attempt < 8; attempt++) {
      await this.driver.pause(1000);
      try {
        const contexts = await this.driver.getContexts() as string[];
        const webCtx = contexts.find(c =>
          c.includes('WEBVIEW') || (typeof c === 'string' && c !== 'NATIVE_APP')
        );
        if (webCtx) {
          await this.driver.switchContext(webCtx);
          const url = await this.driver.getUrl();
          if (url && url.includes('dazn.com')) return url;
          await this.driver.switchContext('NATIVE_APP').catch(() => {});
        }
      } catch {}
    }

    // Fallback: search all screen elements for any value containing 'dazn.com'
    try {
      await this.driver.switchContext('NATIVE_APP').catch(() => {});
      console.log('🔍 Looking for address bar or URL text in browser elements...');

      // Focus the address bar to expand the full URL in Safari/Chrome
      for (const selector of [
        '~Address and search bar',
        '~Address',
        "//XCUIElementTypeButton[contains(@name, 'Address')]",
        "//XCUIElementTypeTextField[contains(@name, 'Address')]"
      ]) {
        try {
          const el = await this.driver.$(selector);
          if (await el.isDisplayed().catch(() => false)) {
            await el.click();
            await this.driver.pause(1000);
            console.log('📱 Focused browser address bar to expand full URL');
            break;
          }
        } catch {}
      }

      // Save browser layout source for debugging
      const src = await this.driver.getPageSource().catch(() => '');
      const fs = require('fs');
      fs.writeFileSync('./test-results/safari_source.xml', src);
      console.log('📄 Saved browser layout source to ./test-results/safari_source.xml');

      const elements = await this.driver.$$('//XCUIElementTypeTextField | //XCUIElementTypeURLField | //XCUIElementTypeButton');
      for (const el of elements) {
        try {
          const val = await el.getValue().catch(() => '');
          const label = await el.getAttribute('label').catch(() => '');
          const name = await el.getAttribute('name').catch(() => '');
          for (const s of [val, label, name]) {
            if (s && s.includes('dazn.com') && s.includes('/')) {
              // Ensure we return a valid absolute URL format
              let cleanUrl = s.trim();
              if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
                cleanUrl = 'https://' + cleanUrl;
              }
              console.log(`✅ Extracted checkout URL from browser elements: "${cleanUrl}"`);
              return cleanUrl;
            }
          }
        } catch {}
      }
    } catch (e: any) {
      console.warn('⚠️ Error searching browser elements:', e.message);
    }

    return '';
  }
}

export async function findEl(driver: WdBrowser, sel: string, timeoutMs = 10000): Promise<WdElement> {
  return new IOSBasePage(driver).findEl(sel, timeoutMs);
}

export async function tapByText(driver: WdBrowser, text: string, timeoutMs = 10000): Promise<boolean> {
  return new IOSBasePage(driver).tapByText(text, timeoutMs);
}

export async function isVisible(driver: WdBrowser, text: string, timeoutMs = 3000): Promise<boolean> {
  return new IOSBasePage(driver).isVisible(text, timeoutMs);
}

export async function scrollToText(driver: WdBrowser, text: string): Promise<boolean> {
  return new IOSBasePage(driver).scrollToText(text);
}

export async function swipeLeft(driver: WdBrowser): Promise<void> {
  return new IOSBasePage(driver).swipeLeft();
}

export async function scrollDown(driver: WdBrowser): Promise<void> {
  return new IOSBasePage(driver).scrollDown();
}

export async function findPPVBanner(driver: WdBrowser, ppvName: string): Promise<boolean> {
  return new IOSBasePage(driver, ppvName).findPPVBanner(ppvName);
}

export async function captureCheckoutUrl(driver: WdBrowser): Promise<string> {
  return new IOSBasePage(driver).captureCheckoutUrl();
}
