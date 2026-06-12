import { test, expect } from '@playwright/test';
import { sleep } from '../utils/helpers';

test('IN: cookies, Dont Miss rail, click Next until Fury vs Hall', async ({ browser }) => {
  test.setTimeout(240_000);

  const context = await browser.newContext({
    viewport:    null,
    colorScheme: 'dark',
    locale:      'en-IN',
    timezoneId:  'Asia/Kolkata',
  });
  await context.clearCookies();
  console.log('Cookies cleared from context');

  const page = await context.newPage();
  page.on('framenavigated', (f) => {
    if (f === page.mainFrame()) console.log('NAV ->', f.url());
  });

  await page.goto('https://www.dazn.com/en-IN/home', { waitUntil: 'domcontentloaded' });

  // ── STEP 1: cookies (nothing else first) ──
  const acceptBtn = page.locator(
    '#onetrust-accept-btn-handler, ' +
    'button:has-text("Accept All"), button:has-text("Accept all"), ' +
    'button:has-text("Accept"), button:has-text("Agree"), button:has-text("Allow all")'
  ).first();
  const banner = page.locator(
    '#onetrust-banner-sdk, #onetrust-consent-sdk, [class*="cookie-banner" i], [class*="consent-banner" i]'
  ).first();
  console.log('Waiting up to 30s for cookie banner...');
  const appeared = await acceptBtn.waitFor({ state: 'visible', timeout: 30_000 }).then(() => true).catch(() => false);
  if (appeared) {
    await acceptBtn.click({ force: true });
    await banner.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});
    console.log('✓ Cookie banner dismissed');
  } else {
    console.log('⚠️  No cookie banner appeared within 30s');
  }
  await sleep(2000);

  // ── STEP 2: trigger lazy-load with one jump-scroll, then land on Don't Miss header ──
  const railHeader = page.getByText(/don'?t miss/i).first();

  // Single large jump to force the lazy-rendered rails to mount
  await page.evaluate(() => window.scrollTo({ top: 1800, behavior: 'instant' as ScrollBehavior }));
  await sleep(1200);

  // If still not attached, give one more nudge
  if (!(await railHeader.count())) {
    await page.evaluate(() => window.scrollTo({ top: 3000, behavior: 'instant' as ScrollBehavior }));
    await sleep(1200);
  }

  await railHeader.waitFor({ state: 'attached', timeout: 20_000 });
  await railHeader.scrollIntoViewIfNeeded({ timeout: 15_000 });
  await expect(railHeader).toBeVisible();
  console.log("✓ Don't Miss rail header visible");
  await sleep(1500);

  // ── STEP 3: locate this rail's container = 3 ancestors up (rail__rail-wrapper) ──
  // and its Next button via aria-label inside it
  const railWrapper = railHeader.locator('xpath=ancestor::*[contains(@class,"rail__rail-wrapper")][1]');
  await expect(railWrapper).toBeVisible();
  const nextBtn = railWrapper.locator('button[aria-label="Next slide"]').first();
  const prevBtn = railWrapper.locator('button[aria-label="Previous slide"]').first();

  // PPV tile by image alt: "Fury vs. Hall" (Tyson Fury vs Eddie Hall).
  // Swiper.js duplicates slides for loop mode; exclude duplicates and pick the non-duplicate img.
  const furyImg = railWrapper.locator(
    'img[alt*="Fury" i][alt*="Hall" i]:not(.swiper-slide-duplicate img)'
  ).first();
  const furyTile = furyImg.locator('xpath=ancestor::a[contains(@class,"tile__link")][1]');

  const isFuryInView = async () => {
    if (!(await furyImg.count())) return null;
    const inView = await furyImg.evaluate((el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      // Partially visible horizontally = good enough; tile is "found"
      return r.width > 0 && r.right > 0 && r.left < window.innerWidth;
    }).catch(() => false);
    return inView ? furyTile : null;
  };

  // hover the rail so swiper arrows are interactable (in case they need hover)
  await railWrapper.hover().catch(() => {});
  await sleep(500);

  let clicks = 0;
  const maxClicks = 30;
  let found = await isFuryInView();
  while (!found && clicks < maxClicks) {
    if (page.isClosed()) throw new Error('Page closed during arrow clicks');

    await railWrapper.hover().catch(() => {});
    await sleep(200);

    const state = await railWrapper.evaluate((el: HTMLElement) => {
      const b = el.querySelector('button[aria-label="Next slide"]') as HTMLElement | null;
      if (!b) return { exists: false };
      const s = window.getComputedStyle(b);
      const r = b.getBoundingClientRect();
      return {
        exists: true,
        disabled: b.classList.contains('swiper-button-disabled') || b.hasAttribute('disabled'),
        display: s.display, visibility: s.visibility, opacity: s.opacity,
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      };
    }).catch(() => null);
    console.log(`click ${clicks} next state:`, JSON.stringify(state));

    if (!state || !state.exists) { console.log('Next button absent — break'); break; }
    if (state.disabled) {
      console.log('Next button disabled — end of rail; will use direct scrollIntoView');
      break;
    }
    if (state.visibility === 'hidden' || state.display === 'none' || Number(state.opacity) === 0) {
      console.log('Next button hidden — try force click anyway');
    }

    await nextBtn.click({ timeout: 5000, force: true }).catch((e) => console.log('next click err:', e.message));
    clicks++;
    await sleep(800);
    found = await isFuryInView();
  }
  console.log('Next-arrow clicks performed:', clicks);

  // Fallback: if the loop ended but the tile is in the rail DOM, just scroll it into view
  if (!found && (await furyImg.count()) > 0) {
    console.log('Fury tile found in DOM but not in viewport — scrolling into view directly');
    await furyImg.scrollIntoViewIfNeeded({ timeout: 8_000 }).catch(() => {});
    await sleep(500);
    found = await isFuryInView();
  }

  if (!found) {
    // Dump everything tile-ish inside the rail wrapper
    const dump = await railWrapper.evaluate((el: HTMLElement) => {
      const collect = (sel: string) =>
        Array.from(el.querySelectorAll(sel)).slice(0, 40).map((e: any) => ({
          tag: e.tagName,
          aria: e.getAttribute('aria-label') || '',
          alt:  e.getAttribute('alt') || '',
          title: e.getAttribute('title') || '',
          tid: e.getAttribute('data-test-id') || e.getAttribute('data-testid') || '',
          href: e.getAttribute('href') || '',
          text: (e.innerText || e.textContent || '').replace(/\s+/g,' ').trim().slice(0, 80),
          cls: (e.className || '').toString().slice(0, 80),
        }));
      return {
        nextDisabled: (el.querySelector('button[aria-label="Next slide"]') as HTMLElement)?.classList.contains('swiper-button-disabled'),
        nextDisplay:  (() => {
          const b = el.querySelector('button[aria-label="Next slide"]') as HTMLElement;
          if (!b) return 'absent';
          const s = window.getComputedStyle(b);
          return `display=${s.display} visibility=${s.visibility} opacity=${s.opacity} pointer-events=${s.pointerEvents}`;
        })(),
        anchors:    collect('a'),
        articleish: collect('[class*="tile" i], [class*="card" i], article'),
        imgs:       collect('img'),
      };
    }).catch(() => null);

    console.log("=== RAIL DUMP ===");
    console.log("Next button state:", dump?.nextDisplay, "disabled?", dump?.nextDisabled);
    console.log(`-- anchors (${dump?.anchors.length})`);
    dump?.anchors.forEach((a, i) => console.log(`   [${i}] <${a.tag}> aria="${a.aria}" title="${a.title}" tid="${a.tid}" href="${a.href}" text="${a.text}" cls="${a.cls}"`));
    console.log(`-- tile-like containers (${dump?.articleish.length})`);
    dump?.articleish.forEach((a, i) => console.log(`   [${i}] <${a.tag}> aria="${a.aria}" tid="${a.tid}" text="${a.text}" cls="${a.cls}"`));
    console.log(`-- imgs (${dump?.imgs.length})`);
    dump?.imgs.forEach((a, i) => console.log(`   [${i}] alt="${a.alt}" title="${a.title}"`));
    throw new Error("Could not bring Fury vs Hall into view after " + clicks + " clicks");
  }

  await furyImg.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
  await expect(furyImg).toBeVisible();
  console.log("✓ Fury vs Hall PPV tile is in view in Don't Miss rail");
  await sleep(800);

  // ── STEP 4: click the tile ──
  const urlBefore = page.url();
  // Verify we have the right tile: dump alt + href of the chosen pair
  const verify = await furyImg.evaluate((img: HTMLImageElement) => {
    const a = img.closest('a.tile__link___vuQG1, a[class*="tile__link"]') as HTMLAnchorElement | null;
    const article = img.closest('article') as HTMLElement | null;
    const r = img.getBoundingClientRect();
    return {
      alt:  img.alt,
      href: a?.getAttribute('href'),
      articleCls: article?.className?.slice(0, 100),
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      isDup: !!img.closest('.swiper-slide-duplicate'),
    };
  });
  console.log('Tile being clicked:', JSON.stringify(verify));

  await expect(furyTile).toBeVisible();
  await furyTile.click({ timeout: 10_000 });
  console.log('✓ Clicked Fury vs Hall tile');

  await page.waitForURL((url) => url.toString() !== urlBefore, { timeout: 15_000 }).catch(() => {});
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await sleep(2500);

  const after = await page.evaluate(() => {
    const modal = document.querySelector('[role="dialog"], [class*="modal" i]') as HTMLElement | null;
    return {
      url: location.href,
      title: document.title,
      hasVideo: !!document.querySelector('video'),
      modalOpen: !!modal,
      modalText: (modal?.innerText || '').replace(/\s+/g,' ').trim().slice(0, 300),
      visibleHeadings: Array.from(document.querySelectorAll('h1,h2,h3'))
        .filter((e: any) => e.offsetWidth || e.offsetHeight)
        .slice(0, 10)
        .map((e: any) => (e.innerText || '').slice(0, 100)),
    };
  });
  console.log('→ After click:', JSON.stringify(after, null, 2));

  await page.screenshot({ path: 'test-results/after-click.png', fullPage: false }).catch(() => {});
  await sleep(3000);

  await context.close();
});
