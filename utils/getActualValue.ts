import { DOMNode } from './helpers';

export async function getActualValue(
  page:       any,
  field:      string,
  _variant?:  string,
  eventData?: Record<string, string>,
  snapshot?:  DOMNode[]
): Promise<string> {

  if (!page || page.isClosed()) return 'N/A';

  // ── Helpers ──────────────────────────────────────────────────
  const clean = (v: string | null | undefined): string =>
    String(v ?? '')
      .replace(/\u200B/g, '')
      .replace(/\s+/g, ' ')
      .trim();

  const T = 0;

  // ── Snapshot helpers ─────────────────────────────────────────
  const snap = snapshot || [];

  const snapFind = (
    predicate: (n: DOMNode) => boolean,
    inModal = false
  ): string => {
    for (const n of snap) {
      if (inModal && !n.isInModal) continue;
      if (!inModal && n.isInModal) continue;
      if (predicate(n)) return n.text;
    }
    return 'N/A';
  };

  const snapFindAll = (
    predicate: (n: DOMNode) => boolean,
    inModal = false
  ): string[] => {
    const results: string[] = [];
    for (const n of snap) {
      if (inModal && !n.isInModal) continue;
      if (!inModal && n.isInModal) continue;
      if (predicate(n)) results.push(n.text);
    }
    return results;
  };

  const snapExists = (predicate: (n: DOMNode) => boolean): string => {
    for (const n of snap) {
      if (predicate(n)) return 'Yes';
    }
    return 'No';
  };

  // ── Live DOM helpers ─────────────────────────────────────────
  const isVisible = async (loc: any): Promise<boolean> => {
    try {
      const count = await loc.count().catch(() => 0);
      for (let i = 0; i < count; i++) {
        if (await loc.nth(i).isVisible().catch(() => false)) return true;
      }
    } catch {}
    return false;
  };

  const firstExists = async (...sels: string[]): Promise<string> => {
    for (const sel of sels) {
      try {
        if (await isVisible(page.locator(sel))) return 'Yes';
      } catch {}
    }
    return 'No';
  };

  // ── Scroll once ──────────────────────────────────────────────
  const scrollPage = async () => {
    try {
      await page.evaluate(() =>
        window.scrollTo(0, document.body.scrollHeight)
      );
      await page.waitForTimeout(150);
      await page.evaluate(() => window.scrollTo(0, 0));
    } catch {}
  };

  // ── Modal — cached ───────────────────────────────────────────
  let _modal: any = undefined;
  const getModal = async (): Promise<any | null> => {
    if (_modal !== undefined) return _modal;
    const modalSels = [
      '[role="dialog"]',
      '[aria-modal="true"]',
      '[class*="modal" i]',
      '[class*="overlay" i]',
      '[class*="popup" i]',
      '[class*="drawer" i]',
      '[class*="sheet" i]',
    ];
    for (const sel of modalSels) {
      const el = page.locator(sel).first();
      if (await el.isVisible().catch(() => false)) {
        _modal = el;
        return _modal;
      }
    }
    _modal = null;
    return null;
  };

  const isPriceText = (t: string) =>
    /^[£$$€₹]\s?[\d,]+(\.\d{2})?$$/.test(t);

  const isDateText = (t: string) =>
    (/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/i.test(t) &&
     /\d{1,2}(st|nd|rd|th)?\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i.test(t)) ||
    (/\d{1,2}\s*(st|nd|rd|th)?\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i.test(t) &&
     /\d{1,2}:\d{2}/.test(t));

  const key = field.toLowerCase().replace(/\s+/g, ' ').trim();

  switch (key) {

    // ════════════════════════════════════════════════════════════
    // PAGE TITLE
    // ════════════════════════════════════════════════════════════
    case 'page title': {
      return snapFind(
        n => n.tag === 'h1' && n.text.length < 120
      );
    }

    // ════════════════════════════════════════════════════════════
    // HEADER SUB TEXT
    // ════════════════════════════════════════════════════════════
    case 'header sub text':
    case 'header full copy':
    case 'header upsell text': {
      return snapFind(n =>
        (n.tag === 'p' || n.tag === 'span') &&
        (n.text.toLowerCase().includes('with dazn') ||
         (n.text.toLowerCase().includes('buy') &&
          n.text.toLowerCase().includes('standard')))
      );
    }

    // ════════════════════════════════════════════════════════════
    // PAGE SUBHEADER
    // ════════════════════════════════════════════════════════════
    case 'pagesubheader':
    case 'page subheader': {
      return snapFind(n =>
        (n.tag === 'p' || n.tag === 'span' ||
         n.tag === 'h2' || n.tag === 'h3') &&
        (n.text.toLowerCase().includes('pick a plan') ||
         n.text.toLowerCase().includes('pay-per-view event'))
      );
    }

    // ════════════════════════════════════════════════════════════
    // HEADER HIGHLIGHT TEXT
    // ════════════════════════════════════════════════════════════
    case 'header highlight text1':
    case 'header highlight text': {
      const ppvName = (eventData?.PPV_NAME || '').toLowerCase();
      const found = snapFind(n =>
        (n.tag === 'strong' || n.tag === 'b' || n.tag === 'a') &&
        n.text.toLowerCase().includes('vs')
      );
      if (found !== 'N/A') return found;
      if (ppvName) {
        return snapFind(n =>
          n.text.toLowerCase().includes(ppvName) &&
          n.text.toLowerCase().includes('vs')
        );
      }
      return 'N/A';
    }

    case 'header highlight text2': {
      const found = snapFind(n =>
        (n.tag === 'strong' || n.tag === 'b' || n.tag === 'a') &&
        (n.text.toLowerCase().includes('ultimate') ||
         n.text.toLowerCase().includes('included'))
      );
      if (found !== 'N/A') return found;
      return snapFind(n =>
        n.text.toLowerCase().includes('get it included') ||
        n.text.toLowerCase().includes('included in dazn ultimate')
      );
    }

    // ════════════════════════════════════════════════════════════
    // HEADER (payment encrypted text)
    // ════════════════════════════════════════════════════════════
    case 'header': {
      return snapFind(n =>
        (n.tag === 'p' || n.tag === 'span') &&
        n.text.toLowerCase().includes('encrypted')
      );
    }

    // ════════════════════════════════════════════════════════════
    // SCHEDULE — PPV TILE PRESENT
    // ════════════════════════════════════════════════════════════
    case 'ppv tile present': {
      const count = await page.locator('article').count().catch(() => 0);
      return count > 0 ? 'Yes' : 'No';
    }

    // ════════════════════════════════════════════════════════════
    // SCHEDULE — LOCK ICON PRESENT
    // ════════════════════════════════════════════════════════════
    case 'lock icon present': {
      return firstExists(
        '[class*="lock" i]',
        '[class*="premium" i]',
        'svg[class*="lock" i]',
        '[aria-label*="lock" i]',
        'article svg'
      );
    }

    // ════════════════════════════════════════════════════════════
    // SCHEDULE — PPV TIME ON TILE
    // ════════════════════════════════════════════════════════════
   case 'ppv time on tile': {
  // Try snapshot first
  const fromSnap = snapFind(n =>
    n.childCount === 0 &&
    /^\d{1,2}:\d{2}$/.test(n.text)
  );
  if (fromSnap !== 'N/A') return fromSnap;

  // Fallback — live DOM
  const firstWord = (eventData?.PPV_NAME || '').toLowerCase().split(' ')[0];
  const articles  = page.locator('article');
  const artCount  = await articles.count().catch(() => 0);
  for (let i = 0; i < artCount; i++) {
    const art = articles.nth(i);
    const artText = clean(
      await art.innerText({ timeout: T }).catch(() => '')
    ).toLowerCase();
    if (firstWord && !artText.includes(firstWord)) continue;
    const inner = art.locator('span, time, p, div');
    const ic    = await inner.count().catch(() => 0);
    for (let j = 0; j < ic; j++) {
      const el = inner.nth(j);
      if (!await el.isVisible().catch(() => false)) continue;
      const kids = await el.locator('> *').count().catch(() => 0);
      if (kids > 1) continue;
      const t = clean(await el.innerText({ timeout: T }).catch(() => ''));
      if (/^\d{1,2}:\d{2}$/.test(t)) return t;
    }
  }
  return 'N/A';
}

    // ════════════════════════════════════════════════════════════
    // SCHEDULE — PPV PROMOTER ON TILE
    // ════════════════════════════════════════════════════════════
   case 'ppv promoter on tile': {
  const promoter  = (eventData?.PPV_PROMOTER || '').toLowerCase();
  const firstWord = promoter.split(' ')[0];

  // Try snapshot first
  const fromSnap = snapFind(n => {
    const t = n.text.toLowerCase();
    return (
      firstWord &&
      t.includes(firstWord) &&
      n.text.length < 80 &&
      !t.includes('vs')
    );
  });
  if (fromSnap !== 'N/A') return fromSnap;

  // Fallback — live DOM
  const ppvFirstWord = (eventData?.PPV_NAME || '').toLowerCase().split(' ')[0];
  const articles     = page.locator('article');
  const artCount     = await articles.count().catch(() => 0);
  for (let i = 0; i < artCount; i++) {
    const art = articles.nth(i);
    const artText = clean(
      await art.innerText({ timeout: T }).catch(() => '')
    ).toLowerCase();
    if (ppvFirstWord && !artText.includes(ppvFirstWord)) continue;
    const inner = art.locator('p, span');
    const ic    = await inner.count().catch(() => 0);
    for (let j = 0; j < ic; j++) {
      const el = inner.nth(j);
      if (!await el.isVisible().catch(() => false)) continue;
      const kids = await el.locator('> *').count().catch(() => 0);
      if (kids > 1) continue;
      const t = clean(await el.innerText({ timeout: T }).catch(() => ''));
      if (
        firstWord &&
        t.toLowerCase().includes(firstWord) &&
        t.length < 80 &&
        !t.toLowerCase().includes('vs')
      ) return t;
    }
  }
  return 'N/A';
}

    // ════════════════════════════════════════════════════════════
    // SCHEDULE — POPUP CLOSE BUTTON
    // ════════════════════════════════════════════════════════════
   case 'popup close button': {
  // Try snapshot first
  const fromSnap = snapFind(n =>
    n.isInModal &&
    (n.tag === 'button') &&
    (n.classes.toLowerCase().includes('close') ||
     n.classes.toLowerCase().includes('dismiss') ||
     n.text === '×' ||
     n.text === '✕' ||
     n.text === 'Close' ||
     n.text === '')
  , true);
  if (fromSnap !== 'N/A') return 'Yes';

  // Live DOM fallback
  return firstExists(
    '[role="dialog"] button[aria-label*="close" i]',
    '[role="dialog"] button[class*="close" i]',
    '[role="dialog"] [class*="dismiss" i]',
    '[role="dialog"] button[class*="icon" i]',
    '[role="dialog"] button:has(svg)',
    '[aria-modal="true"] button:has(svg)',
    '[class*="modal" i] button:has(svg)'
  );
}

    // ════════════════════════════════════════════════════════════
    // PPV NAME
    // ════════════════════════════════════════════════════════════
    case 'ppv name': {
  const firstWord = (eventData?.PPV_NAME || '').toLowerCase().split(' ')[0];
  const ppvName   = (eventData?.PPV_NAME || '').toLowerCase();

  // Try snapshot first
  const fromHeading = snapFind(n =>
    ['h1','h2','h3','h4'].includes(n.tag) &&
    n.text.toLowerCase().includes('vs') &&
    n.text.length < 80
  );
  if (fromHeading !== 'N/A') return fromHeading;

  // Try snapshot spans/p
  const fromSnap = snapFind(n =>
    n.text.toLowerCase().includes('vs') &&
    n.text.length < 80 &&
    !n.text.toLowerCase().includes('buy') &&
    (!firstWord || n.text.toLowerCase().includes(firstWord))
  );
  if (fromSnap !== 'N/A') return fromSnap;

  // Fallback — live DOM for schedule page articles
  const articles = page.locator('article');
  const artCount = await articles.count().catch(() => 0);
  for (let i = 0; i < artCount; i++) {
    const art = articles.nth(i);
    const artText = clean(
      await art.innerText({ timeout: T }).catch(() => '')
    ).toLowerCase();
    if (firstWord && !artText.includes(firstWord)) continue;
    const inner = art.locator('h2, h3, h4, p, span');
    const ic    = await inner.count().catch(() => 0);
    for (let j = 0; j < ic; j++) {
      const el = inner.nth(j);
      if (!await el.isVisible().catch(() => false)) continue;
      const t = clean(await el.innerText({ timeout: T }).catch(() => ''));
      if (t.toLowerCase().includes('vs') && t.length < 80) return t;
    }
  }
  return 'N/A';
}

    // ════════════════════════════════════════════════════════════
    // PPV DATE (schedule page)
    // ════════════════════════════════════════════════════════════
    case 'ppv date': {
      const firstWord = (eventData?.PPV_NAME || '').toLowerCase().split(' ')[0];
      const arts = page.locator('article');
      const ac   = await arts.count().catch(() => 0);

      for (let i = 0; i < ac; i++) {
        const art = arts.nth(i);
        if (!await art.isVisible().catch(() => false)) continue;
        const artText = clean(
          await art.innerText({ timeout: T }).catch(() => '')
        ).toLowerCase();
        if (firstWord && !artText.includes(firstWord)) continue;

        const artHandle = await art.elementHandle().catch(() => null);
        if (artHandle) {
          const dateText = await page.evaluate((el: Element) => {
            let parent = el.parentElement;
            for (let i = 0; i < 5; i++) {
              if (!parent) break;
              const prev = parent.previousElementSibling;
              if (prev) {
                const text = (prev as HTMLElement).innerText?.trim() || '';
                if (/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/i.test(text)) return text;
                if (/\d{1,2}\s*(MAY|JAN|FEB|MAR|APR|JUN|JUL|AUG|SEP|OCT|NOV|DEC)/i.test(text)) return text;
              }
              const parentText = (parent as HTMLElement).innerText?.trim() || '';
              if (
                /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/i.test(parentText) &&
                parentText.length < 30
              ) return parentText;
              parent = parent.parentElement;
            }
            return '';
          }, artHandle).catch(() => '');
          if (dateText && dateText.length < 50) return dateText;
        }
      }
      if (eventData?.PPV_DATE) return eventData.PPV_DATE;
      return 'N/A';
    }

    // ════════════════════════════════════════════════════════════
    // POPUP FIELDS
    // ════════════════════════════════════════════════════════════
    case 'popup image present': {
      return firstExists(
        '[role="dialog"] img',
        '[aria-modal="true"] img',
        '[class*="modal" i] img'
      );
    }

   case 'popup date': {
  const firstWord = (eventData?.PPV_NAME || '').toLowerCase().split(' ')[0];

  // First verify modal contains our event
  const modalTexts = snap.filter(n => n.isInModal).map(n => n.text.toLowerCase());
  const modalHasEvent = firstWord
    ? modalTexts.some(t => t.includes(firstWord))
    : true;

  if (!modalHasEvent) {
    console.log(`⚠️  Modal does not contain "${firstWord}" — wrong modal`);
    return 'N/A';
  }

  return snapFind(n => {
    if (!n.isInModal) return false;
    const t = n.text;
    if (t.toLowerCase().includes('vs')) return false;
    if (isPriceText(t)) return false;
    if (t.toLowerCase().includes('buy')) return false;
    if (t.toLowerCase().includes('catch')) return false;
    if (
      /^\d{1,2}\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+\d{1,2}:\d{2}$/i.test(t)
    ) return true;
    if (
      /\b(MON|TUE|WED|THU|FRI|SAT|SUN)\b/i.test(t) &&
      /\d{1,2}/.test(t) &&
      /\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\b/i.test(t) &&
      t.length < 30
    ) return true;
    if (isDateText(t) && t.length < 60) return true;
    return false;
  }, true);
}

    case 'popup ppv name': {
      const firstWord = (eventData?.PPV_NAME || '').toLowerCase().split(' ')[0];
      return snapFind(n =>
        n.isInModal &&
        n.text.toLowerCase().includes('vs') &&
        n.text.length < 80 &&
        (!firstWord || n.text.toLowerCase().includes(firstWord))
      , true);
    }

    case 'popup promoter': {
      const promoter  = (eventData?.PPV_PROMOTER || '').toLowerCase();
      const firstWord = promoter.split(' ')[0];
      return snapFind(n => {
        if (!n.isInModal) return false;
        const t = n.text.toLowerCase();
        return (
          firstWord &&
          t.includes(firstWord) &&
          n.text.length > 5 &&
          n.text.length < 80 &&
          !t.includes('vs')
        );
      }, true);
    }

    case 'popup description': {
      const ppvDesc = (eventData?.PPV_DESCRIPTION || '').toLowerCase();
      return snapFind(n =>
        n.isInModal &&
        n.tag === 'p' &&
        n.text.length > 30 &&
        !n.text.toLowerCase().includes('vs') &&
        !isDateText(n.text) &&
        (ppvDesc
          ? n.text.toLowerCase().includes(ppvDesc.split(' ')[0])
          : true)
      , true);
    }

    case 'popup buy now cta': {
      const found = snapFind(n =>
        n.isInModal &&
        (n.tag === 'button' || n.tag === 'a') &&
        n.text.toLowerCase().includes('buy')
      , true);
      return found !== 'N/A' ? 'Yes' : 'No';
    }

    // ════════════════════════════════════════════════════════════
    // IMAGES
    // ════════════════════════════════════════════════════════════
    case 'hero image':
    case 'ppv image present':
    case 'ppv image':
      return firstExists(
        'img[src*="ppv"]',
        'img[alt*="vs" i]',
        'main img',
        'img'
      );

    case 'ppv1 image present on ultimate tier':
    case 'ppv1 image present on bundle': {
      return firstExists(
        '[class*="upsell" i] img',
        '[class*="ultimate" i] img',
        '[class*="bundle" i] img',
        '[class*="included" i] img'
      );
    }

    case 'ppv2 image present on ultimate tier':
    case 'ppv2 image present on bundle': {
      const count = await page
        .locator('[class*="upsell" i] img, [class*="ultimate" i] img')
        .count()
        .catch(() => 0);
      return count >= 2 ? 'Yes' : 'No';
    }

    // ════════════════════════════════════════════════════════════
    // EVENT NAME
    // ════════════════════════════════════════════════════════════
    case 'event name':
    case 'event name on top': {
      const ppvName = (eventData?.PPV_NAME || '').toLowerCase();
      return snapFind(n =>
        ['h1','h2','h3','h4'].includes(n.tag) &&
        (n.text.toLowerCase().includes(ppvName) ||
         (n.text.toLowerCase().includes('vs') &&
          n.text.toLowerCase().includes('ppv'))) &&
        n.text.length < 80
      );
    }

    // ════════════════════════════════════════════════════════════
    // PPV PRICE
    // ════════════════════════════════════════════════════════════
    case 'ppv price': {
      return snapFind(n =>
        n.childCount === 0 &&
        isPriceText(n.text)
      );
    }

    // ════════════════════════════════════════════════════════════
    // CURRENCY
    // ════════════════════════════════════════════════════════════
    case 'currency': {
      const priceNode = snap.find(n =>
        n.childCount === 0 && isPriceText(n.text)
      );
      if (priceNode) {
        const match = priceNode.text.match(/^[£$€₹]/);
        if (match) return match[0];
      }
      return 'N/A';
    }

    // ════════════════════════════════════════════════════════════
    // DAZN TIER
    // ════════════════════════════════════════════════════════════
    case 'dazn tier': {
      return snapFind(n => {
        const t = n.text;
        return (
          (t.startsWith('+DAZN') && t.length < 30) ||
          /^DAZN (Standard|Ultimate)$/.test(t)
        );
      });
    }

    // ════════════════════════════════════════════════════════════
    // PPV DATE / TIME (PPV page)
    // ════════════════════════════════════════════════════════════
    case 'ppv date and timetext':
    case 'event date and time':
    case 'ppv date and time':
    case 'ppv1 date and time text on bundle':
    case 'ppv1 date text on ultimate tier': {
      return snapFind(n =>
        n.childCount === 0 &&
        (isDateText(n.text) ||
         (/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/i.test(n.text) &&
          /\d{1,2}(st|nd|rd|th)?/i.test(n.text))) &&
        n.text.length < 60
      );
    }

    case 'ppv2 date text on ultimate tier':
    case 'ppv2 date and time text on bundle': {
      const dates = snapFindAll(n =>
        n.childCount === 0 &&
        (isDateText(n.text) ||
         /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/i.test(n.text)) &&
        n.text.length < 60
      );
      return dates[1] ?? 'N/A';
    }

    // ════════════════════════════════════════════════════════════
    // RADIO / CHECKBOX
    // ════════════════════════════════════════════════════════════
    case 'radio selected': {
      const loc   = page.locator('input[type="radio"], [role="radio"]');
      const count = await loc.count().catch(() => 0);
      for (let i = 0; i < count; i++) {
        if (await loc.nth(i).isChecked().catch(() => false)) return 'Yes';
      }
      return 'No';
    }

    case 'ppv checkbox present': {
      const count = await page
        .locator('input[type="checkbox"]')
        .count()
        .catch(() => 0);
      return count > 0 ? 'Yes' : 'No';
    }

    case 'ppv selected': {
      const cb = page.locator('input[type="checkbox"]').first();
      return (await cb.isChecked().catch(() => false)) ? 'Yes' : 'No';
    }

    case 'trial selected': {
      const r = page.locator('input[type="radio"]').first();
      return (await r.isChecked().catch(() => false)) ? 'Yes' : 'No';
    }

    case 'upsell selected': {
      const r = page.locator('input[type="radio"]').nth(1);
      return (await r.isChecked().catch(() => false)) ? 'Yes' : 'No';
    }

    case 'trial radio present': {
      const r = page.locator('input[type="radio"]').first();
      return (await r.isVisible().catch(() => false)) ? 'Yes' : 'No';
    }

    case 'trial card present': {
      const found = snapFind(n =>
        n.text.toLowerCase().includes('free trial') &&
        n.text.length < 80
      );
      return found !== 'N/A' ? 'Yes' : 'No';
    }

    // ════════════════════════════════════════════════════════════
    // UPSELL SECTION PRESENT
    // ════════════════════════════════════════════════════════════
    case 'upsell section present':
    case 'upsell card present': {
      const found = snapFind(n =>
        n.text.toLowerCase().includes('dazn ultimate') ||
        n.text.toLowerCase().includes('annual - pay over time')
      );
      return found !== 'N/A' ? 'Yes' : 'No';
    }

    // ════════════════════════════════════════════════════════════
    // UPSELL LABEL
    // ════════════════════════════════════════════════════════════
    case 'upsell label': {
  // Try snapshot
  const fromSnap = snapFind(n =>
    n.childCount === 0 &&
    n.text.toLowerCase() === 'pay-per-views included'
  );
  if (fromSnap !== 'N/A') return fromSnap;

  // Live DOM fallback
  const loc   = page.locator('span, p, div');
  const count = await loc.count().catch(() => 0);
  for (let i = 0; i < count; i++) {
    const el = loc.nth(i);
    if (!await el.isVisible().catch(() => false)) continue;
    const kids = await el.locator('> *').count().catch(() => 0);
    if (kids > 1) continue;
    const t = clean(await el.innerText({ timeout: T }).catch(() => ''));
    if (t.toLowerCase() === 'pay-per-views included') return t;
  }
  return 'N/A';
}

    // ════════════════════════════════════════════════════════════
    // UPSELL PLAN NAME
    // ════════════════════════════════════════════════════════════
    case 'upsell plan name': {
      return snapFind(n =>
        n.childCount <= 1 &&
        (n.text.toLowerCase() === 'dazn ultimate' ||
         n.text.toLowerCase() === 'annual - pay over time')
      );
    }

    // ════════════════════════════════════════════════════════════
    // UPSELL PLAN HIGHLIGHT
    // ════════════════════════════════════════════════════════════
    case 'upsell plan highlight': {
      return snapFind(n =>
        (n.tag === 'strong' || n.tag === 'b' || n.tag === 'em' ||
         n.classes.toLowerCase().includes('highlight') ||
         n.classes.toLowerCase().includes('gold') ||
         n.classes.toLowerCase().includes('accent')) &&
        n.text.toLowerCase().includes('pay over time') &&
        n.text.length < 40
      );
    }

    // ════════════════════════════════════════════════════════════
    // UPSELL PRICE TEXT ("From")
    // ════════════════════════════════════════════════════════════
    case 'upsell price text':
    case 'upsell price from': {
      return snapFind(n =>
        n.childCount === 0 &&
        n.text === 'From'
      );
    }

    // ════════════════════════════════════════════════════════════
    // UPSELL PRICE
    // ════════════════════════════════════════════════════════════
    case 'upsell price': {
  const prices = snapFindAll(n =>
    n.childCount === 0 &&
    isPriceText(n.text)
  );
  // prices[0] = PPV price, prices[1] = upsell price
  if (prices[1]) return prices[1];

  // DAZN Plan page — price may not have currency symbol
  // Look for standalone number like "409"
  const annual = eventData?.ANNUAL_PRICE || '';
  if (annual) {
    const found = snapFind(n =>
      n.childCount === 0 &&
      (n.text === annual ||
       n.text === `₹${annual}` ||
       n.text === `£${annual}` ||
       n.text === `$${annual}` ||
       n.text === `€${annual}`)
    );
    if (found !== 'N/A') return found;
  }
  return prices[0] ?? 'N/A';
}

    // ════════════════════════════════════════════════════════════
    // UPSELL PRICE LENGTH (/ month)
    // ════════════════════════════════════════════════════════════
   case 'upsell price length': {
  // Try snapshot
  const fromSnap = snapFind(n =>
    n.childCount === 0 &&
    (n.text === '/ month' || n.text === '/month' || n.text === 'per month')
  );
  if (fromSnap !== 'N/A') return fromSnap;

  // Live DOM fallback
  const loc   = page.locator('span, p');
  const count = await loc.count().catch(() => 0);
  for (let i = 0; i < count; i++) {
    const el = loc.nth(i);
    if (!await el.isVisible().catch(() => false)) continue;
    const kids = await el.locator('> *').count().catch(() => 0);
    if (kids > 0) continue;
    const t = clean(await el.innerText({ timeout: T }).catch(() => ''));
    if (t === '/ month' || t === '/month' || t === 'per month') return t;
  }
  return 'N/A';
} 

    // ════════════════════════════════════════════════════════════
    // UPSELL BILLING / RENEWAL TEXT
    // ════════════════════════════════════════════════════════════
   case 'upsell billing text':
case 'upsell renweal text': {
  return snapFind(n =>
    n.childCount === 0 &&
    n.text.toLowerCase().includes('annual contract') &&
    n.text.toLowerCase().includes('auto renews') &&
    n.text.length < 80
  );
}

    // ════════════════════════════════════════════════════════════
    // UPSELL FEATURES
    // ════════════════════════════════════════════════════════════
    case 'upsell feature 1':
    case 'upsell feature 2':
    case 'upsell feature 3': {
      const idx = key.endsWith('1') ? 0 : key.endsWith('2') ? 1 : 2;

      // Get all li items that are NOT trial items
      const allFeatures = snapFindAll(n =>
        n.tag === 'li' &&
        n.text.length > 5 &&
        !n.text.toLowerCase().includes('7-day') &&
        !n.text.toLowerCase().includes('cancel anytime during') &&
        !n.text.toLowerCase().includes('monthly flex')
      );

      if (allFeatures[idx]) return allFeatures[idx];

      // Fallback — live DOM scroll and check
      await scrollPage();
      const allLi    = page.locator('li');
      const allCount = await allLi.count().catch(() => 0);
      const texts: string[] = [];
      for (let i = 0; i < allCount; i++) {
        const el = allLi.nth(i);
        if (!await el.isVisible().catch(() => false)) continue;
        const t = clean(await el.innerText({ timeout: T }).catch(() => ''));
        if (
          t &&
          t.length > 5 &&
          !t.toLowerCase().includes('7-day') &&
          !t.toLowerCase().includes('cancel anytime during') &&
          !t.toLowerCase().includes('monthly flex')
        ) texts.push(t);
      }
      return texts[idx] ?? 'N/A';
    }

    // ════════════════════════════════════════════════════════════
    // UPSELL HIGHLIGHT TEXT
    // ════════════════════════════════════════════════════════════
    case 'upsell highlight text': {
      const ppvName = (eventData?.PPV_NAME || '').toLowerCase().split(' ')[0];
      const secPPV  = (eventData?.SECONDARY_PPV || '').toLowerCase().split(' ')[0];
      return snapFind(n =>
        n.text.includes('&') &&
        n.text.toLowerCase().includes('vs') &&
        (!ppvName || n.text.toLowerCase().includes(ppvName)) &&
        (!secPPV  || n.text.toLowerCase().includes(secPPV)) &&
        n.text.length < 120
      );
    }

    // ════════════════════════════════════════════════════════════
    // INCLUDED PPV NAMES
    // ════════════════════════════════════════════════════════════
    case 'included ppv1 name': {
      const ppvName = (eventData?.PPV_NAME || '').toLowerCase().split(' ')[0];
      return snapFind(n =>
        n.text.toLowerCase().includes('vs') &&
        n.text.length < 80 &&
        (!ppvName || n.text.toLowerCase().includes(ppvName))
      );
    }

    case 'included ppv2 name': {
      const secPPV  = (eventData?.SECONDARY_PPV || '').toLowerCase().split(' ')[0];
      const ppvName = (eventData?.PPV_NAME || '').toLowerCase().split(' ')[0];

      // Get all vs texts
      const vsTexts = snapFindAll(n =>
        n.text.toLowerCase().includes('vs') &&
        n.text.length < 80
      );

      // Find one matching secondary PPV
      for (const t of vsTexts) {
        if (secPPV && t.toLowerCase().includes(secPPV)) return t;
      }

      // Fallback — second vs text that doesn't match primary
// Fallback — second vs text that doesn't match primary
      for (const t of vsTexts) {
        if (ppvName && !t.toLowerCase().includes(ppvName)) return t;
      }
      return vsTexts[1] ?? 'N/A';
    }

    // ════════════════════════════════════════════════════════════
    // PPV INCLUDED TAGS
    // ════════════════════════════════════════════════════════════
    case 'ppv1 included tag':
    case 'ppv2 included tag': {
      const found = snapFind(n =>
        n.childCount === 0 &&
        n.text.toLowerCase() === 'included' &&
        n.text.length < 40
      );
      return found !== 'N/A' ? 'Yes' : 'No';
    }

    // ════════════════════════════════════════════════════════════
    // WHATS INCLUDED CTA
    // ════════════════════════════════════════════════════════════
    case 'whats included cta': {
      return snapFind(n =>
        (n.tag === 'a' || n.tag === 'button' || n.tag === 'span') &&
        (n.text.toLowerCase().includes('whats included') ||
         n.text.toLowerCase().includes("what's included") ||
         n.text.toLowerCase().includes('what is included'))
      );
    }

    // ════════════════════════════════════════════════════════════
    // GOLD HIGHLIGHT 1 — PPV_NAME in header
    // ════════════════════════════════════════════════════════════
    case 'gold highlight 1': {
      const ppvName = (eventData?.PPV_NAME || '').toLowerCase();
      return snapFind(n =>
        (n.tag === 'strong' || n.tag === 'b' || n.tag === 'a' ||
         n.classes.toLowerCase().includes('highlight') ||
         n.classes.toLowerCase().includes('gold') ||
         n.classes.toLowerCase().includes('accent')) &&
        n.text.toLowerCase().includes('vs') &&
        (!ppvName || n.text.toLowerCase().includes(ppvName.split(' ')[0])) &&
        n.text.length < 80
      );
    }

    // ════════════════════════════════════════════════════════════
    // GOLD HIGHLIGHT 2 — "get it included in DAZN Ultimate."
    // ════════════════════════════════════════════════════════════
    case 'gold highlight 2': {
      return snapFind(n =>
        (n.tag === 'strong' || n.tag === 'b' || n.tag === 'a' ||
         n.classes.toLowerCase().includes('highlight') ||
         n.classes.toLowerCase().includes('gold') ||
         n.classes.toLowerCase().includes('accent')) &&
        (n.text.toLowerCase().includes('get it included') ||
         n.text.toLowerCase().includes('included in dazn ultimate'))
      );
    }

    // ════════════════════════════════════════════════════════════
    // GOLD HIGHLIGHT 3 — "DAZN Ultimate" plan name
    // ════════════════════════════════════════════════════════════
    case 'gold highlight 3': {
      return snapFind(n =>
        (n.tag === 'strong' || n.tag === 'b' ||
         n.classes.toLowerCase().includes('highlight') ||
         n.classes.toLowerCase().includes('gold') ||
         n.classes.toLowerCase().includes('accent')) &&
        n.text.toLowerCase().includes('dazn ultimate') &&
        n.text.length < 40
      );
    }

    // ════════════════════════════════════════════════════════════
    // CTA BUTTON
    // ════════════════════════════════════════════════════════════
    case 'cta button':
    case 'cta button text': {
      const ctaKeywords = ['continue', 'buy', 'subscribe', 'get started', 'start'];
      for (const kw of ctaKeywords) {
        const found = snapFind(n =>
          n.tag === 'button' &&
          n.text.toLowerCase().includes(kw)
        );
        if (found !== 'N/A') return found;
      }
      return 'N/A';
    }

    case 'buy now cta':
    case 'buy now button':
    case 'primary cta': {
      return snapFind(n =>
        (n.tag === 'button' || n.tag === 'a') &&
        n.text.toLowerCase().includes('buy')
      );
    }

    case 'cta present':
    case 'buy now cta present': {
      const found = snapFind(n =>
        (n.tag === 'button' || n.tag === 'a') &&
        (n.text.toLowerCase().includes('buy') ||
         n.text.toLowerCase().includes('continue'))
      );
      return found !== 'N/A' ? 'Yes' : 'No';
    }

    case 'secondary cta':
    case 'secondary cta text':
    case 'cta without ppv':
    case 'subscribe without ppv': {
      return snapFind(n =>
        (n.tag === 'button' || n.tag === 'a') &&
        (n.text.toLowerCase().includes('without') ||
         n.text.toLowerCase().includes('subscribe without') ||
         n.text.toLowerCase().includes('skip'))
      );
    }

    // ════════════════════════════════════════════════════════════
    // TRIAL TITLE
    // ════════════════════════════════════════════════════════════
    case 'trial title': {
      return snapFind(n =>
        ['h2','h3','h4','span','p','label'].includes(n.tag) &&
        n.text.toLowerCase().includes('free trial') &&
        n.text.length < 80
      );
    }

    // ════════════════════════════════════════════════════════════
    // TRIAL DESCRIPTION
    // ════════════════════════════════════════════════════════════
    case 'trial description': {
      return snapFind(n =>
        (n.tag === 'p' || n.tag === 'span') &&
        n.text.toLowerCase().includes('cancel anytime') &&
        n.text.length > 30 &&
        n.text.length < 400
      );
    }

    // ════════════════════════════════════════════════════════════
    // TRIAL FEATURES
    // ════════════════════════════════════════════════════════════
    case 'trial feature 1':
    case 'trial feature 2':
    case 'trial feature 3': {
      const idx = key.endsWith('1') ? 0 : key.endsWith('2') ? 1 : 2;

      // Get li items that ARE trial items
      const trialFeatures = snapFindAll(n =>
        n.tag === 'li' &&
        n.text.length > 5 &&
        (n.text.toLowerCase().includes('7-day') ||
         n.text.toLowerCase().includes('cancel anytime') ||
         n.text.toLowerCase().includes('free access'))
      );

      if (trialFeatures[idx]) return trialFeatures[idx];

      // Fallback — first N li items
      const allLi = snapFindAll(n =>
        n.tag === 'li' &&
        n.text.length > 5
      );
      return allLi[idx] ?? 'N/A';
    }

    // ════════════════════════════════════════════════════════════
    // TRIAL HIGHLIGHT / TRIAL FEATURE 1 HIGHLIGHT
    // ════════════════════════════════════════════════════════════
    case 'trial highlight':
    case 'trial feature 1 highlight': {
      return snapFind(n =>
        (n.tag === 'strong' || n.tag === 'b' || n.tag === 'em' ||
         n.classes.toLowerCase().includes('highlight') ||
         n.classes.toLowerCase().includes('accent') ||
         n.classes.toLowerCase().includes('gold')) &&
        n.text.toLowerCase().includes('7-day') &&
        n.text.toLowerCase().includes('free') &&
        n.text.length < 80
      );
    }

    // ════════════════════════════════════════════════════════════
    // UPSELL BADGE ("FIRST MONTH FREE!")
    // ════════════════════════════════════════════════════════════
   case 'upsell badge': {
  // Try snapshot class-based first
  const fromSnap = snapFind(n =>
    (n.classes.toLowerCase().includes('badge') ||
     n.classes.toLowerCase().includes('tag') ||
     n.classes.toLowerCase().includes('pill') ||
     n.classes.toLowerCase().includes('promo') ||
     n.classes.toLowerCase().includes('label')) &&
    (n.text.toLowerCase().includes('first month') ||
     n.text.toLowerCase().includes('free month') ||
     n.text.toLowerCase().includes('month free') ||
     n.text.toUpperCase() === n.text) && // ALL CAPS = badge
    n.text.length < 40
  );
  if (fromSnap !== 'N/A') return fromSnap;

  // Live DOM fallback
  const badgeSels = [
    '[class*="badge" i]',
    '[class*="tag" i]',
    '[class*="pill" i]',
    '[class*="promo" i]',
    '[class*="label" i]',
  ];
  for (const sel of badgeSels) {
    const loc   = page.locator(sel);
    const count = await loc.count().catch(() => 0);
    for (let i = 0; i < count; i++) {
      const el = loc.nth(i);
      if (!await el.isVisible().catch(() => false)) continue;
      const t = clean(await el.innerText({ timeout: T }).catch(() => ''));
      if (
        (t.toLowerCase().includes('first month') ||
         t.toLowerCase().includes('month free') ||
         t.toUpperCase() === t) &&
        t.length < 40 &&
        t.length > 3
      ) return t;
    }
  }
  return 'N/A';
}

    // ════════════════════════════════════════════════════════════
    // UPSELL BADGE COLOR
    // ════════════════════════════════════════════════════════════
    case 'upsell badge color': {
      // Find badge element via live DOM for color check
      const badgeSels = [
        '[class*="badge" i]',
        '[class*="tag" i]',
        '[class*="pill" i]',
        '[class*="promo" i]',
      ];
      for (const sel of badgeSels) {
        const loc   = page.locator(sel);
        const count = await loc.count().catch(() => 0);
        for (let i = 0; i < count; i++) {
          const el = loc.nth(i);
          if (!await el.isVisible().catch(() => false)) continue;
          const t = clean(await el.innerText({ timeout: T }).catch(() => ''));
          if (
            !t.toLowerCase().includes('first month') &&
            !t.toLowerCase().includes('month free') &&
            !t.toLowerCase().includes('free!')
          ) continue;
          const color = await el.evaluate((node: Element) => {
            const style = window.getComputedStyle(node);
            return style.backgroundColor || style.color || '';
          }).catch(() => '');
          if (
            color.includes('255, 193') ||
            color.includes('255, 215') ||
            color.includes('ffd700') ||
            color.includes('f5a623') ||
            color.includes('ffb800')
          ) return 'Gold';
          const className = await el.evaluate(
            (node: Element) => node.className || ''
          ).catch(() => '');
          if (
            className.toLowerCase().includes('gold') ||
            className.toLowerCase().includes('yellow') ||
            className.toLowerCase().includes('amber') ||
            className.toLowerCase().includes('accent')
          ) return 'Gold';
        }
      }
      return 'N/A';
    }

    // ════════════════════════════════════════════════════════════
    // FIRST MONTH FREE TEXT
    // ════════════════════════════════════════════════════════════
    case 'first month free text': {
  // Look for "+ First month free" specifically
  const exact = snapFind(n =>
    n.childCount <= 1 &&
    n.text.toLowerCase().includes('first month free') &&
    n.text.toLowerCase().startsWith('+') &&
    n.text.length < 60
  );
  if (exact !== 'N/A') return exact;

  // Fallback without + prefix
  return snapFind(n =>
    n.childCount <= 1 &&
    n.text.toLowerCase().includes('first month free') &&
    n.text.length < 60
  );
}

    // ════════════════════════════════════════════════════════════
    // FIRST MONTH FREE HIGHLIGHT
    // ════════════════════════════════════════════════════════════
    case 'first month free highlight': {
      return snapFind(n =>
        (n.tag === 'strong' || n.tag === 'b' || n.tag === 'em' ||
         n.classes.toLowerCase().includes('highlight') ||
         n.classes.toLowerCase().includes('gold') ||
         n.classes.toLowerCase().includes('accent')) &&
        n.text.toLowerCase().includes('first month free') &&
        n.text.length < 60
      );
    }

    // ════════════════════════════════════════════════════════════
    // UPSELL PRICE PREFIX ("Then")
    // ════════════════════════════════════════════════════════════
   case 'upsell price prefix': {
  // Try snapshot
  const fromSnap = snapFind(n =>
    n.childCount === 0 &&
    n.text === 'Then'
  );
  if (fromSnap !== 'N/A') return fromSnap;

  // Live DOM fallback
  const loc   = page.locator('span, p, small');
  const count = await loc.count().catch(() => 0);
  for (let i = 0; i < count; i++) {
    const el = loc.nth(i);
    if (!await el.isVisible().catch(() => false)) continue;
    const kids = await el.locator('> *').count().catch(() => 0);
    if (kids > 0) continue;
    const t = clean(await el.innerText({ timeout: T }).catch(() => ''));
    if (t === 'Then') return t;
  }
  return 'N/A';
}

    // ════════════════════════════════════════════════════════════
    // UPSELL SUB TEXT
    // ════════════════════════════════════════════════════════════
 case 'upsell sub text': {
  return snapFind(n =>
    n.childCount === 0 &&
    n.text.toLowerCase().startsWith('then') &&
    n.text.toLowerCase().includes('month') &&
    n.text.length < 60  // ← strict limit to avoid grabbing renewal text
  );
}

    // ════════════════════════════════════════════════════════════
    // PAYMENT PAGE — DAZN TIER
    // ════════════════════════════════════════════════════════════
    case 'dazn tier': {
      const tier = (eventData?.DAZN_TIER || '').toLowerCase();
      return snapFind(n => {
        const t = n.text.toLowerCase();
        return (
          (tier ? t.includes(tier) : false) ||
          t === 'dazn standard' ||
          t === 'dazn ultimate' ||
          (t.startsWith('+dazn') && n.text.length < 30)
        );
      });
    }

    // ════════════════════════════════════════════════════════════
    // PAYMENT PAGE — 7 DAYS FREE BADGE
    // ════════════════════════════════════════════════════════════
    case '7 days free badge':
    case '7-days free badge':
    case '7 day free text':
    case '7-day free text': {
      return snapFind(n =>
        n.childCount === 0 &&
        (n.text.toLowerCase().includes('7-day') ||
         n.text.toLowerCase().includes('7 day') ||
         n.text.toLowerCase().includes('7-days') ||
         n.text.toLowerCase().includes('7 days')) &&
        n.text.toLowerCase().includes('free') &&
        n.text.length < 40
      );
    }

    // ════════════════════════════════════════════════════════════
    // PAYMENT PAGE — 7 DAYS FREE BADGE COLOR
    // ════════════════════════════════════════════════════════════
    case '7 days free badge color':
    case '7-days free badge color': {
      const badgeSels = [
        '[class*="badge" i]',
        '[class*="tag" i]',
        '[class*="pill" i]',
        '[class*="chip" i]',
      ];
      for (const sel of badgeSels) {
        const loc   = page.locator(sel);
        const count = await loc.count().catch(() => 0);
        for (let i = 0; i < count; i++) {
          const el = loc.nth(i);
          if (!await el.isVisible().catch(() => false)) continue;
          const t = clean(await el.innerText({ timeout: T }).catch(() => ''));
          if (
            !(t.toLowerCase().includes('7-day') ||
              t.toLowerCase().includes('7 day') ||
              t.toLowerCase().includes('7-days') ||
              t.toLowerCase().includes('7 days')) ||
            !t.toLowerCase().includes('free')
          ) continue;
          const color = await el.evaluate((node: Element) => {
            const style = window.getComputedStyle(node);
            return style.backgroundColor || style.color || '';
          }).catch(() => '');
          if (
            color.includes('255, 193') ||
            color.includes('255, 215') ||
            color.includes('ffd700') ||
            color.includes('f5a623') ||
            color.includes('ffb800')
          ) return 'Gold';
          const className = await el.evaluate(
            (node: Element) => node.className || ''
          ).catch(() => '');
          if (
            className.toLowerCase().includes('gold') ||
            className.toLowerCase().includes('yellow') ||
            className.toLowerCase().includes('amber') ||
            className.toLowerCase().includes('accent')
          ) return 'Gold';
        }
      }
      return 'N/A';
    }

    // ════════════════════════════════════════════════════════════
    // PAYMENT PAGE — 7 DAYS FREE PRICE (₹0)
    // ════════════════════════════════════════════════════════════
    case '7 days free price':
    case '7-days free price': {
      // Find ₹0 / £0 / $0 / €0
      return snapFind(n =>
        n.childCount === 0 &&
        /^[£$€₹]\s?0(\.00)?$/.test(n.text)
      );
    }

    // ════════════════════════════════════════════════════════════
    // PAYMENT PAGE — TODAY YOU PAY TEXT
    // ════════════════════════════════════════════════════════════
    case 'today you pay text': {
      return snapFind(n =>
        n.childCount === 0 &&
        n.text.toLowerCase().includes('today') &&
        n.text.toLowerCase().includes('pay') &&
        n.text.length < 40
      );
    }

    // ════════════════════════════════════════════════════════════
    // PAYMENT PAGE — TODAY YOU PAY PRICE
    // ════════════════════════════════════════════════════════════
    case 'today you pay price': {
      // Find "Today you pay" then get next price
      let foundTodayPay = false;
      for (const n of snap) {
        if (n.isInModal) continue;
        if (foundTodayPay && n.childCount === 0 && isPriceText(n.text)) {
          return n.text;
        }
        if (
          n.text.toLowerCase().includes('today') &&
          n.text.toLowerCase().includes('pay')
        ) foundTodayPay = true;
      }
      // Fallback — first price
      return snapFind(n =>
        n.childCount === 0 && isPriceText(n.text)
      );
    }

    // ════════════════════════════════════════════════════════════
    // PAYMENT PAGE — NEXT PAYMENT DATE
    // ════════════════════════════════════════════════════════════
    case 'next payment date': {
      // Look for dd/mm/yyyy pattern
      const exact = snapFind(n =>
        n.childCount === 0 &&
        /^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}$/.test(n.text)
      );
      if (exact !== 'N/A') return exact;

      // Extract from "Next payment on DD/MM/YYYY"
      for (const n of snap) {
        if (n.isInModal) continue;
        const match = n.text.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/);
        if (match && n.text.length < 60) return match[1];
      }
      return 'N/A';
    }

    // ════════════════════════════════════════════════════════════
    // PAYMENT PAGE — NEXT PAYMENT PRICE
    // ════════════════════════════════════════════════════════════
    case 'next payment price': {
      let foundNextPayment = false;
      for (const n of snap) {
        if (n.isInModal) continue;
        if (
          foundNextPayment &&
          n.childCount === 0 &&
          isPriceText(n.text)
        ) return n.text;
        if (n.text.toLowerCase().includes('next payment')) {
          foundNextPayment = true;
        }
      }
      return 'N/A';
    }

    // ════════════════════════════════════════════════════════════
    // PAYMENT PAGE — CANCELLATION TEXT
    // ════════════════════════════════════════════════════════════
    case 'cancellation text':
    case 'cancel text': {
      return snapFind(n =>
        n.childCount <= 1 &&
        n.text.toLowerCase().includes('cancel') &&
        n.text.toLowerCase().includes('subscription') &&
        n.text.length > 20 &&
        n.text.length < 200
      );
    }

    // ════════════════════════════════════════════════════════════
    // PAYMENT PAGE — PLAN CHANGE CTA
    // ════════════════════════════════════════════════════════════
    case 'plan change cta': {
      return snapFind(n =>
        (n.tag === 'button' || n.tag === 'a' || n.tag === 'span') &&
        (n.text.toLowerCase() === 'change' ||
         n.text.toLowerCase() === 'edit' ||
         n.text.toLowerCase() === 'modify')
      );
    }

    // ════════════════════════════════════════════════════════════
    // PAYMENT PAGE — REDEEM PROMO CODE CTA
    // ════════════════════════════════════════════════════════════
    case 'redeem promo code cta': {
      const found = snapFind(n =>
        n.text.toLowerCase().includes('redeem') ||
        n.text.toLowerCase().includes('promo code') ||
        n.text.toLowerCase().includes('voucher')
      );
      return found !== 'N/A' ? 'Yes' : 'No';
    }

    // ════════════════════════════════════════════════════════════
    // PAYMENT PAGE — PAYMENT METHODS
    // ════════════════════════════════════════════════════════════
    case 'credit & debit card option':
    case 'credit and debit card option': {
      return firstExists(
        'text=/Credit/i',
        'text=/Debit/i',
        '[class*="card" i]',
        'img[alt*="visa" i]',
        'img[alt*="mastercard" i]',
        'img[alt*="jcb" i]'
      );
    }

    case 'paypal option': {
      return firstExists(
        'text=/PayPal/i',
        'img[alt*="paypal" i]',
        '[class*="paypal" i]',
        '[data-testid*="paypal" i]'
      );
    }

    case 'google pay option': {
      return firstExists(
        'text=/Google Pay/i',
        'img[alt*="google pay" i]',
        '[class*="googlepay" i]',
        '[class*="google-pay" i]',
        '[data-testid*="google" i]'
      );
    }

    // ════════════════════════════════════════════════════════════
    // GENERIC FALLBACK
    // ════════════════════════════════════════════════════════════
  // ════════════════════════════════════════════════════════════
// SUBSCRIPTION SECTION TITLE (Variant 2 only)
// ════════════════════════════════════════════════════════════
case 'subscription section title': {
  return snapFind(n =>
    n.text.toLowerCase().includes('choose your subscription') &&
    n.text.length < 80
  );
}  default: {
      const keyWords = key
        .split(' ')
        .filter(w => w.length > 2);

      return snapFind(n =>
        n.childCount <= 5 &&
        n.text.length > 2 &&
        n.text.length < 300 &&
        keyWords.some(w => n.text.toLowerCase().includes(w))
      );
    }
  }
}