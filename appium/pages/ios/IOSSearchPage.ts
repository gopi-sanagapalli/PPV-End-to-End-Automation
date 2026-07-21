import { IOSBasePage, IOSFlowHooks, WdBrowser, WdElement } from './IOSBasePage';

export class IOSSearchPage extends IOSBasePage {
  async navigate(): Promise<void> {
    console.log('Navigating to Search screen...');
    await this.driver.saveScreenshot('./test-results/before_ios_search_click.png');

    const searchSelectors = [
      '-ios predicate string:(name == "Search" OR label == "Search") AND type == "XCUIElementTypeButton"',
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
      console.log('  Found Search button, clicking...');
      await searchBtn.click();
      await this.driver.pause(3000);
      await this.driver.saveScreenshot('./test-results/after_ios_search_click.png');
    } else {
      console.warn('  Search button not found in bottom nav');
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
    let searchInput = null;
    const inputSelectors = [
      '//XCUIElementTypeSearchField',
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

    if (searchInput) {
      try {
        await searchInput.click();
        await this.driver.pause(1000);
        await searchInput.setValue(searchQuery);
        await this.driver.pause(1500);

        // Tap keyboard "Search" button if visible
        const searchKey = await this.driver.$('~Search');
        if (await searchKey.isDisplayed().catch(() => false)) {
          await searchKey.click();
        } else {
          // Fallback key event
          await this.driver.keys(['\n']);
        }
        await this.driver.pause(1000);
      } catch (e: any) {
        console.warn(`Search input interaction failed: ${e.message}`);
      }
    } else {
      console.warn('Search input not found on Search screen');
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
      await this.navigate();
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

    // Now on event page, we need to click Buy CTA
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
