import { IOSBasePage, IOSFlowHooks, WdBrowser, WdElement } from './IOSBasePage';

export class IOSSchedulePage extends IOSBasePage {
  private async firstVisible(selectors: string[]): Promise<WdElement | null> {
    for (const selector of selectors) {
      try {
        const elements = await this.driver.$$(selector);
        for (const element of elements) {
          if (await element.isDisplayed().catch(() => false)) return element;
        }
      } catch {
        // The native hierarchy can change while the selected tab is loading.
      }
    }
    return null;
  }

  private async firstVisibleNearY(selectors: string[], targetY: number, tolerance = 120): Promise<WdElement | null> {
    let closest: { element: WdElement; distance: number } | null = null;
    for (const selector of selectors) {
      try {
        const elements = await this.driver.$$(selector);
        for (const element of elements) {
          if (!(await element.isDisplayed().catch(() => false))) continue;
          const location = await element.getLocation().catch(() => null);
          const size = await element.getSize().catch(() => null);
          if (!location || !size) continue;
          const distance = Math.abs(location.y + size.height / 2 - targetY);
          if (distance > tolerance) continue;
          if (distance <= Math.max(8, tolerance * 0.25)) return element;
          if (closest && distance >= closest.distance) continue;
          closest = { element, distance };
        }
      } catch {
        // The Schedule filter hierarchy can be rebuilt while the tab scrolls.
      }
    }
    return closest?.element ?? null;
  }

  private async isSelectedFilter(element: WdElement): Promise<boolean> {
    if (await element.isSelected().catch(() => false)) return true;
    const selected = String(await element.getAttribute('selected').catch(() => '')).toLowerCase();
    return selected === 'true' || selected === '1';
  }

  async navigate(eventConfig?: Record<string, any>): Promise<void> {
    console.log('Navigating to Schedule tab...');
    await this.driver.saveScreenshot('./test-results/before_ios_schedule_click.png');
    const sport = String(eventConfig?.SPORT || 'Boxing');
    const escapedSport = sport.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

    const bottomNavSchedule = [
      '-ios predicate string:type == "XCUIElementTypeButton" AND (name == "Schedule" OR label == "Schedule")',
      '~Schedule',
    ];

    const scheduleTitle = [
      '-ios predicate string:type == "XCUIElementTypeStaticText" AND (name == "Schedule" OR label == "Schedule")',
      '~Schedule',
    ];

    const allSportsTab = [
      '-ios predicate string:(type == "XCUIElementTypeButton" OR type == "XCUIElementTypeStaticText" OR type == "XCUIElementTypeOther") AND (name == "All Sports" OR label == "All Sports")',
      '-ios predicate string:(name CONTAINS[c] "All Sports" OR label CONTAINS[c] "All Sports")',
    ];
    const sportTab = [
      `-ios predicate string:(type == "XCUIElementTypeButton" OR type == "XCUIElementTypeStaticText" OR type == "XCUIElementTypeOther") AND (name == "${escapedSport}" OR label == "${escapedSport}")`,
      `-ios predicate string:(name CONTAINS[c] "${escapedSport}" OR label CONTAINS[c] "${escapedSport}")`,
    ];

    const navBtn = await this.firstVisible(bottomNavSchedule);

    if (!navBtn) {
      await this.driver.saveScreenshot('./test-results/ios_schedule_tab_not_found.png');
      throw new Error('Schedule button was not found in the native bottom navigation.');
    }

    console.log('  Found Schedule button, clicking...');
    await navBtn.click();

    // The tab bar remains visible on every screen. Do not proceed merely
    // because it still exposes "Schedule"; wait for the Schedule heading and
    // its filter strip, which confirms its data-bearing content has rendered.
    await this.driver.waitUntil(async () => {
      const { height } = await this.driver.getWindowRect().catch(() => ({ height: 0 }));
      // `~Schedule` also matches the persistent bottom-navigation button.
      // Restrict the heading to the upper screen before accepting the filter
      // strip as Schedule content.
      const title = await this.firstVisibleNearY(
        scheduleTitle,
        Math.round(height * 0.10),
        Math.round(height * 0.18),
      );
      const titleLocation = title ? await title.getLocation().catch(() => null) : null;
      const filter = titleLocation
        ? await this.firstVisibleNearY(sportTab, titleLocation.y + Math.round(height * 0.10), Math.round(height * 0.20)) ||
          await this.firstVisibleNearY(allSportsTab, titleLocation.y + Math.round(height * 0.10), Math.round(height * 0.20))
        : null;
      return Boolean(title && filter);
    }, {
      timeout: Number(process.env.IOS_SCHEDULE_LOAD_TIMEOUT_MS || 60000),
      interval: 400,
      timeoutMsg: 'Schedule page did not render its heading and filter strip after selecting the Schedule tab.',
    }).catch(async (error: any) => {
      await this.driver.saveScreenshot('./test-results/ios_schedule_not_ready.png').catch(() => { });
      throw error;
    });

    await this.driver.saveScreenshot('./test-results/after_ios_schedule_click.png');
    console.log('Schedule page content loaded successfully');
  }

  async clickSportFilterIfPresent(eventConfig?: Record<string, any>): Promise<void> {
    const sport = String(eventConfig?.SPORT || 'Boxing');
    console.log(`Finding "${sport}" filter on top strip...`);
    const escapedSport = sport.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

    const sportTab = [
      `-ios predicate string:(type == "XCUIElementTypeButton" OR type == "XCUIElementTypeStaticText" OR type == "XCUIElementTypeOther") AND (name == "${escapedSport}" OR label == "${escapedSport}")`,
      `-ios predicate string:(name CONTAINS[c] "${escapedSport}" OR label CONTAINS[c] "${escapedSport}")`,
    ];

    const allSportsTab = [
      '-ios predicate string:(type == "XCUIElementTypeButton" OR type == "XCUIElementTypeStaticText" OR type == "XCUIElementTypeOther") AND (name == "All Sports" OR label == "All Sports")',
      '-ios predicate string:(name CONTAINS[c] "All Sports" OR label CONTAINS[c] "All Sports")',
    ];
    const { width, height } = await this.driver.getWindowRect();
    let sportEl = await this.firstVisibleNearY(
      sportTab,
      Math.round(height * 0.20),
      Math.round(height * 0.24),
    );
    const allSports = sportEl ? null : await this.firstVisibleNearY(
      allSportsTab,
      Math.round(height * 0.20),
      Math.round(height * 0.24),
    );
    if (!sportEl && !allSports) {
      throw new Error('Schedule filter strip was not visible after Schedule loaded.');
    }

    const anchor = sportEl || allSports!;
    const location = await anchor.getLocation();
    const size = await anchor.getSize();
    const menuY = Math.round(location.y + size.height / 2);
    const sportContent = `-ios predicate string:name CONTAINS[c] "${sport}" OR label CONTAINS[c] "${sport}"`;
    const hasFilteredSportContent = async (): Promise<boolean> => {
      const candidates = await this.driver.$$(sportContent).catch(() => []);
      for (const candidate of candidates) {
        if (!(await candidate.isDisplayed().catch(() => false))) continue;
        const candidateLocation = await candidate.getLocation().catch(() => null);
        if (candidateLocation && candidateLocation.y > menuY + size.height / 2) return true;
      }
      return false;
    };

    // The event list can contain a Boxing label too. Restrict discovery to
    // the filter-strip row so the following click cannot select list content.
    sportEl = sportEl || await this.firstVisibleNearY(sportTab, menuY);
    for (let attempt = 0; attempt < 8 && !sportEl; attempt++) {
      console.log(`  Horizontal swipe ${attempt + 1} to find ${sport} in the filter strip...`);
      await this.driver.performActions([{
        type: 'pointer', id: 'schedule-filter-strip', parameters: { pointerType: 'touch' },
        actions: [
          { type: 'pointerMove', duration: 0, x: Math.round(width * 0.80), y: menuY },
          { type: 'pointerDown', button: 0 },
          { type: 'pause', duration: 80 },
          { type: 'pointerMove', duration: 250, x: Math.round(width * 0.20), y: menuY },
          { type: 'pointerUp', button: 0 },
        ],
      }]);
      await this.driver.releaseActions();
      await this.driver.waitUntil(async () => {
        sportEl = await this.firstVisibleNearY(sportTab, menuY);
        return Boolean(sportEl);
      }, { timeout: 1200, interval: 200 }).catch(() => { });
    }

    if (!sportEl) {
      await this.driver.saveScreenshot('./test-results/ios_schedule_sport_filter_not_found.png').catch(() => { });
      throw new Error(`${sport} filter was not found in the Schedule filter strip.`);
    }
    if (await this.isSelectedFilter(sportEl)) {
      console.log(`✅ ${sport} filter already selected`);
      return;
    }

    await sportEl.click();
    await this.driver.waitUntil(async () => {
      const selectedSport = await this.firstVisibleNearY(sportTab, menuY);
      return Boolean(selectedSport && await this.isSelectedFilter(selectedSport)) ||
        await hasFilteredSportContent();
    }, {
      timeout: Number(process.env.IOS_SCHEDULE_FILTER_TIMEOUT_MS || 2500),
      interval: 250,
      timeoutMsg: `${sport} filter did not become selected after it was tapped.`,
    }).catch(() => {
      console.warn(`⚠️ ${sport} filter selection was not exposed quickly after tap; continuing with Schedule search.`);
    });
    await this.driver.saveScreenshot('./test-results/ios_schedule_after_sport_filter.png');
    console.log(`✅ ${sport} filter applied and Schedule content settled`);
  }

  async scrollToPPVTile(ppvName = this.ppvName): Promise<WdElement | null> {
    console.log(`  Target PPV: ${ppvName}`);
    const normaliseTitle = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    const predicateValue = (value: string) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const titleTerms = normaliseTitle(ppvName)
      .split(/[^a-z0-9]+/)
      .filter(term => term.length > 2 && !['the', 'and', 'vs'].includes(term))
      .slice(0, 2);
    const zayasMainEvent = [
      `~${ppvName}`,
      `-ios predicate string:name == "${ppvName}" OR label == "${ppvName}"`,
      titleTerms.length
        ? `-ios predicate string:type == "XCUIElementTypeStaticText" AND ${titleTerms
          .map(term => `(name CONTAINS[c] "${predicateValue(term)}" OR label CONTAINS[c] "${predicateValue(term)}")`)
          .join(' AND ')}`
        : '',
    ];
    const findPPVTile = async (): Promise<WdElement | null> => {
      for (const selector of zayasMainEvent.filter(Boolean)) {
        const el = await this.driver.$(selector).catch(() => null);
        if (el && await el.isDisplayed().catch(() => false)) return el;
      }
      return null;
    };

    const { width, height } = await this.driver.getWindowRect();
    const cx = Math.round(width / 2);
    const midY = Math.round(height * 0.55);

    // Use short swipes so the native hierarchy has a chance to expose the
    // target before the next movement carries it past the viewport.
    for (let i = 0; i < 25; i++) {
      const el = await findPPVTile();
      if (el) {
        console.log(`Found "${ppvName}" tile!`);
        return el;
      }

      // Small vertical swipe up (drags contents up)
      await this.driver.performActions([{
        type: 'pointer', id: 'pd', parameters: { pointerType: 'touch' },
        actions: [
          { type: 'pointerMove', duration: 0, x: cx, y: midY + 55 },
          { type: 'pointerDown', button: 0 },
          { type: 'pause', duration: 80 },
          { type: 'pointerMove', duration: 200, x: cx, y: midY - 55 },
          { type: 'pointerUp', button: 0 },
        ],
      }]);
      await this.driver.releaseActions();
      await this.driver.pause(300);
    }

    // Scroll up recovery just in case we overshot
    for (let i = 0; i < 10; i++) {
      const el = await findPPVTile();
      if (el) {
        console.log(`Found "${ppvName}" tile on recovery!`);
        return el;
      }

      // Small vertical swipe down (drags contents down)
      await this.driver.performActions([{
        type: 'pointer', id: 'pd', parameters: { pointerType: 'touch' },
        actions: [
          { type: 'pointerMove', duration: 0, x: cx, y: midY - 45 },
          { type: 'pointerDown', button: 0 },
          { type: 'pause', duration: 80 },
          { type: 'pointerMove', duration: 200, x: cx, y: midY + 45 },
          { type: 'pointerUp', button: 0 },
        ],
      }]);
      await this.driver.releaseActions();
      await this.driver.pause(300);
    }

    return null;
  }

  async openPPVPaywall(eventConfig?: any, hooks: IOSFlowHooks = {}): Promise<boolean> {
    console.log('Navigating to Schedule page...');
    await this.navigate(eventConfig);
    await this.clickSportFilterIfPresent(eventConfig);

    console.log(`Navigating to ${this.ppvName} using iOS schedule scroll...`);
    try {
      const ppvTile = await this.scrollToPPVTile(this.ppvName);
      if (ppvTile) {
        await this.runSurfaceValidation(hooks, 'PPV Tile');
        await ppvTile.click();
        console.log(`Clicked ${this.ppvName} tile`);
      } else {
        throw new Error(`PPV tile not found: ${this.ppvName}`);
      }
      hooks.recordAvailability?.(true, undefined, 'Schedule');
    } catch (e: any) {
      const shot = hooks.saveScreenshot
        ? await hooks.saveScreenshot('./test-results/ios_schedule_ppv_not_found.png')
        : undefined;
      hooks.recordAvailability?.(false, shot, 'Schedule');
      await hooks.generateAvailabilityFailureReport?.(`PPV "${this.ppvName}" not found on Schedule`);
      throw e;
    }

    await this.driver.pause(2000);

    const isUltimateUser = ['active_ultimate_apm', 'active_ultimate_upfront'].includes(String(process.env.USER_STATE || '').toLowerCase().trim());
    const isLoginFirst = String(process.env.LOGIN_FIRST || '').toLowerCase() === 'true';

    if (isUltimateUser && isLoginFirst) {
      console.log('✨ [Ultimate Active User with LOGIN_FIRST=true] Tile clicked, navigated to fixture page. Ending flow.');
      return true;
    }

    // Validate the native paywall before the external-site CTA replaces it
    // with Apple's confirmation sheet / Safari.
    console.log('Validating native Schedule paywall before external handoff...');
    await this.driver.saveScreenshot('./test-results/ios_schedule_native_paywall.png');
    await this.runPaywallValidation(hooks);

    // Now on details page; we need to click "Go to dazn.com/start" or "Buy"
    console.log('Looking for Go-to / Buy CTA button...');
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
      await this.driver.saveScreenshot('./test-results/ios_schedule_buy_not_found.png');
      throw new Error(`❌ Could not click Buy CTA on event page`);
    }

    return true;
  }
}

export async function navigateToSchedule(driver: WdBrowser): Promise<void> {
  return new IOSSchedulePage(driver).navigate();
}

export async function scrollScheduleToPPVTile(driver: WdBrowser, ppvName: string): Promise<WdElement | null> {
  return new IOSSchedulePage(driver, ppvName).scrollToPPVTile(ppvName);
}

export async function openSchedulePPVPaywall(
  driver: WdBrowser,
  ppvName: string,
  eventConfig?: any,
  hooks: IOSFlowHooks = {},
): Promise<boolean> {
  return new IOSSchedulePage(driver, ppvName).openPPVPaywall(eventConfig, hooks);
}
