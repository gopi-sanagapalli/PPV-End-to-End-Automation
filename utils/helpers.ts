import { Page, BrowserContext } from '@playwright/test';

// ─────────────────────────────────────────────────────────────────
// SLEEP
// ─────────────────────────────────────────────────────────────────
export const sleep = (ms: number): Promise<void> =>
  new Promise(r => setTimeout(r, ms));

// ─────────────────────────────────────────────────────────────────
// PRE-INJECT CONSENT COOKIES
// ── Call ONCE per BrowserContext, BEFORE the first navigation.
//    This sets OneTrust cookies so the banner never appears.
// ─────────────────────────────────────────────────────────────────
export async function injectConsentCookies(context: BrowserContext): Promise<void> {
  const region = (process.env.DAZN_REGION || 'GB').toUpperCase();
  const env = (process.env.DAZN_ENV || 'stag').toLowerCase();

  let domain = 'stag.dazn.com';
  if (env === 'beta') domain = 'beta.dazn.com';
  if (env === 'prod') domain = 'www.dazn.com';

  const baseDomain = '.dazn.com';
  const expiry = Math.floor(Date.now() / 1000) + 365 * 24 * 3600;

  const cookiesToSet = [domain, baseDomain].flatMap(dom => [
    {
      name: 'OptanonAlertBoxClosed',
      value: new Date().toISOString(),
      domain: dom,
      path: '/',
      expires: expiry,
    },
    {
      name: 'OptanonConsent',
      value: `isGpcEnabled=0&datestamp=${encodeURIComponent(new Date().toISOString())}&version=202409.1.0&isIABGlobal=false&hosts=&consentId=test-automation&interactionCount=1&landingPath=NotLandingPage&groups=C0001%3A1%2CC0002%3A1%2CC0003%3A1%2CC0004%3A1&geolocation=${region}%3BEN`,
      domain: dom,
      path: '/',
      expires: expiry,
    },
  ]);

  await context.addCookies(cookiesToSet);
  console.log(`🍪 Pre-injected OneTrust consent cookies for ${domain} (region: ${region})`);
}

// ─────────────────────────────────────────────────────────────────
// HANDLE COOKIES — lightweight safety net
// ── Quick check: if banner is somehow visible, dismiss it.
//    With pre-injected cookies this should rarely fire.
// ─────────────────────────────────────────────────────────────────

const _dismissedContexts = new WeakSet<BrowserContext>();

export async function handleCookies(page: Page, _timeout: number = 500): Promise<void> {
  if (page.isClosed()) return;

  const context = page.context();

  // Skip entirely if we already dismissed in this context
  if (_dismissedContexts.has(context)) return;

  const bannerSelector =
    '#onetrust-banner-sdk, ' +
    '#onetrust-consent-sdk, ' +
    '[class*="cookie-banner" i], ' +
    '[class*="consent-banner" i], ' +
    '[data-test-id="COOKIE_CONTAINER"]';

  // Quick visibility check — 500ms max
  const bannerVisible = await page.locator(bannerSelector).first()
    .isVisible()
    .catch(() => false);

  if (!bannerVisible) {
    _dismissedContexts.add(context);
    return;
  }

  console.log(`🍪 Cookie banner unexpectedly visible — dismissing...`);

  const acceptSelectors = [
    '#onetrust-accept-btn-handler',
    '[data-test-id="COOKIE_BUTTON"]',
    'button:has-text("Accept All")',
    'button:has-text("Accept")',
    'button:has-text("Agree")',
    'button:has-text("Allow all")',
  ];

  for (const sel of acceptSelectors) {
    const btn = page.locator(sel).first();
    if (await btn.isVisible().catch(() => false)) {
      try {
        await btn.click({ timeout: 3000 });
      } catch {
        await btn.click({ force: true, timeout: 3000 }).catch(() => {});
      }
      await page.locator(bannerSelector).first()
        .waitFor({ state: 'hidden', timeout: 3000 })
        .catch(() => {});
      console.log(`🍪 Cookie banner dismissed`);
      break;
    }
  }

  // Remove any remaining overlay elements from the DOM
  await stabilisePage(page);
  _dismissedContexts.add(context);
}

// ─────────────────────────────────────────────────────────────────
// STABILISE PAGE — remove cookie overlays from DOM
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
      '[class*="cookie-disclaimer" i]',
      '[data-test-id="COOKIE_CONTAINER"]',
    ].forEach(sel =>
      document.querySelectorAll<HTMLElement>(sel)
        .forEach(el => el.remove())
    );
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
// SETUP PAGE — single call after navigation (safety net only)
// ─────────────────────────────────────────────────────────────────
export async function setupPage(page: Page, _cookieTimeout: number = 500): Promise<void> {
  if (page.isClosed()) return;
  await handleCookies(page);
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

      const isInInactiveSlide = (el: Element): boolean => {
        const slide = el.closest('.swiper-slide, [class*="swiper-slide"]');
        if (!slide) return false;
        const isHero = el.closest([
          'main [class*="banner"]',
          'main [class*="hero"]',
          'main .swiper',
          'section[class*="banner"]',
          '[class*="heroBanner"]',
          '[class*="hero-banner"]',
        ].join(', '));
        if (!isHero) return false;
        return slide.closest('.swiper-slide-active, [class*="swiper-slide-active"]') === null;
      };

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
        if (isInInactiveSlide(el)) return false;
        return true;
      };

      // OPTIMIZED: avoid getComputedStyle — use only DOM-based checks, except for price elements
      const isStrikethrough = (el: HTMLElement): boolean => {
        if (el.closest('del, s') !== null) return true;
        if (el.closest('[style*="line-through"]') !== null) return true;
        if (el.closest('[class*="strike" i], [class*="line-through" i], [class*="crossed" i], [class*="original" i]') !== null) return true;
        
        // Target specifically text elements that look like prices or contain numbers
        const txt = el.textContent || '';
        if (txt.includes('£') || txt.includes('$') || txt.includes('€') || txt.includes('₹') || /\d/.test(txt)) {
          // Walk up parent elements — text-decoration is NOT inherited via CSS,
          // so the line-through may be on a parent element (e.g. parent div with the class)
          let current: HTMLElement | null = el;
          for (let depth = 0; depth < 8 && current; depth++) {
            try {
              const style = window.getComputedStyle(current);
              if (style.textDecoration.includes('line-through') || style.textDecorationLine.includes('line-through')) {
                return true;
              }
            } catch (e) {}
            current = current.parentElement;
          }
        }
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
