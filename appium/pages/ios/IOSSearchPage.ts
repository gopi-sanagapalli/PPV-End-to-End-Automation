import { IOSBasePage, IOSFlowHooks, WdBrowser, WdElement } from './IOSBasePage';
import { IOSSignupPage } from './IOSSignupPage';
import { IOSValidationResult } from './IOSValidationPage';

export interface IOSSafariSearchOptions {
  capturedUrl: string;
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

  private async waitForSafariStartToSettle(): Promise<void> {
    await this.driver.waitUntil(async () => (await this.browserText()).trim().length > 0, {
      timeout: 20000,
      timeoutMsg: 'Safari /start page did not render a document body.',
    });
    // The handoff route can replace its initial shell after DOM content is
    // available. Allow that transition to finish before opening the source tab.
    await this.driver.pause(2000);
    console.log(`🌐 Safari handoff landing settled: ${await this.driver.getUrl()}`);
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
      await this.driver.saveScreenshot('./test-results/ios_safari_search_icon_not_found.png').catch(() => {});
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
   * Mirrors pages/SearchPage.enableDevMode() for the real iOS Safari context.
   * Ultimate APM/APU flows in GB/US require this before checkout so the
   * account journey does not divert to phone-number collection.
   */
  private async enableSafariDevMode(): Promise<void> {
    console.log('🎭 Enabling Safari dev mode for Ultimate checkout...');
    await this.openSafariSearchFromLanding();

    const hasDevIndicator = async () => {
      if (await this.browserFirstVisible([
        'div[class*="dev-mode__circle" i]', '[class*="dev-mode" i]',
      ])) return true;

      // Mobile Safari sometimes exposes the dot in the DOM but does not
      // report it as a WebDriver-visible element. It is still the same
      // persistent completion signal, so check the document directly too.
      return await this.driver.execute(() => Boolean(document.querySelector(
        '[class*="dev-mode__circle"], [class*="dev-mode"]',
      ))).catch(() => false);
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

    await input.click();
    await input.setValue('[dev_mode_on]');
    await this.driver.keys('Enter');
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

    if (!await hasDevIndicator()) {
      const copyId = await this.browserFirstVisible([
        'button*=Copy ID', '[role="button"]*=Copy ID', 'button[aria-label*="Copy ID" i]',
      ]);
      if (copyId) {
        await copyId.click();
      } else {
        const copiedByDom = await this.driver.execute(() => {
          const button = Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"]'))
            .find(element => (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase() === 'copy id');
          if (!button) return false;
          button.click();
          return true;
        }).catch(() => false);
        if (!copiedByDom) throw new Error('Safari dev mode confirmation appeared but Copy ID was not actionable.');
      }
    }

    // DAZN can redirect after Copy ID. Reload/search again and verify the
    // same yellow dev-mode indicator that the web flow treats as confirmation.
    await this.driver.pause(1500);
    if (!/\/search(?:[/?#]|$)/i.test(await this.driver.getUrl())) {
      await this.openSafariSearchFromLanding();
    }
    let enabled = await hasDevIndicator();
    if (!enabled) {
      await this.driver.waitUntil(hasDevIndicator, {
        timeout: 15000,
        timeoutMsg: 'Safari dev mode was not confirmed by its yellow indicator.',
      }).catch(() => { });
      enabled = await hasDevIndicator();
    }
    // Match the web flow's final refresh only as a fallback; Safari normally
    // returns to Search with the yellow dot already visible after Copy ID.
    if (!enabled) {
      await this.driver.refresh();
      await this.driver.pause(1000);
      enabled = await hasDevIndicator();
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
    await this.switchToSafariWebContext(options.capturedUrl);
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

    // Dev mode must be activated BEFORE clicking Buy now on the welcome page,
    // because it navigates to /search internally. After it completes, we always
    // navigate back to www.dazn.com (welcome) explicitly — history.back() only
    // returns to /search, not to the welcome page where the PPV tile lives.
    const tier = String(options.eventData?.TIER || process.env.TIER || '').toLowerCase();
    const region = String(options.eventData?.DAZN_REGION || process.env.DAZN_REGION || '').toUpperCase();
    const devModeForced = String(process.env.DEV_MODE_ON || '').toLowerCase() === 'on';
    if (devModeForced || (tier === 'ultimate' && (region === 'GB' || region === 'US'))) {
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
      } catch {}
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
      if (cleanWord.includes('vs')) {
        const parts = cleanWord.split(/\bvs\b/).map(p => p.trim());
        candidates.push(...parts);
      } else {
        candidates.push(...cleanWord.split(/\s+/).map(p => p.trim()));
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
    try {
      const elements = await this.driver.$$('//XCUIElementTypeStaticText');
      for (const el of elements) {
        const text = await el.getAttribute('label').catch(() => '');
        if (!text) continue;

        const textLower = text.toLowerCase();
        const matchesQuery = keywords.every(kw => textLower.includes(kw));
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
      } catch {}
    }

    if (!searchInput) {
      await this.driver.saveScreenshot('./test-results/ios_search_input_not_found.png');
      throw new Error('Search input not found on the iOS Search screen; cannot continue with SOURCE=search.');
    }

    try {
      await searchInput.click();
      await this.driver.pause(500);
      await searchInput.clearValue().catch(() => {});
      await searchInput.setValue(searchQuery);
      await this.driver.pause(500);

      // Do not inspect results until the exact configured event is visibly
      // present in the input.  This prevents stale recent-search content from
      // being treated as a real SOURCE=search result.
      let entered = String(await searchInput.getValue().catch(() => ''));
      if (!entered) entered = String(await searchInput.getAttribute('value').catch(() => ''));
      const normalise = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
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
      await this.driver.saveScreenshot('./test-results/ios_search_query_entry_failed.png').catch(() => {});
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
      const retryQuery = `${searchQuery} upcoming`;
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
