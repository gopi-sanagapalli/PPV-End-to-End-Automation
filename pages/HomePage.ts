import { Page } from '@playwright/test';
import { LandingPage } from './LandingPage';
import { RailsInterceptor } from '../utils/railsInterceptor';
import { pollForHomePagePopup, logoutForPopupRetry, clickAndWaitForNav } from '../utils/testHelpers';
import { handleCookies, stabilisePage } from '../utils/helpers';
import { validateVariant } from '../flows/validateVariant';
import { getHomePageData } from '../utils/excelReader';

export class HomePage extends LandingPage {
  protected baseUrl: string;

  constructor(page: Page, baseUrl: string = '') {
    super(page);
    this.baseUrl = baseUrl;
  }

  // Navigation for home-page flows
  override async navigate(baseUrl: string, source?: string, eventData?: Record<string, string>): Promise<void> {
    const welcomeUrl = `${baseUrl}/welcome`;
    console.log(`🌍 [HomePage] Navigating to Welcome page: ${welcomeUrl}`);
    await this.page.goto(welcomeUrl, { waitUntil: 'domcontentloaded' });
    await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => { });
    await this.dismissConsentIfPresent();

    console.log(`✅ [HomePage] Welcome page loaded: ${this.page.url()}`);
    await this.clickExplore();

    console.log(`✅ [HomePage] Home page loaded: ${this.page.url()}`);

    // Wait for the hero banner or swiper component to render and be visible
    const bannerLocator = this.page.locator('main [class*="banner"], [class*="hero-banner-slider"], .swiper:not([class*="rail" i]):not([class*="tiles" i])').first();
    await bannerLocator.waitFor({ state: 'visible', timeout: 10000 }).catch((e) => {
      console.log('⚠️ [HomePage] Timeout waiting for hero banner/swiper: ' + e.message);
    });
  }

  protected async clickExplore(): Promise<void> {
    console.log('🔍 Looking for "Explore" button on welcome page...');

    const exploreSelectors = [
      'a:has-text("Explore")',
      'button:has-text("Explore")',
      'a[href*="/home" i]',
      'a:has-text("Explore DAZN")',
      'a:has-text("Explore without subscribing")',
      'a:has-text("Explore for free")',
      '[class*="explore" i]',
    ];

    const combinedSelector = exploreSelectors.join(', ');
    const anyExplore = this.page.locator(combinedSelector).first();
    const found = await anyExplore.waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false);

    if (found) {
      console.log(`📍 Found Explore button`);
      await anyExplore.scrollIntoViewIfNeeded().catch(() => { });
      await anyExplore.click({ force: true });
      await this.page.waitForURL((url: URL) => url.toString().includes('/home'), { timeout: 15000 }).catch(() => { });
    } else {
      console.log('⚠️ Explore button not found — trying direct navigation to /home');
      const currentUrl = this.page.url();
      const baseMatch = currentUrl.match(/(https:\/\/[a-z0-9.-]*dazn\.com\/en-[A-Z]+)/i);
      const base = baseMatch?.[1] || this.getFallbackBaseUrl();
      await this.page.goto(`${base}/home`, { waitUntil: 'domcontentloaded' });
    }

    // Wait for Home page to be visually ready before next action
    await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => { });
  }

  // Find container logic:
  // For home-page-banner: uses LandingPage.findPPVInBanner
  // For home-page-dont-miss: finds tile, clicks it to open modal, and returns the modal popup!
  override async findPPVContainer(eventData: Record<string, string>, source?: string): Promise<any> {
    const src = (source || '').toLowerCase();

    if (src === 'home-page-banner') {
      return super.findPPVInBanner(eventData);
    }

    if (src === 'home-biggest-fights') {
      console.log('🔍 [HomePage Biggest Fights] Flow: Home → Competition Page → Coming Up → Popup');

      // ── STEP 1: Scroll to the fights section heading ──────────────
      // Section name is dynamic — could be "The Biggest Fights", "Saturday Fight Night", etc.
      // Each source must verify from its specific section — if it doesn't exist, the test should fail.
      const sectionPatterns = [
        /biggest\s*fights/i,
        /saturday\s*fight\s*night/i,
        /fight\s*night/i,
      ];

      let sectionHeading: any = null;
      let foundHeading = false;
      let matchedPattern = '';

      // Check all patterns at each scroll position.
      // IMPORTANT: skip any heading that is wrapped inside an <a> element —
      // those are article/promo tiles (href="/en-GB/home/ArticleId:..."), not rail headings.
      for (let i = 0; i < 20 && !foundHeading; i++) {
        for (const pattern of sectionPatterns) {
          const allCandidates = this.page.locator('h2, h3, [class*="title" i]')
            .filter({ hasText: pattern });
          const count = await allCandidates.count().catch(() => 0);
          for (let j = 0; j < count; j++) {
            const candidate = allCandidates.nth(j);
            if (!await candidate.isVisible().catch(() => false)) continue;
            // Skip if heading is inside an <a> link (promo/article tile)
            const insideLink = await candidate.locator('xpath=ancestor::a[1]').count().catch(() => 0) > 0;
            if (insideLink) {
              const txt = (await candidate.textContent().catch(() => '')) || '';
              console.log(`⏭️ [Biggest Fights] Skipping heading inside <a>: "${txt.trim().substring(0, 60)}"`);
              continue;
            }
            sectionHeading = candidate;
            foundHeading = true;
            matchedPattern = pattern.source;
            break;
          }
          if (foundHeading) break;
        }
        if (!foundHeading) {
          if (this.page.isClosed()) break;
          await this.page.evaluate((pos: number) => {
            window.scrollTo({ top: pos, behavior: 'instant' });
          }, (i + 1) * 400).catch(() => { });
          await this.page.waitForTimeout(200).catch(() => { });
        }
      }

      if (!foundHeading) {
        throw new Error(
          `❌ [HomePage Biggest Fights] No fights section heading found on Home page. ` +
          `Tried patterns: ${sectionPatterns.map(p => p.source).join(', ')}`
        );
      }

      await sectionHeading.scrollIntoViewIfNeeded().catch(() => { });
      const sectionHeadingText = ((await sectionHeading.textContent().catch(() => '')) || '').trim();
      if (sectionHeadingText) {
        eventData.HOME_BIGGEST_FIGHTS_SECTION_HEADING = sectionHeadingText;
      }
      console.log(`✅ [HomePage Biggest Fights] Section heading found (matched: ${matchedPattern})`);

      const ppvName = eventData.PPV_NAME || '';
      const vsMatch = ppvName.match(/(\w+)\s+vs\.?\s+(\w+)/i);
      const fighter1 = vsMatch ? vsMatch[1] : '';
      const fighter2 = vsMatch ? vsMatch[2] : '';
      const ppvEntitlementId = (eventData.PPV_ENTITLEMENT_ID || '').trim();
      const ppvUtcDate = eventData.PPV_UTC_DATE || '';
      console.log(`🔍 [HomePage Biggest Fights] Looking for: "${ppvName}" (f1="${fighter1}", f2="${fighter2}", entitlement="${ppvEntitlementId || 'N/A'}")`);

      const cleanStr = (s: string) =>
        (s || '').toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
      const nameParts = ppvName.split(/[:\-–]/).map(p => p.trim()).filter(p => p.length > 3);
      const partsWordLists = nameParts
        .map(part => cleanStr(part).split(/\s+/).filter(Boolean))
        .filter(list => list.length > 0);
      const matchesTileText = (text: string): boolean => {
        const ct = cleanStr(text);
        const matchTitle = partsWordLists.some(words => words.every(w => ct.includes(w)));
        const matchFighters = !!(
          fighter1 && fighter2 &&
          ct.includes(fighter1.toLowerCase()) &&
          ct.includes(fighter2.toLowerCase())
        );
        return matchTitle || matchFighters;
      };

      let ppvMonth = '';
      if (ppvUtcDate) {
        const d = new Date(ppvUtcDate);
        if (!isNaN(d.getTime())) {
          ppvMonth = d.toLocaleString('en-US', { month: 'short' }).toLowerCase();
        }
      }

      // ── RailsInterceptor (for diagnostics) ──
      const railsInterceptor: RailsInterceptor | undefined = (eventData as any)._railsInterceptor;
      if (railsInterceptor && ppvEntitlementId) {
        const matches = railsInterceptor.findTilesByEntitlement([ppvEntitlementId]);
        if (matches.length > 0) {
          console.log(`🎯 [Biggest Fights] Entitlement match: rail="${matches[0].railTitle}", tileIndex=${matches[0].tileIndex}`);
        } else {
          console.log(`⚠️ [Biggest Fights] No entitlement match for "${ppvEntitlementId}" — falling back to link-based navigation`);
        }
        railsInterceptor.printRailsSummary();
      }

      // ── STEP 2: Find the rail container, then locate the correct tile ─────────
      // IMPORTANT: scope ALL img/link searches to the rail container, not the full
      // page, so we don't accidentally pick up Joshua tiles from Don't Miss or Banner.
      await sectionHeading.scrollIntoViewIfNeeded().catch(() => { });

      // Walk up from heading to the nearest ancestor that has competition links
      let railContainer: any = sectionHeading.locator('xpath=..');
      for (const xpath of ['xpath=..', 'xpath=../..', 'xpath=../../..', 'xpath=../../../..', 'xpath=../../../../..']) {
        const candidate = sectionHeading.locator(xpath);
        const lc = await candidate.locator('a[href*="/competition/"], a[href*="/sport/"], a[href]').count().catch(() => 0);
        if (lc > 0) {
          railContainer = candidate;
          console.log(`✅ [Biggest Fights] Rail container found at ${xpath} (${lc} links)`);
          break;
        }
      }

      await railContainer.scrollIntoViewIfNeeded().catch(() => { });
      await this.page.waitForTimeout(400);
      await railContainer.hover({ force: true }).catch(() => { });

      const nextBtn = railContainer.locator([
        'button[aria-label="Next slide"]',
        'button[class*="swiper-button-next" i]',
        '[class*="next" i]:not(a)',
      ].join(', ')).first();

      let targetTile: any = null;

      // ── Strategy A: RailsInterceptor imageUrl fragment → scoped img[src] ──
      if (railsInterceptor) {
        const fightNightPattern = /saturday.?fight.?night|fight.?night|biggest.?fights|upcoming.?fight/i;
        let railMatches = railsInterceptor.findTilesByRailTitle(
          fightNightPattern,
          (title) => matchesTileText(title)
        );

        if (railMatches.length === 0) {
          const allRailTiles = railsInterceptor.findTilesByRailTitle(fightNightPattern);
          console.log(`ℹ️ [Biggest Fights] No title match in API; all tiles in matching rails:`);
          allRailTiles.forEach(m => console.log(`   tile[${m.tileIndex}] "${m.tileTitle}" img="${m.imageUrl?.substring(0, 80) || 'none'}"`));
          railMatches = allRailTiles;
        }

        for (const match of railMatches) {
          console.log(`🎯 [Biggest Fights] API tile: rail="${match.railTitle}" tile="${match.tileTitle}" img="${match.imageUrl?.substring(0, 80) || 'none'}"`);
          if (!match.imageUrl) continue;

          const urlParts = match.imageUrl.split('/').filter(Boolean);
          const uniqueFragment = urlParts.reverse().find(
            p => p.length > 8 && !/^(image|poster|thumb|thumbnail|jpg|jpeg|png|webp|gif)$/i.test(p)
          );
          if (!uniqueFragment) continue;

          // Scope search to railContainer so we don't pick up other rails
          const imgByUrl = railContainer.locator(`img[src*="${uniqueFragment}" i]:not(.swiper-slide-duplicate img)`).first();
          if (await imgByUrl.count().catch(() => 0) > 0 && await imgByUrl.isVisible().catch(() => false)) {
            const parentLink = imgByUrl.locator('xpath=ancestor::a[1]');
            if (await parentLink.count().catch(() => 0) > 0) {
              const href = await parentLink.getAttribute('href').catch(() => '');
              console.log(`✅ [Biggest Fights] Found tile by imageUrl fragment (scoped): href="${href}"`);
              targetTile = parentLink;
              break;
            }
          }
        }
      }

      // ── Strategy B: scoped img[alt] / img[src] matching within railContainer ──
      const findTileInRail = async (): Promise<any> => {
        const imgSelectors = [
          fighter1 && fighter2 ? `img[alt*="${fighter1}" i][alt*="${fighter2}" i]:not(.swiper-slide-duplicate img)` : null,
          fighter1 ? `img[alt*="${fighter1}" i]:not(.swiper-slide-duplicate img)` : null,
          fighter1 ? `img[src*="${fighter1.toLowerCase()}"]:not(.swiper-slide-duplicate img)` : null,
          ppvEntitlementId ? `img[alt*="${ppvEntitlementId}" i]:not(.swiper-slide-duplicate img)` : null,
          ppvEntitlementId ? `a[href*="${ppvEntitlementId}" i]` : null,
        ].filter(Boolean) as string[];

        for (const sel of imgSelectors) {
          // All searches scoped to railContainer
          const el = railContainer.locator(sel).first();
          if (await el.count().catch(() => 0) > 0 && await el.isVisible().catch(() => false)) {
            const tagName = await el.evaluate((e: HTMLElement) => e.tagName.toLowerCase()).catch(() => '');
            if (tagName === 'a') {
              const href = await el.getAttribute('href').catch(() => '');
              if (!href?.includes('ArticleId')) return el;
            }
            const link = el.locator('xpath=ancestor::a[1]');
            if (await link.count().catch(() => 0) > 0) {
              const href = await link.getAttribute('href').catch(() => '');
              if (href && !href.includes('ArticleId')) {
                console.log(`✅ [Biggest Fights] Found tile by "${sel}" (scoped): href="${href}"`);
                return link;
              }
            }
          }
        }

        // Last resort: first visible competition link in the scoped rail
        const compLinks = railContainer.locator('a[href*="/competition/"], a[href*="/sport/"]');
        const cnt = await compLinks.count().catch(() => 0);
        for (let i = 0; i < cnt; i++) {
          const t = compLinks.nth(i);
          if (await t.isVisible().catch(() => false)) return t;
        }
        return null;
      };

      if (!targetTile) {
        targetTile = await findTileInRail();
        let clicks = 0;
        while (!targetTile && clicks < 15) {
          const nd = await nextBtn.evaluate((el: Element) =>
            el.classList.contains('swiper-button-disabled') || el.hasAttribute('disabled')
          ).catch(() => true);
          if (nd) { console.log('⚠️ [Biggest Fights] Carousel end reached'); break; }
          await railContainer.hover({ force: true }).catch(() => { });
          await nextBtn.click({ force: true, timeout: 3000 }).catch(() => { });
          clicks++;
          await this.page.waitForTimeout(500);
          targetTile = await findTileInRail();
        }
      }

      if (!targetTile) {
        throw new Error(
          `❌ [HomePage Biggest Fights] No competition tile found. ` +
          `PPV: "${ppvName}", Competition ID: ${ppvEntitlementId || 'N/A'}`
        );
      }

      // ── STEP 4: Click tile → Navigate to competition page ────────────
      const tileHref = await targetTile.getAttribute('href').catch(() => '');
      console.log(`✅ [Biggest Fights] Clicking competition tile: href="${tileHref}"`);
      await targetTile.scrollIntoViewIfNeeded().catch(() => { });
      await targetTile.click({ timeout: 5000 });
      console.log('🔗 [Biggest Fights] Clicked tile, waiting for competition/sport page...');

      await this.page.waitForURL(
        (url: URL) => {
          const u = url.toString();
          return u.includes('/competition/') || u.includes('/sport/') || u.includes('/event/');
        },
        { timeout: 15000 }
      );
      await this.page.waitForLoadState('domcontentloaded').catch(() => { });
      await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => { });
      console.log(`✅ [Biggest Fights] Competition page loaded: ${this.page.url()}`);

      // ── STEP 5: Scroll to "Coming Up" section on competition page ────
      // Wait for rails content to appear (async API-loaded) instead of hard timeout

      const comingUpHeading = this.page.locator('h2, h3, h4, [class*="title" i]')
        .filter({ hasText: /coming\s*up/i }).first();

      let foundComingUp = false;
      for (let i = 0; i < 15; i++) {
        if (await comingUpHeading.isVisible().catch(() => false)) {
          foundComingUp = true;
          break;
        }
        await this.page.evaluate((pos: number) => {
          window.scrollTo({ top: pos, behavior: 'instant' });
        }, (i + 1) * 400);
        foundComingUp = await comingUpHeading.waitFor({ state: 'attached', timeout: 500 })
          .then(() => true).catch(() => false);
        if (foundComingUp) break;
      }

      if (!foundComingUp) {
        throw new Error('❌ [Competition Page] "Coming Up" section not found');
      }

      await comingUpHeading.scrollIntoViewIfNeeded().catch(() => { });
      console.log('✅ [Competition Page] "Coming Up" section found');

      // ── STEP 6: Find PPV tile in "Coming Up" rail ────────────────────
      let comingUpRail = comingUpHeading.locator('xpath=ancestor::div[contains(@class,"rail")][1]');
      let hasComingUpRail = await comingUpRail.isVisible({ timeout: 3000 }).catch(() => false);
      if (!hasComingUpRail) {
        comingUpRail = comingUpHeading.locator('xpath=ancestor::section[1]');
        hasComingUpRail = await comingUpRail.isVisible({ timeout: 2000 }).catch(() => false);
      }
      if (!hasComingUpRail) {
        comingUpRail = comingUpHeading.locator('xpath=../..');
      }

      const comingUpTiles = comingUpRail.locator('a[class*="tile" i], a, div[class*="tile" i]');
      const comingUpNext = comingUpRail.locator([
        'button[aria-label="Next slide"]',
        'button[class*="swiper-button-next"]',
        '[class*="next" i]',
      ].join(', ')).first();

      const findComingUpTile = async (): Promise<any> => {
        const count = await comingUpTiles.count().catch(() => 0);
        for (let i = 0; i < count; i++) {
          const tile = comingUpTiles.nth(i);
          if (!await tile.isVisible().catch(() => false)) continue;
          const text = (await tile.textContent().catch(() => '')) || '';
          if (matchesTileText(text)) {
            console.log(`🔍 [Coming Up] Matched tile: "${text.replace(/\s+/g, ' ').trim().substring(0, 80)}"`);
            return tile;
          }
        }
        return null;
      };

      await comingUpRail.hover({ force: true }).catch(() => { });
      let comingUpTile = await findComingUpTile();
      let cuClicks = 0;

      while (!comingUpTile && cuClicks < 10) {
        const disabled = await comingUpNext.evaluate((el: Element) =>
          el.classList.contains('swiper-button-disabled') ||
          el.className.includes('disable') ||
          el.hasAttribute('disabled')
        ).catch(() => true);
        if (disabled) break;

        await comingUpRail.hover({ force: true }).catch(() => { });
        await comingUpNext.click({ force: true, timeout: 3000 }).catch(() => { });
        cuClicks++;
        await this.page.waitForTimeout(500);
        comingUpTile = await findComingUpTile();
      }

      if (!comingUpTile) {
        throw new Error(
          `❌ [Competition Page] PPV tile for "${ppvName}" not found in "Coming Up" section.`
        );
      }

      console.log(`✅ [Competition Page] PPV tile found in "Coming Up" after ${cuClicks} clicks`);
      return comingUpTile;
    }

    if (src === 'home-page-dazntile') {
      const railsInterceptor: RailsInterceptor | undefined =
        (eventData as any)._railsInterceptor;

      if (!railsInterceptor) {
        throw new Error(
          'home-page-dazntile requires RailsInterceptor to be started before home-page navigation'
        );
      }

      // Allow the home rails response to finish after navigation.
      await this.page.waitForTimeout(1500);

      const matches = railsInterceptor.findTilesByEntitlement([
        'base_dazn_content',
      ]);

      if (matches.length === 0) {
        railsInterceptor.printRailsSummary();
        throw new Error(
          'No DAZN tile found with entitlement base_dazn_content'
        );
      }

      // Do not assume API response order equals homepage render order.
      // Scan the rendered homepage from top to bottom and click the first
      // visible tile whose Rails payload has the required entitlement.
      const clicked = await railsInterceptor.clickFirstVisibleEntitlementTile(matches);

      if (!clicked) {
        throw new Error(
          'No rendered DAZN tile with entitlement base_dazn_content was found/clickable'
        );
      }

      console.log(
        `🎯 [HomePage] Clicked first rendered DAZN entitlement tile "${clicked.tileTitle}" ` +
        `from rail "${clicked.railTitle}"`
      );

      return;
    }

    if (src === 'home-page-dont-miss') {
      console.log('🔍 [HomePage Tile] Flow: Tile + Modal popup flow');

      // 1. Scroll to section heading
      const sectionPattern = /don.t miss/i;
      const railHeader = this.page.getByText(sectionPattern).first();

      let foundHeading = false;
      for (let i = 0; i < 8; i++) {
        if (await railHeader.isVisible().catch(() => false)) {
          foundHeading = true;
          break;
        }
        const scrollPos = (i + 1) * 800;
        await this.page.evaluate((pos) => {
          window.scrollTo({ top: pos, behavior: 'instant' });
        }, scrollPos).catch(() => { });

        foundHeading = await railHeader.waitFor({ state: 'attached', timeout: 200 }).then(() => true).catch(() => false);
        if (foundHeading) break;
      }

      if (!foundHeading) {
        throw new Error(`❌ [HomePage Tile] "Don't Miss" rail heading not found in DOM`);
      }

      await railHeader.scrollIntoViewIfNeeded().catch(() => { });
      console.log(`✅ [HomePage Tile] Section heading is visible`);

      // 2. Locate rail wrapper
      const railWrapper = railHeader.locator('xpath=ancestor::*[contains(@class,"rail__rail-wrapper")][1] | ancestor::section[contains(@class,"rail")][1] | ancestor::div[contains(@class,"rail")][1] | ancestor::*[contains(@class,"railWrapper")][1]');
      await railWrapper.waitFor({ state: 'visible', timeout: 10000 }).catch(() => { });
      console.log('✅ [HomePage Tile] Found rail wrapper');

      // 3. Build search parameters for tile (same as LandingPage.ts)
      const ppvName = eventData.PPV_NAME || '';
      const vsMatch = ppvName.match(/(\w+)\s+vs\.?\s+(\w+)/i);
      const fighter1 = vsMatch ? vsMatch[1] : '';
      const fighter2 = vsMatch ? vsMatch[2] : '';
      console.log(`🔍 [HomePage Tile] Searching tile for event: "${ppvName}" (fighter1="${fighter1}", fighter2="${fighter2}")`);

      const cleanStr = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
      const nameParts = ppvName.split(/[:\-–]/).map(p => p.trim()).filter(p => p.length > 3);
      const partsWordLists = nameParts.map(part => cleanStr(part).split(/\s+/).filter(Boolean)).filter(list => list.length > 0);

      const matchesTileText = (text: string): boolean => {
        const ct = cleanStr(text);
        const matchTitle = partsWordLists.some(words => words.every(w => ct.includes(w)));
        const matchFighters = !!(fighter1 && fighter2 && ct.includes(fighter1.toLowerCase()) && ct.includes(fighter2.toLowerCase()));
        return matchTitle || matchFighters;
      };

      const exclusions = [
        'press conference', 'weigh-in', 'workout', 'replay', 'highlights',
        'preview', 'promo', 'interview', 'behind the scenes', 'episode',
        'documentary', 'face off'
      ];
      const exclusionSelector = exclusions.map(term => `:not([alt*="${term}" i])`).join('');

      let imgSelector = '';
      if (fighter1 && fighter2) {
        imgSelector = `img[alt*="${fighter1}" i][alt*="${fighter2}" i]${exclusionSelector}:not(.swiper-slide-duplicate img)`;
      } else if (fighter1) {
        imgSelector = `img[alt*="${fighter1}" i]${exclusionSelector}:not(.swiper-slide-duplicate img)`;
      } else {
        imgSelector = `img[alt*="${ppvName}" i]${exclusionSelector}:not(.swiper-slide-duplicate img)`;
      }

      const ppvImg = railWrapper.locator(imgSelector).first();
      const ppvTileLink = ppvImg.locator('xpath=ancestor::a[1]');


      const isTileInView = async (): Promise<any> => {
        // First check candidates by text
        const tileCandidates = railWrapper.locator('a[class*="tile__link" i], a[class*="tile" i], div[class*="tile" i], div[class*="card" i], a, button');
        const candidateCount = await tileCandidates.count().catch(() => 0);

        let bestTile: any = null;
        let bestScore = 0;

        for (let i = 0; i < candidateCount; i++) {
          const tile = tileCandidates.nth(i);
          if (await tile.isVisible().catch(() => false)) {
            const text = await tile.textContent().catch(() => '');
            if (text && matchesTileText(text)) {
              const inView = await tile.evaluate((el: HTMLElement) => {
                const r = el.getBoundingClientRect();
                return r.width > 0 && r.right > 0 && r.left < window.innerWidth;
              }).catch(() => false);
              if (inView) {
                const score = this.scorePPVMatch(text, ppvName);
                if (score > bestScore) {
                  bestScore = score;
                  bestTile = tile;
                }
              }
            }
          }
        }

        if (bestTile) {
          const tileText = await bestTile.textContent().catch(() => '');
          console.log(`✅ [HomePage Tile] Best matching tile (score=${bestScore}): "${(tileText || '').trim().replace(/\s+/g, ' ').substring(0, 80)}"`);
          return bestTile;
        }

        // Fallback to image alt matching
        for (let retry = 0; retry < 2; retry++) {
          const imgCount = await ppvImg.count().catch(() => 0);
          if (imgCount === 0) {
            if (retry === 0) {
              await this.page.waitForTimeout(100);
              continue;
            }
            break;
          }
          const inView = await ppvImg.evaluate((el: HTMLElement) => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.right > 0 && r.left < window.innerWidth;
          }).catch(() => false);
          if (inView) {
            return ppvTileLink;
          }
        }
        return null;
      };

      const nextBtn = railWrapper.locator([
        'button[aria-label="Next slide"]',
        'button[class*="swiper-button-next"]',
        '.custom-swiper-button-next',
        '[class*="next" i]',
      ].join(', ')).first();

      await nextBtn.waitFor({ state: 'attached', timeout: 5000 }).catch(() => {
        console.log('⚠️ [HomePage Tile] Swiper next button not attached after 5s');
      });

      await railWrapper.hover({ force: true }).catch(() => { });
      await this.page.waitForTimeout(100);

      let clicks = 0;
      const maxClicks = 30;
      let found = await isTileInView();

      while (!found && clicks < maxClicks) {
        if (this.page.isClosed()) throw new Error('Page closed during swiper navigation');

        const nextDisabled = await nextBtn.evaluate((el: Element) => {
          return el.classList.contains('swiper-button-disabled') ||
            el.classList.contains('rail-module__disable') ||
            el.className.includes('disable') ||
            el.hasAttribute('disabled');
        }).catch(() => false);

        if (nextDisabled) {
          console.log('⚠️ [HomePage Tile] Next button disabled — end of rail reached');
          break;
        }

        let nextCount = await nextBtn.count().catch(() => 0);
        if (nextCount === 0) {
          await this.page.waitForTimeout(100);
          nextCount = await nextBtn.count().catch(() => 0);
          if (nextCount === 0) {
            console.log('⚠️ [HomePage Tile] Next button not found in DOM after retry');
            break;
          }
        }

        await nextBtn.click({ timeout: 5000, force: true }).catch((e: any) => {
          console.log('⚠️ Next click error:', e.message);
        });
        clicks++;

        await this.page.waitForTimeout(250);
        found = await isTileInView();
      }

      console.log(`✅ [HomePage Tile] Swiper "Next" clicks performed: ${clicks}`);

      if (!found && (await ppvImg.count()) > 0) {
        console.log('🔍 [HomePage Tile] Tile in DOM but not visible — scrolling into view');
        await ppvImg.scrollIntoViewIfNeeded().catch(() => { });
        await this.page.waitForTimeout(150);
        found = await isTileInView();
      }

      if (!found) {
        const dump = await railWrapper.evaluate((el: HTMLElement) => {
          const imgs = Array.from(el.querySelectorAll('img')).slice(0, 20).map((img: HTMLImageElement) => ({
            alt: img.alt,
            src: img.src?.substring(0, 80),
            w: img.width,
            h: img.height,
          }));
          return {
            nextDisabled: el.querySelector('button[aria-label="Next slide"]')?.classList.contains('swiper-button-disabled'),
            imgs,
          };
        }).catch(() => null);

        console.log('=== RAIL DEBUG ===');
        console.log('Next disabled:', dump?.nextDisabled);
        console.log('Images:', JSON.stringify(dump?.imgs, null, 2));
        throw new Error(`❌ [HomePage Tile] Could not find "${fighter1 || ppvName}" tile in "Don't Miss" rail after ${clicks} clicks`);
      }

      console.log(`📌 [HomePage Tile] Found PPV tile, clicking to open modal...`);
      await found.scrollIntoViewIfNeeded().catch(() => { });
      await this.page.waitForTimeout(150);

      const beforeUrl = this.page.url();
      try {
        await found.click({ force: true, timeout: 10000 });
        console.log(`✅ [HomePage Tile] Clicked PPV tile`);
      } catch (e: any) {
        console.log('⚠️ Standard click failed → trying JS click');
        const handle = await found.elementHandle();
        if (handle) {
          await this.page.evaluate((el: any) => el.click(), handle);
          console.log(`✅ [HomePage Tile] JS click executed on PPV tile`);
        } else {
          throw new Error('❌ PPV tile click failed: ' + e.message);
        }
      }

      let modal: any = null;
      for (let attempt = 0; attempt < 15; attempt++) {
        if (this.page.url() !== beforeUrl) {
          console.log(`✅ [HomePage Tile] Tile click navigated to: ${this.page.url()}`);
          return this.page.locator('body');
        }
        modal = await this.waitForModal();
        if (modal) {
          break;
        }
        await this.page.waitForTimeout(150);
      }

      if (!modal) {
        throw new Error('❌ [HomePage Tile] Modal popup did not appear after clicking tile');
      }

      console.log(`✅ [HomePage Tile] Modal popup found`);
      return modal;
    }

    // For home-page-get-started: locate the "Get Started" CTA on the welcome/home page
    if (src === 'home-page-get-started') {
      console.log('🔍 [HomePage] Finding "Get Started" CTA (preferring header)...');

      // Look in header first to trigger default signup flow without event context
      let getStartedBtn = this.page.locator([
        'header a:has-text("Get started")',
        'header button:has-text("Get started")',
        'header a:has-text("Sign up")',
        'header button:has-text("Sign up")',
        'header a:has-text("Sign up now")',
        'header button:has-text("Sign up now")',
        '[class*="header" i] a:has-text("Get started")',
        '[class*="header" i] button:has-text("Get started")',
        '[class*="header" i] a:has-text("Sign up")',
        '[class*="header" i] button:has-text("Sign up")',
        '[class*="header" i] a:has-text("Sign up now")',
        '[class*="header" i] button:has-text("Sign up now")'
      ].join(', ')).first();

      let found = await getStartedBtn.waitFor({ state: 'visible', timeout: 3000 })
        .then(() => true)
        .catch(() => false);

      if (found) {
        console.log('✅ [HomePage] Found "Get Started" CTA in header');
        return getStartedBtn;
      }

      console.log('⚠️ [HomePage] Header "Get Started" CTA not visible — trying page-wide search');
      getStartedBtn = this.page.locator([
        'button:has-text("Get started ")', 'a:has-text("Get started")',
        'button:has-text("Get started")', 'a:has-text("Get started")',
        'button:has-text("Sign up")', 'a:has-text("Sign up")',
        'button:has-text("Sign up now")', 'a:has-text("Sign up now")'
      ].join(', ')).first();

      found = await getStartedBtn.waitFor({ state: 'visible', timeout: 12000 })
        .then(() => true)
        .catch(() => false);

      if (!found) {
        // Scroll down to find it if not immediately visible
        for (let i = 1; i <= 5; i++) {
          await this.page.evaluate((pos: number) => {
            window.scrollTo({ top: pos, behavior: 'instant' });
          }, i * 600).catch(() => { });
          const visible = await getStartedBtn.isVisible().catch(() => false);
          if (visible) break;
        }
      }

      if (!(await getStartedBtn.isVisible().catch(() => false))) {
        throw new Error('❌ [HomePage] "Get Started" CTA not found on welcome/home page');
      }

      console.log('✅ [HomePage] "Get Started" CTA found');
      return getStartedBtn;
    }

    // For home-page-subscribe: locate the "Subscribe" CTA in the header nav (freemium logged-in users)
    if (src === 'home-page-subscribe') {
      console.log('🔍 [HomePage] Finding "Subscribe" CTA in header nav...');

      const subscribeBtn = this.page.locator([
        'header a:has-text("Subscribe")',
        'header button:has-text("Subscribe")',
        '[class*="header-nav"] a:has-text("Subscribe")',
        '[class*="header-nav"] button:has-text("Subscribe")',
        'a[class*="upgrade-btn"]:has-text("Subscribe")',
        'a[class*="upgrade_btn"]:has-text("Subscribe")',
        '[class*="header" i] a:has-text("Subscribe")',
        '[class*="header" i] button:has-text("Subscribe")',
      ].join(', ')).first();

      const found = await subscribeBtn.waitFor({ state: 'visible', timeout: 10000 })
        .then(() => true)
        .catch(() => false);

      if (!found) {
        throw new Error('❌ [HomePage] "Subscribe" CTA not found in header nav. Ensure user is logged in as freemium.');
      }

      console.log('✅ [HomePage] "Subscribe" CTA found in header nav');
      return subscribeBtn;
    }

    console.warn(`⚠️ Unknown source "${source || 'unknown'}" for HomePage. Valid sources: home-page-banner, home-page-dont-miss, home-page-get-started, home-page-subscribe, home-biggest-fights.`);
    return null;
  }

  private async waitForModal(): Promise<any> {
    // Only match actual modal/dialog containers — NOT generic page elements
    const modalSelectors = [
      '[role="dialog"]',
      '[aria-modal="true"]',
      '[class*="modal" i]',
      '[class*="popup" i]',
      '[class*="Dialog" i]',
      '.Modal',
    ];

    for (const selector of modalSelectors) {
      const modal = this.page.locator(selector).first();
      if (await modal.isVisible().catch(() => false)) {
        const hasBtn = await modal.locator('button, a').first().isVisible().catch(() => false);
        if (hasBtn) {
          return modal;
        }
      }
    }

    // Fallback: find any visible "Buy now" button inside a fixed/absolute overlay
    const buyNowBtn = this.page.locator('button:has-text("Buy now"), a:has-text("Buy now")').first();
    if (await buyNowBtn.isVisible().catch(() => false)) {
      // Walk up to find the closest container that is a true popup (fixed/absolute position)
      const popupContainer = await buyNowBtn.evaluate((el: HTMLElement) => {
        let current: HTMLElement | null = el.parentElement;
        for (let i = 0; i < 10 && current; i++) {
          const style = window.getComputedStyle(current);
          // A real popup is typically fixed or absolute positioned
          if (style.position === 'fixed' || style.position === 'absolute') {
            // Verify it covers a significant area (not just a small positioned element)
            const rect = current.getBoundingClientRect();
            if (rect.width > 200 && rect.height > 200) {
              return true;
            }
          }
          current = current.parentElement;
        }
        return false;
      }).catch(() => false);

      if (popupContainer) {
        // Re-locate the actual container element
        const containerLocator = buyNowBtn.locator('xpath=ancestor::div[contains(@class,"card") or contains(@class,"container") or contains(@class,"content") or contains(@class,"wrapper") or contains(@class,"box")][last()]');
        if (await containerLocator.isVisible().catch(() => false)) {
          console.log('✅ [waitForModal] Found popup via Buy now button in fixed/absolute overlay');
          return containerLocator;
        }
      }
    }

    return null;
  }

  // Click Buy Now logic:
  // For home-page-banner: uses LandingPage clickBuyNow (direct banner navigation)
  // For home-page-dont-miss: clicks Buy Now inside the modal popup
  override async clickBuyNow(container: any, source?: string): Promise<void> {
    const src = (source || '').toLowerCase();

    if (src === 'home-page-banner') {
      await super.clickBuyNow(container, 'banner');
      return;
    }

    if (src === 'home-page-get-started') {
      console.log('🖱️ [HomePage] Clicking "Get Started" CTA...');
      if (!container) {
        throw new Error('❌ [HomePage] Get Started container is null');
      }
      await container.scrollIntoViewIfNeeded().catch(() => { });
      await container.click({ force: true, timeout: 10000 });
      console.log('✅ [HomePage] Clicked "Get Started" CTA');
      return;
    }

    if (src === 'home-page-subscribe') {
      console.log('🖱️ [HomePage] Clicking "Subscribe" CTA...');
      if (!container) {
        throw new Error('❌ [HomePage] Subscribe container is null');
      }
      await container.scrollIntoViewIfNeeded().catch(() => { });
      await container.click({ force: true, timeout: 10000 });
      console.log('✅ [HomePage] Clicked "Subscribe" CTA');
      return;
    }

    if (src === 'home-biggest-fights') {
      console.log('💳 [Biggest Fights] Clicking PPV tile on Competition page → Popup');

      if (!container) {
        throw new Error('❌ [Biggest Fights] Coming Up tile container is null');
      }

      // Click the tile in "Coming Up" rail → popup modal appears
      await container.scrollIntoViewIfNeeded().catch(() => { });
      await container.click({ timeout: 5000 });
      console.log('✅ [Biggest Fights] Clicked Coming Up tile, waiting for popup modal...');

      // Wait for popup modal to appear — then return so handlePopupModal can validate + click Buy Now
      const modalSelectors = [
        '[role="dialog"]',
        '[aria-modal="true"]',
        '[class*="modal" i]',
        '[class*="popup" i]',
        '[class*="Dialog" i]',
      ];

      for (const selector of modalSelectors) {
        const modalLocator = this.page.locator(selector).first();
        const appeared = await modalLocator.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false);
        if (appeared) {
          console.log('✅ [Biggest Fights] Popup modal appeared — handing off to popup handler for validation + Buy Now click');
          return;
        }
      }

      console.log('⚠️ [Biggest Fights] Popup modal not detected — handlePopupModal will attempt to find it');
      return;
    }

    if (src === 'home-page-dont-miss') {
      console.log('💳 [HomePage Tile] Clicking "Buy now" in modal popup...');

      if (!container) {
        throw new Error('❌ [HomePage Tile] Modal container is null');
      }

      const ctaSelector = 'button:has-text("Buy now"), a:has-text("Buy now"), button:has-text("Buy Now"), ' +
        'button:has-text("Subscribe"), a:has-text("Subscribe"), ' +
        'button:has-text("Continue"), a:has-text("Continue")';

      const dialog = container.locator('[role="dialog"], [aria-modal="true"], [class*="modal" i]').first();
      let buyNowBtn = dialog.locator(ctaSelector).first();

      let visible = await buyNowBtn.isVisible({ timeout: 2000 }).catch(() => false);
      if (!visible) {
        console.log('⏳ [HomePage Tile] Dialog selector not active. Trying generic container check...');
        buyNowBtn = container.locator(ctaSelector).first();
        visible = await buyNowBtn.isVisible({ timeout: 2000 }).catch(() => false);
      }

      if (!visible) {
        console.log('⏳ [HomePage Tile] Waiting for Buy now button in modal...');
        await this.page.waitForTimeout(1000);
        visible = await buyNowBtn.isVisible({ timeout: 3000 }).catch(() => false);
      }

      if (!visible) {
        throw new Error('❌ [HomePage Tile] Buy now button not found inside modal popup. Will NOT search page-wide to avoid clicking wrong PPV.');
      }

      // Try robust click strategies:
      // 1. Standard click
      try {
        console.log('🖱️ [HomePage Tile] Trying standard click on Buy now button...');
        await buyNowBtn.click({ timeout: 5000 });
        console.log('✅ [HomePage Tile] Clicked Buy now via standard click');
        return;
      } catch (clickErr: any) {
        console.log(`⚠️ [HomePage Tile] Standard click failed: ${clickErr.message} — trying JS click`);
        const handle = await buyNowBtn.elementHandle().catch(() => null);
        if (handle) {
          await this.page.evaluate((el: any) => {
            el.click();
          }, handle);
          console.log('✅ [HomePage Tile] JS click on Buy now executed');
          return;
        }

        console.log(`⚠️ [HomePage Tile] JS click not possible — trying force click`);
        try {
          await buyNowBtn.click({ force: true, timeout: 5000 });
          console.log('✅ [HomePage Tile] Clicked Buy now via force click');
          return;
        } catch (forceErr: any) {
          throw new Error('❌ [HomePage Tile] Buy now button click failed: ' + forceErr.message);
        }
      }
    }

    await super.clickBuyNow(container, source);
  }

  // --- EXISTING METHODS PRESERVED FOR BACKWARD COMPATIBILITY ---

  async navigateToMyAccount(): Promise<void> {
    console.log('👤 Navigating to My Account...');

    // ── Wait for page to be fully loaded ─────────────────────
    await this.page.waitForLoadState('domcontentloaded');

    // Avoid clicking volatile header controls after sign-in. The profile menu
    // can shift by region/session and may open All Sports instead of Account.
    await this.page.keyboard.press('Escape').catch(() => { });
    await this.navigateDirectly();
  }

  protected getFallbackBaseUrl(): string {
    const env = (process.env.DAZN_ENV || 'stag').toLowerCase();
    let region = (process.env.DAZN_REGION || 'GB').toUpperCase();
    if (region === 'UAE') region = 'AE';
    let domain = 'stag.dazn.com';
    if (env === 'beta') domain = 'beta.dazn.com';
    if (env === 'prod') domain = 'www.dazn.com';
    return `https://${domain}/en-${region}`;
  }

  private async navigateDirectly(): Promise<void> {
    const currentUrl = this.page.url();
    const baseUrlMatch = currentUrl.match(/(https:\/\/[a-z0-9.-]*dazn\.com\/en-[A-Z]+)/i);
    const cleanBase = baseUrlMatch?.[1]
      || this.baseUrl
      || this.getFallbackBaseUrl();

    console.log(`🔗 Direct navigation to: ${cleanBase}/myaccount`);
    await this.page.goto(`${cleanBase}/myaccount`, {
      waitUntil: 'domcontentloaded',
    });
    await this.page.waitForURL(
      url => {
        const u = url.toString().toLowerCase();
        return (
          u.includes('/myaccount') ||
          (u.includes('/account') &&
            !u.includes('/signup') &&
            !u.includes('/signin') &&
            !u.includes('/personaldetails') &&
            !u.includes('/emaildetails') &&
            !u.includes('/content/'))
        );
      },
      { timeout: 15000 }
    ).catch(() => { });
    await this.page.waitForLoadState('domcontentloaded').catch(() => { });
    console.log(`✅ On My Account: ${this.page.url()}`);
  }

  async dismissPopup(): Promise<void> {
    console.log('🔍 Checking for popups...');
    try {
      const dismissSelectors =
        'button:has-text("Keep me updated"), ' +
        'button:has-text("Keep Me Updated"), ' +
        'button:has-text("Maybe later"), ' +
        'button:has-text("Maybe Later"), ' +
        'button:has-text("No thanks"), ' +
        'button:has-text("No Thanks"), ' +
        'button:has-text("Not now"), ' +
        'button:has-text("Not Now"), ' +
        'button:has-text("Close"), ' +
        'button:has-text("Dismiss"), ' +
        'button:has-text("Skip"), ' +
        'button:has-text("Got it"), ' +
        'button:has-text("Got It"), ' +
        'button:has-text("OK"), ' +
        'button:has-text("Cancel"), ' +
        'button:has-text("Done"), ' +
        'button:has-text("Use web version"), ' +
        'button:has-text("Not interested"), ' +
        'button:has-text("Remind me later"), ' +
        'button:has-text("No, thanks"), ' +
        '[aria-label="Close"], ' +
        '[aria-label="close"], ' +
        '[aria-label*="close" i], ' +
        '[aria-label*="dismiss" i], ' +
        '[data-testid*="close" i], ' +
        '[data-testid*="dismiss" i], ' +
        '[role="dialog"] button[class*="close" i], ' +
        '[role="dialog"] button[aria-label*="close" i], ' +
        'button[class*="close" i]:not(input), ' +
        'button[class*="dismiss" i]:not(input)';

      for (let attempt = 0; attempt < 3; attempt++) {
        const popup = this.page.locator(dismissSelectors).first();

        if (await popup.isVisible({ timeout: attempt === 0 ? 2000 : 1000 }).catch(() => false)) {
          const btnText = await popup.textContent().catch(() => '');
          await popup.click({ force: true });
          await this.page.waitForTimeout(200);
          console.log(`✅ Dismissed popup (attempt ${attempt + 1}): "${btnText?.trim()}"`);
          continue;
        }
        break;
      }

      const modal = this.page.locator(
        '[role="dialog"]:not([aria-hidden="true"]), ' +
        '[role="alertdialog"], ' +
        '[class*="modal" i]:not([aria-hidden="true"]), ' +
        '[class*="overlay" i]:not([aria-hidden="true"]), ' +
        '[class*="popup" i]:not([aria-hidden="true"]), ' +
        '[class*="drawer" i]:not([aria-hidden="true"])'
      ).first();

      if (await modal.isVisible({ timeout: 1000 }).catch(() => false)) {
        const closeBtn = modal.locator(
          'button[aria-label*="close" i], ' +
          'button[class*="close" i], ' +
          '[data-testid*="close" i]'
        ).first();

        if (await closeBtn.isVisible({ timeout: 500 }).catch(() => false)) {
          await closeBtn.click({ force: true });
          await this.page.waitForTimeout(200);
          console.log('✅ Dismissed modal via close button');
          return;
        }

        const modalBtn = modal.locator('button').last();
        if (await modalBtn.isVisible({ timeout: 500 }).catch(() => false)) {
          const btnText = await modalBtn.textContent().catch(() => '');
          const dangerous = /confirm|subscribe|buy|pay|upgrade|continue with dazn/i;
          if (!dangerous.test(btnText || '')) {
            await modalBtn.click({ force: true });
            await this.page.waitForTimeout(200);
            console.log(`✅ Dismissed modal via last button: "${btnText?.trim()}"`);
            return;
          }
        }

        await this.page.keyboard.press('Escape');
        await this.page.waitForTimeout(200);
        console.log('✅ Dismissed modal via Escape');
        return;
      }

      console.log('ℹ️  No popup found');
    } catch {
      console.log('ℹ️  No popup found');
    }
  }

  // ─────────────────────────────
  // SPORTS DROPDOWN TRIGGER HELPERS
  // ─────────────────────────────
  protected async clickAllSportsDropdown(): Promise<boolean> {
    console.log('🔍 Looking for "All Sports" or "Sports" dropdown menu trigger...');
    const triggers = [
      { label: 'button role: All sports', locator: this.page.getByRole('button', { name: /^All sports$/i }) },
      { label: 'link role: All sports', locator: this.page.getByRole('link', { name: /^All sports$/i }) },
      { label: 'button role: Sports', locator: this.page.getByRole('button', { name: /^Sports$/i }) },
      { label: 'link role: Sports', locator: this.page.getByRole('link', { name: /^Sports$/i }) },
      { label: 'button text: All sports', locator: this.page.locator('button').filter({ hasText: /^All sports$/i }) },
      { label: 'anchor text: All sports', locator: this.page.locator('a').filter({ hasText: /^All sports$/i }) },
      { label: 'button aria-label sports', locator: this.page.locator('button[aria-label*="sports" i]') },
      { label: 'anchor aria-label sports', locator: this.page.locator('a[aria-label*="sports" i]') },
    ];

    for (const trigger of triggers) {
      const locator = trigger.locator;
      const count = await locator.count().catch(() => 0);
      for (let i = 0; i < count; i++) {
        const el = locator.nth(i);
        const visible = await el.isVisible().catch(() => false);
        if (visible) {
          const triggerText = ((await el.innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
          const ariaLabel = await el.getAttribute('aria-label').catch(() => '');
          const textLooksRight = /^all sports$/i.test(triggerText) || /^sports$/i.test(triggerText) || /sports/i.test(ariaLabel || '');
          if (!textLooksRight) {
            console.log(`⏭️ Skipping dropdown candidate "${trigger.label}" because text/label is "${triggerText || ariaLabel || 'empty'}"`);
            continue;
          }

          console.log(`🎯 Clicking Sports dropdown trigger: "${trigger.label}" (${triggerText || ariaLabel})`);
          await el.scrollIntoViewIfNeeded().catch(() => { });
          await el.click({ force: true });

          // Wait up to 3 seconds for a dropdown container to appear
          const containerSelectors = ['[role="menu"]', '[role="listbox"]', '[class*="dropdown" i]', '[class*="menu" i]'];
          for (const cSel of containerSelectors) {
            const menu = this.page.locator(cSel).filter({ hasText: /Boxing|Football|Basketball|MMA|All sports/i }).first();
            const menuVisible = await menu.waitFor({ state: 'visible', timeout: 1000 }).then(() => true).catch(() => false);
            if (menuVisible) {
              console.log(`✅ Sports dropdown menu visible: "${cSel}"`);
              return true;
            }
          }
          await this.page.waitForTimeout(500); // Fallback wait
          return true;
        }
      }
    }
    console.log('⚠️ Could not click Sports dropdown trigger.');
    return false;
  }

  protected async selectSportFromDropdown(sportName: string): Promise<boolean> {
    console.log(`🔍 Selecting sport "${sportName}" from dropdown list...`);

    // Define potential dropdown container selectors to restrict search scope
    const containers = [
      '[role="menu"]',
      '[role="listbox"]',
      '[class*="dropdown" i]',
      '[class*="menu" i]',
      '[class*="sports" i]',
      'div' // generic fallback
    ];

    let activeContainer = this.page.locator('body');
    for (const cSelector of containers) {
      const locator = this.page.locator(cSelector);
      const count = await locator.count().catch(() => 0);
      for (let i = 0; i < count; i++) {
        const c = locator.nth(i);
        if (await c.isVisible().catch(() => false)) {
          const hasOption = await c.locator(`a:has-text("${sportName}"), button:has-text("${sportName}"), li:has-text("${sportName}"), span:has-text("${sportName}")`).first().isVisible().catch(() => false);
          if (hasOption) {
            const box = await c.boundingBox().catch(() => null);
            // Increased max width to 1000 to accommodate multi-column sports mega-menus
            if (box && box.width > 0 && box.width < 1000) {
              activeContainer = c;
              console.log(`✅ Scoping sport search to active dropdown container: "${cSelector}" (width: ${Math.round(box.width)})`);
              break;
            }
          }
        }
      }
      if (activeContainer !== this.page.locator('body')) break;
    }

    // Helper: check if element's own text matches exactly (not a parent with extra text)
    const isExactTextMatch = async (el: any, name: string): Promise<boolean> => {
      const ownText = await el.evaluate((node: HTMLElement) => {
        // Get only the direct text content of this element (not descendants)
        let text = '';
        for (const child of Array.from(node.childNodes)) {
          if (child.nodeType === Node.TEXT_NODE) {
            text += child.textContent || '';
          }
        }
        // If no direct text, use innerText (for elements like <button><span>Boxing</span></button>)
        return text.trim() || node.innerText?.trim() || '';
      }).catch(() => '');
      return ownText.toLowerCase() === name.toLowerCase();
    };

    // ── Strategy 1: Exact text match via getByText ───────────────
    // This uses Playwright's built-in exact matching
    const exactSelectors = [
      activeContainer.getByRole('link', { name: sportName, exact: true }),
      activeContainer.getByRole('button', { name: sportName, exact: true }),
      activeContainer.getByRole('menuitem', { name: sportName, exact: true }),
    ];

    for (const locator of exactSelectors) {
      const count = await locator.count().catch(() => 0);
      for (let i = 0; i < count; i++) {
        const el = locator.nth(i);
        if (await el.isVisible().catch(() => false)) {
          const box = await el.boundingBox().catch(() => null);
          if (box && box.width > 0 && box.height > 0) {
            console.log(`🎯 Clicking sport link (exact match): "${sportName}" inside container`);
            await el.scrollIntoViewIfNeeded().catch(() => { });
            const beforeUrl = this.page.url();
            await el.click({ force: true });

            const navigated = await this.page.waitForURL(
              (url: URL) => url.toString() !== beforeUrl,
              { timeout: 8000 }
            ).then(() => true).catch(() => false);

            if (navigated) {
              return true;
            } else {
              console.log(`⚠️ Clicked sport link (exact) but URL did not change from "${beforeUrl}"`);
            }
          }
        }
      }
    }

    // ── Strategy 2: has-text selectors with exact text verification ──
    const selectors = [
      `button:has-text("${sportName}")`,
      `button span:has-text("${sportName}")`,
      `a:has-text("${sportName}")`,
      `a[href*="sport"]:has-text("${sportName}")`,
      `a[href*="competition"]:has-text("${sportName}")`,
      `[role="menuitem"]:has-text("${sportName}")`,
      `li:has-text("${sportName}")`,
      `div:has-text("${sportName}")`
    ];

    for (const selector of selectors) {
      const locator = activeContainer.locator(selector);
      const count = await locator.count().catch(() => 0);
      for (let i = 0; i < count; i++) {
        const el = locator.nth(i);
        if (await el.isVisible().catch(() => false)) {
          // Verify the element's own text is an exact match (not "Misfits Boxing" for "Boxing")
          const exact = await isExactTextMatch(el, sportName);
          if (!exact) {
            const elText = await el.innerText().catch(() => '');
            console.log(`⏭️ Skipping "${elText.trim()}" — not exact match for "${sportName}"`);
            continue;
          }
          const box = await el.boundingBox().catch(() => null);
          if (box && box.width > 0 && box.height > 0) {
            console.log(`🎯 Clicking sport link: "${selector}" inside container`);
            await el.scrollIntoViewIfNeeded().catch(() => { });
            const beforeUrl = this.page.url();
            await el.click({ force: true });

            const navigated = await this.page.waitForURL(
              (url: URL) => url.toString() !== beforeUrl,
              { timeout: 8000 }
            ).then(() => true).catch(() => false);

            if (navigated) {
              return true;
            } else {
              console.log(`⚠️ Clicked sport link "${selector}" but URL did not change from "${beforeUrl}"`);
            }
          }
        }
      }
    }
    return false;
  }

  // ─────────────────────────────────────────────────────────────
  // WAIT FOR HOME PAGE POPUP — 3-attempt popup detection + validate + Buy Now
  // Called after the user has authenticated and is ready to land on /home.
  // Handles: navigate to home → poll → refresh+poll → logout+re-login+poll
  //          → validate popup fields → click Buy Now → wait for navigation
  // ─────────────────────────────────────────────────────────────
  async waitForHomePagePopup(
    credentials: { email: string; password: string },
    baseUrl: string,
    results: any[],
    eventData: any
  ): Promise<void> {
    console.log('\n╔═══════════════════════════════════════════════════════╗');
    console.log('║  HOME PAGE POPUP — Detecting popup on home page       ║');
    console.log('╚═══════════════════════════════════════════════════════╝\n');

    // ── Navigate to home page (skip if already there — the popup appears on login redirect) ──
    const currentUrl = this.page.url();
    if (currentUrl.includes('/home')) {
      console.log('🏠 [Home Page Popup] Already on home page — waiting for page to settle...');
      await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => { });
    } else {
      console.log('🏠 [Home Page Popup] Navigating to home page...');
      await this.page.goto(`${baseUrl}/home`, { waitUntil: 'domcontentloaded' });
      await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => { });
    }
    await handleCookies(this.page, 5000);
    await stabilisePage(this.page);
    console.log(`📍 [Home Page Popup] On home page: ${this.page.url()}`);

    // ── Attempt 1 — poll 40s for popup ──
    console.log('\n🔁 [Home Page Popup] Attempt 1 — polling 40s for popup...');
    let popupModal: any = await pollForHomePagePopup(this.page, 40000);

    // ── Attempt 2 — refresh and poll again ──
    if (!popupModal) {
      console.log('\n🔁 [Home Page Popup] Attempt 2 — refreshing page and polling 40s...');
      await this.page.reload({ waitUntil: 'domcontentloaded' });
      await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => { });
      await handleCookies(this.page, 5000);
      await stabilisePage(this.page);
      console.log(`📍 [Home Page Popup] After refresh: ${this.page.url()}`);
      popupModal = await pollForHomePagePopup(this.page, 40000);
    }

    // ── Attempt 3 — logout, re-login, navigate to home, poll ──
    if (!popupModal) {
      console.log('\n🔁 [Home Page Popup] Attempt 3 — logging out and signing back in...');

      await logoutForPopupRetry(this.page, baseUrl);
      await handleCookies(this.page, 5000);

      // Re-login
      const signinUrl = `${baseUrl}/signin`;
      console.log(`🔐 [Home Page Popup] Re-navigating to: ${signinUrl}`);
      await this.page.goto(signinUrl, { waitUntil: 'domcontentloaded' });
      await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => { });
      await handleCookies(this.page, 10000);
      await this.page.waitForURL(/emailDetails|signup|signin/i, { timeout: 10000 }).catch(() => { });

      // Enter email
      const emailInput = this.page.locator(
        'input[type="email"], input[name="email"], input[placeholder*="email" i]'
      ).first();
      await emailInput.waitFor({ state: 'visible', timeout: 10000 });
      console.log(`📧 [Home Page Popup] Re-entering email: ${credentials.email}`);
      await emailInput.fill(credentials.email);

      const emailNextBtn = this.page.locator(
        'button:has-text("Next"), button:has-text("Continue"), button[type="submit"]'
      ).first();
      await clickAndWaitForNav(this.page, emailNextBtn, 'Home Page Popup Retry — Email Next');
      await this.page.waitForLoadState('domcontentloaded').catch(() => { });

      // Enter password if shown
      const passwordInput = this.page.locator(
        'input[type="password"], input[name="password"]'
      ).first();
      try {
        await passwordInput.waitFor({ state: 'visible', timeout: 8000 });
        console.log('🔑 [Home Page Popup] Entering password for retry login...');
        await passwordInput.fill(credentials.password);
        const signInBtn = this.page.locator(
          'button:has-text("Sign in"), button:has-text("Log in"), ' +
          'button:has-text("Sign In"), button[type="submit"]'
        ).first();
        await clickAndWaitForNav(this.page, signInBtn, 'Home Page Popup Retry — Sign In');
      } catch {
        console.log('ℹ️ [Home Page Popup] Password field not shown during retry');
      }

      // Wait for redirect to /home (don't force goto — popup appears on redirect)
      await this.page.waitForURL(/\/home/i, { timeout: 20000 }).catch(() => { });
      await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => { });
      await handleCookies(this.page, 5000);
      await stabilisePage(this.page);
      console.log(`📍 [Home Page Popup] After re-login, on: ${this.page.url()}`);

      popupModal = await pollForHomePagePopup(this.page, 40000);
    }

    // ── Fail if popup still not found ──
    if (!popupModal) {
      throw new Error(
        `❌ [Home Page Popup] PPV popup did not appear after 3 attempts ` +
        `(initial load + page refresh + re-login). URL: ${this.page.url()}`
      );
    }

    // ── Validate popup fields via PPV_Input.xlsx (Home page sheet → Flow: home-page-popup) ──
    console.log('\n📋 [Home Page Popup] Validating popup fields...');
    try {
      const popupData = getHomePageData('home-page-popup');
      if (popupData && popupData.length > 0) {
        await validateVariant(
          this.page, 'home-page', popupData, results, eventData, 'Home Page Popup', 'home-page-popup'
        );
        console.log('✅ [Home Page Popup] Popup validations complete');
      } else {
        console.log('ℹ️ [Home Page Popup] No validation rules found in PPV_Input.xlsx for home-page-popup');
      }
    } catch (err: any) {
      console.warn(`⚠️ [Home Page Popup] Popup validation error: ${err.message}`);
    }

    // ── Click Buy Now inside the popup via JS click (avoids overlay interception) ──
    console.log('\n💳 [Home Page Popup] Clicking Buy Now inside popup...');

    const clicked = await this.page.evaluate(() => {
      // Try DAZN-specific button first
      const selectors = [
        '[class*="content-promotion"] button.tp-button-primary',
        '[class*="content-promotion"] button',
        '[class*="modal"] button.tp-button-primary',
        '[class*="modal"] button',
      ];
      for (const sel of selectors) {
        const btns = document.querySelectorAll<HTMLButtonElement>(sel);
        for (const btn of btns) {
          const text = (btn.textContent || '').trim().toLowerCase();
          if (text.includes('buy now') || text.includes('buy')) {
            btn.click();
            return `Clicked: "${btn.textContent?.trim()}" via ${sel}`;
          }
        }
      }
      return null;
    });

    if (clicked) {
      console.log(`✅ [Home Page Popup] ${clicked}`);
    } else {
      console.warn('⚠️ [Home Page Popup] JS click failed — trying Playwright click...');
      const fallbackBtn = this.page.locator(
        '[class*="content-promotion"] button:has-text("Buy Now"), ' +
        '[class*="modal"] button:has-text("Buy Now")'
      ).first();
      await fallbackBtn.click({ force: true }).catch((e: any) => {
        console.error(`❌ [Home Page Popup] Fallback click also failed: ${e.message}`);
      });
    }

    console.log('⏳ [Home Page Popup] Waiting for navigation...');
    await this.page.waitForURL(
      (url: URL) =>
        url.toString().includes('PlanDetails') ||
        url.toString().includes('TierPlans') ||
        url.toString().includes('signup') ||
        url.toString().includes('payment') ||
        url.toString().includes('checkout'),
      { timeout: 15000 }
    ).catch(() => {
      console.log(`⚠️ [Home Page Popup] Navigation timeout — current URL: ${this.page.url()}`);
    });

    console.log(`📍 [Home Page Popup] After Buy Now: ${this.page.url()}`);
  }
}
