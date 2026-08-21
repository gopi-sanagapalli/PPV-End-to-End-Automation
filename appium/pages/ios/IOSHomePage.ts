import {
  IOSFlowHooks,
  WdBrowser,
} from './IOSBasePage';
import { IOSLandingPage } from './IOSLandingPage';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

interface IOSVisualTileMatch {
  visible: boolean;
  xPercent: number | null;
  yPercent: number | null;
  ocrTexts?: string[];
  screenshotFingerprint?: string;
}

interface IOSVisualRailMatch {
  visible: boolean;
  yPercent: number | null;
}

export class IOSHomePage extends IOSLandingPage {
  async ensureOnHome(): Promise<void> {
    const homeTabSel = '-ios predicate string:(name == "Home" OR label == "Home") AND type == "XCUIElementTypeButton"';
    const homeTab = await this.driver.$(homeTabSel);
    if (await homeTab.isDisplayed().catch(() => false)) {
      console.log('  Already on Home page');
      return;
    }

    const homeClicked = await this.tapByText('Home', 3000);
    if (!homeClicked) {
      console.log('  Could not tap Home by text; trying to click home button locator...');
      await homeTab.click().catch(() => { });
    }
    await this.driver.pause(3000);
  }

  async openHomeBannerPaywall(hooks: IOSFlowHooks = {}, options: { immediatePaywall?: boolean } = {}): Promise<boolean> {
    await this.ensureOnHome();
    await this.driver.pause(2000);

    const bannerCtaTapped = await this.openBannerPaywall({
      label: 'Home Page',
      pageName: 'Home page',
      missingScreenshot: './test-results/ios_home_ppv_banner_not_found.png',
      foundScreenshot: './test-results/ios_home_ppv_banner_found.png',
      buyMissingScreenshot: './test-results/ios_home_buy_cta_not_found.png',
      ctaTexts: ['Buy now', 'Buy Now'],
      validateSurface: 'PPV Banner',
      immediatePaywall: options.immediatePaywall ?? true,
      recordPage: 'Home Page',
      ensureBannerStillVisibleBeforeBuy: true,
      tapVerifiedBannerCta: true,
    }, hooks);
    if (!bannerCtaTapped) return false;

    const isUltimateUser = ['active_ultimate_apm', 'active_ultimate_upfront'].includes(
      String(process.env.USER_STATE || '').toLowerCase().trim(),
    );
    const isLoginFirst = String(process.env.LOGIN_FIRST || '').toLowerCase() === 'true';
    if (isUltimateUser && isLoginFirst) return true;

    console.log('Validating native Home Page paywall before external handoff...');
    await this.driver.saveScreenshot('./test-results/ios_home_native_paywall.png');
    await this.runPaywallValidation(hooks);
    if (await this.handleUsNativePaywallSheet(hooks)) return true;

    return this.tapBuyCtaWithFallback([
      'Go to dazn.com/start',
      'Go to DAZN.com/start',
      'dazn.com/start',
      'Buy now',
      'Buy Now',
      'Buy',
      'Get PPV',
      'Purchase',
    ]);
  }

  async openGenericPPVPaywall(hooks: IOSFlowHooks = {}): Promise<boolean> {
    console.log(`Unknown source fallback - finding "${this.ppvName}" from current screen`);
    const found = await this.findPPVBanner(this.ppvName);
    if (!found) {
      const shot = hooks.saveScreenshot
        ? await hooks.saveScreenshot('./test-results/ios_ppv_not_found.png')
        : undefined;
      hooks.recordAvailability?.(false, shot);
      await hooks.generateAvailabilityFailureReport?.(`PPV "${this.ppvName}" not found`);
      throw new Error(`"${this.ppvName}" not found`);
    }

    hooks.recordAvailability?.(true);
    await this.runSurfaceValidation(hooks, 'PPV Banner');
    await this.tapByText(this.ppvName);
    await this.driver.pause(2000);

    const isUltimateUser = ['active_ultimate_apm', 'active_ultimate_upfront'].includes(String(process.env.USER_STATE || '').toLowerCase().trim());
    const isLoginFirst = String(process.env.LOGIN_FIRST || '').toLowerCase() === 'true';

    if (isUltimateUser && isLoginFirst) {
      await this.validateUltimateFixtureOrPreviewPage(hooks);
      console.log('✨ [Ultimate Active User with LOGIN_FIRST=true] Tile clicked (generic). Skipping Buy click and returning true.');
      return true;
    }

    return this.tapBuyCtaWithFallback(['Buy now', 'Buy Now', 'Buy'], { scrollBeforeFallback: false });
  }

  async openHomePageDontMissPaywall(
    hooks: IOSFlowHooks = {},
    options: { skipEnsureHome?: boolean; recordPage?: string } = {},
  ): Promise<boolean> {
    console.log('Home Page -> Find "Don\'t Miss" rail -> swipe to PPV tile -> open PPV');
    if (!options.skipEnsureHome) await this.ensureOnHome();
    delete process.env.IOS_DONT_MISS_PPV_TILE_FOUND;
    delete process.env.IOS_DONT_MISS_OCR_TEXTS;

    // iOS accessibility labels vary between the straight and typographic
    // apostrophe, depending on the feed payload and OS text rendering.
    const railLabels = ["Don't Miss", 'Don’t Miss', 'Dont Miss'];
    // XCUITest can report collection items as displayed while they sit beyond
    // the left or right edge of a horizontally scrolling rail. Require the
    // element's centre point to be on screen so an off-screen/edge-only PPV
    // card cannot bypass the rail swipe loop.
    const isInViewport = async (candidate: any): Promise<boolean> => {
      if (typeof candidate?.getLocation !== 'function') return false;
      const [viewport, location, size] = await Promise.all([
        this.driver.getWindowRect().catch(() => null),
        candidate.getLocation().catch(() => null),
        typeof candidate.getSize === 'function'
          ? candidate.getSize().catch(() => null)
          : Promise.resolve(null),
      ]);
      if (!viewport || !location || !size || size.width <= 0 || size.height <= 0) return false;
      const centreX = location.x + (size?.width || 0) / 2;
      const centreY = location.y + (size?.height || 0) / 2;
      return centreX >= 0 && centreX < viewport.width && centreY >= 0 && centreY < viewport.height;
    };
    const findVisibleDontMissRail = async (): Promise<any | undefined> => {
      for (const label of railLabels) {
        const selectors = [
          `~${label}`,
          `-ios predicate string:type == "XCUIElementTypeStaticText" AND (name CONTAINS[c] "${label}" OR label CONTAINS[c] "${label}")`,
          `-ios predicate string:name CONTAINS[c] "${label}" OR label CONTAINS[c] "${label}"`,
        ];
        for (const selector of selectors) {
          const candidates = await this.driver.$$(selector);
          for (const candidate of candidates) {
            if (!(await candidate.isDisplayed().catch(() => false))) continue;
            const type = await candidate.getAttribute('type').catch(() => '');
            if (type && type !== 'XCUIElementTypeStaticText') continue;
            // XCTest can retain a displayed accessibility node after its rail
            // has moved outside the viewport. Do not lock horizontal swipes
            // to that stale heading.
            if (typeof candidate.getLocation !== 'function') continue;
            if (await isInViewport(candidate)) return candidate;
          }
        }
      }
      return undefined;
    };
    let railFound = false;
    let railY = 0;
    const findRailByRenderedHeading = async (): Promise<boolean> => {
      // On this real-device build, the screenshot shows the heading while its
      // accessibility element can be absent from page source and predicates.
      // Check the rendered screen directly, rather than gating OCR on the
      // unavailable native hierarchy.
      const visualRail = await locateIOSDontMissRailByImage(this.driver);
      if (!visualRail.visible || visualRail.yPercent === null) return false;
      const { height } = await this.driver.getWindowRect();
      railY = Math.round(height * visualRail.yPercent);
      console.log(`  Found rendered Don't Miss heading at y=${railY}; stopping vertical scroll.`);
      return true;
    };
    // After an existing-user login, the Home tab is visible before its feed
    // has rendered. Wait for the actual rail condition before any vertical
    // movement; otherwise the scroll can outrun the late-arriving feed.
    railFound = await this.driver.waitUntil(async () => {
      const rail = await findVisibleDontMissRail();
      if (!rail) return false;
      const location = await rail.getLocation().catch(() => null);
      if (!location) return false;
      railY = location.y;
      railFound = true;
      return true;
    }, {
      timeout: 10000,
      interval: 500,
      timeoutMsg: "Don't Miss rail did not appear in the initial Home feed.",
    }).then(() => true).catch(() => false);
    // Some real-device builds render the heading in the screenshot before it
    // becomes an accessibility element. Preserve the OCR fallback, but only
    // after the native rail wait so it is not repeatedly invoked while the
    // feed is still mounting.
    let lastRailOcrAttempt = 0;
    if (!railFound) railFound = await findRailByRenderedHeading();
    // Keep the vertical movement deliberately small. The generic scrollDown
    // gesture moves roughly 40% of the screen and can take this rail from
    // below the fold to above it in one action before it is checked again.
    const scrollTowardDontMissRail = async (): Promise<void> => {
      const { width, height } = await this.driver.getWindowRect();
      const x = Math.round(width / 2);
      await this.driver.performActions([{
        type: 'pointer', id: 'dont-miss-vertical-search', parameters: { pointerType: 'touch' },
        actions: [
          { type: 'pointerMove', duration: 0, x, y: Math.round(height * 0.65) },
          { type: 'pointerDown', button: 0 },
          { type: 'pause', duration: 80 },
          { type: 'pointerMove', duration: 250, x, y: Math.round(height * 0.50) },
          { type: 'pointerUp', button: 0 },
        ],
      }]);
      await this.driver.releaseActions();
    };
    for (let attempt = 0; attempt < 20 && !railFound; attempt++) {
      const rail = await findVisibleDontMissRail();
      if (rail) {
        const location = await rail.getLocation();
        railY = location.y;
        railFound = true;
        console.log(`  Found visible Don't Miss rail at y=${railY}; stopping vertical scroll.`);
      } else if (attempt - lastRailOcrAttempt >= 2) {
        lastRailOcrAttempt = attempt;
        railFound = await findRailByRenderedHeading();
      }
      if (!railFound) {
        console.log(`  Don't Miss rail is not in the viewport; making short vertical swipe ${attempt + 1}/20.`);
        await scrollTowardDontMissRail();
        // Poll the real rail condition after each small gesture. This waits
        // for the native list to settle without adding a blind delay.
        await this.driver.waitUntil(async () => {
          const appearedRail = await findVisibleDontMissRail();
          if (!appearedRail) return false;
          const location = await appearedRail.getLocation().catch(() => null);
          if (!location) return false;
          railY = location.y;
          railFound = true;
          console.log(`  Found visible Don't Miss rail at y=${railY}; stopping vertical scroll.`);
          return true;
        }, {
          timeout: 1500,
          interval: 250,
          timeoutMsg: "Don't Miss rail did not appear after the short vertical swipe.",
        }).catch(() => { });
      }
    }

    // A heading at the bottom of the viewport leaves its cards underneath the
    // bottom navigation, and a horizontal gesture at the calculated rail
    // position lands above the cards. Move the discovered rail into the middle
    // once, then re-query it before starting the horizontal search.
    if (railFound) {
      const { height } = await this.driver.getWindowRect();
      if (railY > height * 0.55) {
        console.log(`  Don't Miss rail is at y=${railY}; making one short swipe to centre its cards.`);
        await scrollTowardDontMissRail();
        await this.driver.waitUntil(async () => {
          const centredRail = await findVisibleDontMissRail();
          if (!centredRail) return false;
          const location = await centredRail.getLocation().catch(() => null);
          if (!location) return false;
          railY = location.y;
          return true;
        }, {
          timeout: 1500,
          interval: 250,
          timeoutMsg: "Don't Miss rail did not remain visible while being centred.",
        });
        console.log(`  Don't Miss rail centred at y=${railY}; starting horizontal search from its card row.`);
      }
    }

    const recordPage = options.recordPage || 'Home Page';
    if (!railFound) {
      const shot = hooks.saveScreenshot
        ? await hooks.saveScreenshot('./test-results/ios_dont_miss_rail_not_found.png')
        : undefined;
      hooks.recordAvailability?.(false, shot, recordPage);
      await hooks.generateAvailabilityFailureReport?.('"Don\'t Miss" rail not found');
      throw new Error('"Don\'t Miss" rail not found. See test-results/ios_dont_miss_rail_not_found.png');
    }

    const { width, height } = await this.driver.getWindowRect();
    // Do not vertically scroll after this point. Once the rail is visible,
    // all remaining discovery happens in its horizontal card row.
    console.log(`  Don't Miss rail locked at y=${railY}; starting horizontal search only.`);
    const swipeY = Math.max(Math.round(height * 0.30), Math.min(Math.round(height * 0.80), railY + Math.round(height * 0.16)));
    const swipeRail = async (direction: 'left' | 'right', pointerId: string): Promise<void> => {
      const startX = direction === 'left' ? Math.round(width * 0.68) : Math.round(width * 0.32);
      const endX = direction === 'left' ? Math.round(width * 0.38) : Math.round(width * 0.62);
      await this.driver.performActions([{
        type: 'pointer', id: pointerId, parameters: { pointerType: 'touch' },
        actions: [
          { type: 'pointerMove', duration: 0, x: startX, y: swipeY },
          { type: 'pointerDown', button: 0 },
          { type: 'pause', duration: 80 },
          { type: 'pointerMove', duration: 300, x: endX, y: swipeY },
          { type: 'pointerUp', button: 0 },
        ],
      }]);
      await this.driver.releaseActions();
    };
    // The native tile artwork does not consistently expose the complete event
    // name to XCTest.  Match the full name first, then the fighter names, and
    // keep the actual matching element so it can be tapped immediately.
    const ppvTerms = Array.from(new Set([
      this.ppvName,
      ...this.ppvName.split(/\s+vs\.?\s+/i).map(name => name.trim()),
      ...this.ppvTitleTermVariants(this.ppvName).flat(),
    ].filter(term => term.length >= 3)));
    const railBottom = railY + Math.round(height * 0.45);
    let targetTileOutsideViewport = false;
    const findVisiblePpvTile = async (): Promise<any | undefined> => {
      targetTileOutsideViewport = false;
      const inspectedCandidates = new Set<string>();
      for (const term of ppvTerms) {
        const escapedTerm = term.replace(/"/g, '\\"');
        const candidates = await this.driver.$$(`-ios predicate string:name CONTAINS[c] "${escapedTerm}" OR label CONTAINS[c] "${escapedTerm}"`);
        for (const candidate of candidates) {
          if (!(await candidate.isDisplayed().catch(() => false))) continue;
          const location = await candidate.getLocation().catch(() => undefined);
          if (!location || location.y < railY - 40 || location.y > railBottom) continue;
          const size = await candidate.getSize().catch(() => null);
          const fingerprint = `${location.x}:${location.y}:${size?.width || 0}:${size?.height || 0}`;
          // The full event name and both fighter names frequently resolve to
          // the same XCTest node. Inspect and log that node only once per
          // search pass instead of repeating three expensive geometry calls.
          if (inspectedCandidates.has(fingerprint)) continue;
          inspectedCandidates.add(fingerprint);
          const centreX = location.x + (size?.width || 0) / 2;
          const centreY = location.y + (size?.height || 0) / 2;
          if (centreX < 0 || centreX >= width || centreY < 0 || centreY >= height) {
            console.log(`  PPV tile using "${term}" is outside the horizontal viewport at x=${location.x}, y=${location.y}; continuing rail swipe search.`);
            // The exact configured title proves this is the target rail card;
            // querying its fighter-name fallbacks before the next swipe only
            // repeats slow XCUITest geometry calls against the same clipped node.
            if (term === this.ppvName) {
              targetTileOutsideViewport = true;
              return undefined;
            }
            continue;
          }
          console.log(`  Found PPV tile using "${term}" at y=${location.y}; stopping horizontal search.`);
          return candidate;
        }
      }
      return undefined;
    };

    // Don't Miss cards are artwork-only on iOS: XCTest exposes the rail title
    // but not necessarily the PPV title inside the image. OCR the current
    // screenshot locally without changing the scroll or rail-location logic.
    let latestRailScreenshotFingerprint = '';
    const findPpvTileByImage = async (collectEvidenceWithoutTitleMatch = false): Promise<{ x: number; y: number } | undefined> => {
      const visualMatch = await locateIOSPpvTileByImage(this.driver, this.ppvName, {
        minYPercent: Math.max(0, railY / height),
        maxYPercent: Math.min(1, railBottom / height),
      }, collectEvidenceWithoutTitleMatch);
      latestRailScreenshotFingerprint = visualMatch.screenshotFingerprint || '';
      if (!visualMatch.visible || visualMatch.xPercent === null || visualMatch.yPercent === null) {
        if (collectEvidenceWithoutTitleMatch && visualMatch.ocrTexts?.length) {
          // The native tile lookup has already confirmed this event. Retain its
          // complete title when artwork OCR splits or misspells a fighter name.
          process.env.IOS_DONT_MISS_OCR_TEXTS = JSON.stringify([
            ...visualMatch.ocrTexts,
            this.ppvName,
          ]);
        }
        return undefined;
      }

      const x = Math.round(width * visualMatch.xPercent);
      const y = Math.round(height * visualMatch.yPercent);
      if (x < 0 || x > width || y < railY || y > railBottom) {
        console.warn(`  Ignoring visual PPV match outside the Don't Miss rail: x=${x}, y=${y}`);
        return undefined;
      }
      process.env.IOS_DONT_MISS_OCR_TEXTS = JSON.stringify(visualMatch.ocrTexts || []);
      console.log(`  Found PPV artwork for "${this.ppvName}" at x=${x}, y=${y}; stopping horizontal search.`);
      return { x, y };
    };

    let ppvTile = await findVisiblePpvTile();
    let visualTile: { x: number; y: number } | undefined;
    const maxHorizontalRailSwipes = 40;
    let previousRailScreenshotFingerprint = createHash('sha256')
      .update(await this.driver.takeScreenshot())
      .digest('hex');
    let unchangedRailSwipes = 0;
    for (let attempt = 0; attempt < maxHorizontalRailSwipes && !ppvTile && !visualTile; attempt++) {
      console.log(`  PPV tile is not in the current card viewport; making short horizontal swipe ${attempt + 1}/${maxHorizontalRailSwipes}.`);
      await swipeRail('left', 'dont-miss-rail-search');
      ppvTile = await findVisiblePpvTile();
      if (!ppvTile && !targetTileOutsideViewport) visualTile = await findPpvTileByImage();
      if (!ppvTile && !visualTile && latestRailScreenshotFingerprint) {
        unchangedRailSwipes = latestRailScreenshotFingerprint === previousRailScreenshotFingerprint
          ? unchangedRailSwipes + 1
          : 0;
        previousRailScreenshotFingerprint = latestRailScreenshotFingerprint;
        if (unchangedRailSwipes >= 2) {
          console.log('  Don\'t Miss rail did not move after consecutive horizontal swipes; stopping search.');
          break;
        }
      }
    }

    // Vision OCR starts a Swift process and can take tens of seconds on the
    // test host. It is an artwork-only fallback, so keep native search first
    // and only do one final evidence/fallback pass if the loop did not match.
    if (!ppvTile && !visualTile) visualTile = await findPpvTileByImage();

    if (!ppvTile && !visualTile) {
      const shot = hooks.saveScreenshot
        ? await hooks.saveScreenshot('./test-results/ios_dont_miss_ppv_not_found.png')
        : undefined;
      hooks.recordAvailability?.(false, shot, recordPage);
      await hooks.generateAvailabilityFailureReport?.(`PPV "${this.ppvName}" not found in Don't Miss rail`);
      throw new Error(`PPV "${this.ppvName}" not found in Don't Miss rail. See test-results/ios_dont_miss_ppv_not_found.png`);
    }

    // Centre the found card before validation and interaction. The card can
    // first appear at either edge after a search swipe, where validation
    // screenshots are incomplete and the title element is a poor tap target.
    for (let adjustment = 0; adjustment < 2; adjustment++) {
      const location = ppvTile
        ? await ppvTile.getLocation().catch(() => null)
        : visualTile;
      const size = ppvTile
        ? await ppvTile.getSize().catch(() => null)
        : null;
      if (!location) break;
      const tileCenterX = location.x + (size?.width || 0) / 2;
      const centreTolerance = width * 0.15;
      if (Math.abs(tileCenterX - width / 2) <= centreTolerance) break;

      const direction = tileCenterX > width / 2 ? 'left' : 'right';
      console.log(`  PPV tile is at x=${Math.round(tileCenterX)}; making short ${direction} swipe to centre it before validation.`);
      await swipeRail(direction, 'dont-miss-rail-centre');
      if (ppvTile) {
        await this.driver.waitUntil(async () => Boolean(await findVisiblePpvTile()), {
          timeout: 1200,
          interval: 250,
          timeoutMsg: `PPV tile "${this.ppvName}" did not remain visible while being centred.`,
        });
      }
      ppvTile = await findVisiblePpvTile();
      visualTile = ppvTile ? undefined : await findPpvTileByImage();
      if (!ppvTile && !visualTile) {
        throw new Error(`PPV "${this.ppvName}" disappeared while being centred in Don't Miss rail.`);
      }
    }

    // Native title nodes do not contain the date rendered in the card artwork.
    // Capture OCR evidence once the target is centred so PPV Date validation
    // uses the visible card rather than replacing it with the title alone.
    const visualEvidence = await findPpvTileByImage(Boolean(ppvTile));
    if (visualEvidence) visualTile = visualTile || visualEvidence;

    process.env.IOS_DONT_MISS_PPV_TILE_FOUND = 'true';
    if (ppvTile && !process.env.IOS_DONT_MISS_OCR_TEXTS) {
      process.env.IOS_DONT_MISS_OCR_TEXTS = JSON.stringify([this.ppvName]);
    }
    hooks.recordAvailability?.(true, undefined, recordPage);
    await this.driver.saveScreenshot('./test-results/ios_dont_miss_ppv_found.png');
    await this.runSurfaceValidation(hooks, 'PPV Tile');
    if (ppvTile) {
      try {
        await ppvTile.click();
        console.log(`  Opened PPV tile "${this.ppvName}" immediately after it became visible.`);
      } catch {
        const location = await ppvTile.getLocation();
        const size = await ppvTile.getSize();
        await this.driver.performActions([{
          type: 'pointer', id: 'dont-miss-ppv-tile', parameters: { pointerType: 'touch' },
          actions: [
            { type: 'pointerMove', duration: 0, x: Math.round(location.x + size.width / 2), y: Math.round(location.y + size.height / 2) },
            { type: 'pointerDown', button: 0 },
            { type: 'pause', duration: 80 },
            { type: 'pointerUp', button: 0 },
          ],
        }]);
        await this.driver.releaseActions();
        console.log(`  Opened PPV tile "${this.ppvName}" using its visible element bounds.`);
      }
    } else {
      await this.driver.performActions([{
        type: 'pointer', id: 'dont-miss-ppv-artwork', parameters: { pointerType: 'touch' },
        actions: [
          { type: 'pointerMove', duration: 0, x: visualTile!.x, y: visualTile!.y },
          { type: 'pointerDown', button: 0 },
          { type: 'pause', duration: 80 },
          { type: 'pointerUp', button: 0 },
        ],
      }]);
      await this.driver.releaseActions();
      console.log(`  Opened PPV tile "${this.ppvName}" using its artwork coordinates.`);
    }
    await this.driver.pause(2000);

    const isUltimateUser = ['active_ultimate_apm', 'active_ultimate_upfront'].includes(String(process.env.USER_STATE || '').toLowerCase().trim());
    const isLoginFirst = String(process.env.LOGIN_FIRST || '').toLowerCase() === 'true';
    if (isUltimateUser && isLoginFirst) {
      await this.validateUltimateFixtureOrPreviewPage(hooks);
      return true;
    }

    console.log('Validating native Don\'t Miss paywall before external handoff...');
    await this.driver.saveScreenshot('./test-results/ios_dont_miss_native_paywall.png');
    await this.runPaywallValidation(hooks);
    if (await this.handleUsNativePaywallSheet(hooks)) return true;

    const externalCtas = [
      'Go to dazn.com/start',
      'Go to DAZN.com/start',
      'dazn.com/start',
    ];
    return this.tapBuyCtaWithFallback(externalCtas, {
      scrollBeforeFallback: true,
      fallbackCtas: externalCtas,
    });
  }
}

export async function openHomeBannerPaywall(
  driver: WdBrowser,
  ppvName: string,
  hooks: IOSFlowHooks = {},
  options: { immediatePaywall?: boolean } = {},
): Promise<boolean> {
  return new IOSHomePage(driver, ppvName).openHomeBannerPaywall(hooks, options);
}

export async function openGenericPPVPaywall(
  driver: WdBrowser,
  ppvName: string,
  hooks: IOSFlowHooks = {},
): Promise<boolean> {
  return new IOSHomePage(driver, ppvName).openGenericPPVPaywall(hooks);
}

export async function openHomePageDontMissPaywall(
  driver: WdBrowser,
  ppvName: string,
  hooks: IOSFlowHooks = {},
  options: { skipEnsureHome?: boolean; recordPage?: string } = {},
): Promise<boolean> {
  return new IOSHomePage(driver, ppvName).openHomePageDontMissPaywall(hooks, options);
}

async function locateIOSDontMissRailByImage(driver: WdBrowser): Promise<IOSVisualRailMatch> {
  let screenshotPath = '';
  try {
    screenshotPath = path.join(os.tmpdir(), `dazn-dont-miss-ocr-${process.pid}-${Date.now()}.png`);
    fs.writeFileSync(screenshotPath, Buffer.from(await driver.takeScreenshot(), 'base64'));

    const swiftVisionScript = `
      import AppKit
      import Vision

      guard CommandLine.arguments.count > 1,
            let image = NSImage(contentsOfFile: CommandLine.arguments[1]),
            let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
        exit(1)
      }
      let request = VNRecognizeTextRequest()
      request.recognitionLevel = .accurate
      request.usesLanguageCorrection = true
      request.recognitionLanguages = ["en-GB"]
      let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
      try handler.perform([request])
      let values = (request.results ?? []).compactMap { observation -> [String: Any]? in
        guard let text = observation.topCandidates(1).first?.string else { return nil }
        let box = observation.boundingBox
        return ["text": text, "yPercent": 1 - box.midY]
      }
      let data = try JSONSerialization.data(withJSONObject: values)
      print(String(data: data, encoding: .utf8)!)
    `;
    const output = execFileSync('/usr/bin/swift', ['-e', swiftVisionScript, screenshotPath], {
      encoding: 'utf8',
      timeout: 30000,
    });
    const observations = JSON.parse(output) as Array<{ text: string; yPercent: number }>;
    const heading = observations.find(observation => /^don['\u2019]?t\s+miss$/i.test(observation.text.trim()));
    return heading
      ? { visible: true, yPercent: heading.yPercent }
      : { visible: false, yPercent: null };
  } catch (error: any) {
    console.warn(`  Local OCR Don't Miss heading lookup failed: ${error.message}`);
    return { visible: false, yPercent: null };
  } finally {
    if (screenshotPath && fs.existsSync(screenshotPath)) fs.unlinkSync(screenshotPath);
  }
}

async function locateIOSPpvTileByImage(
  driver: WdBrowser,
  ppvName: string,
  verticalRange?: { minYPercent: number; maxYPercent: number },
  collectEvidenceWithoutTitleMatch = false,
): Promise<IOSVisualTileMatch> {
  let screenshotPath = '';
  try {
    screenshotPath = path.join(os.tmpdir(), `dazn-ppv-ocr-${process.pid}-${Date.now()}.png`);
    const screenshot = await driver.takeScreenshot();
    const screenshotFingerprint = createHash('sha256').update(screenshot).digest('hex');
    fs.writeFileSync(screenshotPath, Buffer.from(screenshot, 'base64'));

    const swiftVisionScript = `
      import AppKit
      import Vision

      guard CommandLine.arguments.count > 1,
            let image = NSImage(contentsOfFile: CommandLine.arguments[1]),
            let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
        exit(1)
      }
      let request = VNRecognizeTextRequest()
      request.recognitionLevel = .accurate
      request.usesLanguageCorrection = true
      request.recognitionLanguages = ["en-GB"]
      let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
      try handler.perform([request])
      let values = (request.results ?? []).compactMap { observation -> [String: Any]? in
        guard let text = observation.topCandidates(1).first?.string else { return nil }
        let box = observation.boundingBox
        return ["text": text, "xPercent": box.midX, "yPercent": 1 - box.midY]
      }
      let data = try JSONSerialization.data(withJSONObject: values)
      print(String(data: data, encoding: .utf8)!)
    `;
    const output = execFileSync('/usr/bin/swift', ['-e', swiftVisionScript, screenshotPath], {
      encoding: 'utf8',
      timeout: 30000,
    });
    const observations = JSON.parse(output) as Array<{ text: string; xPercent: number; yPercent: number }>;
    const normalise = (value: string) => String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    const terms = normalise(ppvName)
      .split(/\s+vs\.?\s+|[^a-z0-9]+/)
      .map(term => term.trim())
      .filter(term => term.length >= 3);
    const railObservations = verticalRange
      ? observations.filter(observation =>
        observation.yPercent >= verticalRange.minYPercent &&
        observation.yPercent <= verticalRange.maxYPercent,
      )
      : observations;
    // Prefer an OCR result containing more of the configured PPV name. A
    // partial fighter-name match remains valid for artwork such as the Moses
    // card, where Vision exposes the names as separate words.
    const match = railObservations
      .map(observation => ({
        observation,
        matchedTerms: terms.filter(term => normalise(observation.text).includes(term)).length,
      }))
      .filter(candidate => candidate.matchedTerms > 0)
      .sort((left, right) => right.matchedTerms - left.matchedTerms)[0]?.observation;
    if (!match) {
      return {
        visible: false,
        xPercent: null,
        yPercent: null,
        ocrTexts: collectEvidenceWithoutTitleMatch
          ? railObservations.map(observation => observation.text)
          : undefined,
        screenshotFingerprint,
      };
    }
    console.log(`  Local OCR matched PPV artwork text: "${match.text}".`);
    return {
      visible: true,
      xPercent: match.xPercent,
      yPercent: match.yPercent,
      // The surface validator uses this evidence for the artwork-only title
      // and date checks. Previously it was discarded even after an OCR match,
      // making those checks deterministically report "Not found".
      ocrTexts: railObservations.map(observation => observation.text),
      screenshotFingerprint,
    };
  } catch (error: any) {
    console.warn(`  Local OCR PPV lookup failed: ${error.message}`);
    return { visible: false, xPercent: null, yPercent: null };
  } finally {
    if (screenshotPath && fs.existsSync(screenshotPath)) fs.unlinkSync(screenshotPath);
  }
}
