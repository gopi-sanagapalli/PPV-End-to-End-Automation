import { AndroidBasePage, AndroidFlowHooks, WdBrowser, adbTap, getScreenSize } from '../android/AndroidBasePage';
import { sendTvKeyevent, TV_KEYCODES } from '../../utils/androidTvControls';
import { parsePPVDate } from '../../utils/eventLoader';

type FireTvBounds = { x1: number; y1: number; x2: number; y2: number };
type FireTvTile = FireTvBounds & { label: string };

export class FireTvSchedulePage extends AndroidBasePage {
  private fireTvExitDialogDismissed = false;

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

  private getXmlBounds(node: string): FireTvBounds | null {
    const match = node.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
    if (!match) return null;

    return {
      x1: Number(match[1]),
      y1: Number(match[2]),
      x2: Number(match[3]),
      y2: Number(match[4]),
    };
  }

  private async dismissFireTvExitDialogIfPresent(): Promise<boolean> {
    if (this.fireTvExitDialogDismissed) return false;

    const source = await this.driver.getPageSource().catch(() => '');
    if (!/Would you like to close DAZN\?|Close DAZN|Keep watching/.test(source)) {
      return false;
    }

    console.log('Dismissing Fire TV close-app popup with one Back before selecting Schedule...');
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
        console.log('Schedule page assertion passed: Schedule heading + date rail + event tiles visible');
        return true;
      }
    } catch {}

    return false;
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

  private async isFireTvStillOnScheduleSurface(ppvName = this.ppvName): Promise<boolean> {
    const source = await this.driver.getPageSource().catch(() => '');
    const hasScheduleChrome = /text="Schedule"|content-desc="Schedule"|text="Previous"|text="Boxing"|text="Chess"/.test(source);
    const hasScheduleContent =
      this.normalizeScheduleText(source).includes(this.normalizeScheduleText(ppvName)) ||
      /text="Sat"|text="Sun"|text="Mon"|text="Tue"|text="Wed"|text="Thu"|text="Fri"|text="Aug"|text="Sep"|text="Oct"/.test(source);

    return hasScheduleChrome && hasScheduleContent;
  }

  private async isFireTvPpvPaywallVisible(ppvName = this.ppvName): Promise<boolean> {
    const source = await this.driver.getPageSource().catch(() => '');
    const lowerSource = source.toLowerCase();
    const hasPpvName = this.normalizeScheduleText(source).includes(this.normalizeScheduleText(ppvName));
    const hasTvPurchaseMessage = lowerSource.includes('my account') && lowerSource.includes('purchase this event');
    const hasPaywallCloseButton = /text="Close"/.test(source);

    return hasPpvName && hasTvPurchaseMessage && hasPaywallCloseButton;
  }

  private isFireTvLocationUnavailableDialogVisible(source: string): boolean {
    const lowerSource = source.toLowerCase();
    return lowerSource.includes('current location') || lowerSource.includes('not available to you');
  }

  private getVisibleFireTvScheduleTiles(source: string): FireTvTile[] {
    const screen = getScreenSize();
    const tiles: FireTvTile[] = [];

    for (const match of source.matchAll(/<[^>]+>/g)) {
      const node = match[0];
      const label = this.getXmlAttribute(node, 'text') || this.getXmlAttribute(node, 'content-desc');
      if (!label || !label.includes(' vs. ')) continue;

      const bounds = this.getXmlBounds(node);
      if (!bounds) continue;

      const isVisibleTile =
        bounds.x1 >= Math.round(screen.width * 0.08) &&
        bounds.y1 >= Math.round(screen.height * 0.22) &&
        bounds.x2 > bounds.x1 &&
        bounds.y2 > bounds.y1 &&
        (bounds.x2 - bounds.x1) >= Math.round(screen.width * 0.12) &&
        (bounds.y2 - bounds.y1) >= Math.round(screen.height * 0.12);

      if (isVisibleTile) {
        tiles.push({ label, ...bounds });
      }
    }

    return tiles.sort((a, b) => a.y1 - b.y1 || a.x1 - b.x1);
  }

  private getFocusedFireTvScheduleTile(source: string, tiles: FireTvTile[]): FireTvTile | undefined {
    const screen = getScreenSize();

    for (const match of source.matchAll(/<[^>]+>/g)) {
      const node = match[0];
      if (!/focused="true"/.test(node)) continue;

      const focusedBounds = this.getXmlBounds(node);
      if (!focusedBounds) continue;
      if ((focusedBounds.x2 - focusedBounds.x1) > Math.round(screen.width * 0.75)) continue;
      if ((focusedBounds.y2 - focusedBounds.y1) > Math.round(screen.height * 0.75)) continue;

      const focusedCenterX = Math.round((focusedBounds.x1 + focusedBounds.x2) / 2);
      const focusedCenterY = Math.round((focusedBounds.y1 + focusedBounds.y2) / 2);
      const focusedTile = tiles.find(tile =>
        focusedCenterX >= tile.x1 &&
        focusedCenterX <= tile.x2 &&
        focusedCenterY >= tile.y1 &&
        focusedCenterY <= tile.y2
      );

      if (focusedTile) return focusedTile;
    }

    return undefined;
  }

  private getGridIndex(value: number, centers: number[]): number {
    return centers.findIndex(center => Math.abs(center - value) <= 120);
  }

  private async moveFireTvFocusToScheduleTile(fromTile: FireTvTile, targetTile: FireTvTile, tiles: FireTvTile[]): Promise<void> {
    const uniqueCenters = (values: number[]) => values
      .sort((a, b) => a - b)
      .reduce<number[]>((centers, value) => {
        if (!centers.some(center => Math.abs(center - value) <= 120)) centers.push(value);
        return centers;
      }, []);
    const centerX = (tile: FireTvBounds) => Math.round((tile.x1 + tile.x2) / 2);
    const centerY = (tile: FireTvBounds) => Math.round((tile.y1 + tile.y2) / 2);
    const columns = uniqueCenters(tiles.map(centerX));
    const rows = uniqueCenters(tiles.map(centerY));
    const fromColumn = this.getGridIndex(centerX(fromTile), columns);
    const targetColumn = this.getGridIndex(centerX(targetTile), columns);
    const fromRow = this.getGridIndex(centerY(fromTile), rows);
    const targetRow = this.getGridIndex(centerY(targetTile), rows);

    if (fromColumn < 0 || targetColumn < 0 || fromRow < 0 || targetRow < 0) {
      throw new Error(`Fire TV Schedule debug: could not map visible tile grid from "${fromTile.label}" to "${targetTile.label}".`);
    }

    console.log(`  Fire TV moving focus from "${fromTile.label}" to "${targetTile.label}" by remote keys.`);

    for (let step = 0; step < Math.abs(targetRow - fromRow); step++) {
      await this.pressScheduleKeyForFireTv(targetRow > fromRow ? TV_KEYCODES.DPAD_DOWN : TV_KEYCODES.DPAD_UP);
      await this.driver.pause(700);
    }

    for (let step = 0; step < Math.abs(targetColumn - fromColumn); step++) {
      await this.pressScheduleKeyForFireTv(targetColumn > fromColumn ? TV_KEYCODES.DPAD_RIGHT : TV_KEYCODES.DPAD_LEFT);
      await this.driver.pause(700);
    }
  }

  private async tapExactVisiblePpvTileForFireTv(ppvName = this.ppvName): Promise<void> {
    console.log(`Fire TV Schedule debug: clicking exact visible PPV tile: ${ppvName}`);
    await this.driver.saveScreenshot('./test-results/firetv_schedule_before_exact_tile_click.png').catch(() => {});

    const source = await this.driver.getPageSource().catch(() => '');
    const target = this.normalizeScheduleText(ppvName);
    const tiles = this.getVisibleFireTvScheduleTiles(source);

    const tile = tiles
      .filter(candidate => this.normalizeScheduleText(candidate.label) === target)
      .sort((a, b) => a.y1 - b.y1 || a.x1 - b.x1)[0];

    if (!tile) {
      await this.driver.saveScreenshot('./test-results/firetv_schedule_exact_tile_not_visible.png').catch(() => {});
      throw new Error(`Fire TV Schedule debug: exact PPV tile not visible on the checked date: ${ppvName}`);
    }

    console.log(`Fire TV Schedule debug: exact tile found: "${tile.label}" at [${tile.x1},${tile.y1}][${tile.x2},${tile.y2}]`);
    const focusedTile = this.getFocusedFireTvScheduleTile(source, tiles) || tiles[0];
    await this.moveFireTvFocusToScheduleTile(focusedTile, tile, tiles);
    await this.driver.saveScreenshot('./test-results/firetv_schedule_before_target_center.png').catch(() => {});

    const sourceBeforeCenter = await this.driver.getPageSource().catch(() => '');
    if (this.isFireTvLocationUnavailableDialogVisible(sourceBeforeCenter)) {
      await this.driver.saveScreenshot('./test-results/firetv_schedule_location_unavailable_before_center.png').catch(() => {});
      throw new Error(`Fire TV Schedule debug: location unavailable dialog appeared before opening target PPV tile: ${ppvName}`);
    }

    console.log('  Pressing Center on the exact PPV tile...');
    await this.pressScheduleKeyForFireTv(TV_KEYCODES.DPAD_CENTER);

    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      await this.driver.pause(500);
      const currentSource = await this.driver.getPageSource().catch(() => '');
      if (this.isFireTvLocationUnavailableDialogVisible(currentSource)) {
        await this.driver.saveScreenshot('./test-results/firetv_schedule_location_unavailable_after_center.png').catch(() => {});
        throw new Error(`Fire TV Schedule debug: opening "${ppvName}" showed the location unavailable dialog.`);
      }

      if (await this.isFireTvPpvPaywallVisible(ppvName)) {
        console.log(`Fire TV Schedule debug: exact PPV tile opened paywall: ${ppvName}`);
        return;
      }

      if (!await this.isFireTvStillOnScheduleSurface(ppvName)) {
        console.log(`Fire TV Schedule debug: exact PPV tile opened: ${ppvName}`);
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

  private async getVisibleBoxingFilterBoundsForFireTv(): Promise<FireTvBounds | null> {
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

  private isConfiguredPpvDateVisibleInSource(source: string, ppvDate: string): boolean {
    const parsedDate = parsePPVDate(ppvDate);
    const targetDay = String(parsedDate.day);
    const targetMonth = parsedDate.month.toLowerCase();
    const targetMonthShort = targetMonth.slice(0, 3);
    const stripOrdinals = (value: string) => value.replace(/(\d+)(st|nd|rd|th)\b/gi, '$1');
    const monthDayPattern = new RegExp(`\\b${targetMonthShort}[a-z]*\\s+${targetDay}\\b`, 'i');
    const dayMonthPattern = new RegExp(`\\b${targetDay}\\s+${targetMonthShort}[a-z]*\\b`, 'i');
    const screen = getScreenSize();

    const dateNodes: Array<FireTvBounds & { text: string }> = [];
    for (const match of source.matchAll(/<[^>]+>/g)) {
      const node = match[0];
      if (!/displayed="true"/.test(node)) continue;

      const text = this.getXmlAttribute(node, 'text') || this.getXmlAttribute(node, 'content-desc');
      if (!text) continue;

      const bounds = this.getXmlBounds(node);
      if (!bounds) continue;
      if (bounds.x2 <= bounds.x1 || bounds.y2 <= bounds.y1) continue;
      if (bounds.y2 < Math.round(screen.height * 0.16) || bounds.y1 > Math.round(screen.height * 0.95)) continue;

      dateNodes.push({ text: stripOrdinals(this.normalizeScheduleText(text)), ...bounds });
    }

    if (dateNodes.some(node => monthDayPattern.test(node.text) || dayMonthPattern.test(node.text))) {
      return true;
    }

    const dayNodes = dateNodes.filter(node => node.text === targetDay);
    const monthNodes = dateNodes.filter(node => node.text === targetMonthShort || node.text === targetMonth);

    return dayNodes.some(dayNode => monthNodes.some(monthNode => {
      const sameDateColumn = Math.abs(((dayNode.x1 + dayNode.x2) / 2) - ((monthNode.x1 + monthNode.x2) / 2)) <= 80;
      const closeDateStack = Math.abs(((dayNode.y1 + dayNode.y2) / 2) - ((monthNode.y1 + monthNode.y2) / 2)) <= 120;
      return sameDateColumn && closeDateStack;
    }));
  }

  private async moveDownAndAssertPpvDateForFireTv(eventConfig?: any): Promise<void> {
    console.log('Fire TV Schedule debug: moving Down from Boxing to check PPV date first...');
    await this.driver.saveScreenshot('./test-results/firetv_schedule_after_boxing_down.png').catch(() => {});

    const ppvDate = this.getConfiguredPpvDate(eventConfig);
    if (!ppvDate) {
      console.warn('Fire TV Schedule debug: PPV_DATE not configured, skipping date assertion.');
      return;
    }

    const maxAttempts = 15;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const sourceBeforeDown = await this.driver.getPageSource();
      if (this.isConfiguredPpvDateVisibleInSource(sourceBeforeDown, ppvDate)) {
        console.log(`Fire TV Schedule debug: PPV date "${ppvDate}" found before DOWN press ${attempt + 1}.`);
        await this.driver.saveScreenshot('./test-results/firetv_schedule_ppv_date_found.png').catch(() => {});
        return;
      }

      sendTvKeyevent(TV_KEYCODES.DPAD_DOWN);
      await this.driver.pause(1200);

      const pageSource = await this.driver.getPageSource();
      if (this.isConfiguredPpvDateVisibleInSource(pageSource, ppvDate)) {
        console.log(`Fire TV Schedule debug: PPV date "${ppvDate}" found after ${attempt + 1} DOWN press(es).`);
        await this.driver.saveScreenshot('./test-results/firetv_schedule_ppv_date_found.png').catch(() => {});
        return;
      }
      console.log(`Fire TV Schedule debug: DOWN press ${attempt + 1}: PPV date not visible yet.`);
    }

    const deadline = Date.now() + 6000;
    while (Date.now() < deadline) {
      const source = await this.driver.getPageSource().catch(() => '');
      if (this.isConfiguredPpvDateVisibleInSource(source, ppvDate)) {
        console.log(`Fire TV Schedule debug: PPV date visible before tile search: ${ppvDate}`);
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
    const candidates: FireTvTile[] = [];

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
      console.warn(`Boxing focus metadata did not update after moving Right. Continuing to PPV date check. Focused label was "${focusedLabel || 'unknown'}".`);
      return;
    }

    console.log('Boxing focused in Schedule filter row. Clicking Boxing...');
    await this.pressScheduleKeyForFireTv(TV_KEYCODES.DPAD_CENTER);
    await this.driver.pause(1500);

    const boxingSelected = await this.isBoxingHighlightedForFireTv();
    if (!boxingSelected) {
      const focusedAfterClick = (await this.getFocusedLabel()).toLowerCase();
      if (!focusedAfterClick.includes('boxing')) {
        console.warn(`Boxing click did not update Fire TV focus metadata. Continuing to PPV date check. Focused label: "${focusedAfterClick || 'unknown'}".`);
      }
    }

    await this.driver.saveScreenshot('./test-results/firetv_schedule_boxing_selected.png').catch(() => {});
    console.log('Boxing clicked on Schedule page');
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
    console.log('Navigating to Fire TV Schedule tab...');
    if (await this.navigateFireTvLeftNavToSchedule()) {
      return;
    }
    console.log('Could not navigate to Schedule tab from Fire TV left navigation');
  }

  async openPPVPaywall(eventConfig?: any, hooks: AndroidFlowHooks = {}): Promise<boolean> {
    console.log('Navigating to Fire TV Schedule page...');
    await this.navigate();
    await this.driver.pause(3000);

    const onSchedule = await this.waitForSchedulePage(45000);
    if (!onSchedule) {
      await this.driver.saveScreenshot('./test-results/schedule_navigation_failed.png');
      throw new Error('Schedule page assertion failed after clicking Schedule. Expected Schedule title plus schedule date/tile content.');
    }

    console.log('On Fire TV Schedule page');
    await this.driver.pause(2000);
    await this.focusAndClickBoxingForFireTv();
    await this.driver.pause(3000);

    console.log(`Navigating to ${this.ppvName} using Fire TV schedule controls...`);
    try {
      await this.moveDownAndAssertPpvDateForFireTv(eventConfig);
      await this.runSurfaceValidation(hooks, 'PPV Tile');
      await this.tapExactVisiblePpvTileForFireTv(this.ppvName);
      hooks.recordAvailability?.(true, undefined, 'Schedule');
    } catch (error) {
      const shot = hooks.saveScreenshot
        ? await hooks.saveScreenshot('./test-results/android_schedule_ppv_not_found.png')
        : undefined;
      hooks.recordAvailability?.(false, shot, 'Schedule');
      await hooks.generateAvailabilityFailureReport?.(`PPV "${this.ppvName}" not found on Schedule`);
      throw error;
    }

    await this.driver.pause(2000);

    const isUltimateUser = ['active_ultimate_apm', 'active_ultimate_upfront'].includes(String(process.env.USER_STATE || '').toLowerCase().trim());
    const isLoginFirst = String(process.env.LOGIN_FIRST || '').toLowerCase() === 'true';

    if (isUltimateUser && isLoginFirst) {
      console.log('[Ultimate Active User with LOGIN_FIRST=true] Tile clicked, navigated to fixture page. Ending flow.');
      return true;
    }

    console.log('  On paywall screen - will capture URL via Copy button');
    await this.runPaywallValidation(hooks);
    return true;
  }
}

export async function openFireTvSchedulePPVPaywall(
  driver: WdBrowser,
  ppvName: string,
  eventConfig?: any,
  hooks: AndroidFlowHooks = {},
): Promise<boolean> {
  return new FireTvSchedulePage(driver, ppvName).openPPVPaywall(eventConfig, hooks);
}