import { AndroidBasePage, AndroidFlowHooks, WdBrowser, WdElement, adbSwipe, adbTap, getScreenSize } from './AndroidBasePage';
import { navigateToPPVTile } from '../../utils/scheduleNavigator';
import { sendTvKeyevent, TV_KEYCODES } from '../../utils/androidTvControls';

export class AndroidSchedulePage extends AndroidBasePage {
  private async tapElementCenter(el: WdElement, label: string): Promise<boolean> {
    try {
      const rect = await el.getRect();
      adbTap(Math.round(rect.x + rect.width / 2), Math.round(rect.y + rect.height / 2));
      await this.driver.pause(1500);
      console.log(`  ${label} tapped by center coordinates`);
      return true;
    } catch {
      return false;
    }
  }

  private async waitForSchedulePage(timeoutMs = 8000): Promise<boolean> {
    const monthPattern = '(January|February|March|April|May|June|July|August|September|October|November|December|JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)';
    const contentSelectors = [
      'android=new UiSelector().text("Boxing")',
      'android=new UiSelector().textContains("Boxing")',
      'android=new UiSelector().textContains("Today")',
      'android=new UiSelector().textContains("Tomorrow")',
      `android=new UiSelector().textMatches("(?i).*${monthPattern}.*")`,
    ];
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      for (const selector of contentSelectors) {
        try {
          const el = await this.driver.$(selector);
          if (await el.isDisplayed({ timeout: 400 }).catch(() => false)) {
            return true;
          }
        } catch {}
      }
      await this.driver.pause(500);
    }

    return false;
  }

  private async getFocusedLabel(): Promise<string> {
    try {
      const focused = await this.driver.$('//*[@focused="true"]');
      if (await focused.isDisplayed({ timeout: 400 }).catch(() => false)) {
        const text = String(await focused.getText().catch(() => '')).trim();
        const desc = String(await focused.getAttribute('contentDescription').catch(() => '')).trim();
        return (text || desc || '').trim();
      }
    } catch {}

    return '';
  }

  private async focusAndClickBoxingForFireTv(): Promise<void> {
    console.log('Fire TV Schedule flow: move focus to Boxing (UP + RIGHT), verify focus, then click...');
    await this.driver.pause(1200);

    sendTvKeyevent(TV_KEYCODES.DPAD_UP);
    await this.driver.pause(450);
    sendTvKeyevent(TV_KEYCODES.DPAD_RIGHT);
    await this.driver.pause(600);

    const focusedLabel = (await this.getFocusedLabel()).toLowerCase();
    if (!focusedLabel.includes('boxing')) {
      await this.driver.saveScreenshot('./test-results/firetv_schedule_boxing_focus_failed.png').catch(() => {});
      throw new Error(`Schedule->Boxing focus assertion failed. Expected focus on Boxing after UP+RIGHT, got "${focusedLabel || 'unknown'}".`);
    }
    console.log('✅ Boxing is focused after UP + RIGHT');

    sendTvKeyevent(TV_KEYCODES.DPAD_CENTER);
    await this.driver.pause(1500);

    const boxingSelected = await this.driver
      .$('android=new UiSelector().text("Boxing").selected(true)')
      .isDisplayed({ timeout: 1200 })
      .catch(() => false);

    if (!boxingSelected) {
      await this.driver.saveScreenshot('./test-results/firetv_schedule_boxing_click_failed.png').catch(() => {});
      throw new Error('Boxing selection assertion failed after clicking Boxing on Schedule.');
    }

    await this.driver.saveScreenshot('./test-results/firetv_schedule_boxing_selected.png').catch(() => {});
    console.log('✅ Boxing selected on Schedule page');
  }

  async navigate(): Promise<void> {
    console.log('Navigating to Schedule tab...');
    await this.driver.saveScreenshot('./test-results/before_schedule_click.png');

    console.log('  Looking for Schedule button by text/description...');
    const scheduleSelectors = [
      'android=new UiSelector().text("Schedule")',
      'android=new UiSelector().textMatches("(?i)^schedule$")',
      'android=new UiSelector().descriptionContains("Schedule")',
      '//android.widget.TextView[@text="Schedule"]',
      '//*[@content-desc[contains(.,"Schedule")]]',
    ];

    for (const selector of scheduleSelectors) {
      try {
        const scheduleEl = await this.driver.$(selector);
        if (!await scheduleEl.isDisplayed({ timeout: 1000 }).catch(() => false)) continue;

        console.log(`  Found Schedule candidate: ${selector}`);
        await scheduleEl.click().catch(() => undefined);
        await this.driver.pause(2000);
        if (await this.waitForSchedulePage(5000)) {
          console.log('Schedule tab clicked successfully');
          await this.driver.saveScreenshot('./test-results/after_schedule_click.png');
          return;
        }

        if (await this.tapElementCenter(scheduleEl, 'Schedule')) {
          if (await this.waitForSchedulePage(5000)) {
            console.log('Schedule tab clicked successfully');
            await this.driver.saveScreenshot('./test-results/after_schedule_click.png');
            return;
          }
        }
      } catch {
        console.log(`  Schedule candidate not usable: ${selector}`);
      }
    }

    console.log('  Taking screenshot to see home page layout...');
    await this.driver.saveScreenshot('./test-results/home_page_before_schedule.png');

    const screenSize = getScreenSize();
    const bottomNavY = Math.round(screenSize.height * 0.92);
    const scheduleX = Math.round(screenSize.width * 0.70);
    console.log(`  Tapping Schedule at coordinates (${scheduleX}, ${bottomNavY})`);
    adbTap(scheduleX, bottomNavY);
    await this.driver.pause(3000);
    await this.driver.saveScreenshot('./test-results/after_schedule_click.png');

    if (await this.waitForSchedulePage(5000)) {
      console.log('Schedule tab clicked successfully');
      return;
    }

    console.log('Could not navigate to Schedule tab');
  }

  async scrollToPPVTile(ppvName = this.ppvName): Promise<WdElement | null> {
    console.log(`  Target PPV: ${ppvName}`);
    console.log('  Step 1: Fast scroll to July...');

    for (let i = 0; i < 20; i++) {
      if (await this.isVisible('July', 300) || await this.isVisible('JUL', 300)) {
        console.log(`  Found July (step ${i + 1})`);
        break;
      }
      const screen = getScreenSize();
      adbSwipe(
        Math.round(screen.width / 2),
        Math.round(screen.height * 0.75),
        Math.round(screen.width / 2),
        Math.round(screen.height * 0.20),
      );
      await this.driver.pause(500);
    }

    await this.driver.pause(1000);
    console.log('  Step 2: Searching July for PPV...');

    for (let i = 0; i < 20; i++) {
      try {
        const textViews = await this.driver.$$('android=new UiSelector().className("android.widget.TextView")').catch(() => []);
        let ppvEl: WdElement | null = null;

        // Try exact match first
        for (const el of textViews) {
          const txt = await el.getText().catch(() => '');
          if (txt.toLowerCase().trim() === ppvName.toLowerCase().trim()) {
            ppvEl = el;
            break;
          }
        }

        // Try contains check excluding ancillary keywords
        if (!ppvEl) {
          for (const el of textViews) {
            const txt = await el.getText().catch(() => '');
            const lower = txt.toLowerCase();
            if (
              lower.includes(ppvName.toLowerCase()) &&
              !lower.includes('weigh') &&
              !lower.includes('press') &&
              !lower.includes('media') &&
              !lower.includes('workout') &&
              !lower.includes('undercard')
            ) {
              ppvEl = el;
              break;
            }
          }
        }

        if (ppvEl && await ppvEl.isDisplayed()) {
          console.log(`Found "${ppvName}" (step ${i + 1})`);
          const rect = await ppvEl.getRect();
          const screenH = getScreenSize().height;
          const bottomNavThreshold = screenH * 0.75;

          if (rect.y > bottomNavThreshold) {
            console.log(`  Tile at y=${rect.y}, scrolling to center...`);
            const screen = getScreenSize();
            adbSwipe(
              Math.round(screen.width / 2),
              Math.round(screenH * 0.75),
              Math.round(screen.width / 2),
              Math.round(screenH * 0.55),
            );
            await this.driver.pause(500);

            adbSwipe(
              Math.round(screen.width / 2),
              Math.round(screenH * 0.7),
              Math.round(screen.width / 2),
              Math.round(screenH * 0.3),
            );
            await this.driver.pause(1500);

            let centeredEl: WdElement | null = null;
            const updatedViews = await this.driver.$$('android=new UiSelector().className("android.widget.TextView")').catch(() => []);
            for (const el of updatedViews) {
              const txt = await el.getText().catch(() => '');
              if (txt.toLowerCase().trim() === ppvName.toLowerCase().trim()) {
                centeredEl = el;
                break;
              }
            }
            if (!centeredEl) {
              for (const el of updatedViews) {
                const txt = await el.getText().catch(() => '');
                const lower = txt.toLowerCase();
                if (
                  lower.includes(ppvName.toLowerCase()) &&
                  !lower.includes('weigh') &&
                  !lower.includes('press') &&
                  !lower.includes('media') &&
                  !lower.includes('workout') &&
                  !lower.includes('undercard')
                ) {
                  centeredEl = el;
                  break;
                }
              }
            }

            if (centeredEl && await centeredEl.isDisplayed()) {
              const newRect = await centeredEl.getRect();
              console.log(`  Tile centered at y=${newRect.y}`);
              return centeredEl;
            }
          }

          return ppvEl;
        }
      } catch {}

      if (await this.isVisible('August', 200) || await this.isVisible('AUG', 200)) {
        console.log('  Reached August - stopping');
        break;
      }

      const screen = getScreenSize();
      adbSwipe(
        Math.round(screen.width / 2),
        Math.round(screen.height * 0.55),
        Math.round(screen.width / 2),
        Math.round(screen.height * 0.45),
      );
      await this.driver.pause(800);
    }

    return null;
  }

  async clickBoxingFilterIfPresent(): Promise<void> {
    console.log('Finding Boxing filter...');
    const selectors = [
      'android=new UiSelector().text("Boxing")',
      'android=new UiSelector().textContains("Boxing")',
      '//android.widget.TextView[@text="Boxing"]',
    ];

    const tryClick = async (): Promise<boolean> => {
      for (const selector of selectors) {
        try {
          const boxingEl = await this.driver.$(selector);
          if (!await boxingEl.isDisplayed({ timeout: 800 }).catch(() => false)) continue;

          await boxingEl.click().catch(() => undefined);
          await this.driver.pause(1200);
          console.log(`Boxing filter clicked successfully via ${selector}`);
          return true;
        } catch {}
      }
      return false;
    };

    if (await tryClick()) return;

    console.log('  Boxing filter not immediately visible - swiping filter rail...');
    const screen = getScreenSize();
    for (let i = 0; i < 5; i++) {
      adbSwipe(
        Math.round(screen.width * 0.75),
        Math.round(screen.height * 0.22),
        Math.round(screen.width * 0.25),
        Math.round(screen.height * 0.22),
      );
      await this.driver.pause(700);
      if (await tryClick()) return;
    }

    await this.driver.saveScreenshot('./test-results/android_schedule_boxing_not_found.png').catch(() => {});
    if (String(process.env.TV_TARGET || '').toLowerCase().trim() === 'androidtv') {
      throw new Error('Boxing filter not found on Schedule page. See test-results/android_schedule_boxing_not_found.png');
    }

    console.log('  Boxing filter not found - continuing without filter');
  }

  async openPPVPaywall(eventConfig?: any, hooks: AndroidFlowHooks = {}): Promise<boolean> {
    console.log('Navigating to Schedule page...');
    await this.navigate();
    await this.driver.pause(3000);

    let onSchedule = false;
    const scheduleIndicators = [
      'android=new UiSelector().textMatches("(?i)^schedule$")',
      'android=new UiSelector().descriptionContains("Schedule")',
    ];

    for (const selector of scheduleIndicators) {
      try {
        const el = await this.driver.$(selector);
        if (await el.isDisplayed({ timeout: 500 }).catch(() => false)) {
          onSchedule = true;
          break;
        }
      } catch {}
    }

    if (!onSchedule) {
      await this.driver.saveScreenshot('./test-results/schedule_navigation_failed.png');
      throw new Error('Schedule page header was not detected after navigation.');
    }

    console.log('On Schedule page');
    await this.driver.pause(2000);
    if ((process.env.TV_TARGET || '').toLowerCase().trim() === 'firetv') {
      await this.focusAndClickBoxingForFireTv();
    } else {
      await this.clickBoxingFilterIfPresent();
    }
    await this.driver.pause(3000);

    console.log(`Navigating to ${this.ppvName} using schedule navigator...`);
    try {

      if (eventConfig) {
        await navigateToPPVTile(this.driver, eventConfig, hooks);
      } else {
        const ppvTile = await this.scrollToPPVTile(this.ppvName);
        if (ppvTile) {
          await this.runSurfaceValidation(hooks, 'PPV Tile');
          await ppvTile.click();
          console.log(`Clicked ${this.ppvName} tile`);
        }
      }
      hooks.recordAvailability?.(true, undefined, 'Schedule');
    } catch (e: any) {
      const shot = hooks.saveScreenshot
        ? await hooks.saveScreenshot('./test-results/android_schedule_ppv_not_found.png')
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

    console.log('  On paywall screen - will capture URL via Copy button');
    await this.runPaywallValidation(hooks);
    return true;
  }
}

export async function navigateToSchedule(driver: WdBrowser): Promise<void> {
  return new AndroidSchedulePage(driver).navigate();
}

export async function scrollScheduleToPPVTile(driver: WdBrowser, ppvName: string): Promise<WdElement | null> {
  return new AndroidSchedulePage(driver, ppvName).scrollToPPVTile(ppvName);
}

export async function openSchedulePPVPaywall(
  driver: WdBrowser,
  ppvName: string,
  eventConfig?: any,
  hooks: AndroidFlowHooks = {},
): Promise<boolean> {
  return new AndroidSchedulePage(driver, ppvName).openPPVPaywall(eventConfig, hooks);
}
