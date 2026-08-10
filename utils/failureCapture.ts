import fs from 'fs';
import path from 'path';

// ─────────────────────────────────────────────────────────────────
// FAILURE SCREENSHOT CAPTURE
// For each FAILED field on the currently-displayed page, re-locate the
// element by its rendered text, draw a red box around it, and capture a
// screenshot. The screenshot path is attached to the result object so the
// HTML/PDF report can embed it as evidence.
// Must be called while the page is still on the validated screen
// (i.e. before the flow navigates away).
// ─────────────────────────────────────────────────────────────────

const SHOTS_DIR = path.resolve(process.cwd(), 'test-results', 'failure-shots');
const FAILURE_BANNER_MARKER = 'data-ppv-failure-banner';
const FAILURE_FIELD_MARKER = 'data-ppv-failure-field-target';
const BANNER_ROOT_SELECTORS = [
  'main [class*="hero-banner" i]',
  'main [class*="heroBanner" i]',
  'main [class*="herobanner" i]',
  'main div.heroBannerSlider',
  'main [class*="bannersContainer" i]',
  'main [class*="hero-slider" i]',
  'main [class*="heroSlider" i]',
  'main [class*="hero" i] .swiper',
  'main [class*="banner" i] .swiper',
  'main .swiper-container',
].join(', ');

// Values that are not real on-screen text and so can't be boxed directly
const NON_TEXT = new Set(['n/a', 'na', 'yes', 'no', 'true', 'false', '', '—']);

function matchCandidates(result: any): string[] {
  const out: string[] = [];
  const push = (raw: unknown) => {
    let s = String(raw ?? '').replace(/​/g, '').replace(/\s+/g, ' ').trim();
    if (!s) return;
    // Configs use "a|b" to list acceptable alternatives — take the first
    if (s.includes('|')) s = s.split('|')[0].trim();
    if (NON_TEXT.has(s.toLowerCase())) return;
    if (s.length < 2) return;

    if (!out.includes(s)) out.push(s);

    // If it contains newlines or punctuation, try pushing parts
    const parts = s.split(/[\n\r\-–—:•]+/).map(p => p.trim()).filter(p => p.length >= 4);
    for (const part of parts) {
      if (!out.includes(part)) out.push(part);
    }

    // Try first 4 words for long strings
    const words = s.split(/\s+/).filter(Boolean);
    if (words.length > 4) {
      const shortPhrase = words.slice(0, 4).join(' ');
      if (!out.includes(shortPhrase) && shortPhrase.length >= 4) {
        out.push(shortPhrase);
      }
    }
  };
  // Prefer the ACTUAL rendered value (it is what's on the page), then expected
  push(result.actual);
  push(result.expected);
  return out;
}

function safeName(s: string): string {
  return String(s || '').replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 50);
}

async function findTarget(page: any, candidates: string[]): Promise<any | null> {
  for (const text of candidates) {
    try {
      const locator = page.getByText(text, { exact: false });
      const count = await locator.count().catch(() => 0);
      let best: any = null;
      let bestArea = Infinity;
      for (let i = 0; i < count; i++) {
        const item = locator.nth(i);
        if (!await item.isVisible().catch(() => false)) continue;
        // getByText can match both a small date tag and its whole banner parent.
        // Prefer the smallest visible match so the marker surrounds the field.
        const box = await item.boundingBox().catch(() => null);
        const area = box ? box.width * box.height : Infinity;
        if (area > 0 && area < bestArea) {
          best = item;
          bestArea = area;
        }
      }
      if (best) return best;
    } catch { /* try next candidate */ }
  }
  return null;
}

async function findDontMissLiveTarget(
  page: any,
  source: string,
  field: string,
  candidates: string[],
  context?: Record<string, any>
): Promise<any | null> {
  if (!source.startsWith('landing-page-dont-miss-live')) return null;
  const tileFields = new Set([
    'event name',
    'ppv name',
    'ppv card title',
    'ppv tile present',
    'ppv date',
    'landing page ppv date',
    'ppv image present',
    'ppv image',
    'hero image',
    'buy now cta',
  ]);
  if (!tileFields.has(field.toLowerCase().replace(/\s+/g, ' ').trim())) return null;

  const marked = await page.evaluate(({ marker, field, candidates, context }: {
    marker: string;
    field: string;
    candidates: string[];
    context?: Record<string, any>;
  }) => {
    const clean = (value: string | null | undefined) => String(value || '').replace(/\s+/g, ' ').trim();
    const normalize = (value: string | null | undefined) => clean(value)
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const isVisible = (el: HTMLElement) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' &&
        style.visibility !== 'hidden' && style.opacity !== '0';
    };
    const isConfigId = (value: string) => /(^|[\s_-])ppv[\s_-]/i.test(value) || /[_/\\]/.test(value);
    const distance = (a: string, b: string) => {
      const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
      const current = Array(b.length + 1).fill(0);
      for (let row = 1; row <= a.length; row++) {
        current[0] = row;
        for (let column = 1; column <= b.length; column++) {
          current[column] = Math.min(
            previous[column] + 1,
            current[column - 1] + 1,
            previous[column - 1] + (a[row - 1] === b[column - 1] ? 0 : 1)
          );
        }
        for (let column = 0; column <= b.length; column++) previous[column] = current[column];
      }
      return previous[b.length];
    };
    const titles = [
      context?.PPV_DISPLAY_NAME,
      context?.PPV_CARD_TITLE,
      context?.PPV_FULL_NAME,
      context?.PPV_NAME,
      ...candidates,
    ]
      .map(value => clean(value))
      .filter(value => value.length > 3 && !isConfigId(value));
    const titleScore = (value: string) => {
      const actualTokens = normalize(value).split(' ').filter(token => token.length > 1 && token !== 'vs');
      let best = 0;
      for (const title of titles) {
        const expectedTokens = normalize(title).split(' ').filter(token => token.length > 1 && token !== 'vs');
        if (!expectedTokens.length) continue;
        const matched = expectedTokens.filter(expected => actualTokens.some(actual =>
          actual === expected ||
          (actual.length >= 4 && expected.length >= 4 && Math.abs(actual.length - expected.length) <= 1 && distance(actual, expected) <= 1)
        )).length;
        if (matched === expectedTokens.length) best = Math.max(best, matched);
      }
      return best;
    };
    const heading = Array.from(document.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6'))
      .find(node => isVisible(node) && /don.?t miss live/i.test(clean(node.innerText || node.textContent)));
    if (!heading || !titles.length) return false;

    let rail: HTMLElement | null = heading.parentElement;
    for (let depth = 0; rail && depth < 8; depth++, rail = rail.parentElement) {
      const text = clean(rail.innerText || rail.textContent);
      const actions = rail.querySelectorAll('button,a,[role="button"]').length;
      if (/don.?t miss live/i.test(text) && actions >= 2) break;
    }
    if (!rail) return false;

    const controls = Array.from(rail.querySelectorAll<HTMLElement>('button,a,[role="button"]'))
      .filter(node => isVisible(node) && /buy now|see more|watch free/i.test(clean(node.innerText || node.textContent)));
    let card: HTMLElement | null = null;
    let cardLength = Infinity;
    for (const control of controls) {
      let node: HTMLElement | null = control;
      for (let depth = 0; node && node !== rail && depth < 8; depth++, node = node.parentElement) {
        const text = clean(node.innerText || node.textContent);
        const rect = node.getBoundingClientRect();
        if (rect.width < 100 || rect.height < 100 || titleScore(text) === 0) continue;
        if (text.length < cardLength) {
          card = node;
          cardLength = text.length;
        }
      }
    }
    if (!card) return false;

    const fieldKey = normalize(field);
    let target: HTMLElement | null = card;
    if (/\b(name|title|event)\b/.test(fieldKey)) {
      target = Array.from(card.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6,p,span,strong,b'))
        .filter(node => isVisible(node) && titleScore(clean(node.innerText || node.textContent)) > 0)
        .sort((a, b) => clean(a.innerText || a.textContent).length - clean(b.innerText || b.textContent).length)[0] || card;
    } else if (/\b(date|time)\b/.test(fieldKey)) {
      target = Array.from(card.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6,p,span,strong,b'))
        .filter(node => isVisible(node) && /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\b|\b\d{1,2}(?:st|nd|rd|th)?\b/i.test(clean(node.innerText || node.textContent)))
        .sort((a, b) => clean(a.innerText || a.textContent).length - clean(b.innerText || b.textContent).length)[0] || card;
    } else if (/\b(image|poster|thumbnail)\b/.test(fieldKey)) {
      target = Array.from(card.querySelectorAll<HTMLElement>('img')).find(isVisible) || card;
    } else if (/\b(status|cta|button)\b/.test(fieldKey)) {
      target = Array.from(card.querySelectorAll<HTMLElement>('button,a,[role="button"]')).find(isVisible) || card;
    }

    document.querySelectorAll(`[${marker}]`).forEach(node => node.removeAttribute(marker));
    target.setAttribute(marker, 'true');
    return true;
  }, { marker: FAILURE_FIELD_MARKER, field, candidates, context }).catch(() => false);

  if (!marked) return null;
  const target = page.locator(`[${FAILURE_FIELD_MARKER}="true"]`).first();
  await target.waitFor({ state: 'visible', timeout: 1000 }).catch(() => { });
  return target;
}

// A payment summary contains the PPV price twice: once beside the PPV name
// and once beside "Today you pay".  Generic text matching always picks the
// first occurrence, which made failure evidence box the wrong price.  Scope
// this field to the price in the same row as the Today-you-pay label.
async function findTodayYouPayPriceTarget(page: any): Promise<any | null> {
  const marked = await page.evaluate((marker: string) => {
    const clean = (value: string | null | undefined) => String(value || '').replace(/\s+/g, ' ').trim();
    const isVisible = (el: HTMLElement) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const isPrice = (value: string) => /^(?:AED\s?|[£$€₹])\s*\d+(?:[.,]\d{2})?$/.test(clean(value));

    document.querySelectorAll(`[${marker}]`).forEach(node => node.removeAttribute(marker));
    const labels = Array.from(document.querySelectorAll<HTMLElement>('h1,h2,h3,h4,p,span,strong,b,div'))
      .filter(el => isVisible(el) && el.children.length <= 2 && /^today\s+you\s+pay$/i.test(clean(el.innerText || el.textContent)));
    for (const label of labels) {
      const labelRect = label.getBoundingClientRect();
      let parent: HTMLElement | null = label.parentElement;
      for (let depth = 0; depth < 6 && parent; depth++, parent = parent.parentElement) {
        const prices = Array.from(parent.querySelectorAll<HTMLElement>('h1,h2,h3,h4,p,span,strong,b,div'))
          .filter(el => isVisible(el) && el.children.length === 0 && !el.closest('del,s'))
          .map(el => ({ el, rect: el.getBoundingClientRect(), text: clean(el.innerText || el.textContent) }))
          .filter(item => isPrice(item.text) && item.rect.top >= labelRect.top - 8);
        if (prices.length) {
          prices.sort((a, b) => {
            const aDistance = Math.abs(a.rect.top - labelRect.top) + Math.abs(a.rect.left - labelRect.left) / 100;
            const bDistance = Math.abs(b.rect.top - labelRect.top) + Math.abs(b.rect.left - labelRect.left) / 100;
            return aDistance - bDistance;
          });
          prices[0].el.setAttribute(marker, 'true');
          return true;
        }
      }
    }
    return false;
  }, FAILURE_FIELD_MARKER).catch(() => false);

  if (!marked) return null;
  const target = page.locator(`[${FAILURE_FIELD_MARKER}="true"]`).first();
  await target.waitFor({ state: 'visible', timeout: 1000 }).catch(() => { });
  return target;
}

async function findPpvTitleTarget(page: any, field: string, candidates: string[]): Promise<any | null> {
  const fieldKey = String(field || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!['event name', 'ppv name', 'ppv card title'].includes(fieldKey)) return null;

  const marked = await page.evaluate(({ marker, fieldKey, candidates }: {
    marker: string;
    fieldKey: string;
    candidates: string[];
  }) => {
    const clean = (value: string | null | undefined) =>
      String(value ?? '').replace(/\s+/g, ' ').trim();
    const comparable = (value: string) =>
      clean(value)
        .replace(/\bppv\b/gi, '')
        .replace(/[^a-z0-9]+/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
    const wanted = candidates
      .map(comparable)
      .filter(value => value.length > 2);
    if (!wanted.length) return false;

    document.querySelectorAll(`[${marker}]`).forEach(node => node.removeAttribute(marker));

    const isVisible = (el: HTMLElement) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== 'hidden' &&
        style.display !== 'none' &&
        style.opacity !== '0';
    };

    const nodes = Array.from(document.querySelectorAll<HTMLElement>(
      'h1,h2,h3,h4,h5,p,span,strong,b,div'
    ));

    let best: HTMLElement | null = null;
    let bestScore = -Infinity;

    for (const node of nodes) {
      if (!isVisible(node)) continue;
      const text = clean(node.innerText || node.textContent);
      if (text.length < 2 || text.length > 100) continue;

      const normalizedText = comparable(text);
      const isMatch = wanted.some(value =>
        normalizedText === value ||
        (normalizedText.includes(value) && normalizedText.length <= value.length + 20)
      );
      if (!isMatch) continue;

      const rect = node.getBoundingClientRect();
      const style = window.getComputedStyle(node);
      const fontSize = Number.parseFloat(style.fontSize || '0') || 0;
      const parentText = clean((node.parentElement?.innerText || node.parentElement?.textContent || '')).toLowerCase();
      const grandText = clean((node.parentElement?.parentElement?.innerText || node.parentElement?.parentElement?.textContent || '')).toLowerCase();
      const surroundingText = `${parentText} ${grandText}`;
      const nearPpvDetails = /(?:AED\s?|[£$€₹]\s?)\d|\/fight|\b(?:sun|mon|tue|wed|thu|fri|sat)day?\b|\b\d{1,2}:\d{2}\b/i.test(surroundingText);
      const nearCardCopy = surroundingText.includes('just the fight') || surroundingText.includes('pay-per-view');

      let score = 100;
      score -= rect.top / 100;

      if (fieldKey === 'ppv card title') {
        score += fontSize * 8;
        if (nearCardCopy) score += 40;
        if (nearPpvDetails) score -= 20;
      } else {
        if (nearPpvDetails) score += 70;
        score -= fontSize * 2;
        if (fieldKey === 'event name' && /\b(?:sun|mon|tue|wed|thu|fri|sat)day?\b|\b\d{1,2}:\d{2}\b/i.test(surroundingText)) {
          score += 25;
        }
      }

      if (score > bestScore) {
        best = node;
        bestScore = score;
      }
    }

    if (!best) return false;
    best.setAttribute(marker, 'true');
    return true;
  }, { marker: FAILURE_FIELD_MARKER, fieldKey, candidates }).catch(() => false);

  if (!marked) return null;
  const target = page.locator(`[${FAILURE_FIELD_MARKER}="true"]`).first();
  await target.waitFor({ state: 'visible', timeout: 1000 }).catch(() => { });
  return target;
}

/**
 * Banner carousels may rotate after validation but before a failure screenshot
 * is taken. Re-select the PPV slide and mark it so evidence is scoped to the
 * content that was actually validated, not the currently active promotion.
 */
async function activatePpvBannerForEvidence(page: any, ppvName: string): Promise<any | null> {
  const activated = await page.evaluate(({ marker, name, selector }: {
    marker: string;
    name: string;
    selector: string;
  }) => {
    const words = name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2);
    if (!words.length) return false;

    document.querySelectorAll(`[${marker}]`).forEach(node => node.removeAttribute(marker));
    const roots = Array.from(document.querySelectorAll(selector)) as HTMLElement[];

    for (const root of roots) {
      const slides = Array.from(
        root.querySelectorAll('.swiper-slide:not(.swiper-slide-duplicate)')
      ) as HTMLElement[];
      const target = slides.find(slide => {
        const text = (slide.innerText || slide.textContent || '')
          .toLowerCase()
          .replace(/[^a-z0-9]/g, ' ')
          .replace(/\s+/g, ' ');
        return words.every(word => text.includes(word));
      });
      if (!target) continue;

      try { (root as any).swiper?.autoplay?.stop(); } catch { }
      try { (root.querySelector('.swiper') as any)?.swiper?.autoplay?.stop(); } catch { }
      const wrapper = root.querySelector('.swiper-wrapper') as HTMLElement | null;
      if (wrapper) wrapper.style.transitionDuration = '0ms';

      root.querySelectorAll('.swiper-slide').forEach(node => {
        const slide = node as HTMLElement;
        slide.classList.remove('swiper-slide-active', 'swiper-slide-next', 'swiper-slide-prev');
        slide.style.opacity = '0';
        slide.style.pointerEvents = 'none';
      });
      target.classList.add('swiper-slide-active');
      target.style.opacity = '1';
      target.style.pointerEvents = 'auto';
      target.setAttribute(marker, 'true');
      return true;
    }
    return false;
  }, { marker: FAILURE_BANNER_MARKER, name: ppvName, selector: BANNER_ROOT_SELECTORS }).catch(() => false);

  if (!activated) return null;

  const target = page.locator(`[${FAILURE_BANNER_MARKER}]`).last();
  await target.waitFor({ state: 'visible', timeout: 3000 }).catch(() => { });
  console.log(`✅ [Fail Shot] Re-activated PPV banner "${ppvName}" before evidence capture.`);
  return target;
}

async function findPopupContainer(page: any): Promise<any | null> {
  const selectors = [
    '[role="dialog"]',
    '[aria-modal="true"]',
    '[class*="content-promotion" i]',
    '[class*="modal-dialog" i]',
    '[class*="modal" i]',
    '[class*="popup" i]',
  ];

  let best: any = null;
  let bestScore = -Infinity;
  let bestArea = Infinity;

  for (const sel of selectors) {
    const loc = page.locator(sel);
    const count = await loc.count().catch(() => 0);
    for (let i = 0; i < Math.min(count, 80); i++) {
      const candidate = loc.nth(i);
      if (!await candidate.isVisible().catch(() => false)) continue;

      const info = await candidate.evaluate((el: HTMLElement) => {
        const clean = (value: string | null | undefined) =>
          String(value ?? '').replace(/\s+/g, ' ').trim();
        const rect = el.getBoundingClientRect();
        const text = clean(el.innerText || el.textContent).toLowerCase();
        const classText = clean(el.className as any).toLowerCase();
        const area = rect.width * rect.height;
        const viewportArea = Math.max(1, window.innerWidth * window.innerHeight);
        let score = 0;

        if (el.getAttribute('role') === 'dialog' || el.getAttribute('aria-modal') === 'true') score += 35;
        if (classText.includes('modal-dialog') || classText.includes('content-promotion')) score += 45;
        if (classText.includes('modal') || classText.includes('popup')) score += 15;
        if (text.includes('buy now')) score += 60;
        if (el.querySelector('img')) score += 15;
        if (el.querySelector('button, a')) score += 12;
        if (el.querySelector('[aria-label*="close" i], [class*="close" i]')) score += 8;
        if (rect.width < 180 || rect.height < 120) score -= 80;
        if (area > viewportArea * 0.7) score -= 70;
        else score += 30;
        if (classText.includes('header') || classText.includes('nav') || classText.includes('menu')) score -= 100;

        return { score, area };
      }).catch(() => null);

      if (!info || info.score < 20) continue;
      if (info.score > bestScore || (info.score === bestScore && info.area < bestArea)) {
        best = candidate;
        bestScore = info.score;
        bestArea = info.area;
      }
    }
  }

  return best;
}

async function findPopupTarget(page: any, candidates: string[]): Promise<any | null> {
  const popup = await findPopupContainer(page);
  if (!popup) return null;

  for (const text of candidates) {
    try {
      const locator = popup.getByText(text, { exact: false });
      const count = await locator.count().catch(() => 0);
      for (let i = 0; i < count; i++) {
        const item = locator.nth(i);
        if (await item.isVisible().catch(() => false)) {
          return item;
        }
      }
    } catch { /* try next candidate */ }
  }
  return null;
}

export async function captureFailures(
  page: any,
  results: any[],
  pageName: string,
  context?: Record<string, any>
): Promise<void> {
  if (!page || page.isClosed()) return;

  const fails = results.filter(
    (r) => r && r.page === pageName && r.status === 'FAIL' && !r.__shotDone
  );
  if (!fails.length) return;

  if (!fs.existsSync(SHOTS_DIR)) fs.mkdirSync(SHOTS_DIR, { recursive: true });

  for (const r of fails) {
    r.__shotDone = true; // mark so we don't re-capture if called again
    const field = r.field || 'field';
    const file = path.join(
      SHOTS_DIR,
      `${safeName(pageName)}_${safeName(field)}_${Date.now()}.png`
    );

    let handle: any = null;
    let overlayId: string | null = null;
    try {
      const candidates = matchCandidates(r);
      const isPopupField = String(field).toLowerCase().replace(/\s+/g, ' ').trim().startsWith('popup');
      const isBannerField = String(field).toLowerCase().includes('banner');
      const source = String(context?.SOURCE || context?.source || '').toLowerCase();
      const ppvName = String(context?.PPV_NAME || context?.PPV_DISPLAY_NAME || '').trim();
      const isTileSource = source.includes('tile') || source.includes('dont-miss') ||
        source.includes('upcoming') || source.includes('rail');
      const popup = isTileSource ? await findPopupContainer(page) : null;
      const tilePopupOpen = !!popup;
      const banner = isBannerField && source.includes('banner') && ppvName
        ? await activatePpvBannerForEvidence(page, ppvName)
        : null;
      const normalizedField = String(field).toLowerCase().replace(/\s+/g, ' ').trim();
      // Tile fields were captured before the click. Once a tile popup is open,
      // do not hunt for those fields in the dimmed page: the same event can be
      // present in the hero banner and scrollIntoView would replace the tile
      // evidence with an unrelated banner screenshot.
      const target = tilePopupOpen && !isPopupField
        ? null
        : (normalizedField === 'today you pay price'
          ? await findTodayYouPayPriceTarget(page)
          : null) ||
          (isPopupField ? await findPopupTarget(page, candidates) : null) ||
          (isPopupField && popup ? await findTarget(popup, candidates) : null) ||
          await findDontMissLiveTarget(page, source, field, candidates, context) ||
          await findPpvTitleTarget(page, field, candidates) ||
          (banner ? await findTarget(banner, candidates) : null) ||
          await findTarget(page, candidates);

      if (tilePopupOpen && !isPopupField) {
        console.log(`ℹ️ [Fail Shot] Keeping tile-popup background fixed for "${field}"; no background target will be highlighted.`);
      }

      if (target) {
        console.log(`🎯 [Fail Shot] Highlight target found for field "${field}": "${(await target.textContent().catch(() => '')).trim().substring(0, 50)}"`);
        await target.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => { });
        handle = await target.elementHandle().catch(() => null);
        if (handle) {
          // Draw a red highlight box around the failing element
          await page.evaluate((el: HTMLElement) => {
            (el as any).__prevOutline = el.style.outline;
            (el as any).__prevShadow = el.style.boxShadow;
            (el as any).__prevOffset = el.style.outlineOffset;
            (el as any).__prevBackground = el.style.backgroundColor;
            el.style.setProperty('outline', '4px solid #ff1744', 'important');
            el.style.setProperty('outline-offset', '2px', 'important');
            el.style.setProperty('box-shadow', '0 0 0 4px rgba(255,23,68,0.35)', 'important');
            el.style.setProperty('background-color', 'rgba(255, 23, 68, 0.2)', 'important');
            el.scrollIntoView({ block: 'center', inline: 'center' });
          }, handle).catch(() => { });
          await page.waitForTimeout(150);
        }

        const box = await target.boundingBox().catch(() => null);
        if (box && box.width > 0 && box.height > 0) {
          overlayId = `ppv-failure-marker-${Date.now()}-${Math.random().toString(16).slice(2)}`;
          await page.evaluate(({ id, rect }: {
            id: string;
            rect: { x: number; y: number; width: number; height: number };
          }) => {
            document.getElementById(id)?.remove();
            const marker = document.createElement('div');
            marker.id = id;
            marker.setAttribute('data-ppv-failure-marker', 'true');
            Object.assign(marker.style, {
              position: 'fixed',
              left: `${Math.max(0, rect.x - 4)}px`,
              top: `${Math.max(0, rect.y - 4)}px`,
              width: `${Math.max(24, rect.width + 8)}px`,
              height: `${Math.max(24, rect.height + 8)}px`,
              border: '4px solid #ff1744',
              borderRadius: '4px',
              boxSizing: 'border-box',
              background: 'rgba(255, 23, 68, 0.18)',
              zIndex: '2147483647',
              pointerEvents: 'none',
            });
            document.body.appendChild(marker);
          }, {
            id: overlayId,
            rect: box,
          }).catch(() => { });
          await page.waitForTimeout(100);
        }
      }

      // Remove any overflow:hidden that causes dark/clipped screenshots
      await page.evaluate(() => {
        document.documentElement.style.overflow = '';
        document.body.style.overflow = '';
      }).catch(() => { });
      await page.waitForTimeout(100);
      // Viewport screenshot (element is centered & boxed when found)
      await page.screenshot({ path: file, fullPage: false }).catch(() => { });
      if (fs.existsSync(file)) {
        r.screenshot = file;
        console.log(`📸 [Fail Shot] ${pageName} · ${field} → ${file}`);
      }
    } catch (e: any) {
      console.warn(`⚠️  [Fail Shot] could not capture "${field}": ${e?.message || e}`);
    } finally {
      // Always remove the highlight so later screenshots aren't polluted
      if (handle) {
        await page.evaluate((el: HTMLElement) => {
          el.style.outline = (el as any).__prevOutline || '';
          el.style.boxShadow = (el as any).__prevShadow || '';
          el.style.outlineOffset = (el as any).__prevOffset || '';
          el.style.backgroundColor = (el as any).__prevBackground || '';
        }, handle).catch(() => { });
      }
      if (overlayId) {
        await page.evaluate((id: string) => document.getElementById(id)?.remove(), overlayId).catch(() => { });
      }
      await page.locator(`[${FAILURE_BANNER_MARKER}]`).evaluateAll((nodes: Element[]) => {
        nodes.forEach((node: Element) => node.removeAttribute(FAILURE_BANNER_MARKER));
      }).catch(() => { });
      await page.locator(`[${FAILURE_FIELD_MARKER}]`).evaluateAll((nodes: Element[]) => {
        nodes.forEach((node: Element) => node.removeAttribute(FAILURE_FIELD_MARKER));
      }).catch(() => { });
    }
  }
}
