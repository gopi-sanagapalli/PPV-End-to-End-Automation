import {
  IOSFlowHooks,
  WdBrowser,
} from './IOSBasePage';
import { IOSLandingPage } from './IOSLandingPage';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

interface IOSVisualTileMatch {
  visible: boolean;
  xPercent: number | null;
  yPercent: number | null;
  ocrTexts?: string[];
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

    return this.openBannerPaywall({
      label: 'Home Page',
      pageName: 'Home page',
      missingScreenshot: './test-results/ios_home_ppv_banner_not_found.png',
      foundScreenshot: './test-results/ios_home_ppv_banner_found.png',
      buyMissingScreenshot: './test-results/ios_home_buy_cta_not_found.png',
      validateSurface: 'PPV Banner',
      immediatePaywall: options.immediatePaywall ?? true,
      recordPage: 'Home Page',
    }, hooks);
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
    await this.driver.pause(2000);
    delete process.env.IOS_DONT_MISS_PPV_TILE_FOUND;
    delete process.env.IOS_DONT_MISS_OCR_TEXTS;

    // iOS accessibility labels vary between the straight and typographic
    // apostrophe, depending on the feed payload and OS text rendering.
    const railLabels = ["Don't Miss", 'Don’t Miss', 'Dont Miss'];
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
            if (await candidate.isDisplayed().catch(() => false)) return candidate;
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
    // Home can report its tab as visible before the content rails have
    // rendered. Give the feed a short, non-scrolling settle window first.
    for (let attempt = 0; attempt < 5 && !railFound; attempt++) {
      const rail = await findVisibleDontMissRail();
      if (rail) {
        railY = (await rail.getLocation()).y;
        railFound = true;
        console.log(`  Found visible Don't Miss rail at y=${railY}; stopping vertical scroll.`);
      } else if (await findRailByRenderedHeading()) {
        railFound = true;
      } else {
        await this.driver.pause(1000);
      }
    }
    for (let attempt = 0; attempt < 12 && !railFound; attempt++) {
      const rail = await findVisibleDontMissRail();
      if (rail) {
        const location = await rail.getLocation();
        railY = location.y;
        railFound = true;
        console.log(`  Found visible Don't Miss rail at y=${railY}; stopping vertical scroll.`);
      } else if (await findRailByRenderedHeading()) {
        railFound = true;
      }
      if (!railFound) {
        await this.scrollDown();
        await this.driver.pause(800);
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
    // The native tile artwork does not consistently expose the complete event
    // name to XCTest.  Match the full name first, then the fighter names, and
    // keep the actual matching element so it can be tapped immediately.
    const ppvTerms = Array.from(new Set([
      this.ppvName,
      this.ppvName.replace(/[^a-z0-9 ]/gi, ' ').replace(/\s+/g, ' ').trim(),
      ...this.ppvName.split(/\s+vs\.?\s+/i).map(name => name.trim()),
    ].filter(term => term.length >= 3)));
    const railBottom = railY + Math.round(height * 0.45);
    const findVisiblePpvTile = async (): Promise<any | undefined> => {
      for (const term of ppvTerms) {
        const escapedTerm = term.replace(/"/g, '\\"');
        const candidates = await this.driver.$$(`-ios predicate string:name CONTAINS[c] "${escapedTerm}" OR label CONTAINS[c] "${escapedTerm}"`);
        for (const candidate of candidates) {
          if (!(await candidate.isDisplayed().catch(() => false))) continue;
          const location = await candidate.getLocation().catch(() => undefined);
          if (!location || location.y < railY - 40 || location.y > railBottom) continue;
          console.log(`  Found PPV tile using "${term}" at y=${location.y}; stopping horizontal search.`);
          return candidate;
        }
      }
      return undefined;
    };

    // Don't Miss cards are artwork-only on iOS: XCTest exposes the rail title
    // but not necessarily the PPV title inside the image. OCR the current
    // screenshot locally without changing the scroll or rail-location logic.
    const findPpvTileByImage = async (): Promise<{ x: number; y: number } | undefined> => {
      const visualMatch = await locateIOSPpvTileByImage(this.driver, this.ppvName);
      if (!visualMatch.visible || visualMatch.xPercent === null || visualMatch.yPercent === null) return undefined;

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
    let visualTile = ppvTile ? undefined : await findPpvTileByImage();
    for (let attempt = 0; attempt < 10 && !ppvTile && !visualTile; attempt++) {
      await this.driver.performActions([{
        type: 'pointer', id: 'dont-miss-rail', parameters: { pointerType: 'touch' },
        actions: [
          { type: 'pointerMove', duration: 0, x: Math.round(width * 0.80), y: swipeY },
          { type: 'pointerDown', button: 0 },
          { type: 'pause', duration: 80 },
          { type: 'pointerMove', duration: 300, x: Math.round(width * 0.20), y: swipeY },
          { type: 'pointerUp', button: 0 },
        ],
      }]);
      await this.driver.releaseActions();
      await this.driver.pause(800);
      ppvTile = await findVisiblePpvTile();
      visualTile = ppvTile ? undefined : await findPpvTileByImage();
    }

    if (!ppvTile && !visualTile) {
      const shot = hooks.saveScreenshot
        ? await hooks.saveScreenshot('./test-results/ios_dont_miss_ppv_not_found.png')
        : undefined;
      hooks.recordAvailability?.(false, shot, recordPage);
      await hooks.generateAvailabilityFailureReport?.(`PPV "${this.ppvName}" not found in Don't Miss rail`);
      throw new Error(`PPV "${this.ppvName}" not found in Don't Miss rail. See test-results/ios_dont_miss_ppv_not_found.png`);
    }

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
    if (isUltimateUser && isLoginFirst) return true;

    console.log('Validating native Don\'t Miss paywall before external handoff...');
    await this.driver.saveScreenshot('./test-results/ios_dont_miss_native_paywall.png');
    await this.runPaywallValidation(hooks);

    return this.tapBuyCtaWithFallback(['Buy now', 'Buy Now', 'Buy', 'Get PPV', 'Purchase']);
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
    const heading = observations.find(observation => /don.?t miss/i.test(observation.text));
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

async function locateIOSPpvTileByImage(driver: WdBrowser, ppvName: string): Promise<IOSVisualTileMatch> {
  let screenshotPath = '';
  try {
    screenshotPath = path.join(os.tmpdir(), `dazn-ppv-ocr-${process.pid}-${Date.now()}.png`);
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
    const terms = ppvName.toLowerCase()
      .split(/\s+vs\.?\s+|[^a-z0-9]+/)
      .map(term => term.trim())
      .filter(term => term.length >= 3);
    const match = observations.find(observation => {
      const text = observation.text.toLowerCase();
      return terms.some(term => text.includes(term));
    });
    if (!match) {
      return { visible: false, xPercent: null, yPercent: null };
    }
    console.log(`  Local OCR matched PPV artwork text: "${match.text}".`);
    return { visible: true, xPercent: match.xPercent, yPercent: match.yPercent };
  } catch (error: any) {
    console.warn(`  Local OCR PPV lookup failed: ${error.message}`);
    return { visible: false, xPercent: null, yPercent: null };
  } finally {
    if (screenshotPath && fs.existsSync(screenshotPath)) fs.unlinkSync(screenshotPath);
  }
}
