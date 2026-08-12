import { IOSBasePage, IOSFlowHooks, WdBrowser, WdElement } from './IOSBasePage';
import { IOSSignupPage } from './IOSSignupPage';
import { IOSValidationResult } from './IOSValidationPage';

export interface IOSSafariSearchOptions {
  capturedUrl: string;
  safariContext?: string;
  eventName: string;
  results: IOSValidationResult[];
  eventData?: Record<string, any>;
}

export class IOSSearchPage extends IOSBasePage {
  private async switchToSafariWebContext(expectedUrl: string, timeoutMs = 30000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    // Derive the expected hostname for loose matching. The captured URL may be
    // a collapsed address-bar value (e.g. https://dazn.com/) that differs from
    // the fully-resolved tab URL (e.g. https://www.dazn.com/en-GB/).
    let expectedHostname = '';
    try {
      expectedHostname = new URL(expectedUrl).hostname.replace(/^www\./, '');
    } catch { }

    while (Date.now() < deadline) {
      const contexts = await this.driver.getContexts().catch(() => []) as string[];
      // The newest WebKit context is the visible Safari handoff. Older
      // contexts can remain alive in the same Appium session.
      for (const context of contexts.filter((value: string) => value !== 'NATIVE_APP').reverse()) {
        try {
          await this.driver.switchContext(context);
          const url = await this.driver.getUrl();
          if (!url) continue;
          // Prefer exact match; fall back to hostname comparison so that
          // locale-prefixed URLs like /en-GB/ are still accepted.
          const tabHostname = (() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } })();
          const isMatch = url === expectedUrl ||
            (expectedHostname && tabHostname && tabHostname === expectedHostname);
          if (isMatch) {
            console.log(`🌐 Switched to Safari search context: ${context} (${url})`);
            return;
          }
        } catch { }
      }
      await this.driver.switchContext('NATIVE_APP').catch(() => { });
      await this.driver.pause(500);
    }
    throw new Error(`Safari WebKit context was not exposed for ${expectedUrl}.`);
  }

  private async switchToPreferredSafariContext(context: string, expectedUrl: string): Promise<boolean> {
    try {
      await this.driver.switchContext(context);
      const url = await this.driver.getUrl();
      const expectedHostname = new URL(expectedUrl).hostname.replace(/^www\./, '');
      const actualHostname = new URL(url).hostname.replace(/^www\./, '');
      if (expectedHostname === actualHostname) {
        console.log(`🌐 Switched to the new Safari private-tab context: ${context} (${url})`);
        return true;
      }
    } catch { }
    await this.driver.switchContext('NATIVE_APP').catch(() => { });
    return false;
  }

  private async waitForSafariStartToSettle(): Promise<void> {
    await this.driver.waitUntil(async () => this.browserDocumentReady(), {
      timeout: Number(process.env.IOS_SAFARI_SETTLE_TIMEOUT_MS || 35000),
      interval: Number(process.env.IOS_SAFARI_SETTLE_POLL_MS || 2000),
      timeoutMsg: 'Safari /start page did not render a document body.',
    });
    console.log(`🌐 Safari handoff landing settled: ${await this.driver.getUrl()}`);
  }

  private async waitForSafariLandingNavigation(): Promise<void> {
    const landingControls = [
      'a*=Explore', 'button*=Explore', '[role="button"]*=Explore',
      'header a[href*="/search"]', 'header button[aria-label*="Search" i]',
      'header [data-testid*="search" i]', 'a[href*="/search"]',
      'button[aria-label*="Search" i]', '[role="button"][aria-label*="Search" i]',
      '[data-testid*="search" i]',
    ];
    console.log('⏳ Waiting for Safari landing controls after cookie handling...');
    await this.driver.waitUntil(async () => {
      if (!await this.browserDocumentReady()) return false;
      if (/\/search(?:[/?#]|$)/i.test(await this.driver.getUrl())) return true;
      return Boolean(await this.browserFirstVisible(landingControls));
    }, {
      timeout: 30000,
      interval: 2000,
      timeoutMsg: 'Safari landing page did not expose Explore or Search after cookie handling.',
    });
  }

  private isAccountCheckoutUrl(url: string): boolean {
    return /\/account\//i.test(url) &&
      (/\/signup/i.test(url) || /[?&]page=/i.test(url) || /payment|checkout|purchase|choose/i.test(url));
  }

  private async openSafariSearchFromLanding(): Promise<void> {
    // Follow the visible web journey, matching the native flow: the welcome
    // screen exposes Explore, and the resulting home header exposes Search.
    // Do not force /search with driver.url(); that skips the actual handoff UI.
    if (/\/search(?:[/?#]|$)/i.test(await this.driver.getUrl())) {
      console.log('ℹ️ Safari is already on the Search route.');
      return;
    }

    const explore = await this.browserFirstVisible([
      '//*[self::button or self::a or @role="button"][normalize-space(.)="Explore"]',
      'a*=Explore', 'button*=Explore', '[role="button"]*=Explore',
    ]);
    if (explore) {
      await explore.click();
      console.log('✅ Safari handoff selected Explore.');
      await this.driver.pause(1200);
    } else {
      console.log('ℹ️ Safari handoff is already beyond the Explore screen.');
    }

    const deadline = Date.now() + 15000;
    let searchControl: any | null = null;
    while (Date.now() < deadline && !searchControl) {
      searchControl = await this.browserFirstVisible([
        'header a[href*="/search"]',
        'header button[aria-label*="Search" i]',
        'header [data-testid*="search" i]',
        'a[href*="/search"]',
        'button[aria-label*="Search" i]',
        '[role="button"][aria-label*="Search" i]',
        '[data-testid*="search" i]',
      ]);
      if (!searchControl) await this.driver.pause(300);
    }
    if (!searchControl) {
      await this.driver.saveScreenshot('./test-results/ios_safari_search_icon_not_found.png').catch(() => { });
      throw new Error('Safari home did not expose a Search icon after Explore.');
    }

    await searchControl.click();
    await this.driver.waitUntil(async () => /\/search(?:[/?#]|$)/i.test(await this.driver.getUrl()), {
      timeout: 20000,
      timeoutMsg: 'Safari Search icon did not open the DAZN search route.',
    });
    console.log(`🌐 Safari Search icon opened: ${await this.driver.getUrl()}`);
  }

  /**
   * In a Safari WebKit context, driver.keys('Enter') can leave the iOS
   * keyboard open without firing the search form's submit action. Submit via
   * the visible native Return key when WebDriverAgent exposes it.
   */
  private async submitSafariSearch(): Promise<void> {
    const safariContext = await this.driver.getContext().catch(() => '');
    let submitted = false;

    try {
      await this.driver.switchContext('NATIVE_APP');
      const nativeContext = await this.driver.getContext().catch(() => '');
      const returnKeySelectors = [
        '~Return', '~return', '~Enter', '~enter',
        '-ios predicate string:(type == "XCUIElementTypeKey" OR type == "XCUIElementTypeButton") AND (name == "Return" OR label == "Return" OR value == "Return" OR name == "return" OR label == "return" OR value == "return" OR name == "Enter" OR label == "Enter" OR value == "Enter" OR name == "enter" OR label == "enter" OR value == "enter")',
      ];
      let returnKey: WdElement | null = null;
      let keyboardShown = false;
      await this.driver.waitUntil(async () => {
        keyboardShown = await this.driver.isKeyboardShown().catch(() => false);
        returnKey = nativeContext === 'NATIVE_APP'
          ? await this.browserFirstVisible(returnKeySelectors)
          : null;
        return Boolean(returnKey) || keyboardShown;
      }, {
        timeout: 5000,
        interval: 250,
        timeoutMsg: 'iOS Safari keyboard did not appear.',
      }).catch(() => { });
      if (returnKey) {
        await returnKey.click();
        submitted = true;
        console.log('⌨️ Submitted Safari search using the native Return key.');
      } else if (keyboardShown) {
        // Safari on iOS 16.5 can render the Return glyph without exposing an
        // accessible key element. Its position is fixed within the visible
        // iPhone keyboard; derive the tap from the current screen size rather
        // than hard-coding a device resolution.
        const { width, height } = await this.driver.getWindowSize();
        const returnX = Math.round(width * 0.86);
        const returnY = Math.round(height * 0.88);
        await this.driver.performActions([{
          type: 'pointer', id: 'safari-keyboard-return', parameters: { pointerType: 'touch' },
          actions: [
            { type: 'pointerMove', duration: 0, x: returnX, y: returnY },
            { type: 'pointerDown', button: 0 },
            { type: 'pause', duration: 60 },
            { type: 'pointerUp', button: 0 },
          ],
        }]);
        await this.driver.releaseActions();
        submitted = true;
        console.log(`⌨️ Submitted Safari search by tapping the visible Return key (${returnX}, ${returnY}).`);
      } else {
        // WDA's dedicated keyboard endpoint can still reach Safari's Return
        // action when the keyboard is visible on screen but isKeyboardShown()
        // is not reported for the external Safari process.
        const pressedByWda = await this.driver.execute('mobile: hideKeyboard', {
          keys: ['return', 'Return', 'enter', 'Enter'],
        }).then(() => true).catch(() => false);
        if (pressedByWda) {
          submitted = true;
          console.log('⌨️ Submitted Safari search using WDA’s native Return action.');
        }
      }
    } finally {
      if (safariContext && safariContext !== 'NATIVE_APP') {
        await this.driver.switchContext(safariContext);
      }
    }

    if (!submitted) {
      await this.driver.keys('Enter');
    }
  }

  /**
   * Mirrors pages/SearchPage.enableDevMode() for the real iOS Safari context.
   * Ultimate APM/APU flows in GB/US require this before checkout so the
   * account journey does not divert to phone-number collection.
   */
  private async enableSafariDevMode(): Promise<void> {
    console.log('🎭 Enabling Safari dev mode for Ultimate checkout...');
    await this.openSafariSearchFromLanding();

    const hasDevIndicator = async () => {
      if (await this.browserFirstVisible([
        'div[class*="dev-mode__circle" i]',
      ])) return true;

      // Mobile Safari sometimes exposes the dot in the DOM but does not
      // report it as a WebDriver-visible element. Do not treat a hidden
      // dev-mode template as success: the yellow dot must actually be visible
      // before checkout leaves this page.
      return await this.driver.execute(() =>
        Array.from(document.querySelectorAll<HTMLElement>(
          '[class*="dev-mode__circle"]',
        )).some(element => {
          const style = window.getComputedStyle(element);
          const box = element.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' &&
            style.opacity !== '0' && box.width > 0 && box.height > 0;
        }),
      ).catch(() => false);
    };
    // A previous activation can already have completed before the current
    // method resumes. The visible yellow dot is the same success signal used
    // by the web flow, so continue instead of trying to enter the command.
    if (await hasDevIndicator()) {
      console.log('✅ Safari dev mode is already active (yellow indicator visible).');
      return;
    }

    const prompt = await this.browserFirstVisible([
      '//*[self::button or self::a or @role="button" or @role="searchbox"][contains(normalize-space(.), "Search sports, teams, events")]',
      '[role="search"]', '[aria-label*="Search" i]',
    ]);
    if (prompt) await prompt.click();

    let input: any | null = null;
    const inputDeadline = Date.now() + 15000;
    while (Date.now() < inputDeadline && !input) {
      input = await this.browserFirstVisible([
        'input[type="search"]', 'input[placeholder*="search" i]',
        '[role="searchbox"]', '[role="textbox"]',
      ]);
      if (!input) await this.driver.pause(300);
    }
    if (!input) throw new Error('Safari dev mode could not find the Search input.');

    // Do not use WebKit's element-click atom here: on real Safari it can wait
    // for 10 seconds and be retried even though normal JavaScript still works.
    // Focus the corresponding native Safari field, then return to WebKit to
    // enter the command through the already-focused DOM input.
    const safariContext = await this.driver.getContext().catch(() => '');
    let focusedNatively = false;
    try {
      await this.driver.switchContext('NATIVE_APP');
      const nativeContext = await this.driver.getContext().catch(() => '');
      const nativeInput = nativeContext === 'NATIVE_APP'
        ? await this.browserFirstVisible([
          '-ios predicate string:(type == "XCUIElementTypeSearchField" OR type == "XCUIElementTypeTextField") AND (name CONTAINS[c] "Search" OR label CONTAINS[c] "Search" OR value CONTAINS[c] "Search")',
        ])
        : null;
      if (nativeInput) {
        await nativeInput.click();
        focusedNatively = true;
      }
    } finally {
      if (safariContext && safariContext !== 'NATIVE_APP') {
        await this.driver.switchContext(safariContext);
      }
    }
    // Retain the WebKit click only as a compatibility fallback when Safari
    // does not expose its search field to the native accessibility tree.
    if (!focusedNatively) await input.click();
    await input.clearValue().catch(() => {});
    await input.addValue('[dev_mode_on]');
    // Safari can drop focus after WebKit enters text into a field that was
    // initially focused through the native tree. Refocus the entered field
    // so the visible keyboard Return action can submit the command.
    await input.click();
    await this.submitSafariSearch();
    await this.driver.pause(1000);

    // Safari can first show "no results" and only then mount the UUID/Copy ID
    // sheet. Some Safari variants activate immediately and only show the
    // yellow dev-mode dot (no UUID dialog), which is also a valid success.
    await this.driver.waitUntil(async () => {
      const text = await this.browserText();
      return await hasDevIndicator() ||
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(text) ||
        /copy id/i.test(text);
    }, { timeout: 30000, timeoutMsg: 'Safari dev mode confirmation did not appear.' });

    let copiedId = false;
    if (!await hasDevIndicator()) {
      const copyIdSelectors = [
        'button*=Copy ID', '[role="button"]*=Copy ID', 'button[aria-label*="Copy ID" i]',
      ];
      let copyId = await this.browserFirstVisible(copyIdSelectors);
      if (!copyId) {
        await this.driver.waitUntil(async () => {
          copyId = await this.browserFirstVisible(copyIdSelectors);
          return Boolean(copyId);
        }, {
          timeout: 10000,
          interval: 500,
          timeoutMsg: 'Safari dev mode confirmation did not expose Copy ID.',
        }).catch(() => { });
      }
      if (copyId) {
        // Safari's WebDriver click atom repeatedly times out on this control
        // even though JavaScript commands remain responsive.  Trigger the
        // visible Copy ID button through WebKit instead, then verify the
        // yellow indicator only after the subsequent document load below.
        const copiedByDom = await this.driver.execute(() => {
          const button = Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"]'))
            .find(element => (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase() === 'copy id');
          if (!button) return false;
          button.click();
          return true;
        }).catch(() => false);
        if (!copiedByDom) throw new Error('Safari dev mode confirmation exposed Copy ID but it was not actionable.');
        copiedId = true;
      } else {
        const copiedByDom = await this.driver.execute(() => {
          const button = Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"]'))
            .find(element => (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase() === 'copy id');
          if (!button) return false;
          button.click();
          return true;
        }).catch(() => false);
        if (!copiedByDom) throw new Error('Safari dev mode confirmation appeared but Copy ID was not actionable.');
        copiedId = true;
      }
    }

    let enabled = false;
    // Copy ID changes the Safari dev-mode state only after the next document
    // load. Stay on this same page: wait for a new, complete document and its
    // visible yellow indicator before the caller navigates to Welcome.
    if (copiedId) {
      console.log('🔄 Refreshing Safari after Copy ID...');
      const refreshMarker = `ios-dev-mode-refresh-${Date.now()}`;
      const refreshMarkerApplied = await this.driver.execute((marker: string) => {
        document.documentElement.setAttribute('data-ios-dev-mode-refresh', marker);
        return document.documentElement.getAttribute('data-ios-dev-mode-refresh') === marker;
      }, refreshMarker).catch(() => false);
      await this.driver.refresh();
      await this.driver.waitUntil(async () => this.browserDocumentReady(), {
        timeout: Number(process.env.IOS_SAFARI_SETTLE_TIMEOUT_MS || 35000),
        interval: Number(process.env.IOS_SAFARI_SETTLE_POLL_MS || 2000),
        timeoutMsg: 'Safari did not render after refreshing dev mode.',
      });
      console.log('🌐 Safari refreshed after Copy ID.');
      console.log('⏳ Waiting for the visible yellow Safari dev-mode indicator on the refreshed page...');
      await this.driver.waitUntil(async () => {
        if (!await this.browserDocumentReady()) return false;
        if (refreshMarkerApplied) {
          const refreshedDocument = await this.driver.execute((marker: string) =>
            document.documentElement.getAttribute('data-ios-dev-mode-refresh') !== marker,
          refreshMarker).catch(() => false);
          if (!refreshedDocument) return false;
        }
        enabled = await hasDevIndicator();
        return enabled;
      }, {
        timeout: Number(process.env.IOS_SAFARI_SETTLE_TIMEOUT_MS || 35000),
        interval: Number(process.env.IOS_SAFARI_SETTLE_POLL_MS || 2000),
        timeoutMsg: 'Safari dev mode was not confirmed by a visible yellow indicator after Copy ID refresh.',
      });
    } else {
      // A Safari variant can activate without exposing Copy ID. Preserve its
      // search/refresh fallback, but still confirm the visible indicator.
      if (!/\/search(?:[/?#]|$)/i.test(await this.driver.getUrl())) {
        await this.openSafariSearchFromLanding();
      }
      await this.driver.waitUntil(async () => {
        if (!await this.browserDocumentReady()) return false;
        enabled = await hasDevIndicator();
        return enabled;
      }, {
        timeout: 15000,
        interval: 500,
        timeoutMsg: 'Safari dev mode was not confirmed by its yellow indicator.',
      }).catch(() => { });
      enabled = enabled || await hasDevIndicator();
      if (!enabled) {
        await this.driver.refresh();
        await this.driver.waitUntil(async () => this.browserDocumentReady(), {
          timeout: Number(process.env.IOS_SAFARI_SETTLE_TIMEOUT_MS || 35000),
          interval: Number(process.env.IOS_SAFARI_SETTLE_POLL_MS || 2000),
          timeoutMsg: 'Safari did not render after refreshing dev mode.',
        });
        enabled = await hasDevIndicator();
      }
    }
    if (!enabled) throw new Error('Safari dev mode was not confirmed by its yellow indicator.');
    console.log('✅ Safari dev mode confirmed.');
  }

  private async openSafariSearchResult(eventName: string): Promise<void> {
    await this.openSafariSearchFromLanding();

    const prompt = await this.browserFirstVisible([
      '//*[self::button or self::a or @role="button" or @role="searchbox"][contains(normalize-space(.), "Search sports, teams, events")]',
      '[role="search"]', '[aria-label*="Search" i]',
    ]);
    if (prompt) await prompt.click();

    let input: any | null = null;
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline && !input) {
      input = await this.browserFirstVisible([
        'input[type="search"]', 'input[placeholder*="search" i]', '[role="searchbox"]', '[role="textbox"]',
      ]);
      if (!input) await this.driver.pause(300);
    }
    if (!input) throw new Error('Safari search did not expose an editable search field.');
    // Dev-mode activation can leave [dev_mode_on] in this same search box.
    // Clear it explicitly so the PPV query does not append to the command.
    await input.clearValue().catch(() => { });
    await input.setValue(eventName);
    await this.driver.keys('Enter');
    await this.driver.pause(1200);

    const expected = eventName.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const expectedWords = expected.split(' ').filter(word => word.length > 2 && word !== 'the');
    await this.driver.waitUntil(async () => {
      const resultText = (await this.browserText()).toLowerCase().replace(/[^a-z0-9]+/g, ' ');
      return expectedWords.every(word => resultText.includes(word));
    }, {
      timeout: 15000,
      timeoutMsg: `Safari search results did not render ${eventName}`,
    });

    // The mobile DAZN search result shown on the device is an anchor/role-link
    // rather than an article or a class-named card. Include both structural
    // forms and the data-target form used by the existing web page object.
    const candidates = await this.driver.$$(
      'article, [class*="tile" i], [class*="card" i], [class*="result" i], ' +
      'a[href], [role="link"], [role="button"], [data-target-title]'
    );
    for (const candidate of candidates) {
      const text = (await candidate.getText().catch(() => '')).replace(/\s+/g, ' ').trim();
      const normalised = text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      if (!normalised.includes(expected) || /press conference|weigh.?in|prelims?|highlights?|interview/i.test(text)) continue;
      const link = await candidate.$('a[href*="/fixture/"], a[href*="/event/"], a[href*="/stream/"], a[href*="/player/"], a');
      const target = await link.isDisplayed().catch(() => false) ? link : candidate;
      await target.scrollIntoView();
      await target.click();
      console.log(`✅ Safari search selected PPV: ${text.substring(0, 100)}`);
      await this.driver.pause(1500);
      return;
    }
    const visibleText = (await this.browserText()).replace(/\s+/g, ' ').slice(0, 800);
    throw new Error(`Safari search found no clickable PPV tile for "${eventName}". Visible text: ${visibleText}`);
  }

  async continueSafariCheckout(options: IOSSafariSearchOptions): Promise<void> {
    const switchedToNewTab = options.safariContext
      ? await this.switchToPreferredSafariContext(options.safariContext, options.capturedUrl)
      : false;
    if (!switchedToNewTab) await this.switchToSafariWebContext(options.capturedUrl);
    const landedUrl = await this.driver.getUrl();
    options.results.push({
      page: 'iOS Safari',
      field: 'Safari landed URL',
      expected: 'DAZN URL',
      actual: landedUrl || 'Not found',
      status: /dazn\.com/i.test(landedUrl) ? 'PASS' : 'FAIL',
    });
    await this.waitForSafariStartToSettle();
    this.resetCookieConsentCache();
    await this.handleSafariCookies();
    const settledUrl = await this.driver.getUrl().catch(() => '');
    if (this.isAccountCheckoutUrl(settledUrl)) {
      console.log(`ℹ️ Safari handoff is already in account checkout: ${settledUrl}`);
      await new IOSSignupPage(this.driver).completeToPayment(options.results, options.eventName, options.eventData);
      return;
    }

    // Dev mode must be activated BEFORE clicking Buy now on the welcome page,
    // because it navigates to /search internally. After it completes, we always
    // navigate back to www.dazn.com (welcome) explicitly — history.back() only
    // returns to /search, not to the welcome page where the PPV tile lives.
    const tier = String(options.eventData?.TIER || process.env.TIER || '').toLowerCase();
    const region = String(options.eventData?.DAZN_REGION || process.env.DAZN_REGION || '').toUpperCase();
    const userState = String(options.eventData?.USER_STATE || process.env.USER_STATE || '').toLowerCase().trim();
    const isUSorGB = region === 'GB' || region === 'US';
    const isUltimateUser = userState.startsWith('active_ultimate');
    const isLoginFirst = String(process.env.LOGIN_FIRST || process.env.LOGIN || '').toLowerCase() === 'true';
    const ppvDevMode = String(options.eventData?.PPV_DEV_MODE || process.env.PPV_DEV_MODE || '').toLowerCase() === 'true';
    const devModeForced = String(process.env.DEV_MODE_ON || '').toLowerCase() === 'on' || ppvDevMode;
    if (devModeForced || (tier === 'ultimate' && isUSorGB) || (isUltimateUser && isLoginFirst)) {
      await this.waitForSafariLandingNavigation();
      await this.enableSafariDevMode();
      // Always navigate explicitly to welcome — dev mode ends on /search.
      await this.navigateToWelcomePage();
      this.resetCookieConsentCache();
      await this.handleSafariCookies(5000);
    }

    // findWelcomePagePPVTile is defined in IOSBasePage and inherited here.
    await this.findWelcomePagePPVTile(options.eventName);
    await new IOSSignupPage(this.driver).completeToPayment(options.results, options.eventName, options.eventData);
  }
  async navigate(): Promise<void> {
    console.log('Navigating to Search screen...');
    await this.driver.saveScreenshot('./test-results/before_ios_search_click.png');

    const searchSelectors = [
      // iOS DAZN real-device home uses a magnifying glass in the top header,
      // not a bottom-navigation Search tab.
      '-ios class chain:**/XCUIElementTypeButton[`name CONTAINS[c] "Search" OR label CONTAINS[c] "Search"`]',
      '-ios predicate string:name CONTAINS[c] "Search" OR label CONTAINS[c] "Search"',
      '//XCUIElementTypeButton[contains(@name, "Search") or contains(@label, "Search")]',
      '~Search',
    ];

    let searchBtn: WdElement | null = null;
    for (const selector of searchSelectors) {
      try {
        const el = await this.driver.$(selector);
        if (await el.isDisplayed()) {
          searchBtn = el;
          break;
        }
      } catch { }
    }

    if (searchBtn) {
      console.log('  Found header Search icon, clicking...');
      await searchBtn.click();
      await this.driver.pause(3000);
      await this.driver.saveScreenshot('./test-results/after_ios_search_click.png');
    } else {
      // The production iOS app sometimes does not expose an accessibility
      // label for this icon. Its position is stable in the header, between
      // the DAZN logo and Sign up button (as shown on the target device).
      const { width, height } = await this.driver.getWindowSize();
      const x = Math.round(width * 0.37);
      const y = Math.round(height * 0.09);
      console.warn(`  Header Search icon has no accessible label; tapping fallback coordinates (${x}, ${y}).`);
      await this.driver.action('pointer')
        .move({ x, y })
        .down()
        .pause(100)
        .up()
        .perform();
      await this.driver.pause(2000);
      await this.driver.saveScreenshot('./test-results/after_ios_search_header_fallback.png');

      // Retain the native tree for selector refinement when the app layout
      // changes; this is more useful than reporting a misleading bottom-nav
      // failure.
      const source = await this.driver.getPageSource().catch(() => '');
      require('fs').writeFileSync('./test-results/ios_search_header_source.xml', source);
    }
  }

  getPPVKeywords(searchQuery: string, ppvName = this.ppvName): string[] {
    const words = [searchQuery, ppvName];
    const candidates: string[] = [];
    for (const word of words) {
      if (!word) continue;
      const cleanWord = word.toLowerCase().replace(/[:\-–\.]/g, ' ');
      const normalisedCleanWord = cleanWord.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (normalisedCleanWord.includes('vs')) {
        const parts = normalisedCleanWord.split(/\bvs\b/).map(p => p.trim());
        candidates.push(...parts);
      } else {
        candidates.push(...normalisedCleanWord.split(/\s+/).map(p => p.trim()));
      }
    }

    const keywordsSet = new Set<string>();
    for (const candidate of candidates) {
      const subWords = candidate.split(/\s+/);
      for (const subWord of subWords) {
        if (subWord.length > 2 && subWord !== 'the' && subWord !== 'vs' && subWord !== 'and') {
          keywordsSet.add(subWord);
        }
      }
    }

    const result = Array.from(keywordsSet);
    return result.length > 0 ? result : [searchQuery.toLowerCase()];
  }

  async findCorrectPPVTile(keywords: string[]): Promise<WdElement | null> {
    console.log(`Scanning XCUIElementTypeStaticText elements for keywords: ${JSON.stringify(keywords)}`);
    const expectedPpvName = this.ppvName
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
    try {
      const elements = await this.driver.$$('//XCUIElementTypeStaticText');
      for (const el of elements) {
        const text = await el.getAttribute('label').catch(() => '');
        if (!text) continue;

        const textLower = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
        const normalisedText = textLower.replace(/[^a-z0-9]+/g, ' ').trim();
        const matchesQuery = expectedPpvName
          ? normalisedText === expectedPpvName
          : keywords.every(kw => textLower.includes(kw));
        const isAncillary = [
          'press', 'weigh', 'workout', 'replay', 'highlights',
          'preview', 'promo', 'interview', 'behind the', 'episode',
          'documentary', 'face off', 'kickboxing',
        ].some(term => textLower.includes(term));

        if (matchesQuery && !isAncillary) {
          console.log(`  Found matching main event tile: "${text}"`);
          return el;
        }
      }
    } catch (e: any) {
      console.log(`  Error finding tile: ${e.message}`);
    }

    return null;
  }

  async typeSearchQuery(searchQuery: string): Promise<void> {
    let searchInput: WdElement | null = null;
    const inputSelectors = [
      '//XCUIElementTypeSearchField',
      // The production iOS field is exposed as a text field with the
      // placeholder "Search sports, teams, events".  Restrict every locator
      // to an editable field; a broad "label contains Search" selector can
      // otherwise select the header magnifying-glass button.
      '-ios predicate string:type == "XCUIElementTypeTextField" AND (name CONTAINS[c] "Search" OR label CONTAINS[c] "Search" OR value CONTAINS[c] "Search")',
      '//XCUIElementTypeTextField[contains(@name, "Search") or contains(@label, "Search") or contains(@value, "Search")]',
      '//XCUIElementTypeTextField',
    ];

    for (const selector of inputSelectors) {
      try {
        const el = await this.driver.$(selector);
        if (await el.isDisplayed()) {
          searchInput = el;
          break;
        }
      } catch { }
    }

    if (!searchInput) {
      await this.driver.saveScreenshot('./test-results/ios_search_input_not_found.png');
      throw new Error('Search input not found on the iOS Search screen; cannot continue with SOURCE=search.');
    }

    try {
      await searchInput.click();
      await this.driver.pause(500);
      await searchInput.clearValue().catch(() => { });
      await searchInput.setValue(searchQuery);
      await this.driver.pause(500);

      // Do not inspect results until the exact configured event is visibly
      // present in the input.  This prevents stale recent-search content from
      // being treated as a real SOURCE=search result.
      let entered = String(await searchInput.getValue().catch(() => ''));
      if (!entered) entered = String(await searchInput.getAttribute('value').catch(() => ''));
      const normalise = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      if (!normalise(entered).includes(normalise(searchQuery))) {
        throw new Error(`Search query was not entered. Expected="${searchQuery}" actual="${entered || 'empty'}"`);
      }
      console.log(`  ✓ Entered and verified Search query: "${entered}"`);

      // On the real iPhone keyboard the action is labelled Done.  Prefer it,
      // then fall back to Search / Enter for other iOS versions.
      const keyboardActions = ['~Done', '~done', '~Search', '~search'];
      let submitted = false;
      for (const selector of keyboardActions) {
        const key = await this.driver.$(selector);
        if (await key.isDisplayed().catch(() => false)) {
          await key.click();
          submitted = true;
          break;
        }
      }
      if (!submitted) await this.driver.keys(['\n']);
      await this.driver.pause(1500);
    } catch (e: any) {
      await this.driver.saveScreenshot('./test-results/ios_search_query_entry_failed.png').catch(() => { });
      throw new Error(`Unable to enter and submit iOS Search query "${searchQuery}": ${e.message}`);
    }
  }

  async openSearchResultPaywall(searchQuery: string, hooks: IOSFlowHooks = {}): Promise<boolean> {
    await this.navigate();
    await this.typeSearchQuery(searchQuery);
    await this.driver.pause(4000);
    await this.driver.saveScreenshot('./test-results/ios_search_results.png');

    const keywords = this.getPPVKeywords(searchQuery, this.ppvName);
    console.log(`Looking for PPV tile: "${this.ppvName}"...`);
    let ppvTile = await this.findCorrectPPVTile(keywords);

    if (!ppvTile) {
      console.log('  PPV tile not immediately visible. Swiping down search results...');
      await this.scrollDown();
      await this.driver.pause(2000);
      ppvTile = await this.findCorrectPPVTile(keywords);
    }

    if (!ppvTile) {
      const retryQuery = `${this.ppvName || searchQuery} upcoming`;
      console.log(`PPV tile not found for "${searchQuery}". Retrying search with "${retryQuery}"...`);
      // Stay on the current Search screen. Re-running navigate() can hit the
      // header/back control and leave Search, which violates SOURCE=search.
      await this.typeSearchQuery(retryQuery);
      await this.driver.pause(4000);
      await this.driver.saveScreenshot('./test-results/ios_search_retry_results.png');

      ppvTile = await this.findCorrectPPVTile(keywords);
      if (!ppvTile) {
        console.log('  PPV tile not immediately visible in retry search. Swiping down results...');
        await this.scrollDown();
        await this.driver.pause(2000);
        ppvTile = await this.findCorrectPPVTile(keywords);
      }
    }

    if (!ppvTile) {
      const shot = hooks.saveScreenshot
        ? await hooks.saveScreenshot('./test-results/ios_search_ppv_not_found.png')
        : undefined;
      hooks.recordAvailability?.(false, shot, 'Search');
      await hooks.generateAvailabilityFailureReport?.(`PPV "${this.ppvName}" not found in Search`);
      throw new Error(`PPV event "${this.ppvName}" not found in search results (after primary & retry search).`);
    }

    hooks.recordAvailability?.(true, undefined, 'Search');
    console.log('Found PPV tile - tapping it...');
    await this.runSurfaceValidation(hooks, 'PPV Tile');
    await ppvTile.click();
    await this.driver.pause(4000);
    await this.driver.saveScreenshot('./test-results/ios_search_after_tile_click.png');

    const isUltimateUser = ['active_ultimate_apm', 'active_ultimate_upfront'].includes(String(process.env.USER_STATE || '').toLowerCase().trim());
    const isLoginFirst = String(process.env.LOGIN_FIRST || '').toLowerCase() === 'true';

    if (isUltimateUser && isLoginFirst) {
      console.log('✨ [Ultimate Active User with LOGIN_FIRST=true] Search tile clicked, navigated to fixture page. Ending flow.');
      return true;
    }

    // The bottom sheet is the native iOS paywall. Validate it while it is
    // still on screen, before tapping the external-site CTA. That CTA opens
    // Apple's confirmation sheet and makes native paywall selectors stale.
    console.log('Validating native Search paywall before external handoff...');
    await this.driver.saveScreenshot('./test-results/ios_search_native_paywall.png');
    await this.runPaywallValidation(hooks);
    if (await this.handleUsNativePaywallSheet(hooks)) return true;

    // Only after native validation is complete may we leave DAZN for Safari.
    console.log('Tapping Buy/Go-to CTA on event page...');
    const buyTapped = await this.tapBuyCtaWithFallback([
      'Go to dazn.com/start',
      'Go to DAZN.com/start',
      'Buy now',
      'Buy Now',
      'Buy',
      'Get PPV',
      'Purchase',
      'Continue',
    ], { scrollBeforeFallback: true });

    if (!buyTapped) {
      await this.driver.saveScreenshot('./test-results/ios_search_buy_not_found.png');
      throw new Error(`❌ Could not click Buy CTA on event page`);
    }

    return true;
  }
}

export async function navigateToSearch(driver: WdBrowser): Promise<void> {
  return new IOSSearchPage(driver).navigate();
}

export async function typeSearchQuery(driver: WdBrowser, searchQuery: string): Promise<void> {
  return new IOSSearchPage(driver).typeSearchQuery(searchQuery);
}

export function getPPVKeywords(searchQuery: string, ppvName: string): string[] {
  return new IOSSearchPage(null, ppvName).getPPVKeywords(searchQuery, ppvName);
}

export async function findCorrectPPVTile(driver: WdBrowser, keywords: string[]): Promise<WdElement | null> {
  return new IOSSearchPage(driver).findCorrectPPVTile(keywords);
}

export async function openSearchResultPaywall(
  driver: WdBrowser,
  ppvName: string,
  searchQuery: string,
  hooks: IOSFlowHooks = {},
): Promise<boolean> {
  return new IOSSearchPage(driver, ppvName).openSearchResultPaywall(searchQuery, hooks);
}
