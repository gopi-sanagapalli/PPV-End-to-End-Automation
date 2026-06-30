import { Page, BrowserContext, Locator } from '@playwright/test';


// ─────────────────────────────────────────────────────────────────
// SLEEP
// ─────────────────────────────────────────────────────────────────
export const sleep = (ms: number): Promise<void> =>
  new Promise(r => setTimeout(r, ms));


// ─────────────────────────────────────────────────────────────────
// HANDLE COOKIES — dismiss cookie banner via UI click
// ── Called after every navigation. Dismisses cookie consent banner
//    by clicking the Accept button. Only runs once per BrowserContext.
// ─────────────────────────────────────────────────────────────────

const _dismissedContexts = new WeakSet<BrowserContext>();

export async function handleCookies(page: Page, timeout: number = 8000): Promise<void> {
  if (page.isClosed()) return;

  const context = page.context();

  // If already dismissed in this context, do a fast visible check first
  // and only proceed if the banner reappeared (e.g. on a new page/redirect)
  if (_dismissedContexts.has(context)) {
    const isVisibleNow = await page.locator('#onetrust-accept-btn-handler')
      .isVisible()
      .catch(() => false);
    if (!isVisibleNow) return;
    console.log('🍪 Cookie banner reappeared after initial dismissal — dismissing again...');
  }

  // ── DAZN pattern: wait the full timeout for the Accept button ─────
  // Always use the caller-provided timeout so late-loading banners
  // (e.g. on signin page) are caught reliably.
  const cookieAcceptBtn = page.locator('#onetrust-accept-btn-handler');
  const isVisible = await cookieAcceptBtn
    .waitFor({ state: 'visible', timeout })
    .then(() => true)
    .catch(() => false);

  if (isVisible) {
    try {
      await cookieAcceptBtn.click({ timeout: 3000 });
      console.log('🍪 Accepted cookies via #onetrust-accept-btn-handler');
      _dismissedContexts.add(context);
      // Wait for banner to disappear after clicking
      await page.locator('#onetrust-banner-sdk')
        .waitFor({ state: 'hidden', timeout: 5000 })
        .catch(() => { });
      await stabilisePage(page);
      return;
    } catch {
      // Force click fallback
      try {
        await cookieAcceptBtn.click({ force: true, timeout: 3000 });
        console.log('🍪 Accepted cookies via forced click');
        _dismissedContexts.add(context);
        await stabilisePage(page);
        return;
      } catch {
        // JS click as last resort
        const handle = await cookieAcceptBtn.elementHandle().catch(() => null);
        if (handle) {
          await page.evaluate((el: any) => el.click(), handle).catch(() => { });
          console.log('🍪 Accepted cookies via JS click');
          _dismissedContexts.add(context);
          await stabilisePage(page);
          return;
        }
      }
    }
  }

  // ── Fallback: try other common cookie accept selectors ───────
  const fallbackSelectors = [
    '[data-test-id="COOKIE_BUTTON"]',
    'button:has-text("Accept All")',
    'button:has-text("Accept")',
    'button:has-text("Agree")',
    'button:has-text("Allow all")',
  ];

  for (const selector of fallbackSelectors) {
    const btn = page.locator(selector).first();
    const btnVisible = await btn.isVisible().catch(() => false);
    if (btnVisible) {
      try {
        await btn.click({ timeout: 3000 });
        console.log(`🍪 Accepted cookies via fallback: ${selector}`);
        _dismissedContexts.add(context);
        await stabilisePage(page);
        return;
      } catch {
        // continue to next selector
      }
    }
  }

  // Cookie banner not displayed
  console.log('🍪 Cookie banner not displayed — skipping');
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
  }).catch(() => { });
}

// ─────────────────────────────────────────────────────────────────
// DISMISS MARKETING POPUP ("Unlock exclusive content")
// ─────────────────────────────────────────────────────────────────
export async function dismissMarketingPopup(page: Page, timeout: number = 0): Promise<void> {
  if (page.isClosed()) return;
  try {
    const dismissSelectors = [
      'button:has-text("Keep me updated")',
      'button:has-text("Keep Me Updated")',
      'button:has-text("Maybe later")',
      'button:has-text("Maybe Later")',
      'button:has-text("No thanks")',
      'button:has-text("No Thanks")',
      'button:has-text("Not now")',
      'button:has-text("Not Now")',
      'button:has-text("Close")',
      'button:has-text("Dismiss")',
      '[aria-label="Close"]',
      '[aria-label="close"]',
      '[aria-label*="close" i]',
      '[data-testid*="close" i]',
    ].join(', ');

    const popup = page.locator(dismissSelectors).first();

    let isVisible = false;
    if (timeout > 0) {
      isVisible = await popup.waitFor({ state: 'visible', timeout })
        .then(() => true)
        .catch(() => false);
    } else {
      isVisible = await popup.isVisible().catch(() => false);
    }

    if (isVisible) {
      const btnText = await popup.textContent().catch(() => '');
      console.log(`🔔 Marketing popup detected ("${btnText?.trim()}"). Dismissing...`);
      await popup.click({ force: true }).catch(() => { });
      console.log('✅ Dismissed marketing popup');
    }
  } catch (e) {
    console.warn('⚠️ Error in dismissMarketingPopup:', e);
  }
}

// ─────────────────────────────────────────────────────────────────
// WAIT FOR SPA READY / PAGE READY — generic stabilization helper
// ─────────────────────────────────────────────────────────────────
export interface PageReadyOptions {
  timeout?: number;
  waitForNetwork?: boolean;
  waitForImages?: boolean;
  waitForLazyContent?: boolean;
}

export async function waitForPageReady(
  page: Page,
  options: PageReadyOptions = {}
): Promise<void> {
  if (page.isClosed()) return;

  const timeout = options.timeout ?? 10000;
  const start = Date.now();

  // Check if a modal/popup/dialog/paywall is open — skip generic wait if so
  const isModalOpen = await page.locator([
    '[role="dialog"]',
    '[aria-modal="true"]',
    '[class*="modal" i]',
    '[class*="popup" i]',
    '[class*="dialog" i]',
    '[class*="paywall" i]'
  ].join(', ')).first().isVisible().catch(() => false);

  if (isModalOpen) {
    console.log('[Page Ready] Modal/Paywall is open — skipping page-level stabilization.');
    return;
  }

  // 1. Wait for DomContentLoaded
  await page.waitForLoadState('domcontentloaded', { timeout: Math.min(5000, timeout) }).catch(() => { });

  // 2. Wait for initial content to attach (prevents premature returns on blank pages)
  await page.locator([
    'article',
    '[class*="rail" i]',
    '.swiper-slide',
    '[class*="tile" i]',
    '[class*="skeleton" i]',
    '[class*="loading" i]',
    '[class*="spinner" i]',
    'h1, h2, h3, h4',
    'input',
    'button'
  ].join(', ')).first().waitFor({
    state: 'attached',
    timeout: Math.min(3000, Math.max(0, timeout - (Date.now() - start)))
  }).catch(() => { });

  // 3. Network idle — only when explicitly requested (opt-in)
  if (options.waitForNetwork === true) {
    await page.waitForLoadState('networkidle', {
      timeout: Math.min(10000, Math.max(0, timeout - (Date.now() - start)))
    }).catch(() => { });
  }

  // 4. Wait for visible spinner/skeleton to disappear (if present)
  const spinnerSelector = [
    '[class*="spinner" i]',
    '[class*="loading-indicator" i]',
    '[class*="skeleton" i]',
  ].join(', ');
  const spinner = page.locator(spinnerSelector).first();
  if (await spinner.isVisible().catch(() => false)) {
    await spinner.waitFor({
      state: 'hidden',
      timeout: Math.min(5000, Math.max(0, timeout - (Date.now() - start)))
    }).catch(() => { });
  }

  const elapsed = Date.now() - start;
  const pageName = page.url().split('/').pop()?.split('?')[0] || 'unknown';
  console.log(`[Page Ready] Page: ${pageName}  Strategy: generic  Elapsed: ${elapsed}ms`);
}

export async function waitForSPAReady(page: Page): Promise<void> {
  await waitForPageReady(page);
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
  }).catch(() => { });
  await sleep(150);
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => { });
}

// ─────────────────────────────────────────────────────────────────
// SETUP PAGE — single call after navigation (safety net only)
// ─────────────────────────────────────────────────────────────────
export async function setupPage(page: Page, _cookieTimeout: number = 500): Promise<void> {
  if (page.isClosed()) return;
  await handleCookies(page, _cookieTimeout);
}

// ─────────────────────────────────────────────────────────────────
// SCROLL TO CENTER
// ─────────────────────────────────────────────────────────────────
export async function scrollToCenter(
  page: Page,
  selector: string
): Promise<void> {
  if (page.isClosed()) return;
  await page.evaluate(sel => {
    const el = document.querySelector(sel);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, selector).catch(() => { });
}

// ─────────────────────────────────────────────────────────────────
// DOM NODE INTERFACE
// ─────────────────────────────────────────────────────────────────
export interface DOMNode {
  tag: string;
  text: string;
  classes: string;
  childCount: number;
  isInModal: boolean;
  isStrike?: boolean;
  isChecked?: boolean;
  type?: string;
  src?: string;
  href?: string;
  ariaPressed?: string;
  ariaChecked?: string;
  id?: string;
  hasCheckedSvg?: boolean;
  ariaLabel?: string;
  dataTestId?: string;
  hasCrossSvg?: boolean;
}

// ─────────────────────────────────────────────────────────────────
// GET PAGE SNAPSHOT — bulk DOM read in one JS call
// ─────────────────────────────────────────────────────────────────
export async function getPageSnapshot(pageOrLocator: Page | Locator): Promise<DOMNode[]> {
  const isLocator = 'evaluate' in pageOrLocator && !('goto' in pageOrLocator);
  const contextPage = isLocator ? (pageOrLocator as any).page() : (pageOrLocator as any);
  if (contextPage.isClosed()) return [];
  try {
    const evaluateFn = (rootEl?: any): any[] => {
      const clean = (s: string) =>
        s.replace(/\u200B/g, '').replace(/\s+/g, ' ').trim();


      const getElementClasses = (el: Element): string =>
        (el.getAttribute('class') || '')
          .trim()
          .replace(/\s+/g, ' ');


      const modalSelectors = [
        '[role="dialog" i]',
        '[aria-modal="true"]',
        '[class*="modal" i]',
        '[class*="overlay" i]',
        '[class*="popup" i]',
        '[class*="dialog" i]',
        '.Modal',
      ];

      const isInModal = (el: Element): boolean => {
        if (rootEl) {
          const isRootModal = modalSelectors.some(sel => {
            try {
              return (typeof rootEl.matches === 'function' && rootEl.matches(sel)) ||
                (typeof rootEl.closest === 'function' && rootEl.closest(sel) !== null);
            } catch (e) {
              return false;
            }
          });
          if (isRootModal) return true;
        }
        return modalSelectors.some(sel => {
          const closest = el.closest(sel);
          return closest !== null && closest.tagName !== 'BODY' && closest.tagName !== 'HTML';
        });
      };

      const isInInactiveSlide = (el: any): boolean => {
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
      const isRendered = (el: HTMLElement): boolean => {
        const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
        if (!isMobile && el.offsetWidth === 0 && el.offsetHeight === 0) return false;
        const style = el.style;
        if (style.display === 'none') return false;
        if (style.visibility === 'hidden') return false;
        if (style.opacity === '0') return false;
        if (el.hidden) return false;
        if (isInInactiveSlide(el)) return false;
        return true;
      };

      const isStrikethrough = (el: HTMLElement): boolean => {
        if (el.closest('del, s') !== null) return true;
        if (el.closest('[style*="line-through"]') !== null) return true;
        if (el.closest('[class*="strike" i], [class*="line-through" i], [class*="crossed" i], [class*="original" i]') !== null) return true;

        const txt = el.textContent || '';
        if (txt.includes('£') || txt.includes('$') || txt.includes('€') || txt.includes('₹') || /\d/.test(txt)) {
          let current: HTMLElement | null = el;
          for (let depth = 0; depth < 8 && current; depth++) {
            try {
              const style = window.getComputedStyle(current);
              if (style.textDecoration.includes('line-through') || style.textDecorationLine.includes('line-through')) {
                return true;
              }
            } catch (e) { }
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
          const tagName = htmlEl.tagName.toUpperCase();
          if (tagName === 'SCRIPT' || tagName === 'STYLE') {
            return '';
          }
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
        'button', 'a', 'h1', 'h2', 'h3', 'h4', 'h5',
        'p', 'span', 'li', 'label',
        'small', 'time', 'strong', 'b', 'em', 'div',
        'img', 'input'
      ];

      const results: any[] = [];
      const seen = new Set<string>();
      let totalProcessed = 0;
      const MAX_ELEMENTS = 5000;

      const root = (rootEl || document) as Document | HTMLElement;

      for (const tag of tags) {
        const els = Array.from(root.querySelectorAll<HTMLElement>(tag));
        if (rootEl && typeof rootEl.matches === 'function' && rootEl.matches(tag)) {
          els.unshift(rootEl);
        }

        for (const el of els) {
          totalProcessed++;
          if (totalProcessed > MAX_ELEMENTS) break;
          if (!isRendered(el)) continue;
          const text = isStrikethrough(el) ? clean(el.textContent || '') : clean(getNonStrikeText(el));
          let isInteractive = ['button', 'a', 'img', 'input'].includes(tag);
          if (!isInteractive) {
            const role = el.getAttribute('role');
            const ariaLabel = el.getAttribute('aria-label') || '';
            const dataTestId = el.getAttribute('data-testid') || el.getAttribute('data-test-id') || '';
            const classes = typeof (el as any).className === 'string' ? (el as any).className : ((el as any).className && typeof (el as any).className.baseVal === 'string' ? (el as any).className.baseVal : '');
            const id = el.id || '';
            
            const isCloseIndicator = 
              role === 'button' ||
              ariaLabel.toLowerCase().includes('close') ||
              dataTestId.toLowerCase().includes('close') ||
              dataTestId.toLowerCase().includes('cross') ||
              classes.toLowerCase().includes('close') ||
              id.toLowerCase().includes('close') ||
              el.querySelector('svg[data-test-id*="cross" i], svg[data-testid*="cross" i], svg[class*="cross" i], [class*="cross" i]') !== null;
              
            if (isCloseIndicator) {
              isInteractive = true;
            }
          }
          if (!isInteractive && (!text || text.length < 2 || text.length > 500)) continue;
          const classStr = (typeof (el as any).className === 'string' ? (el as any).className : ((el as any).className && typeof (el as any).className.baseVal === 'string' ? (el as any).className.baseVal : '')) || '';
          const key = text ? `${tag}:${text}` : `${tag}:${classStr}:${results.length}`;
          if (seen.has(key)) continue;
          seen.add(key);
          results.push({
            tag,
            text,
            classes: classStr,
            childCount: el.children.length,
            isInModal: isInModal(el),
            isStrike: isStrikethrough(el),
            isChecked: (el as HTMLInputElement).checked || el.getAttribute('aria-checked') === 'true' || el.getAttribute('aria-pressed') === 'true',
            type: el.getAttribute('type') || undefined,
            src: (el as HTMLImageElement).src || el.getAttribute('src') || undefined,
            href: (el as HTMLAnchorElement).href || el.getAttribute('href') || undefined,
            ariaPressed: el.getAttribute('aria-pressed') || undefined,
            ariaChecked: el.getAttribute('aria-checked') || undefined,
            id: el.id || undefined,
            hasCheckedSvg: el.querySelector('svg[class*="checked" i], [class*="checkmark" i]') !== null,
            ariaLabel: el.getAttribute('aria-label') || undefined,
            dataTestId: el.getAttribute('data-testid') || undefined,
            hasCrossSvg: el.querySelector('svg[data-test-id*="cross" i], svg[data-testid*="cross" i], svg[class*="cross" i], [class*="cross" i]') !== null,
          });
          if (results.length >= 2000) break;
        }
        if (results.length >= 2000 || totalProcessed > MAX_ELEMENTS) break;
      }
      return results;
    };

    if (isLocator) {
      return await (pageOrLocator as Locator).evaluate(evaluateFn);
    } else {
      return await (pageOrLocator as Page).evaluate(evaluateFn);
    }
  } catch {
    return [];
  }
}
