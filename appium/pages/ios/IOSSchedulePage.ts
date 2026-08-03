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
          if (distance > tolerance || (closest && distance >= closest.distance)) continue;
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

  async navigate(): Promise<void> {
    console.log('Navigating to Schedule tab...');
    await this.driver.saveScreenshot('./test-results/before_ios_schedule_click.png');

    const bottomNavSchedule = [
      '-ios predicate string:type == "XCUIElementTypeButton" AND (name == "Schedule" OR label == "Schedule")',
      '~Schedule',
    ];

    const scheduleTitle = [
      '-ios predicate string:type == "XCUIElementTypeStaticText" AND (name == "Schedule" OR label == "Schedule")',
      '~Schedule',
    ];

    const allSportsTab = [
      '-ios predicate string:type == "XCUIElementTypeButton" AND (name == "All Sports" OR label == "All Sports")',
      '~All Sports',
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
      const allSports = titleLocation
        ? await this.firstVisibleNearY(allSportsTab, titleLocation.y + Math.round(height * 0.10), Math.round(height * 0.20))
        : null;
      const pageSource = await this.driver.getPageSource().catch(() => '');
      return Boolean(title && allSports) && !/<XCUIElementTypeActivityIndicator\b/i.test(pageSource);
    }, {
      timeout: 20000,
      interval: 400,
      timeoutMsg: 'Schedule page did not render its heading and filter strip after selecting the Schedule tab.',
    }).catch(async (error: any) => {
      await this.driver.saveScreenshot('./test-results/ios_schedule_not_ready.png').catch(() => {});
      throw error;
    });

    await this.driver.saveScreenshot('./test-results/after_ios_schedule_click.png');
    console.log('Schedule page content loaded successfully');
  }

  async clickSportFilterIfPresent(eventConfig?: Record<string, any>): Promise<void> {
    const sport = String(eventConfig?.SPORT || 'Boxing');
    console.log(`Finding "${sport}" filter on top strip...`);

    const sportTab = [
      `-ios predicate string:(type == "XCUIElementTypeButton" OR type == "XCUIElementTypeStaticText") AND (name == "${sport}" OR label == "${sport}")`,
      `~${sport}`,
    ];

    const allSportsTab = [
      '-ios predicate string:type == "XCUIElementTypeButton" AND (name == "All Sports" OR label == "All Sports")',
      '~All Sports',
    ];
    const { width, height } = await this.driver.getWindowRect();
    const allSports = await this.firstVisibleNearY(
      allSportsTab,
      Math.round(height * 0.20),
      Math.round(height * 0.24),
    );
    if (!allSports) {
      throw new Error('Schedule filter strip was not visible after Schedule loaded.');
    }

    const location = await allSports.getLocation();
    const size = await allSports.getSize();
    const menuY = Math.round(location.y + size.height / 2);

    // The event list can contain a Boxing label too. Restrict discovery to
    // the filter-strip row so the following click cannot select list content.
    let sportEl = await this.firstVisibleNearY(sportTab, menuY);
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
      }, { timeout: 1200, interval: 200 }).catch(() => {});
    }

    if (sportEl) {
      if (await this.isSelectedFilter(sportEl)) {
        console.log(`✅ ${sport} filter already selected`);
        return;
      }
      const sourceBeforeFilterTap = await this.driver.getPageSource().catch(() => '');
      await sportEl.click();
      await this.driver.waitUntil(async () => {
        const selectedSport = await this.firstVisibleNearY(sportTab, menuY);
        if (!selectedSport) return false;
        const pageSource = await this.driver.getPageSource().catch(() => '');
        const selectionExposed = await this.isSelectedFilter(selectedSport);
        const contentRefreshed = Boolean(pageSource && pageSource !== sourceBeforeFilterTap);
        return !/<XCUIElementTypeActivityIndicator\b/i.test(pageSource) && (selectionExposed || contentRefreshed);
      }, {
        timeout: 10000,
        interval: 300,
        timeoutMsg: `${sport} filter did not refresh Schedule content after it was tapped.`,
      }).catch(async (error: any) => {
        await this.driver.saveScreenshot('./test-results/ios_schedule_sport_filter_not_selected.png').catch(() => {});
        throw error;
      });
      await this.driver.saveScreenshot('./test-results/ios_schedule_after_sport_filter.png');
      console.log(`✅ ${sport} filter applied and Schedule content settled`);
    } else {
      console.warn(`⚠️ ${sport} filter not found, proceeding with default list`);
    }
  }

  async scrollToPPVTile(ppvName = this.ppvName): Promise<WdElement | null> {
    console.log(`  Target PPV: ${ppvName}`);
    const zayasMainEvent = [
      `~${ppvName}`,
      `-ios predicate string:name == "${ppvName}" OR label == "${ppvName}"`,
    ];

    const { width, height } = await this.driver.getWindowRect();
    const cx = Math.round(width / 2);
    const midY = Math.round(height * 0.55);

    // Scroll down in small steps
    for (let i = 0; i < 25; i++) {
      for (const sel of zayasMainEvent) {
        try {
          const el = await this.driver.$(sel);
          if (await el.isDisplayed()) {
            console.log(`Found "${ppvName}" tile!`);
            return el;
          }
        } catch {}
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
      await this.driver.pause(500);
    }

    // Scroll up recovery just in case we overshot
    for (let i = 0; i < 10; i++) {
      for (const sel of zayasMainEvent) {
        try {
          const el = await this.driver.$(sel);
          if (await el.isDisplayed()) {
            console.log(`Found "${ppvName}" tile on recovery!`);
            return el;
          }
        } catch {}
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
      await this.driver.pause(500);
    }

    return null;
  }

  async openPPVPaywall(eventConfig?: any, hooks: IOSFlowHooks = {}): Promise<boolean> {
    console.log('Navigating to Schedule page...');
    await this.navigate();
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
