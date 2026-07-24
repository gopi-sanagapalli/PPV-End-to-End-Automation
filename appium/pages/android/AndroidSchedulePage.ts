import { AndroidBasePage, AndroidFlowHooks, WdBrowser, WdElement, adbSwipe, adbTap, getScreenSize } from './AndroidBasePage';
import { navigateToPPVTile } from '../../utils/scheduleNavigator';
import { sendTvKeyevent, TV_KEYCODES } from '../../utils/androidTvControls';
import { parsePPVDate } from '../../utils/eventLoader';

export class AndroidSchedulePage extends AndroidBasePage {
  private fireTvExitDialogDismissed = false;

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
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if (await this.dismissFireTvExitDialogIfPresent()) continue;
      if (await this.isSchedulePageVisible()) return true;
      await this.driver.pause(500);
    }

    return false;
  }

  private async dismissFireTvExitDialogIfPresent(): Promise<boolean> {
    if (!this.isFireTv()) return false;
    if (this.fireTvExitDialogDismissed) return false;

    const source = await this.driver.getPageSource().catch(() => '');
    if (!/Would you like to close DAZN\?|Close DAZN|Keep watching/.test(source)) {
      return false;
    }

    console.log('↩️ Dismissing Fire TV close-app popup with one Back before selecting Schedule...');
    sendTvKeyevent(TV_KEYCODES.BACK);
    this.fireTvExitDialogDismissed = true;
    await this.driver.pause(1500);
    return true;
  }

  private async isSchedulePageVisible(): Promise<boolean> {
    try {
      const source = await this.driver.getPageSource();
      const hasBlockingOverlay = /Would you like to close DAZN\?|Close DAZN|Keep watching/.test(source);
      const hasScheduleHeading = /text="Schedule"/.test(source);
      const hasDateRail = /text="Previous"|text="Today"|text="Tomorrow"|text="Fri"|text="Sat"|text="Sun"/.test(source);
      const hasScheduleTile = /text="LIVE"|text="Joshua|Spence|EWC|Teamfight|Matchroom|PBC/.test(source);
      const isBoxingHome = /text="Introducing Ultimate"|text="Upcoming Fights"|text="The Locker Room"/.test(source);

      if (!hasBlockingOverlay && hasScheduleHeading && hasDateRail && hasScheduleTile && !isBoxingHome) {
        console.log('✅ Schedule page assertion passed: Schedule heading + date rail + event tiles visible');
        return true;
      }
    } catch {}

    return false;
  }

  private isFireTv(): boolean {
    return String(process.env.TV_TARGET || '').toLowerCase().trim() === 'firetv';
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

  private async pressScheduleKeyForFireTv(keyCode: number): Promise<void> {
    sendTvKeyevent(keyCode);
  }

  private normalizeScheduleText(value: string): string {
    return value.replace(/\s+/g, ' ').trim().toLowerCase();
  }

  private decodeXmlAttribute(value: string): string {
    return value
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
  }

  private getXmlAttribute(node: string, attribute: string): string {
    const match = node.match(new RegExp(`${attribute}="([^"]*)"`));
    return match ? this.decodeXmlAttribute(match[1]) : '';
  }

  private getXmlBounds(node: string): { x1: number; y1: number; x2: number; y2: number } | null {
    const match = node.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
    if (!match) return null;

    return {
      x1: Number(match[1]),
      y1: Number(match[2]),
      x2: Number(match[3]),
      y2: Number(match[4]),
    };
  }

  private async isFireTvPpvPaywallVisible(ppvName = this.ppvName): Promise<boolean> {
    const source = await this.driver.getPageSource().catch(() => '');
    const lowerSource = source.toLowerCase();
    const hasPpvName = this.normalizeScheduleText(source).includes(this.normalizeScheduleText(ppvName));
    const hasTvPurchaseMessage = lowerSource.includes('my account') && lowerSource.includes('purchase this event');
    const hasPaywallCloseButton = /text="Close"/.test(source);

    return hasPpvName && hasTvPurchaseMessage && hasPaywallCloseButton;
  }

  private async tapExactVisiblePpvTileForFireTv(ppvName = this.ppvName): Promise<void> {
    console.log(`Fire TV Schedule debug: clicking exact visible PPV tile: ${ppvName}`);
    await this.driver.saveScreenshot('./test-results/firetv_schedule_before_exact_tile_click.png').catch(() => {});

    const source = await this.driver.getPageSource().catch(() => '');
    const target = this.normalizeScheduleText(ppvName);
    const candidates: Array<{ label: string; x1: number; y1: number; x2: number; y2: number }> = [];

    for (const match of source.matchAll(/<[^>]+>/g)) {
      const node = match[0];
      const text = this.getXmlAttribute(node, 'text');
      const desc = this.getXmlAttribute(node, 'content-desc');
      const label = text || desc;
      if (this.normalizeScheduleText(label) !== target) continue;

      const bounds = this.getXmlBounds(node);
      if (!bounds) continue;
      candidates.push({ label, ...bounds });
    }

    const tile = candidates
      .filter(candidate => candidate.x2 > candidate.x1 && candidate.y2 > candidate.y1)
      .sort((a, b) => a.y1 - b.y1 || a.x1 - b.x1)[0];

    if (!tile) {
      await this.driver.saveScreenshot('./test-results/firetv_schedule_exact_tile_not_visible.png').catch(() => {});
      throw new Error(`Fire TV Schedule debug: exact PPV tile not visible on the checked date: ${ppvName}`);
    }

    const tapX = Math.round((tile.x1 + tile.x2) / 2);
    const tapY = Math.round((tile.y1 + tile.y2) / 2);
    console.log(`✅ Fire TV Schedule debug: exact tile found: "${tile.label}" at [${tile.x1},${tile.y1}][${tile.x2},${tile.y2}]`);
    adbTap(tapX, tapY);

    const firstOpenDeadline = Date.now() + 2500;
    while (Date.now() < firstOpenDeadline) {
      await this.driver.pause(500);
      if (await this.isFireTvPpvPaywallVisible(ppvName)) {
        console.log(`✅ Fire TV Schedule debug: exact PPV tile opened paywall: ${ppvName}`);
        return;
      }

      if (!await this.isSchedulePageVisible()) {
        console.log(`✅ Fire TV Schedule debug: exact PPV tile opened: ${ppvName}`);
        return;
      }
    }

    console.log('  Exact PPV tile selected but paywall not open yet. Pressing Center once to activate it...');
    await this.pressScheduleKeyForFireTv(TV_KEYCODES.DPAD_CENTER);

    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      await this.driver.pause(500);
      if (await this.isFireTvPpvPaywallVisible(ppvName)) {
        console.log(`✅ Fire TV Schedule debug: exact PPV tile opened paywall: ${ppvName}`);
        return;
      }

      if (!await this.isSchedulePageVisible()) {
        console.log(`✅ Fire TV Schedule debug: exact PPV tile opened: ${ppvName}`);
        return;
      }
    }

    await this.driver.saveScreenshot('./test-results/firetv_schedule_exact_tile_click_no_navigation.png').catch(() => {});
    throw new Error(`Fire TV Schedule debug: tapped exact PPV tile but Schedule page is still visible: ${ppvName}`);
  }

  private async isBoxingHighlightedForFireTv(): Promise<boolean> {
    const selectors = [
      'android=new UiSelector().text("Boxing").selected(true)',
      'android=new UiSelector().textContains("Boxing").selected(true)',
      'android=new UiSelector().text("Boxing").focused(true)',
      'android=new UiSelector().textContains("Boxing").focused(true)',
    ];

    for (const selector of selectors) {
      const visible = await this.driver
        .$(selector)
        .isDisplayed({ timeout: 500 })
        .catch(() => false);
      if (visible) return true;
    }

    try {
      const boxingEl = await this.driver.$('android=new UiSelector().textContains("Boxing")');
      if (!await boxingEl.isDisplayed({ timeout: 500 }).catch(() => false)) return false;
      const selected = String(await boxingEl.getAttribute('selected').catch(() => '')).toLowerCase();
      const focused = String(await boxingEl.getAttribute('focused').catch(() => '')).toLowerCase();
      return selected === 'true' || focused === 'true';
    } catch {
      return false;
    }
  }

  private async getVisibleBoxingFilterBoundsForFireTv(): Promise<{ x1: number; y1: number; x2: number; y2: number } | null> {
    const source = await this.driver.getPageSource().catch(() => '');
    const screen = getScreenSize();

    for (const match of source.matchAll(/<[^>]+>/g)) {
      const node = match[0];
      const label = this.getXmlAttribute(node, 'text') || this.getXmlAttribute(node, 'content-desc');
      if (!this.normalizeScheduleText(label).includes('boxing')) continue;

      const bounds = this.getXmlBounds(node);
      if (!bounds) continue;

      const isFilterRow =
        bounds.y1 >= Math.round(screen.height * 0.10) &&
        bounds.y2 <= Math.round(screen.height * 0.36);

      if (isFilterRow) return bounds;
    }

    return null;
  }

  private async isFocusedFilterOnBoxingForFireTv(): Promise<boolean> {
    const source = await this.driver.getPageSource().catch(() => '');
    const screen = getScreenSize();
    const boxingBounds = await this.getVisibleBoxingFilterBoundsForFireTv();
    if (!boxingBounds) return false;

    for (const match of source.matchAll(/<[^>]+>/g)) {
      const node = match[0];
      if (!/focused="true"/.test(node)) continue;

      const bounds = this.getXmlBounds(node);
      if (!bounds) continue;

      const isFilterRow =
        bounds.y1 >= Math.round(screen.height * 0.10) &&
        bounds.y2 <= Math.round(screen.height * 0.36);

      if (!isFilterRow) continue;

      const focusX = Math.round((bounds.x1 + bounds.x2) / 2);
      const focusY = Math.round((bounds.y1 + bounds.y2) / 2);
      if (
        focusX >= boxingBounds.x1 &&
        focusX <= boxingBounds.x2 &&
        focusY >= boxingBounds.y1 &&
        focusY <= boxingBounds.y2
      ) {
        return true;
      }
    }

    return false;
  }

  private getConfiguredPpvDate(eventConfig?: any): string | undefined {
    const region = String(process.env.DAZN_REGION || '').toUpperCase().trim();
    return eventConfig?.regions?.[region]?.PPV_DATE || eventConfig?.global?.PPV_DATE;
  }

  private async moveDownAndAssertPpvDateForFireTv(eventConfig?: any): Promise<void> {
    console.log('Fire TV Schedule debug: moving Down from Boxing to check PPV date first...');
    sendTvKeyevent(TV_KEYCODES.DPAD_DOWN);
    await this.driver.pause(1200);
    await this.driver.saveScreenshot('./test-results/firetv_schedule_after_boxing_down.png').catch(() => {});

    const ppvDate = this.getConfiguredPpvDate(eventConfig);
    if (!ppvDate) {
      console.warn('Fire TV Schedule debug: PPV_DATE not configured, skipping date assertion.');
      return;
    }

    const parsedDate = parsePPVDate(ppvDate);
    const targetDay = String(parsedDate.day);
    const targetMonth = parsedDate.month.toLowerCase();
    const targetMonthShort = targetMonth.slice(0, 3);
    const monthDayPattern = new RegExp(`\\b${targetMonthShort}[a-z]*\\s+${targetDay}\\b`, 'i');
    const dayMonthPattern = new RegExp(`\\b${targetDay}\\s+${targetMonthShort}[a-z]*\\b`, 'i');
    const deadline = Date.now() + 6000;

    while (Date.now() < deadline) {
      const source = await this.driver.getPageSource().catch(() => '');
      const visibleTexts = Array.from(source.matchAll(/(?:text|content-desc)="([^"]+)"/g), match => match[1].trim());
      const dateVisible = visibleTexts.some(text => {
        const lower = text.toLowerCase().replace(/\s+/g, ' ').trim();
        return lower === targetDay ||
          lower.includes(`${targetDay} ${targetMonthShort}`) ||
          lower.includes(`${targetMonthShort} ${targetDay}`) ||
          lower.includes(`${targetDay} ${targetMonth}`) ||
          lower.includes(`${targetMonth} ${targetDay}`) ||
          monthDayPattern.test(lower) ||
          dayMonthPattern.test(lower);
      });

      if (dateVisible) {
        console.log(`✅ Fire TV Schedule debug: PPV date visible before tile search: ${ppvDate}`);
        return;
      }

      await this.driver.pause(500);
    }

    await this.driver.saveScreenshot('./test-results/firetv_schedule_ppv_date_not_visible.png').catch(() => {});
    throw new Error(`Fire TV Schedule debug: PPV date not visible after pressing Down from Boxing: ${ppvDate}`);
  }

  private async tapScheduleFromFireTvLeftNav(): Promise<boolean> {
    const source = await this.driver.getPageSource().catch(() => '');
    const screen = getScreenSize();
    const candidates: Array<{ label: string; x1: number; y1: number; x2: number; y2: number }> = [];

    for (const match of source.matchAll(/<[^>]+>/g)) {
      const node = match[0];
      const label = this.getXmlAttribute(node, 'text') || this.getXmlAttribute(node, 'content-desc');
      if (!this.normalizeScheduleText(label).includes('schedule')) continue;

      const bounds = this.getXmlBounds(node);
      if (!bounds) continue;

      const isLeftNavLabel =
        bounds.x1 <= Math.round(screen.width * 0.18) &&
        bounds.x2 <= Math.round(screen.width * 0.24) &&
        bounds.y1 >= Math.round(screen.height * 0.40) &&
        bounds.y2 <= Math.round(screen.height * 0.78);

      if (isLeftNavLabel) {
        candidates.push({ label, ...bounds });
      }
    }

    for (const candidate of candidates.sort((a, b) => a.y1 - b.y1)) {
      const tapX = Math.min(Math.round(screen.width * 0.13), Math.max(candidate.x2 + 40, candidate.x1));
      const tapY = Math.round((candidate.y1 + candidate.y2) / 2);
      console.log(`  Fire TV left nav Schedule candidate: "${candidate.label}" at [${candidate.x1},${candidate.y1}][${candidate.x2},${candidate.y2}], tapping row (${tapX}, ${tapY})`);
      adbTap(tapX, tapY);
      await this.driver.pause(3000);
      if (await this.waitForSchedulePage(45000)) {
        console.log('Schedule selected from Fire TV left navigation via Schedule row bounds');
        await this.driver.saveScreenshot('./test-results/after_schedule_click.png').catch(() => {});
        return true;
      }
    }

    return false;
  }

  private async focusAndClickBoxingForFireTv(): Promise<void> {
    console.log('Fire TV Schedule flow: highlighting Boxing filter...');
    await this.driver.pause(1200);

    console.log('  Moving Up once to place focus on the Schedule filter row...');
    await this.pressScheduleKeyForFireTv(TV_KEYCODES.DPAD_UP);
    await this.driver.pause(900);

    let focusedLabel = '';
    let boxingFocused = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      focusedLabel = (await this.getFocusedLabel()).toLowerCase();
      boxingFocused =
        focusedLabel.includes('boxing') ||
        await this.isBoxingHighlightedForFireTv() ||
        await this.isFocusedFilterOnBoxingForFireTv();

      if (boxingFocused) break;

      console.log(`  Boxing not focused yet. Current focus: ${focusedLabel || 'unknown'}. Moving Right (${attempt + 1}/5)...`);
      await this.pressScheduleKeyForFireTv(TV_KEYCODES.DPAD_RIGHT);
      await this.driver.pause(700);
    }

    focusedLabel = (await this.getFocusedLabel()).toLowerCase();
    boxingFocused =
      boxingFocused ||
      focusedLabel.includes('boxing') ||
      await this.isBoxingHighlightedForFireTv() ||
      await this.isFocusedFilterOnBoxingForFireTv();

    if (!boxingFocused) {
      await this.driver.saveScreenshot('./test-results/firetv_schedule_boxing_not_highlighted.png').catch(() => {});
      console.warn(`⚠️ Boxing focus metadata did not update after moving Right. Continuing to PPV date check. Focused label was "${focusedLabel || 'unknown'}".`);
      return;
    }

    console.log('✅ Boxing focused in Schedule filter row. Clicking Boxing...');
    await this.pressScheduleKeyForFireTv(TV_KEYCODES.DPAD_CENTER);
    await this.driver.pause(1500);

    const boxingSelected = await this.isBoxingHighlightedForFireTv();

    if (!boxingSelected) {
      const focusedAfterClick = (await this.getFocusedLabel()).toLowerCase();
      if (!focusedAfterClick.includes('boxing')) {
        console.warn(`⚠️ Boxing click did not update Fire TV focus metadata. Continuing to PPV date check. Focused label: "${focusedAfterClick || 'unknown'}".`);
      }
    }

    await this.driver.saveScreenshot('./test-results/firetv_schedule_boxing_selected.png').catch(() => {});
    console.log('✅ Boxing clicked on Schedule page');
  }

  private async navigateFireTvLeftNavToSchedule(): Promise<boolean> {
    console.log('Fire TV Schedule flow: opening left navigation and selecting Schedule...');
    this.fireTvExitDialogDismissed = false;

    sendTvKeyevent(TV_KEYCODES.DPAD_LEFT);
    await this.driver.pause(1200);

    if (await this.tapScheduleFromFireTvLeftNav()) {
      return true;
    }

    await this.driver.saveScreenshot('./test-results/firetv_left_nav_schedule_not_ready.png').catch(() => {});
    console.log('  Fire TV left navigation Schedule selection did not complete.');
    return false;
  }

  async navigate(): Promise<void> {
    console.log('Navigating to Schedule tab...');

    if (this.isFireTv()) {
      if (await this.navigateFireTvLeftNavToSchedule()) {
        return;
      }
      console.log('Could not navigate to Schedule tab from Fire TV left navigation');
      return;
    }

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
        if (await this.waitForSchedulePage(this.isFireTv() ? 45000 : 5000)) {
          console.log('Schedule tab clicked successfully');
          await this.driver.saveScreenshot('./test-results/after_schedule_click.png');
          return;
        }

        if (await this.tapElementCenter(scheduleEl, 'Schedule')) {
          if (await this.waitForSchedulePage(this.isFireTv() ? 45000 : 5000)) {
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

    if (this.isFireTv()) {
      console.log('Could not navigate to Schedule tab from Fire TV left navigation');
      return;
    }

    const screenSize = getScreenSize();
    const bottomNavY = Math.round(screenSize.height * 0.92);
    const scheduleX = Math.round(screenSize.width * 0.70);
    console.log(`  Tapping Schedule at coordinates (${scheduleX}, ${bottomNavY})`);
    adbTap(scheduleX, bottomNavY);
    await this.driver.pause(3000);
    await this.driver.saveScreenshot('./test-results/after_schedule_click.png');

    if (await this.waitForSchedulePage(this.isFireTv() ? 45000 : 5000)) {
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

    let onSchedule = await this.waitForSchedulePage(this.isFireTv() ? 45000 : 8000);
    if (!onSchedule) {
      await this.driver.saveScreenshot('./test-results/schedule_navigation_failed.png');
      throw new Error('Schedule page assertion failed after clicking Schedule. Expected Schedule title plus schedule date/tile content.');
    }

    console.log('On Schedule page');
    await this.driver.pause(2000);
    const isFireTv = (process.env.TV_TARGET || '').toLowerCase().trim() === 'firetv';
    if (isFireTv) {
      await this.focusAndClickBoxingForFireTv();
    } else {
      await this.clickBoxingFilterIfPresent();
    }
    await this.driver.pause(3000);

    console.log(`Navigating to ${this.ppvName} using schedule navigator...`);
    try {
      if (isFireTv) {
        await this.moveDownAndAssertPpvDateForFireTv(eventConfig);
        await this.runSurfaceValidation(hooks, 'PPV Tile');
        await this.tapExactVisiblePpvTileForFireTv(this.ppvName);
      } else if (eventConfig) {
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

  async debugFireTvBoxingAndPpvTile(eventConfig?: any, hooks: AndroidFlowHooks = {}): Promise<void> {
    if (await this.isFireTvPpvPaywallVisible(this.ppvName)) {
      console.log(`✅ Fire TV Schedule debug: PPV paywall already open for ${this.ppvName}`);
      return;
    }

    console.log('Fire TV Schedule debug: verifying current Schedule page...');
    let onSchedule = await this.waitForSchedulePage(8000);
    if (!onSchedule) {
      console.log('Fire TV Schedule debug: not on Schedule page yet, navigating to Schedule first...');
      await this.navigate();
      onSchedule = await this.waitForSchedulePage(45000);
      if (!onSchedule) {
        await this.driver.saveScreenshot('./test-results/firetv_schedule_debug_not_on_schedule.png').catch(() => {});
        throw new Error('Fire TV Schedule debug could not navigate to the Schedule page.');
      }
    }

    if (String(process.env.SKIP_BOXING || '').toLowerCase().trim() === 'true') {
      console.log('Fire TV Schedule debug: Boxing already selected, skipping Boxing filter selection.');
    } else {
      console.log('Fire TV Schedule debug: selecting Boxing from the Schedule filter row.');
      await this.focusAndClickBoxingForFireTv();
    }

    await this.moveDownAndAssertPpvDateForFireTv(eventConfig);

    console.log(`Fire TV Schedule debug: PPV date checked. Clicking exact visible tile for ${this.ppvName}...`);
    await this.tapExactVisiblePpvTileForFireTv(this.ppvName);
    await this.driver.saveScreenshot('./test-results/firetv_schedule_debug_after_tile_click.png').catch(() => {});
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

export async function debugFireTvScheduleBoxingAndPpvTile(
  driver: WdBrowser,
  ppvName: string,
  eventConfig?: any,
  hooks: AndroidFlowHooks = {},
): Promise<void> {
  return new AndroidSchedulePage(driver, ppvName).debugFireTvBoxingAndPpvTile(eventConfig, hooks);
}
