import * as fs   from 'fs';
import * as path from 'path';
import { Page }  from '@playwright/test';

const COOKIE_STATE_FILE = 'auth/dazn-storage-state.json';

// WeakMap to track checked origins per BrowserContext (session)
const contextCheckedOrigins = new WeakMap<any, Set<string>>();
// WeakMap to track accepted origins per BrowserContext (session)
const contextAcceptedOrigins = new WeakMap<any, Set<string>>();

// ─────────────────────────────────────────────────────────────────
// SLEEP
// ─────────────────────────────────────────────────────────────────
export const sleep = (ms: number): Promise<void> =>
  new Promise(r => setTimeout(r, ms));

// ─────────────────────────────────────────────────────────────────
// COOKIE STATE
// ─────────────────────────────────────────────────────────────────
export async function saveCookieState(page: Page): Promise<void> {
  try {
    const state = await page.context().storageState();
    const dir   = path.dirname(COOKIE_STATE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(COOKIE_STATE_FILE, JSON.stringify(state, null, 2));
    console.log('💾 Cookie state saved');
  } catch (e) {
    console.log('⚠️  Could not save cookie state:', e);
  }
}

export function loadCookieState(): any {
  try {
    if (fs.existsSync(COOKIE_STATE_FILE)) {
      console.log('📂 Cookie state loaded');
      return JSON.parse(fs.readFileSync(COOKIE_STATE_FILE, 'utf8'));
    }
  } catch (e) {
    console.log('⚠️  Could not load cookie state:', e);
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────
// HANDLE COOKIES
// ── Wait for banner, accept it, move on. Same for all flows/regions
// ─────────────────────────────────────────────────────────────────
export async function handleCookies(page: Page, timeout: number = 15000): Promise<void> {
  if (page.isClosed()) return;
  const context = page.context();

  let checkedSet = contextCheckedOrigins.get(context);
  if (!checkedSet) {
    checkedSet = new Set<string>();
    contextCheckedOrigins.set(context, checkedSet);
  }

  let acceptedSet = contextAcceptedOrigins.get(context);
  if (!acceptedSet) {
    acceptedSet = new Set<string>();
    contextAcceptedOrigins.set(context, acceptedSet);
  }

  let origin = '';
  try {
    origin = new URL(page.url()).origin;
  } catch (e) {
    origin = page.url();
  }

  const getBaseDomain = (urlStr: string) => {
    try {
      const hostname = new URL(urlStr).hostname;
      const parts = hostname.split('.');
      return parts.length >= 2 ? parts.slice(-2).join('.') : hostname;
    } catch {
      return urlStr;
    }
  };

  const originBase = getBaseDomain(origin);
  const alreadyAccepted = Array.from(acceptedSet).some(o => getBaseDomain(o) === originBase);

  // Determine the timeout to use
  let actualTimeout = timeout;
  if (acceptedSet.has(origin) || alreadyAccepted) {
    // Already accepted on this origin/domain or its base domain. Use a safe 1000ms check.
    actualTimeout = Math.min(timeout, 1000);
  } else if (checkedSet.has(origin)) {
    // Checked before but not accepted. Use a fast check (1500ms max)
    actualTimeout = Math.min(timeout, 1500);
  } else {
    // First time on this domain/origin. Wait up to 5000ms for the banner container itself to become visible
    console.log(`🍪 Initial page load on ${origin} — waiting up to 5000ms for cookie banner container...`);
    await page.waitForSelector(
      '#onetrust-banner-sdk, ' +
      '#onetrust-consent-sdk, ' +
      '.onetrust-pc-dark-filter, ' +
      '[class*="cookie-banner" i], ' +
      '[class*="consent-banner" i]',
      { state: 'visible', timeout: 5000 }
    ).catch(() => {});
    actualTimeout = timeout;
  }

  try {
    const btn = page.locator(
      '#onetrust-accept-btn-handler, '  +
      'button:has-text("Accept All"), ' +
      'button:has-text("Accept"), '     +
      'button:has-text("Agree"), '      +
      'button:has-text("Allow all"), '  +
      'button:has-text("Essential Only")'
    ).first();

    let isBtnVisible = await btn.isVisible().catch(() => false);

    if (!isBtnVisible && actualTimeout > 0) {
      await btn.waitFor({ state: 'visible', timeout: actualTimeout }).catch(() => {});
      isBtnVisible = await btn.isVisible().catch(() => false);
    }

    if (isBtnVisible) {
      console.log(`🍪 Cookie banner visible on ${origin} — dismissing...`);
      await btn.click({ force: true });
      await btn.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
      console.log(`🍪 Cookies accepted for ${origin}`);
      acceptedSet.add(origin);

      // Persist OneTrust consent cookies in the browser context so the banner
      // does not reappear on subsequent navigations within the same session.
      try {
        const hostname = new URL(origin).hostname;
        const hostParts = hostname.split('.');
        const baseDomain = hostParts.length >= 2 ? '.' + hostParts.slice(-2).join('.') : hostname;
        const expiry = Math.floor(Date.now() / 1000) + 365 * 24 * 3600;

        // Inject for both the specific domain and the base/root domain to cover all subdomains
        const domainsToSet = new Set([hostname, baseDomain]);
        for (const dom of domainsToSet) {
          await context.addCookies([
            { name: 'OptanonAlertBoxClosed', value: new Date().toISOString(), domain: dom, path: '/', expires: expiry },
            { name: 'OptanonConsent',        value: 'isGpcEnabled=0&datestamp=' + encodeURIComponent(new Date().toISOString()) + '&version=202409.1.0&isIABGlobal=false&hosts=&consentId=test&interactionCount=1&landingPath=NotLandingPage&groups=C0001%3A1%2CC0002%3A1%2CC0003%3A1%2CC0004%3A1&geolocation=GB%3BEN', domain: dom, path: '/', expires: expiry },
          ]);
          console.log(`🍪 OneTrust cookies injected for ${dom}`);
        }
      } catch (cookieErr: any) {
        console.log(`⚠️ Could not inject OneTrust cookies: ${cookieErr.message}`);
      }
    } else {
      if (actualTimeout > 0) {
        console.log(`ℹ️  No cookie banner found on ${origin} (timeout: ${actualTimeout}ms)`);
      }
    }

    // Mark that we checked this origin
    checkedSet.add(origin);
  } catch (err: any) {
    console.log(`⚠️ Error in handleCookies: ${err.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────
// STABILISE PAGE
// ─────────────────────────────────────────────────────────────────
export async function stabilisePage(page: Page): Promise<void> {
  if (page.isClosed()) return;
  await page.evaluate(() => {
    if (window.location.href.includes('/myaccount')) return;
    [
      '#onetrust-banner-sdk',
      '#onetrust-consent-sdk',
      '#onetrust-pc-sdk',
      '.onetrust-pc-dark-filter',
      '[class*="cookie-banner" i]',
      '[class*="consent-banner" i]',
    ].forEach(sel =>
      document.querySelectorAll<HTMLElement>(sel)
        .forEach(el => el.remove())
    );
    window.scrollTo(0, 0);
  }).catch(() => {});
}

// ─────────────────────────────────────────────────────────────────
// WAIT FOR SPA READY
// ─────────────────────────────────────────────────────────────────
export async function waitForSPAReady(page: Page): Promise<void> {
  if (page.isClosed()) return;
  await page.waitForLoadState('domcontentloaded').catch(() => {});
}

// ─────────────────────────────────────────────────────────────────
// TRIGGER LAZY LOAD — only called explicitly after selectSport()
// ─────────────────────────────────────────────────────────────────
export async function triggerLazyLoad(page: Page): Promise<void> {
  if (page.isClosed()) return;
  const url = page.url();
  if (!url.includes('/schedule')) return;
  await page.evaluate(() => {
    const target = Math.min(
      document.body.scrollHeight,
      window.innerHeight * 3
    );
    window.scrollTo(0, target);
  }).catch(() => {});
  await sleep(150);
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
}

// ─────────────────────────────────────────────────────────────────
// SETUP PAGE — single call after every navigation
// ─────────────────────────────────────────────────────────────────
export async function setupPage(page: Page, cookieTimeout: number = 8000): Promise<void> {
  if (page.isClosed()) return;
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await handleCookies(page, cookieTimeout);
  await stabilisePage(page);
}

// ─────────────────────────────────────────────────────────────────
// SCROLL TO CENTER
// ─────────────────────────────────────────────────────────────────
export async function scrollToCenter(
  page:     Page,
  selector: string
): Promise<void> {
  if (page.isClosed()) return;
  await page.evaluate(sel => {
    const el = document.querySelector(sel);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, selector).catch(() => {});
}

// ─────────────────────────────────────────────────────────────────
// DOM NODE INTERFACE
// ─────────────────────────────────────────────────────────────────
export interface DOMNode {
  tag:        string;
  text:       string;
  classes:    string;
  childCount: number;
  isInModal:  boolean;
  isStrike?:  boolean;
}

// ─────────────────────────────────────────────────────────────────
// GET PAGE SNAPSHOT — bulk DOM read in one JS call
// ─────────────────────────────────────────────────────────────────
export async function getPageSnapshot(page: Page): Promise<DOMNode[]> {
  if (page.isClosed()) return [];
  try {
    return await page.evaluate((): any[] => {
      const clean = (s: string) =>
        s.replace(/\u200B/g, '').replace(/\s+/g, ' ').trim();

      const modalSelectors = [
        '[role="dialog" i]',
        '[aria-modal="true"]',
        '[class*="modal" i]',
        '[class*="overlay" i]',
        '[class*="popup" i]',
      ];

      const isInModal = (el: Element): boolean =>
        modalSelectors.some(sel => {
          const closest = el.closest(sel);
          return closest !== null && closest.tagName !== 'BODY' && closest.tagName !== 'HTML';
        });

      // OPTIMIZED: avoid getComputedStyle — use offsetWidth/Height + inline style checks
      // getComputedStyle forces a full style recalculation per element and blocks the thread
      const isRendered = (el: HTMLElement): boolean => {
        if (el.offsetWidth === 0 && el.offsetHeight === 0) return false;
        const style = el.style;
        if (style.display === 'none') return false;
        if (style.visibility === 'hidden') return false;
        if (style.opacity === '0') return false;
        // Check for hidden attribute
        if (el.hidden) return false;
        return true;
      };

      // OPTIMIZED: avoid getComputedStyle — use only DOM-based checks
      const isStrikethrough = (el: HTMLElement): boolean => {
        if (el.closest('del, s') !== null) return true;
        if (el.closest('[style*="line-through"]') !== null) return true;
        return false;
      };

      const getNonStrikeText = (node: Node): string => {
        if (node.nodeType === Node.TEXT_NODE) {
          return node.textContent || '';
        }
        if (node.nodeType === Node.ELEMENT_NODE) {
          const htmlEl = node as HTMLElement;
          if (isStrikethrough(htmlEl)) {
            return '';
          }
          let text = '';
          for (let i = 0; i < htmlEl.childNodes.length; i++) {
            text += getNonStrikeText(htmlEl.childNodes[i]);
          }
          return text;
        }
        return '';
      };

      const tags = [
        'button','a','h1','h2','h3','h4','h5',
        'p','span','li','label',
        'small','time','strong','b','em','div'
      ];

      const results: any[] = [];
      const seen = new Set<string>();
      let totalProcessed = 0;
      const MAX_ELEMENTS = 5000; // Performance budget: stop after processing this many elements

      for (const tag of tags) {
        const els = document.querySelectorAll<HTMLElement>(tag);
        for (const el of els) {
          totalProcessed++;
          if (totalProcessed > MAX_ELEMENTS) break;
          if (!isRendered(el)) continue;
          const text = isStrikethrough(el) ? clean(el.textContent || '') : clean(getNonStrikeText(el));
          const isInteractive = tag === 'button' || tag === 'a';
          if (!isInteractive && (!text || text.length < 2 || text.length > 500)) continue;
          const key = text ? `${tag}:${text}` : `${tag}:${el.className || ''}:${results.length}`;
          if (seen.has(key)) continue;
          seen.add(key);
          results.push({
            tag,
            text,
            classes:    el.className || '',
            childCount: el.children.length,
            isInModal:  isInModal(el),
            isStrike:   isStrikethrough(el),
          });
          if (results.length >= 2000) break;
        }
        if (results.length >= 2000 || totalProcessed > MAX_ELEMENTS) break;
      }
      return results;
    });
  } catch {
    return [];
  }
}
