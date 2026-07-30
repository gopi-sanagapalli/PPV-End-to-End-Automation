import { IOSBasePage, IOSFlowHooks, WdBrowser, WdElement } from './IOSBasePage';

export class IOSSchedulePage extends IOSBasePage {
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

    let navBtn: WdElement | null = null;
    for (const sel of bottomNavSchedule) {
      try {
        const el = await this.driver.$(sel);
        if (await el.isDisplayed()) {
          navBtn = el;
          break;
        }
      } catch {}
    }

    if (navBtn) {
      console.log('  Found Schedule button, clicking...');
      await navBtn.click();
      await this.driver.pause(3000);
      await this.driver.saveScreenshot('./test-results/after_ios_schedule_click.png');
    } else {
      console.log('  Schedule button not found in bottom nav');
    }

    // Verify Schedule page title is displayed
    let titleVisible = false;
    for (const sel of scheduleTitle) {
      try {
        const el = await this.driver.$(sel);
        if (await el.isDisplayed()) {
          titleVisible = true;
          break;
        }
      } catch {}
    }
    if (titleVisible) {
      console.log('Schedule tab loaded successfully');
    } else {
      console.warn('⚠️ Schedule title not detected after navigation');
    }
  }

  async clickSportFilterIfPresent(eventConfig?: Record<string, any>): Promise<void> {
    const sport = String(eventConfig?.SPORT || 'Boxing');
    console.log(`Finding "${sport}" filter on top strip...`);

    const sportTab = [
      `-ios predicate string:(type == "XCUIElementTypeButton" OR type == "XCUIElementTypeStaticText") AND (name == "${sport}" OR label == "${sport}")`,
      `~${sport}`,
    ];

    // First check if the sport filter is already visible
    let sportEl: WdElement | null = null;
    for (const sel of sportTab) {
      try {
        const el = await this.driver.$(sel);
        if (await el.isDisplayed()) { sportEl = el; break; }
      } catch {}
    }

    // If not visible, swipe the filter strip horizontally to find it
    if (!sportEl) {
      const allSportsTab = [
        '-ios predicate string:type == "XCUIElementTypeButton" AND (name == "All Sports" OR label == "All Sports")',
        '~All Sports',
      ];
      let allSports: WdElement | null = null;
      for (const sel of allSportsTab) {
        try {
          const el = await this.driver.$(sel);
          if (await el.isDisplayed()) { allSports = el; break; }
        } catch {}
      }

      if (!allSports) {
        console.log('  All Sports tab not visible; skipping filter strip swipe');
        return;
      }

      const loc = await allSports.getLocation();
      const size = await allSports.getSize();
      const menuY = Math.round(loc.y + size.height / 2);
      const { width } = await this.driver.getWindowRect();

      for (let i = 0; i < 8 && !sportEl; i++) {
        console.log(`  Horizontal swipe ${i + 1} to find ${sport}...`);
        const fromX = Math.round(width * 0.80);
        const toX = Math.round(width * 0.20);
        await this.driver.performActions([{
          type: 'pointer', id: 'pd', parameters: { pointerType: 'touch' },
          actions: [
            { type: 'pointerMove', duration: 0, x: fromX, y: menuY },
            { type: 'pointerDown', button: 0 },
            { type: 'pause', duration: 80 },
            { type: 'pointerMove', duration: 250, x: toX, y: menuY },
            { type: 'pointerUp', button: 0 },
          ],
        }]);
        await this.driver.releaseActions();
        await this.driver.pause(500);

        for (const sel of sportTab) {
          try {
            const el = await this.driver.$(sel);
            if (await el.isDisplayed()) { sportEl = el; break; }
          } catch {}
        }
      }
    }

    if (sportEl) {
      await sportEl.click();
      // Wait for the schedule content to refresh after filter change
      await this.driver.pause(3000);
      await this.driver.saveScreenshot('./test-results/ios_schedule_after_sport_filter.png');
      console.log(`✅ ${sport} filter selected`);
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
    // Allow Schedule page content to fully render before interacting
    await this.driver.pause(7000);
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
