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
  private static readonly safariCookieConsentHandledDrivers = new WeakSet<object>();

  constructor(protected driver: WdBrowser, protected ppvName = process.env.PPV_NAME || 'Joshua') { }

  protected async browserText(): Promise<string> {
    return this.driver.execute(() => document.body?.innerText || '').catch(() => '');
  }

  protected async browserFirstVisible(selectors: string[]): Promise<WdElement | null> {
    for (const selector of selectors) {
      try {
        const elements = await this.driver.$$(selector);
        for (const element of elements) {
          if (await element.isDisplayed().catch(() => false)) return element;
        }
      } catch { }
    }
    return null;
  }

  /**
   * Dismiss the DAZN OneTrust banner in a Safari/WKWebView context.
   * Every iOS page object inherits this so any browser handoff can call the
   * same behaviour immediately after its navigation.
   */
  async handleSafariCookies(timeoutMs = 20000): Promise<void> {
    const driverKey = this.driver as object;
    const alreadyHandled = IOSBasePage.safariCookieConsentHandledDrivers.has(driverKey);
    const effectiveTimeout = alreadyHandled ? Math.min(timeoutMs, 2000) : timeoutMs;
    const acceptSelectors = [
      // OneTrust expanded preference centre. Prefer the explicit "Accept
      // All" control; it is different from the first-layer banner button.
      '#accept-recommended-btn-handler',
      '#onetrust-accept-btn-handler',
      '[data-testid="accept-all"]',
      'button*=Accept All',
      '#onetrust-pc-sdk .save-preference-btn-handler',
      'button*=Confirm My Choices',
      'button[aria-label="Accept"]',
      '//button[normalize-space(.)="Accept"]',
      'button*=Accept',
      '[role="button"]*=Accept',
    ];
    const consentCopy = /select your cookie preferences|essential cookies only|manage preferences|privacy preference center|cookie list|list of partners/i;
    const isConsentOverlayVisible = async (): Promise<boolean> => this.driver.execute(() => {
      const overlay = document.querySelector<HTMLElement>(
        '#onetrust-banner-sdk, #onetrust-consent-sdk, #onetrust-pc-sdk, .onetrust-pc-dark-filter'
      );
      if (!overlay) return false;
      const style = window.getComputedStyle(overlay);
      const box = overlay.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' &&
        style.opacity !== '0' && box.width > 0 && box.height > 0;
    }).catch(() => false);
    const waitForConsentToClose = async (): Promise<void> => {
      await this.driver.waitUntil(async () => !(await isConsentOverlayVisible()), {
        timeout: 8000,
        timeoutMsg: 'DAZN cookie banner remained visible after clicking Accept.',
      });
      IOSBasePage.safariCookieConsentHandledDrivers.add(driverKey);
      await this.driver.pause(500);
      console.log('✅ DAZN cookie banner is hidden.');
    };
    const deadline = Date.now() + effectiveTimeout;
    let consentWasSeen = false;

    while (Date.now() < deadline) {
      const accept = await this.browserFirstVisible(acceptSelectors);
      const consentIsVisible = consentCopy.test(await this.browserText());
      if (accept) {
        consentWasSeen = true;
        await accept.scrollIntoView().catch(() => {});
        const clickedByUi = await accept.click().then(() => true).catch(() => false);
        if (!clickedByUi) {
          const clickedByDom = await this.driver.execute(() => {
            const button = document.querySelector<HTMLElement>('#accept-recommended-btn-handler, #onetrust-accept-btn-handler')
              || Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"]'))
                .find(element => ['accept all', 'accept', 'confirm my choices'].includes((element.innerText || element.textContent || '').trim().toLowerCase()));
            if (!button) return false;
            button.click();
            return true;
          }).catch(() => false);
          if (!clickedByDom) {
            await this.driver.pause(250);
            continue;
          }
          console.log('🍪 Accepted cookies via DOM-click fallback.');
        } else {
          console.log('🍪 Accepted cookies via #onetrust-accept-btn-handler.');
        }

        await waitForConsentToClose();
        return;
      }

      // On some iOS Safari sessions the visible "Accept" control is rendered
      // in the page but is not returned by WebDriver's element query. Only
      // use the DOM fallback while an actual OneTrust overlay is visible, and
      // verify that the overlay closes before letting the journey continue.
      const overlayVisible = consentIsVisible || await isConsentOverlayVisible();
      const clickedWelcomeAccept = overlayVisible && await this.driver.execute(() => {
        const button = document.querySelector<HTMLElement>('#accept-recommended-btn-handler, #onetrust-accept-btn-handler')
          || Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"]'))
            .find(element => ['accept all', 'accept', 'confirm my choices'].includes(
              (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase(),
            ));
        if (!button) return false;
        button.click();
        return true;
      }).catch(() => false);
      if (clickedWelcomeAccept) {
        console.log('🍪 Accepted Safari Welcome cookies via DOM fallback.');
        await waitForConsentToClose();
        return;
      }

      if (consentIsVisible) consentWasSeen = true;
      await this.driver.pause(250);
    }

    if (consentWasSeen) {
      await this.driver.saveScreenshot('./test-results/ios_safari_cookie_consent_not_actionable.png').catch(() => {});
      throw new Error('DAZN cookie consent was displayed but its Accept button was not actionable.');
    }
    console.log('ℹ️ No DAZN cookie consent was shown in Safari.');
  }

  /**
   * Reset the per-session cookie-consent cache so the next call to
   * handleSafariCookies() gets the full timeout. Call this whenever the flow
   * navigates to a new URL that may show the OneTrust banner again.
   */
  resetCookieConsentCache(): void {
    IOSBasePage.safariCookieConsentHandledDrivers.delete(this.driver as object);
  }

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
    } catch { }
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
    try {
      const hostname = new URL(url).hostname.toLowerCase();
      return hostname === 'dazn.com' || hostname.endsWith('.dazn.com') || hostname.endsWith('.amazonaws.com');
    } catch {
      return false;
    }
  }

  private isSafariHandoffLandingUrl(url: string): boolean {
    if (!this.isValidCheckoutUrl(url)) return false;
    try {
      const pathname = new URL(url).pathname.toLowerCase();
      // Only a DAZN landing route represents the webview just created by the
      // external-website handoff. Account/search/checkout routes can belong
      // to Safari views that were already open before this native CTA.
      if (pathname === '/' || pathname === '/start' || pathname === '/welcome') return true;
      // DAZN can redirect /start directly to the localized welcome route.
      // It is the normal visible result of the App Store Continue action, not
      // a checkout or Search context from an earlier test run.
      // Locale is supplied by DAZN's redirect, so do not couple this to
      // DAZN_REGION or a specific language. Support ordinary BCP-47 paths
      // such as /en-GB, /es-419 and /zh-Hant-HK, with an optional landing
      // segment, while still excluding account/search/checkout routes.
      return /^\/[a-z]{2,3}(?:-[a-z0-9]{2,8})*(?:\/(?:start|welcome))?\/?$/i.test(pathname);
    } catch {
      return false;
    }
  }

  private isLocalizedWelcomeUrl(url: string): boolean {
    try {
      return /^\/[a-z]{2,3}(?:-[a-z0-9]{2,8})*\/welcome\/?$/i.test(new URL(url).pathname);
    } catch {
      return false;
    }
  }

  async captureCheckoutUrl(): Promise<string> {
    // The external-website confirmation is a native App Store sheet. A prior
    // Safari WEBVIEW can still be selected after the native paywall click, in
    // which case iOS selectors cannot see its Continue button.
    await this.driver.switchContext('NATIVE_APP').catch(() => { });
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

    // 1. Let the system sheet complete its presentation animation. On this
    // device/iOS version the App Store sheet is visible on screen but omitted
    // from both the XCUITest tree and native page source, so source-based
    // presence checks would block forever.
    await this.driver.pause(Number(process.env.IOS_EXTERNAL_SHEET_SETTLE_MS || 1500));

    // 2. Resolve the system sheet by accessibility label. Looking up six
    // selectors five times made XCUITest wait for idle on each miss (nearly a
    // minute), then used unsafe coordinate taps.  Coordinate tapping is now
    // opt-in for unusual devices only.
    let alertHandled = false;
    console.log('🔍 Waiting briefly for the iOS redirect confirmation...');
    const redirectSelectors = [
      '-ios predicate string:type == "XCUIElementTypeButton" AND (name == "Continue" OR label == "Continue" OR name == "Open" OR label == "Open" OR name == "Allow" OR label == "Allow")',
      '//XCUIElementTypeButton[@name="Continue" or @label="Continue"]',
      '~Continue',
    ];
    // The sheet is already visible when this method is called. If XCUITest
    // has not surfaced Continue within a few seconds, it will not do so for
    // this presentation and the coordinate fallback is required.
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && !alertHandled) {
      // The previous URL capture may have left the session in a WKWebView.
      // Reassert the native context on every poll: system sheets are not
      // visible to WebKit selectors.
      await this.driver.switchContext('NATIVE_APP').catch(() => { });
      for (const selector of redirectSelectors) {
        try {
          const button = await this.driver.$(selector);
          if (!await button.isDisplayed().catch(() => false)) continue;
          const label = await button.getAttribute('label').catch(() => 'redirect button');
          await button.click();
          console.log(`✅ Clicked iOS redirect button "${label}" via native accessibility locator.`);
          alertHandled = true;
          await this.driver.pause(1500);
          break;
        } catch { }
      }
      if (!alertHandled) await this.driver.pause(250);
    }

    // On this App Store confirmation sheet, some iOS/WDA combinations render
    // Continue but omit it from the accessibility hierarchy. This is exactly
    // what the attached run shows. Keep the semantic locator as the primary
    // path, then use the known, centred bottom-sheet position automatically.
    if (!alertHandled) {
      console.warn('⚠️ Continue is not exposed to XCUITest; using the App Store sheet fallback position.');
      try {
        // Some XCUITest versions omit the button from the hierarchy but still
        // expose it through the native alert endpoint (the same mechanism the
        // working iOS Schedule flow uses).
        const nativeAlertOpen = typeof this.driver.isAlertOpen === 'function'
          ? await this.driver.isAlertOpen().catch(() => false)
          : false;
        const alertButtons = nativeAlertOpen
          ? await this.driver.execute('mobile: alert', { action: 'getButtons' }).catch(() => []) as string[]
          : [];
        const continueLabel = Array.isArray(alertButtons)
          ? alertButtons.find(label => /^(continue|open|allow)$/i.test(String(label).trim()))
          : undefined;
        if (continueLabel) {
          await this.driver.execute('mobile: alert', { action: 'accept', buttonLabel: continueLabel });
          console.log(`✅ Clicked iOS redirect button "${continueLabel}" via native alert API.`);
          alertHandled = true;
          await this.driver.pause(1500);
        }

        if (alertHandled) {
          // The native alert endpoint handled the sheet; do not send a second
          // coordinate tap into the newly opened browser.
        } else {
          const { width, height } = await this.driver.getWindowSize();
          const x = Math.round(width / 2);
          // Leave-app sheets place Continue above Cancel at roughly 83% of the
          // screen height on the iOS devices used here. The old bottom offsets
          // were in/under the Cancel region, so the handoff never began.
          const y = Math.round(height * 0.83);
          const tapped = await this.driver.execute('mobile: tap', { x, y })
            .then(() => true)
            .catch(() => false);
          if (!tapped) {
            await this.driver.action('pointer')
              .move({ x, y })
              .down()
              .pause(100)
              .up()
              .perform();
          }
          alertHandled = true;
          await this.driver.pause(2500);
        }
      } catch (e: any) {
        console.warn('⚠️ Coordinate fallback failed:', e.message);
      }
    }

    // Switch automation context to the active browser app to inspect its UI tree.
    // DAZN opens the web flow in SFSafariViewController (an in-app browser), so
    // the foreground app remains com.dazn.theApp — not com.apple.mobilesafari.
    // We detect the browser by checking for a WEBVIEW context with a valid DAZN
    // URL before falling back to the external Safari poll.
    let activatedBrowser = '';

    // Phase 1: poll for a WEBVIEW context (SFSafariViewController or WKWebView)
    // that resolves to a valid DAZN handoff URL. This covers the common in-app
    // browser case without requiring an external Safari process.
    console.log('🔍 Polling for WEBVIEW context (SFSafariViewController / WKWebView)...');
    const webviewDeadline = Date.now() + 20000;
    let lastContextSummary = '';
    while (Date.now() < webviewDeadline) {
      await this.driver.pause(1000);
      try {
        const contexts = await this.driver.getContexts() as string[];
        // XCUITest appends a new context for the newly presented Safari view.
        // Probe the newest context first; the earlier one is commonly a
        // background DAZN webview whose URL can be manipulated without
        // changing the web page visible on the device.
        const webContexts = contexts.filter(c =>
          c.includes('WEBVIEW') || (typeof c === 'string' && c !== 'NATIVE_APP')
        ).reverse();
        const contextSummary = contexts.join(', ') || 'none';
        if (contextSummary !== lastContextSummary) {
          console.log(`🌐 Available iOS contexts: ${contextSummary}`);
          lastContextSummary = contextSummary;
        }
        for (let contextIndex = 0; contextIndex < webContexts.length; contextIndex++) {
          const webCtx = webContexts[contextIndex];
          try {
            await this.driver.switchContext(webCtx);
            const url = await this.driver.getUrl();
            console.log(`🌐 Checking web context ${webCtx}: ${url || '(no URL yet)'}`);
            if (this.isSafariHandoffLandingUrl(url)) {
              // When two contexts exist, a localized /welcome can be an old
              // background Safari view while the newer view is still loading.
              // Give the newer context a short opportunity to resolve first.
              if (this.isLocalizedWelcomeUrl(url) && webContexts.length > 1 && contextIndex > 0 &&
                Date.now() < webviewDeadline - 5000) {
                continue;
              }
              console.log(`✅ Captured new DAZN handoff URL from WEBVIEW context ${webCtx}: ${url}`);
              activatedBrowser = 'WEBVIEW';
              return url;
            }
          } catch (e: any) {
            console.warn(`⚠️ Unable to inspect web context ${webCtx}: ${e.message}`);
          } finally {
            await this.driver.switchContext('NATIVE_APP').catch(() => { });
          }
        }
      } catch (e: any) {
        console.warn(`⚠️ Could not list web contexts: ${e.message}`);
      }
    }

    // Phase 2: check if external Safari/Chrome was opened instead.
    if (!activatedBrowser) {
      const browserDeadline = Date.now() + 15000;
      while (Date.now() < browserDeadline && !activatedBrowser) {
        try {
          const activeApp = await this.driver.execute('mobile: activeAppInfo').catch(() => null);
          if (activeApp && (activeApp.bundleId === 'com.apple.mobilesafari' || activeApp.bundleId === 'com.google.chrome.ios')) {
            console.log(`📱 Browser ${activeApp.bundleId} is in the foreground.`);
            activatedBrowser = activeApp.bundleId;
            break;
          }
        } catch (e: any) {
          console.warn('⚠️ Failed to query activeAppInfo:', e.message);
        }
        await this.driver.pause(500);
      }

      if (!activatedBrowser) {
        console.log('ℹ️ No external browser foregrounded; will attempt address bar fallback.');
      }
    }

    // Phase 3: try web contexts for external Safari (legacy path).
    if (activatedBrowser && activatedBrowser !== 'WEBVIEW') {
      lastContextSummary = '';
      for (let attempt = 0; attempt < 20; attempt++) {
        await this.driver.pause(1000);
        try {
          const contexts = await this.driver.getContexts() as string[];
          const webContexts = contexts.filter(c =>
            c.includes('WEBVIEW') || (typeof c === 'string' && c !== 'NATIVE_APP')
          ).sort((a, b) => Number(/SAFARI|MOBILESAFARI/i.test(b)) - Number(/SAFARI|MOBILESAFARI/i.test(a)));
          const contextSummary = contexts.join(', ') || 'none';
          if (contextSummary !== lastContextSummary) {
            console.log(`🌐 Available iOS contexts: ${contextSummary}`);
            lastContextSummary = contextSummary;
          }
          for (const webCtx of webContexts) {
            try {
              await this.driver.switchContext(webCtx);
              const url = await this.driver.getUrl();
              console.log(`🌐 Checking web context ${webCtx}: ${url || '(no URL yet)'}`);
              if (this.isSafariHandoffLandingUrl(url)) {
                console.log(`✅ Captured new Safari handoff context ${webCtx}: ${url}`);
                return url;
              }
            } catch (e: any) {
              console.warn(`⚠️ Unable to inspect web context ${webCtx}: ${e.message}`);
            } finally {
              await this.driver.switchContext('NATIVE_APP').catch(() => { });
            }
          }
        } catch (e: any) {
          console.warn(`⚠️ Could not list Safari web contexts: ${e.message}`);
        }
      }
    }

    // Fallback: search all screen elements for any value containing 'dazn.com'
    try {
      if (!activatedBrowser) return '';
      await this.driver.switchContext('NATIVE_APP').catch(() => { });
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
        } catch { }
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
            if (!s) continue;
            const trimmed = s.trim();
            // Accept bare 'dazn.com' (collapsed address bar) or any dazn.com URL
            const isDaznDomain = trimmed === 'dazn.com' || trimmed.includes('dazn.com');
            if (!isDaznDomain) continue;
            // Ensure we return a valid absolute URL format
            let cleanUrl = trimmed.includes('/') ? trimmed : trimmed + '/';
            if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
              cleanUrl = 'https://' + cleanUrl;
            }
            if (this.isSafariHandoffLandingUrl(cleanUrl)) {
              console.log(`✅ Extracted Safari handoff URL from browser elements: "${cleanUrl}"`);
              return cleanUrl;
            }
          }
        } catch { }
      }
    } catch (e: any) {
      console.warn('⚠️ Error searching browser elements:', e.message);
    }

    return '';
  }

  /**
   * Navigate to the DAZN welcome page and wait for it to settle.
   * Safe to call from any web context — always resolves to the welcome route.
   */
  async navigateToWelcomePage(baseUrl = 'https://www.dazn.com'): Promise<void> {
    console.log('🌐 Navigating to DAZN welcome page...');
    await this.driver.url(baseUrl).catch(() => {});
    await this.driver.waitUntil(async () => (await this.browserText()).trim().length > 0, {
      timeout: 20000,
      timeoutMsg: 'DAZN welcome page did not render a document body.',
    });
    await this.driver.pause(1500);
    console.log(`🌐 Landed on: ${await this.driver.getUrl().catch(() => '?')}`);
  }

  /**
   * Scrolls the DAZN welcome page down to the "Don't miss" rail, finds the PPV
   * tile matching eventName, and clicks its "Buy now" CTA.
   *
   * Must be called in a Safari/WebView web context (not NATIVE_APP).
   * Uses JS-based scrolling (window.scrollBy / element.scrollLeft) — NOT native
   * iOS gestures — because those only work in NATIVE_APP context.
   *
   * The "Don't miss" section is a horizontal carousel: scrolls the rail up to
   * maxCarouselScrolls times to find a tile that is off-screen to the right.
   */
  async findWelcomePagePPVTile(eventName: string, maxCarouselScrolls = 8): Promise<void> {
    const simplified = eventName.split(/ vs/i)[0].trim().replace(/\./g, '').toLowerCase();
    console.log(`🔍 Looking for PPV tile "${eventName}" in Don't miss section...`);

    // ── Step 1: Scroll the page down until "Don't miss" is visible ───────────
    const isDontMissVisible = async (): Promise<boolean> =>
      this.driver.execute(() =>
        Array.from(document.querySelectorAll<HTMLElement>('*'))
          .some(el => el.offsetParent !== null &&
            /don.?t miss/i.test(el.innerText || el.textContent || ''))
      ).catch(() => false);

    for (let scroll = 0; scroll < 15; scroll++) {
      if (await isDontMissVisible()) break;
      await this.driver.execute(() => window.scrollBy(0, 350));
      await this.driver.pause(400);
    }
    console.log('📜 "Don\'t miss" section reached (or max scroll hit); scanning for PPV tile...');

    // ── Step 2: Find the PPV tile by event name ───────────────────────────────
    const findMatchingTile = async (): Promise<any | null> => {
      const candidates = await this.driver.$$(
        '[class*="tile" i], [class*="card" i], [class*="event" i], ' +
        '[class*="rail" i] li, [class*="dont-miss" i] li, ' +
        'article, [role="listitem"]'
      ).catch(() => []);
      for (const candidate of candidates) {
        try {
          const text = (await candidate.getText().catch(() => ''))
            .replace(/\s+/g, ' ').toLowerCase();
          if (!text.includes(simplified)) continue;
          if (/press conference|weigh.?in|prelims?|highlights?|interview/i.test(text)) continue;
          if (await candidate.isDisplayed().catch(() => false)) return candidate;
        } catch { }
      }
      return null;
    };

    // ── Step 3: Click "Buy now" inside the matched tile ───────────────────────
    const clickBuyInTile = async (tile: any): Promise<boolean> => {
      const buyCtas = [
        'a*=Buy now', 'button*=Buy now', 'a*=Buy Now', 'button*=Buy Now',
        'a*=Get PPV', 'button*=Get PPV', 'a*=Purchase', 'button*=Purchase',
      ];
      for (const selector of buyCtas) {
        try {
          const btn = await tile.$(selector);
          if (btn && await btn.isDisplayed().catch(() => false)) {
            await btn.scrollIntoView().catch(() => {});
            await btn.click();
            console.log(`✅ Clicked "Buy now" on PPV tile for "${eventName}"`);
            return true;
          }
        } catch { }
      }
      // Fallback: click the tile card itself (it is often an <a> link)
      try {
        await tile.scrollIntoView().catch(() => {});
        await tile.click();
        console.log(`✅ Clicked PPV tile card directly for "${eventName}"`);
        return true;
      } catch { }
      return false;
    };

    // ── First pass: no carousel scroll needed ─────────────────────────────────
    let tile = await findMatchingTile();
    if (tile) {
      const clicked = await clickBuyInTile(tile);
      if (clicked) { await this.driver.pause(1500); return; }
    }

    // ── Carousel scroll passes: scroll the rail left to reveal hidden tiles ───
    for (let i = 0; i < maxCarouselScrolls; i++) {
      await this.driver.execute(() => {
        const rail = Array.from(document.querySelectorAll<HTMLElement>(
          '[class*="rail" i], [class*="carousel" i], [class*="dont-miss" i], ' +
          '[class*="slider" i], [class*="scroll" i]'
        )).find(el => el.scrollWidth > el.clientWidth && el.offsetParent !== null);
        if (rail) rail.scrollLeft += rail.clientWidth * 0.8;
      }).catch(() => {});
      await this.driver.pause(600);

      tile = await findMatchingTile();
      if (tile) {
        const clicked = await clickBuyInTile(tile);
        if (clicked) { await this.driver.pause(1500); return; }
      }
    }

    // ── Failure: screenshot + descriptive error ───────────────────────────────
    await this.driver.saveScreenshot('./test-results/ios_safari_ppv_tile_not_found.png').catch(() => {});
    const pageText = (await this.browserText()).slice(0, 600);
    throw new Error(
      `Safari welcome page: PPV tile not found for "${eventName}" after ${maxCarouselScrolls} carousel scrolls.\n` +
      `Visible text snippet: ${pageText}`
    );
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
