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
  pageName: string
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
      const target = (isPopupField ? await findPopupTarget(page, candidates) : null) ||
        await findTarget(page, candidates);

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
    }
  }
}