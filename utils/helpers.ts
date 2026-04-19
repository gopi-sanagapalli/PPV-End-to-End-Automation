import * as fs   from 'fs';
import * as path from 'path';
import { Page }  from '@playwright/test';

const COOKIE_STATE_FILE = 'auth/dazn-storage-state.json';

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
// ─────────────────────────────────────────────────────────────────
export async function handleCookies(page: Page): Promise<void> {
  if (page.isClosed()) return;
  try {
    const btn = page.locator(
      '#onetrust-accept-btn-handler, '  +
      'button:has-text("Accept All"), ' +
      'button:has-text("Accept"), '     +
      'button:has-text("Agree"), '      +
      'button:has-text("Allow all")'
    ).first();
    if (await btn.isVisible({ timeout: 1500 })) {
      await btn.click({ force: true });
      await btn.waitFor({ state: 'hidden', timeout: 1500 }).catch(() => {});
      console.log('🍪 Cookies accepted');
    }
  } catch {}
}

// ─────────────────────────────────────────────────────────────────
// STABILISE PAGE
// ─────────────────────────────────────────────────────────────────
export async function stabilisePage(page: Page): Promise<void> {
  if (page.isClosed()) return;
  await page.evaluate(() => {
    // ✅ Remove OneTrust completely from DOM
    [
      '#onetrust-banner-sdk',
      '#onetrust-consent-sdk',
      '#onetrust-pc-sdk',
      '.onetrust-pc-dark-filter',
      '[class*="cookie-banner" i]',
      '[class*="consent-banner" i]',
    ].forEach(sel =>
      document.querySelectorAll<HTMLElement>(sel)
        .forEach(el => el.remove())  // ✅ remove() not display:none
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
// TRIGGER LAZY LOAD — single scroll, no sleep
// ─────────────────────────────────────────────────────────────────
export async function triggerLazyLoad(page: Page): Promise<void> {
  if (page.isClosed()) return;

  const url = page.url();

  // ✅ Only run on schedule page
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
export async function setupPage(page: Page): Promise<void> {
  if (page.isClosed()) return;
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await handleCookies(page);
  await stabilisePage(page);
  await triggerLazyLoad(page);
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
}

// ─────────────────────────────────────────────────────────────────
// GET PAGE SNAPSHOT — bulk DOM read in one JS call
// ✅ Saves and restores scroll position to prevent page jumping
// ─────────────────────────────────────────────────────────────────
export async function getPageSnapshot(page: Page): Promise<DOMNode[]> {
  if (page.isClosed()) return [];

  try {
    return await page.evaluate((): any[] => {
      const clean = (s: string) =>
        s.replace(/\u200B/g, '').replace(/\s+/g, ' ').trim();

      const modalSelectors = [
        '[role="dialog"]',
        '[aria-modal="true"]',
        '[class*="modal"]',
        '[class*="overlay"]',
        '[class*="popup"]',
      ];

      const isInModal = (el: Element): boolean =>
        modalSelectors.some(sel => el.closest(sel) !== null);

      const isRendered = (el: HTMLElement): boolean => {
        const style = window.getComputedStyle(el);
        return (
          style.display    !== 'none'   &&
          style.visibility !== 'hidden' &&
          style.opacity    !== '0'
        );
      };

      const tags = [
        'h1','h2','h3','h4','h5',
        'p','span','li','div','label',
        'small','time','button','a','strong','b','em'
      ];

      const results: any[] = [];
      const seen = new Set<string>();

      for (const tag of tags) {
        const els = document.querySelectorAll<HTMLElement>(tag);
        for (const el of els) {
          if (!isRendered(el)) continue;

          // ✅ textContent instead of innerText
          // innerText forces layout recalculation → triggers scroll
          // textContent reads raw DOM text → no layout → no scroll
          const text = clean(el.textContent || '');
          if (!text || text.length < 2 || text.length > 500) continue;

          const key = `${tag}:${text}`;
          if (seen.has(key)) continue;
          seen.add(key);

          results.push({
            tag,
            text,
            classes:    el.className || '',
            childCount: el.children.length,
            isInModal:  isInModal(el),
          });

          if (results.length >= 1000) break;
        }
        if (results.length >= 1000) break;
      }

      return results;
    });
  } catch {
    return [];
  }
}