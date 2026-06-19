import { Page } from '@playwright/test';

export interface RailTileMatch {
  railIndex: number;
  railTitle: string;
  railId: string;
  tileIndex: number;
  tileTitle: string;
  tileId: string;
  entitlementIds: string[];
}

interface RailData {
  id: string;
  title: string;
  tiles: TileData[];
}

interface TileData {
  id: string;
  title: string;
  entitlementIds: string[];
}

export class RailsInterceptor {
  private rails: RailData[] = [];
  private intercepting = false;

  constructor(private page: Page) {}

  private routePredicate = (url: any) => {
    const urlStr = url.toString().toLowerCase();
    return urlStr.includes('rail') || urlStr.includes('catalogue') || urlStr.includes('content') || urlStr.includes('page');
  };

  /**
   * Start intercepting Rails API responses.
   * Call this BEFORE navigating to the page.
   */
  async startIntercepting(): Promise<void> {
    if (this.intercepting) return;
    this.intercepting = true;
    this.rails = [];

    await this.page.route(this.routePredicate, async (route) => {
      const url = route.request().url();
      if (url.match(/\.(png|jpg|jpeg|svg|js|css|woff|woff2|ico|gif)(\?|$)/i)) {
        await route.continue();
        return;
      }

      console.log(`🔌 [RailsInterceptor] Intercepted request: ${url}`);
      try {
        const response = await route.fetch();
        const contentType = response.headers()['content-type'] || '';
        if (contentType.includes('application/json')) {
          const body = await response.json();
          this.parseRailsResponse(body);
        }
        await route.fulfill({ response });
      } catch (err: any) {
        console.log(`⚠️ [RailsInterceptor] Error fetching/parsing ${url}: ${err.message}`);
        await route.continue().catch(() => {});
      }
    });

    console.log('🔌 [RailsInterceptor] Started intercepting matching API responses');
  }

  /**
   * Stop intercepting and clean up routes.
   */
  async stopIntercepting(): Promise<void> {
    if (!this.intercepting) return;
    await this.page.unroute(this.routePredicate).catch(() => {});
    this.intercepting = false;
    console.log('🔌 [RailsInterceptor] Stopped intercepting');
  }

  /**
   * Parse a Rails API response body and extract rail/tile data.
   */
  private parseRailsResponse(body: any): void {
    if (!body || typeof body !== 'object') return;

    // Handle array of rails
    const railList: any[] = Array.isArray(body)
      ? body
      : body.rails || body.data?.rails || body.items || body.data?.items || [];

    for (const rail of railList) {
      if (!rail || typeof rail !== 'object') continue;
      const railId = rail.id || rail.railId || '';
      const railTitle = rail.title || rail.railTitle || rail.heading || '';

      const tileList: any[] = rail.tiles || rail.items || rail.content || [];
      const tiles: TileData[] = [];

      for (const tile of tileList) {
        if (!tile || typeof tile !== 'object') continue;

        const tileId = tile.id || tile.tileId || tile.contentId || tile.assetId || '';
        const tileTitle = tile.title || tile.name || tile.heading || '';

        // Extract entitlement IDs from various possible locations
        const entitlementIds: string[] = [];
        const rawEntitlements =
          tile.entitlementIds ||
          tile.entitlements ||
          tile.metadata?.entitlementIds ||
          tile.details?.entitlementIds ||
          tile.asset?.entitlementIds ||
          [];

        if (Array.isArray(rawEntitlements)) {
          for (const e of rawEntitlements) {
            if (typeof e === 'string') entitlementIds.push(e);
            else if (e?.id) entitlementIds.push(e.id);
          }
        } else if (typeof rawEntitlements === 'string') {
          entitlementIds.push(rawEntitlements);
        }

        tiles.push({ id: tileId, title: tileTitle, entitlementIds });
      }

      if (railId || railTitle || tiles.length > 0) {
        // Avoid duplicates
        const exists = this.rails.find(r => r.id === railId && r.title === railTitle);
        if (!exists) {
          this.rails.push({ id: railId, title: railTitle, tiles });
          if (tiles.length > 0) {
            console.log(`📡 [RailsInterceptor] Captured rail "${railTitle}" (${tiles.length} tiles)`);
          }
        }
      }
    }
  }

  /**
   * Find tiles that match any of the given entitlement IDs.
   */
  findTilesByEntitlement(entitlementIds: string[]): RailTileMatch[] {
    const matches: RailTileMatch[] = [];
    const lowerIds = entitlementIds.map(e => e.toLowerCase().trim());

    for (let ri = 0; ri < this.rails.length; ri++) {
      const rail = this.rails[ri];
      for (let ti = 0; ti < rail.tiles.length; ti++) {
        const tile = rail.tiles[ti];
        const tileEntitlements = tile.entitlementIds.map(e => e.toLowerCase().trim());
        const hasMatch = lowerIds.some(id => tileEntitlements.some(te => te.includes(id) || id.includes(te)));
        if (hasMatch) {
          matches.push({
            railIndex: ri,
            railTitle: rail.title,
            railId: rail.id,
            tileIndex: ti,
            tileTitle: tile.title,
            tileId: tile.id,
            entitlementIds: tile.entitlementIds,
          });
        }
      }
    }

    return matches;
  }

  /**
   * Print a summary of all captured rails and tile counts.
   */
  printRailsSummary(): void {
    console.log(`\n📊 [RailsInterceptor] Rails captured: ${this.rails.length}`);
    for (const rail of this.rails) {
      console.log(`  • "${rail.title}" (id="${rail.id}") → ${rail.tiles.length} tiles`);
    }
  }

  get capturedRails(): RailData[] {
    return this.rails;
  }
}
