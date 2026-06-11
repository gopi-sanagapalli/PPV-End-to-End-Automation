import { test, expect } from '@playwright/test';
import { sleep } from '../utils/helpers';

test('Inspect PPV popup contents after clicking Fury vs Hall', async ({ browser }) => {
  test.setTimeout(180_000);

  const context = await browser.newContext({
    viewport:    null,
    colorScheme: 'dark',
    locale:      'en-IN',
    timezoneId:  'Asia/Kolkata',
  });
  await context.clearCookies();
  const page = await context.newPage();

  await page.goto('https://www.dazn.com/en-IN/home', { waitUntil: 'domcontentloaded' });

  // STRICT cookie handling — wait for, accept, verify gone
  const acceptBtn = page.locator('#onetrust-accept-btn-handler').first();
  const banner    = page.locator('#onetrust-banner-sdk, #onetrust-consent-sdk').first();
  if (await acceptBtn.waitFor({ state: 'visible', timeout: 30_000 }).then(() => true).catch(() => false)) {
    await acceptBtn.click({ force: true });
    await banner.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});
    await page.waitForFunction(() => !document.querySelector('#onetrust-banner-sdk, #onetrust-consent-sdk'), null, { timeout: 10_000 }).catch(() => {});
    console.log('✓ Cookies accepted + banner gone');
  }
  await sleep(1500);

  // trigger lazy load + scroll to header
  await page.evaluate(() => window.scrollTo({ top: 1800, behavior: 'instant' as ScrollBehavior }));
  await sleep(1500);

  const railHeader = page.getByText(/don'?t miss/i).first();
  await railHeader.waitFor({ state: 'attached', timeout: 30_000 });
  await railHeader.scrollIntoViewIfNeeded({ timeout: 15_000 });

  const railWrapper = railHeader.locator('xpath=ancestor::*[contains(@class,"rail__rail-wrapper")][1]');
  const furyImg = railWrapper.locator('img[alt*="Fury" i][alt*="Hall" i]:not(.swiper-slide-duplicate img)').first();
  const nextBtn = railWrapper.locator('button[aria-label="Next slide"]').first();

  for (let i = 0; i < 6; i++) {
    if ((await furyImg.count()) > 0) {
      const inView = await furyImg.evaluate((el: HTMLElement) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.right > 0 && r.left < window.innerWidth;
      }).catch(() => false);
      if (inView) break;
    }
    if (!(await nextBtn.isVisible().catch(() => false))) break;
    await nextBtn.click({ force: true }).catch(() => {});
    await sleep(700);
  }
  await furyImg.scrollIntoViewIfNeeded({ timeout: 8_000 }).catch(() => {});

  const furyTile = furyImg.locator('xpath=ancestor::a[contains(@class,"tile__link")][1]');
  await furyTile.click({ timeout: 10_000 });
  console.log('✓ Clicked Fury vs Hall tile');

  // Wait longer for the PPV popup to render (NOT the cookie one)
  await sleep(5500);
  await page.screenshot({ path: 'test-results/home-popup-before.png' }).catch(() => {});

  // FULL page dump — what's on the page now?
  const allHeadings = await page.evaluate(() => {
    const hs = Array.from(document.querySelectorAll('h1,h2,h3'))
      .filter((e: any) => e.offsetWidth || e.offsetHeight)
      .map((e: any) => {
        const r = e.getBoundingClientRect();
        return { tag: e.tagName, text: (e.innerText || '').slice(0, 120), y: Math.round(r.y) };
      });
    return { url: location.href, title: document.title, headings: hs };
  });
  console.log('--- POST-CLICK PAGE STATE ---');
  console.log('URL  :', allHeadings.url);
  console.log('Title:', allHeadings.title);
  console.log('Visible headings:');
  allHeadings.headings.forEach((h, i) => console.log(`  [${i}] <${h.tag}> y=${h.y} "${h.text}"`));
  console.log('-----------------------------');

  // ── Find the popup: the container around the H2 with the PPV name ──
  const dump = await page.evaluate(() => {
    // Find the H2 whose text is the PPV name we expect (Fury vs. Hall)
    const allH2 = Array.from(document.querySelectorAll('h2'))
      .filter((h: any) => /fury.*hall/i.test((h.innerText || '')));
    if (!allH2.length) return { found: false, candidateCount: 0, url: location.href };

    // Walk up from the H2 to find a "popup-ish" container (overflow:auto/scroll, or class hinting at popup)
    let node: HTMLElement | null = allH2[0] as HTMLElement;
    let candidates: HTMLElement[] = [];
    for (let i = 0; i < 10 && node; i++) {
      candidates.push(node);
      node = node.parentElement;
    }

    // Pick the ancestor that looks like the popup root (largest one with reasonable size that isn't the body)
    const real = candidates.filter((el) => {
      if (!el || el.tagName === 'BODY' || el.tagName === 'HTML') return false;
      const r = el.getBoundingClientRect();
      return r.width > 300 && r.height > 200;
    });
    if (!real.length) return { found: false, candidateCount: 0, url: location.href };
    // The "popup" is usually a few levels up — pick a candidate roughly 4-6 levels above H2 if available, else the largest
    const modal = real[Math.min(5, real.length - 1)];

    const dumpEl = (m: HTMLElement) => {
      const text = m.innerText.split('\n').map((s) => s.trim()).filter(Boolean);
      const imgs = Array.from(m.querySelectorAll('img')).map((i: any) => ({ alt: i.alt, src: (i.src || '').slice(0, 120) }));
      const buttons = Array.from(m.querySelectorAll('button, [role="button"], a[role="button"], a[class*="cta" i], a.tile__link')).map((b: any) => ({
        tag: b.tagName, text: (b.innerText || '').replace(/\s+/g,' ').trim().slice(0, 100),
        aria: b.getAttribute('aria-label') || '', href: b.getAttribute('href') || '',
        cls: (b.className || '').toString().slice(0, 100),
      }));
      const headings   = Array.from(m.querySelectorAll('h1,h2,h3,h4,h5,h6')).map((h: any) => ({ tag: h.tagName, text: (h.innerText || '').trim().slice(0, 200) }));
      const paragraphs = Array.from(m.querySelectorAll('p')).map((p: any) => (p.innerText || '').trim().slice(0, 200)).filter(Boolean);
      const spans      = Array.from(m.querySelectorAll('span')).map((s: any) => (s.innerText || '').trim()).filter(Boolean).slice(0, 60);
      return {
        cls: m.className.slice(0, 200), role: m.getAttribute('role') || '', id: m.id,
        rect: (() => { const r = m.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; })(),
        lines: text.slice(0, 60), imgs: imgs.slice(0, 10), headings, paragraphs: paragraphs.slice(0, 30), spans, buttons: buttons.slice(0, 25),
        outerHTML: m.outerHTML.slice(0, 6000),
      };
    };

    return { found: true, candidateCount: real.length, dump: dumpEl(modal) };
  });

  if (!dump.found) {
    console.log('❌ No PPV popup detected. Candidates considered:', (dump as any).candidateCount);
    console.log('URL:', page.url());
  } else {
    const d: any = (dump as any).dump;
    console.log('=== PPV POPUP DUMP ===');
    console.log('Modal id:', d.id, '| role:', d.role, '| rect:', JSON.stringify(d.rect));
    console.log('Modal cls:', d.cls);
    console.log('-- Text lines --');     d.lines.forEach((l: string, i: number) => console.log(`  [${i}] ${l}`));
    console.log('-- Headings --');       d.headings.forEach((h: any, i: number) => console.log(`  [${i}] <${h.tag}> ${h.text}`));
    console.log('-- Paragraphs --');     d.paragraphs.forEach((p: string, i: number) => console.log(`  [${i}] ${p}`));
    console.log('-- Spans --');          d.spans.forEach((s: string, i: number) => console.log(`  [${i}] ${s}`));
    console.log('-- Imgs --');           d.imgs.forEach((i: any, idx: number) => console.log(`  [${idx}] alt="${i.alt}" src=${i.src}`));
    console.log('-- Buttons --');        d.buttons.forEach((b: any, i: number) => console.log(`  [${i}] <${b.tag}> text="${b.text}" aria="${b.aria}" href="${b.href}" cls="${b.cls}"`));
    console.log('-- outerHTML (6000) --');
    console.log(d.outerHTML);
  }

  await page.screenshot({ path: 'test-results/home-popup.png', fullPage: false }).catch(() => {});
  await sleep(3000);
  await context.close();
});
