import { Page } from '@playwright/test';

export interface RailTileMatch {
  railIndex: number;
  railTitle: string;
  railId: string;
  tileIndex: number;
  tileTitle: string;
  tileId: string;
  entitlementIds: string[];
  imageUrl?: string;
}

export interface RailsInterceptResult {
  allRails: unknown[];
  matchingTiles: RailTileMatch[];
  rawResponse?: unknown[];
}

type AnyRecord = Record<string, unknown>;

export class RailsInterceptor {
  private allRails: AnyRecord[] = [];
  private intercepting = false;
  private responseHandler?: (response: any) => Promise<void>;
  private readonly seenRailKeys = new Set<string>();

  constructor(private readonly page: Page) {}

  /**
   * Capture every JSON response during `action`, extract rail-like objects,
   * and optionally return entitlement matches.
   *
   * Start capture before navigation or the action that loads the home rails.
   */
  async captureAllRailsResponses(
    action: () => Promise<void>,
    timeout = 30_000,
    targetEntitlements?: string[]
  ): Promise<RailsInterceptResult> {
    this.allRails = [];
    const responses: unknown[] = [];
    const seenResponses = new Set<string>();

    const handler = async (response: any) => {
      const url = response.url();
      const contentType = response.headers()['content-type'] || '';

      if (
        response.status() !== 200 ||
        !contentType.toLowerCase().includes('application/json') ||
        !this.looksLikeRailsEndpoint(url)
      ) {
        return;
      }

      try {
        const body = await response.json();
        responses.push(body);
        this.collectRails(body, seenResponses);
      } catch {
        // Ignore malformed/non-JSON bodies even when the response header is misleading.
      }
    };

    this.page.on('response', handler);

    try {
      await action();
      await this.page.waitForLoadState('networkidle', { timeout: Math.min(timeout, 10_000) }).catch(() => {});
      await this.page.waitForTimeout(1_000);
    } finally {
      this.page.off('response', handler);
    }

    const matchingTiles = targetEntitlements
      ? this.findTilesByEntitlement(targetEntitlements)
      : [];

    console.log(
      `📡 [RailsInterceptor] Captured ${this.allRails.length} rails from ${responses.length} JSON response(s)`
    );

    return {
      allRails: this.allRails,
      matchingTiles,
      rawResponse: responses,
    };
  }

  /**
   * Compatibility API used by the existing PPV specs.
   * Starts passive response capture before navigation.
   */
  async startIntercepting(): Promise<void> {
    if (this.intercepting) return;

    this.intercepting = true;
    this.allRails = [];
    this.seenRailKeys.clear();

    this.responseHandler = async (response: any) => {
      const url = response.url();
      const contentType = response.headers()['content-type'] || '';

      if (
        response.status() !== 200 ||
        !contentType.toLowerCase().includes('application/json') ||
        !this.looksLikeRailsEndpoint(url)
      ) {
        return;
      }

      try {
        const body = await response.json();
        this.collectRails(body, this.seenRailKeys);
      } catch {
        // Ignore a response that cannot be decoded as JSON.
      }
    };

    this.page.on('response', this.responseHandler);
    console.log('🔌 [RailsInterceptor] Started intercepting rails responses');
  }

  /**
   * Compatibility API used by the existing PPV specs.
   * Always remove the listener so later tests do not leak listeners.
   */
  async stopIntercepting(): Promise<void> {
    if (this.responseHandler) {
      this.page.off('response', this.responseHandler);
    }

    this.responseHandler = undefined;
    this.intercepting = false;
    console.log('🔌 [RailsInterceptor] Stopped intercepting rails responses');
  }

  findTilesByEntitlement(
    targetEntitlements: string[],
    matchAll = false
  ): RailTileMatch[] {
    const targets = new Set(
      targetEntitlements
        .map(value => value.trim().toLowerCase())
        .filter(Boolean)
    );

    if (targets.size === 0) {
      throw new Error('[RailsInterceptor] At least one entitlement ID is required');
    }

    const matches: RailTileMatch[] = [];

    this.allRails.forEach((rail, railIndex) => {
      const railTitle = this.readString(rail, ['Title', 'title', 'Name', 'name', 'Heading', 'heading'])
        || `Rail ${railIndex}`;
      const railId = this.readString(rail, ['Id', 'id', 'RailId', 'railId']);

      if (this.isFreeRail(railTitle)) {
        console.log(`⏭️ [RailsInterceptor] Skipping free rail: "${railTitle}"`);
        return;
      }

      const tiles = this.readArray(rail, ['Tiles', 'tiles', 'Items', 'items', 'Contents', 'contents']);

      tiles.forEach((rawTile, tileIndex) => {
        if (!this.isRecord(rawTile)) return;

        const entitlementIds = this.extractEntitlementIds(rawTile);
        const normalized = new Set(entitlementIds.map(value => value.toLowerCase()));

        const matched = matchAll
          ? [...targets].every(target => normalized.has(target))
          : [...targets].some(target => normalized.has(target));

        if (!matched) return;

        matches.push({
          railIndex,
          railTitle,
          railId,
          tileIndex,
          tileTitle: this.readString(rawTile, ['Title', 'title', 'Name', 'name', 'Heading', 'heading']) || `Tile ${tileIndex}`,
          tileId: this.readString(rawTile, ['Id', 'id', 'TileId', 'tileId', 'ContentId', 'contentId', 'AssetId', 'assetId']),
          entitlementIds,
          imageUrl: this.findImageUrl(rawTile),
        });
      });
    });

    console.log(`🎯 [RailsInterceptor] Found ${matches.length} entitlement match(es)`);
    return matches;
  }

  async clickFirstVisibleEntitlementTile(
    matches: RailTileMatch[]
  ): Promise<RailTileMatch | undefined> {
    const normalise = (value: string) =>
      value.replace(/\s+/g, ' ').trim().toLowerCase();

    console.log(
      `🔎 [RailsInterceptor] Finding first entitled tile in visual DOM order among ${matches.length} API matches`
    );

    await this.page.evaluate(() =>
      window.scrollTo({ top: 0, behavior: 'instant' })
    );
    await this.page.waitForTimeout(700);

    for (let step = 0; step < 18; step++) {
      const visibleCandidates: Array<{
        match: RailTileMatch;
        target: any;
        top: number;
        left: number;
      }> = [];

      for (const match of matches) {
        const titleText = match.tileTitle?.trim();

        if (!titleText) continue;

        const title = this.page.getByText(titleText, { exact: true }).first();

        if (!await title.isVisible().catch(() => false)) {
          continue;
        }

        const clickable = title.locator(
          'xpath=ancestor-or-self::a | ancestor-or-self::button | ancestor-or-self::*[@role="link"] | ancestor-or-self::*[@role="button"]'
        ).first();

        const target = (await clickable.count()) > 0 ? clickable : title;
        const box = await target.boundingBox().catch(() => null);

        if (!box || box.width <= 0 || box.height <= 0) {
          continue;
        }

        // Only consider cards actually inside the current viewport.
        if (box.y + box.height < 0 || box.y > await this.page.evaluate(() => window.innerHeight)) {
          continue;
        }

        visibleCandidates.push({
          match,
          target,
          top: box.y,
          left: box.x,
        });
      }

      if (visibleCandidates.length > 0) {
        // Homepage visual order: top-to-bottom rails, then left-to-right tiles.
        visibleCandidates.sort(
          (a, b) =>
            Math.abs(a.top - b.top) > 25
              ? a.top - b.top
              : a.left - b.left
        );

        const first = visibleCandidates[0];

        console.log(
          '🎯 [RailsInterceptor] Visible entitled candidates in DOM order:\n' +
          visibleCandidates
            .map((candidate, index) =>
              `  ${index + 1}. "${candidate.match.tileTitle}" ` +
              `rail="${candidate.match.railTitle}" top=${Math.round(candidate.top)} left=${Math.round(candidate.left)}`
            )
            .join('\n')
        );

        await first.target.scrollIntoViewIfNeeded();
        await this.page.waitForTimeout(250);

        console.log(
          `🎯 [RailsInterceptor] Clicking first visually ordered entitled tile "${first.match.tileTitle}" ` +
          `from rail "${first.match.railTitle}"`
        );

        await first.target.click({ force: true, timeout: 8_000 });

        console.log(
          `✅ [RailsInterceptor] Clicked first visually ordered entitled tile "${first.match.tileTitle}"`
        );

        return first.match;
      }

      const moved = await this.page.evaluate(() => {
        const before = window.scrollY;
        window.scrollBy({
          top: Math.max(window.innerHeight * 0.8, 650),
          behavior: 'instant',
        });
        return window.scrollY > before;
      });

      if (!moved) break;

      await this.page.waitForTimeout(500);
    }

    await this.page.evaluate(() =>
      window.scrollTo({ top: 0, behavior: 'instant' })
    );

    console.log(
      '⚠️ [RailsInterceptor] No rendered DAZN entitlement tile was found in visual DOM order'
    );

    return undefined;
  }

  /**
   * Click one exact entitlement match.
   * Keeps the caller's selected match as the only candidate: no rail/title
   * hardcoding and no fallback to a different entitled tile.
   */
  async clickTileByRailPosition(
    match: RailTileMatch
  ): Promise<RailTileMatch | undefined> {
    return this.clickFirstVisibleEntitlementTile([match]);
  }

  printRailsSummary(): void {
    console.log(`📊 [RailsInterceptor] Rails captured: ${this.allRails.length}`);
    this.allRails.forEach((rail, index) => {
      const title = this.readString(rail, ['Title', 'title', 'Name', 'name']) || `Rail ${index}`;
      const tiles = this.readArray(rail, ['Tiles', 'tiles', 'Items', 'items', 'Contents', 'contents']);
      console.log(`  • "${title}" → ${tiles.length} tiles`);
    });
  }

  get capturedRails(): readonly AnyRecord[] {
    return this.allRails;
  }

  private looksLikeRailsEndpoint(url: string): boolean {
    const value = url.toLowerCase();

    // Keep this deliberately broad. The old working interceptor captured
    // responses whose URL contained any of these tokens, and DAZN endpoint
    // names can vary by environment.
    return (
      value.includes('rail') ||
      value.includes('catalogue') ||
      value.includes('content') ||
      value.includes('page')
    );
  }

  private collectRails(value: unknown, seen: Set<string>): void {
    if (Array.isArray(value)) {
      value.forEach(item => this.collectRails(item, seen));
      return;
    }

    if (!this.isRecord(value)) return;

    if (this.looksLikeRail(value)) {
      const key = [
        this.readString(value, ['Id', 'id', 'RailId', 'railId']),
        this.readString(value, ['Title', 'title', 'Name', 'name']),
      ].join('|');

      if (!seen.has(key)) {
        seen.add(key);
        this.allRails.push(value);
      }
    }

    Object.values(value).forEach(child => this.collectRails(child, seen));
  }

  private looksLikeRail(value: AnyRecord): boolean {
    return this.readArray(value, ['Tiles', 'tiles', 'Items', 'items', 'Contents', 'contents']).length > 0;
  }

  private extractEntitlementIds(tile: AnyRecord): string[] {
    const found = new Set<string>();

    const visit = (value: unknown, depth: number): void => {
      if (depth > 5 || value == null) return;

      if (typeof value === 'string') return;

      if (Array.isArray(value)) {
        value.forEach(item => visit(item, depth + 1));
        return;
      }

      if (!this.isRecord(value)) return;

      for (const [key, child] of Object.entries(value)) {
        if (/^entitlementids?$/i.test(key) || /^entitlements?$/i.test(key)) {
          if (typeof child === 'string' && child.trim()) found.add(child.trim());
          if (Array.isArray(child)) {
            child.forEach(item => {
              if (typeof item === 'string' && item.trim()) found.add(item.trim());
              if (this.isRecord(item)) {
                const id = this.readString(item, ['Id', 'id', 'EntitlementId', 'entitlementId']);
                if (id) found.add(id);
              }
            });
          }
        }
        visit(child, depth + 1);
      }
    };

    visit(tile, 0);
    return [...found];
  }

  private findImageUrl(tile: AnyRecord): string | undefined {
    const visit = (value: unknown, depth: number): string | undefined => {
      if (depth > 4 || value == null) return undefined;
      if (typeof value === 'string') return /^https?:\/\//i.test(value) ? value : undefined;
      if (Array.isArray(value)) {
        for (const item of value) {
          const result = visit(item, depth + 1);
          if (result) return result;
        }
        return undefined;
      }
      if (!this.isRecord(value)) return undefined;

      for (const [key, child] of Object.entries(value)) {
        if (/image|poster|thumbnail|artwork/i.test(key)) {
          const result = visit(child, depth + 1);
          if (result) return result;
        }
      }
      return undefined;
    };

    return visit(tile, 0);
  }

  private readArray(record: AnyRecord, keys: string[]): unknown[] {
    for (const key of keys) {
      const value = record[key];
      if (Array.isArray(value)) return value;
    }
    return [];
  }

  private readString(record: AnyRecord, keys: string[]): string {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
      if (typeof value === 'number') return String(value);
    }
    return '';
  }

  private isFreeRail(title: string): boolean {
    const value = title.toLowerCase();
    return [
      'free to watch',
      'free to air',
      'watch for free',
      'freeview',
    ].some(label => value.includes(label));
  }

  private isRecord(value: unknown): value is AnyRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
