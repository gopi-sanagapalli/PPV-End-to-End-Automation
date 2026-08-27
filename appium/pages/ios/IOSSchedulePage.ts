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

  private async waitForFilteredScheduleContent(sport: string, ppvName = this.ppvName): Promise<'events' | 'empty'> {
    const timeoutMs = Number(process.env.IOS_SCHEDULE_FILTERED_CONTENT_TIMEOUT_MS || 30000);
    const deadline = Date.now() + timeoutMs;
    const expectedTitle = this.normalisePpvMatchText(ppvName);
    let sawEmptyState = false;
    while (Date.now() < deadline) {
      const { height } = await this.driver.getWindowRect().catch(() => ({ height: 0 }));
      const source = await this.driver.getPageSource().catch(() => '');
      const lowerSource = source.toLowerCase();
      const normalisedSource = this.normalisePpvMatchText(source);
      const loading = await this.driver.$$('-ios predicate string:type == "XCUIElementTypeActivityIndicator"')
        .then(async indicators => {
          for (const indicator of indicators) {
            if (await indicator.isDisplayed().catch(() => false)) return true;
          }
          return false;
        })
        .catch(() => false);

      if (!loading) {
        if (expectedTitle && normalisedSource.includes(expectedTitle)) return 'events';
        if (lowerSource.includes('no events scheduled')) {
          sawEmptyState = true;
        } else {
          const visibleTexts = await this.driver.$$('-ios predicate string:type == "XCUIElementTypeStaticText"')
            .catch(() => []);
          for (const text of visibleTexts) {
            if (!(await text.isDisplayed().catch(() => false))) continue;
            const location = await text.getLocation().catch(() => null);
            if (location && location.y > height * 0.20) return 'events';
          }
        }
      }

      await this.driver.pause(500);
    }
    if (sawEmptyState) return 'empty';
    throw new Error(`Schedule content did not finish loading after selecting ${sport}.`);
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
      `-ios predicate string:(type == "XCUIElementTypeButton" OR type == "XCUIElementTypeStaticText" OR type == "XCUIElementTypeOther") AND (name CONTAINS[c] "${escapedSport}" OR label CONTAINS[c] "${escapedSport}")`,
    ];

    const allSportsTab = [
      '-ios predicate string:(type == "XCUIElementTypeButton" OR type == "XCUIElementTypeStaticText" OR type == "XCUIElementTypeOther") AND (name == "All Sports" OR label == "All Sports")',
      '-ios predicate string:(type == "XCUIElementTypeButton" OR type == "XCUIElementTypeStaticText" OR type == "XCUIElementTypeOther") AND (name CONTAINS[c] "All Sports" OR label CONTAINS[c] "All Sports")',
    ];
    const { width, height } = await this.driver.getWindowRect();
    // The Schedule strip is always directly beneath the header, but some
    // iOS builds expose its chips only after they enter the viewport. Use the
    // stable strip row rather than requiring an All Sports accessibility node
    // before beginning the horizontal search.
    const menuY = Math.round(height * 0.14);
    const findSportInStrip = async (): Promise<WdElement | null> => {
      const candidates = await this.driver.$$(
        `-ios predicate string:(type == "XCUIElementTypeButton" OR type == "XCUIElementTypeStaticText" OR type == "XCUIElementTypeOther") AND (name == "${escapedSport}" OR label == "${escapedSport}" OR name CONTAINS[c] "${escapedSport}" OR label CONTAINS[c] "${escapedSport}")`,
      ).catch(() => []);
      for (const candidate of candidates) {
        if (!(await candidate.isDisplayed().catch(() => false))) continue;
        const location = await candidate.getLocation().catch(() => null);
        const size = await candidate.getSize().catch(() => null);
        const centreY = location && size ? location.y + size.height / 2 : -1;
        if (Math.abs(centreY - menuY) <= Math.round(height * 0.08)) return candidate;
      }
      return null;
    };
    await this.driver.pause(Number(process.env.IOS_SCHEDULE_FILTER_STRIP_SETTLE_MS || 1000));
    let sportEl = await findSportInStrip();
    const filterSearchDeadline = Date.now() + Number(process.env.IOS_SCHEDULE_FILTER_SEARCH_TIMEOUT_MS || 180000);
    let swipes = 0;
    while (Date.now() < filterSearchDeadline && !sportEl) {
      console.log(`  Horizontal swipe ${swipes + 1} to find ${sport} in the filter strip...`);
      await this.driver.performActions([{
        type: 'pointer', id: 'schedule-filter-strip', parameters: { pointerType: 'touch' },
        actions: [
          { type: 'pointerMove', duration: 0, x: Math.round(width * 0.70), y: menuY },
          { type: 'pointerDown', button: 0 },
          { type: 'pause', duration: 40 },
          { type: 'pointerMove', duration: 180, x: Math.round(width * 0.30), y: menuY },
          { type: 'pointerUp', button: 0 },
        ],
      }]);
      await this.driver.releaseActions();
      swipes++;
      await this.driver.pause(200);
      sportEl = await findSportInStrip();
    }

    if (!sportEl) {
      await this.driver.saveScreenshot('./test-results/ios_schedule_sport_filter_not_found.png').catch(() => { });
      throw new Error(`${sport} filter was not found in the Schedule filter strip.`);
    }
    // Tap the sport filter using coordinates (more reliable on real iOS).
    const currentSportEl = sportEl;
    const loc = await currentSportEl.getLocation().catch(() => null);
    const sz = await currentSportEl.getSize().catch(() => null);
    if (loc && sz) {
      const tapX = Math.round(loc.x + sz.width / 2);
      const tapY = Math.round(loc.y + sz.height / 2);
      await this.driver.performActions([{
        type: 'pointer', id: 'schedule-filter-tap', parameters: { pointerType: 'touch' },
        actions: [
          { type: 'pointerMove', duration: 0, x: tapX, y: tapY },
          { type: 'pointerDown', button: 0 },
          { type: 'pause', duration: 40 },
          { type: 'pointerUp', button: 0 },
        ],
      }]);
      await this.driver.releaseActions();
    } else {
      await currentSportEl.click();
    }
    const contentState = await this.waitForFilteredScheduleContent(sport, this.ppvName);
    await this.driver.saveScreenshot('./test-results/ios_schedule_after_sport_filter.png');
    if (contentState === 'empty') throw new Error(`No events scheduled for ${sport} in Schedule.`);
    console.log(`✅ ${sport} filter applied and Schedule content settled`);
  }

  async scrollToPPVTile(ppvName = this.ppvName): Promise<WdElement | null> {
    console.log(`  Target PPV: ${ppvName}`);
    const expectedTitle = this.normalisePpvMatchText(ppvName);
    const isAncillaryTitle = (value: string) =>
      /press conference|weigh.?in|prelims?|workout|replay|highlights?|preview|promo|interview|behind the|episode|documentary|face off/i.test(value);
    const isMainEventTitle = (value: string) => {
      const normalised = this.normalisePpvMatchText(value)
        .replace(/\b(?:article|epg|list)\b.*$/i, '')
        .trim();
      return normalised === expectedTitle && !isAncillaryTitle(value);
    };
    const titleTermVariants = this.ppvTitleTermVariants(ppvName)
      .slice(0, 2);
    const zayasMainEvent = [
      `~${ppvName}`,
      `-ios predicate string:name == "${ppvName}" OR label == "${ppvName}"`,
      titleTermVariants.length
        ? `-ios predicate string:type == "XCUIElementTypeStaticText" AND ${titleTermVariants
          .map(variants => `(${variants
            .map(term => `name CONTAINS[c] "${this.iosPredicateValue(term)}" OR label CONTAINS[c] "${this.iosPredicateValue(term)}"`)
            .join(' OR ')})`)
          .join(' AND ')}`
        : '',
    ];
    const findPPVTile = async (): Promise<WdElement | null> => {
      for (const selector of zayasMainEvent.filter(Boolean)) {
        const elements = await this.driver.$$(selector).catch(() => []);
        for (const el of elements) {
          if (!(await el.isDisplayed().catch(() => false))) continue;
          const text = [
            await el.getAttribute('label').catch(() => ''),
            await el.getAttribute('name').catch(() => ''),
            await el.getText().catch(() => ''),
          ].find(Boolean) || '';
          if (isMainEventTitle(text)) return el;
        }
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

    try {
      await this.clickSportFilterIfPresent(eventConfig);
      console.log(`Navigating to ${this.ppvName} using iOS schedule scroll...`);
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
      await this.validateUltimateFixtureOrPreviewPage(hooks);
      console.log('✨ [Ultimate Active User with LOGIN_FIRST=true] Tile clicked, navigated to fixture page. Ending flow.');
      return true;
    }

    // Validate the native paywall before the external-site CTA replaces it
    // with Apple's confirmation sheet / Safari.
    console.log('Validating native Schedule paywall before external handoff...');
    await this.driver.saveScreenshot('./test-results/ios_schedule_native_paywall.png');
    await this.runPaywallValidation(hooks);
    if (await this.handleUsNativePaywallSheet(hooks)) return true;

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
